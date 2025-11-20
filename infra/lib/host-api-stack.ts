import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Properties for HostApiStack
 */
export interface HostApiStackProps extends cdk.StackProps {
  /** Environment stage (dev, dev1, staging, prod) */
  stage: string;
  /** Cognito User Pool ID for authorizer */
  userPoolId: string;
  /** Cognito User Pool ARN for authorizer */
  userPoolArn: string;
  /** DynamoDB table */
  table: dynamodb.Table;
  /** Locations DynamoDB table */
  locationsTable: dynamodb.Table;
  /** Public Listings DynamoDB table */
  publicListingsTable: dynamodb.Table;
  /** Public Listing Media DynamoDB table */
  publicListingMediaTable: dynamodb.Table;
  /** S3 bucket for host assets */
  bucket: s3.Bucket;
  /** Email templates DynamoDB table */
  emailTemplatesTable: dynamodb.Table;
  /** SSM parameter name for SendGrid API key */
  sendGridParamName: string;
  /** CloudFront distribution domain name (optional) */
  cloudFrontDomain?: string;
  /** Frontend URL for deep links in notifications */
  frontendUrl: string;
}

/**
 * HostApiStack - Host-Facing API
 * 
 * Contains API Gateway and Lambda functions for host operations:
 * - Profile management (submit-intent, confirm-submission, update-rejected, get-profile)
 * - Subscription management
 * - Listing management (CRUD operations, images, pricing)
 * - Request management (verification, video uploads)
 * - Notification management (subscribe, unsubscribe, list)
 */
export class HostApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;
  
  // Lambda functions
  public readonly hostProfileHandlerLambda: nodejs.NodejsFunction;
  public readonly getSubscriptionLambda: nodejs.NodejsFunction;
  public readonly hostListingsHandlerLambda: nodejs.NodejsFunction;
  public readonly publishListingLambda: nodejs.NodejsFunction;
  public readonly unpublishListingLambda: nodejs.NodejsFunction;
  public readonly hostRequestsHandlerLambda: nodejs.NodejsFunction;
  public readonly subscribeNotificationLambda: nodejs.NodejsFunction;
  public readonly unsubscribeNotificationLambda: nodejs.NodejsFunction;
  public readonly listSubscriptionsLambda: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: HostApiStackProps) {
    super(scope, id, props);

    const { 
      stage, 
      userPoolId, 
      userPoolArn, 
      table, 
      bucket, 
      emailTemplatesTable, 
      sendGridParamName, 
      frontendUrl,
    } = props;

    // ========================================
    // API Gateway Setup
    // ========================================

    // Import existing User Pool
    const userPool = cognito.UserPool.fromUserPoolArn(
      this,
      'UserPool',
      userPoolArn
    );

    // Create CloudWatch Log Group for API Gateway logs
    const apiLogGroup = new logs.LogGroup(this, 'HostApiGatewayLogs', {
      logGroupName: `/aws/apigateway/localstays-${stage}-host-api`,
      retention: stage === 'prod' 
        ? logs.RetentionDays.ONE_YEAR 
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Create REST API (Host API)
    this.api = new apigateway.RestApi(this, 'HostApi', {
      restApiName: `localstays-${stage}-host-api`,
      description: `Localstays Host API (${stage}) - Host-facing endpoints`,
      
      deploy: true,
      deployOptions: {
        stageName: stage,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        throttlingRateLimit: stage === 'prod' ? 1000 : 100,
        throttlingBurstLimit: stage === 'prod' ? 2000 : 200,
      },
      
      defaultCorsPreflightOptions: {
        allowOrigins: stage === 'prod' 
          ? ['https://app.localstays.com']
          : apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: true,
      },
      
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      
      cloudWatchRole: true,
    });

    // Add Gateway Responses for CORS on errors (especially 401 from authorizer)
    // This ensures CORS headers are returned even when the authorizer fails
    this.api.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      statusCode: '401',
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    this.api.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      statusCode: '403',
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    this.api.addGatewayResponse('Default4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    this.api.addGatewayResponse('Default5XX', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    // Create Cognito authorizer
    this.authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'HostCognitoAuthorizer',
      {
        cognitoUserPools: [userPool],
        authorizerName: `localstays-${stage}-host-authorizer`,
        identitySource: 'method.request.header.Authorization',
        resultsCacheTtl: cdk.Duration.minutes(5),
      }
    );

    // ========================================
    // Lambda Functions Setup
    // ========================================

    // Common environment variables for all Lambda functions
    const commonEnvironment = {
      TABLE_NAME: table.tableName,
      LOCATIONS_TABLE_NAME: props.locationsTable.tableName,
      PUBLIC_LISTINGS_TABLE_NAME: props.publicListingsTable.tableName,
      PUBLIC_LISTING_MEDIA_TABLE_NAME: props.publicListingMediaTable.tableName,
      BUCKET_NAME: bucket.bucketName,
      EMAIL_TEMPLATES_TABLE: emailTemplatesTable.tableName,
      SENDGRID_PARAM: sendGridParamName,
      FROM_EMAIL: 'marko@localstays.me', // Same verified SendGrid sender as auth emails
      FRONTEND_URL: frontendUrl, // For deep links in notifications
      STAGE: stage,
      CLOUDFRONT_DOMAIN: props.cloudFrontDomain || '',
      USE_CLOUDFRONT: props.cloudFrontDomain ? 'true' : 'false',
    };

    // Common Lambda configuration
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'es2022',
        externalModules: ['@aws-sdk/*'], // Only AWS SDK is external (available in Lambda runtime)
      },
      logRetention: stage === 'prod' 
        ? logs.RetentionDays.ONE_MONTH 
        : logs.RetentionDays.ONE_WEEK,
    };

    // ========================================
    // HOST PROFILE LAMBDA (CONSOLIDATED)
    // ========================================
    this.hostProfileHandlerLambda = new nodejs.NodejsFunction(this, 'HostProfileHandlerLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-host-profile-handler`,
      entry: 'backend/services/api/hosts/handler.ts',
      handler: 'handler',
      description: 'Consolidated: Host profile operations (submit-intent, confirm-submission, update-rejected, get-profile)',
      environment: commonEnvironment,
    });

    // Grant DynamoDB permissions (read + write for all operations)
    table.grantReadWriteData(this.hostProfileHandlerLambda);
    emailTemplatesTable.grantReadData(this.hostProfileHandlerLambda); // For confirm-submission emails

    // Grant S3 permissions (for pre-signed URLs and verification)
    this.hostProfileHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:PutObject',      // For generating pre-signed PUT URLs
        's3:HeadObject',     // For verifying object exists (confirm-submission)
        's3:GetObject',      // For future document validation
      ],
      resources: [
        `${bucket.bucketArn}/*`,
      ],
    }));

    // Grant SSM permissions for SendGrid API key (for confirm-submission emails)
    this.hostProfileHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`,
      ],
    }));

    // ========================================
    // Get Subscription Lambda
    // ========================================
    this.getSubscriptionLambda = new nodejs.NodejsFunction(this, 'GetSubscriptionLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-get-subscription`,
      entry: 'backend/services/api/hosts/get-subscription.ts',
      handler: 'handler',
      description: 'Retrieve host subscription details and entitlements',
      environment: commonEnvironment,
    });

    // Grant DynamoDB permissions (read-only)
    table.grantReadData(this.getSubscriptionLambda);

    // ========================================
    // HOST LISTINGS HANDLER LAMBDA (CONSOLIDATED)
    // ========================================
    this.hostListingsHandlerLambda = new nodejs.NodejsFunction(this, 'HostListingsHandlerLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-host-listings-handler`,
      entry: 'backend/services/api/listings/handler.ts',
      handler: 'handler',
      description: 'Consolidated: Host listings operations (get-metadata, submit-intent, confirm-submission, list, get, delete)',
      environment: commonEnvironment,
    });

    // Grant DynamoDB permissions (read + write for all operations)
    table.grantReadWriteData(this.hostListingsHandlerLambda);
    props.publicListingsTable.grantWriteData(this.hostListingsHandlerLambda); // For syncing updates to PublicListings

    // Grant S3 permissions (for pre-signed URLs and verification)
    this.hostListingsHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:PutObject',      // For generating pre-signed PUT URLs (submit-intent)
        's3:HeadObject',     // For verifying object exists (confirm-submission)
        's3:GetObject',      // For future document validation
      ],
      resources: [
        `${bucket.bucketArn}/*`,
      ],
    }));

    // Grant email permissions (for sending confirmation emails)
    emailTemplatesTable.grantReadData(this.hostListingsHandlerLambda);
    this.hostListingsHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`],
    }));

    // ========================================
    // PUBLISH LISTING LAMBDA
    // ========================================
    this.publishListingLambda = new nodejs.NodejsFunction(this, 'PublishListingLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-publish-listing`,
      entry: 'backend/services/api/listings/publish-listing.ts',
      handler: 'handler',
      description: 'Publish an APPROVED or OFFLINE listing to PublicListings table',
      environment: commonEnvironment,
    });

    // Grant DynamoDB permissions (least privilege)
    table.grantReadWriteData(this.publishListingLambda); // Main table (read listing, update status)
    props.locationsTable.grantReadWriteData(this.publishListingLambda); // Locations table (check/create location, increment count)
    props.publicListingsTable.grantWriteData(this.publishListingLambda); // PublicListings table (write only)
    props.publicListingMediaTable.grantWriteData(this.publishListingLambda); // PublicListingMedia table (write only)

    // ========================================
    // UNPUBLISH LISTING LAMBDA
    // ========================================
    this.unpublishListingLambda = new nodejs.NodejsFunction(this, 'UnpublishListingLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-unpublish-listing`,
      entry: 'backend/services/api/listings/unpublish-listing.ts',
      handler: 'handler',
      description: 'Unpublish an ONLINE listing from PublicListings table',
      environment: commonEnvironment,
    });

    // Grant DynamoDB permissions (least privilege)
    table.grantReadWriteData(this.unpublishListingLambda); // Main table (read listing, update status)
    props.locationsTable.grantWriteData(this.unpublishListingLambda); // Locations table (decrement count only)
    props.publicListingsTable.grantWriteData(this.unpublishListingLambda); // PublicListings table (delete only)
    props.publicListingMediaTable.grantReadWriteData(this.unpublishListingLambda); // PublicListingMedia table (read for query, delete)

    // ========================================
    // HOST REQUESTS HANDLER LAMBDA (CONSOLIDATED)
    // ========================================
    this.hostRequestsHandlerLambda = new nodejs.NodejsFunction(this, 'HostRequestsHandlerLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-host-requests-handler`,
      entry: 'backend/services/api/requests/handler.ts',
      handler: 'handler',
      description: 'Consolidated: Host requests operations (list, get, submit-intent, confirm-submission, video, verification)',
      environment: commonEnvironment,
    });

    // Grant DynamoDB permissions (read + write for all operations)
    table.grantReadWriteData(this.hostRequestsHandlerLambda);

    // Grant S3 permissions (for pre-signed URLs and verification)
    bucket.grantReadWrite(this.hostRequestsHandlerLambda);

    // Grant email templates table read access (for verification code emails)
    emailTemplatesTable.grantReadData(this.hostRequestsHandlerLambda);

    // Grant SSM parameter access (for SendGrid API key)
    this.hostRequestsHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`],
    }));

    // ========================================
    // NOTIFICATION LAMBDAS
    // ========================================

    // Subscribe to push notifications
    this.subscribeNotificationLambda = new nodejs.NodejsFunction(this, 'SubscribeNotificationLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-subscribe-notification`,
      entry: 'backend/services/api/notifications/subscribe.ts',
      handler: 'handler',
      description: 'Subscribe to push notifications',
      environment: {
        ...commonEnvironment,
        STAGE: stage,
      },
    });

    // Unsubscribe from push notifications
    this.unsubscribeNotificationLambda = new nodejs.NodejsFunction(this, 'UnsubscribeNotificationLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-unsubscribe-notification`,
      entry: 'backend/services/api/notifications/unsubscribe.ts',
      handler: 'handler',
      description: 'Unsubscribe from push notifications',
      environment: {
        ...commonEnvironment,
        STAGE: stage,
      },
    });

    // List user's push subscriptions
    this.listSubscriptionsLambda = new nodejs.NodejsFunction(this, 'ListSubscriptionsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-list-subscriptions`,
      entry: 'backend/services/api/notifications/list-subscriptions.ts',
      handler: 'handler',
      description: 'List push subscriptions for authenticated user',
      environment: {
        ...commonEnvironment,
        STAGE: stage,
      },
    });

    // Grant DynamoDB permissions for notification lambdas
    table.grantReadWriteData(this.subscribeNotificationLambda);
    table.grantReadWriteData(this.unsubscribeNotificationLambda);
    table.grantReadData(this.listSubscriptionsLambda);

    // Grant SSM parameter access for VAPID keys
    const vapidPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/vapid/*`],
    });

    this.subscribeNotificationLambda.addToRolePolicy(vapidPolicyStatement);

    // ========================================
    // API Gateway Routes - Host Profile
    // ========================================

    // Create API structure: /api/v1/hosts/{hostId}/profile
    const apiRoot = this.api.root.addResource('api');
    const v1 = apiRoot.addResource('v1');
    const hosts = v1.addResource('hosts');
    const hostIdParam = hosts.addResource('{hostId}');
    const profileResource = hostIdParam.addResource('profile');

    // POST /api/v1/hosts/{hostId}/profile/submit-intent
    const submitIntentResource = profileResource.addResource('submit-intent');
    submitIntentResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.hostProfileHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
          validateRequestParameters: true,
        },
      }
    );

    // POST /api/v1/hosts/{hostId}/profile/confirm-submission
    const confirmSubmissionResource = profileResource.addResource('confirm-submission');
    confirmSubmissionResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.hostProfileHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
          validateRequestParameters: true,
        },
      }
    );

    // PUT /api/v1/hosts/{hostId}/profile/update-rejected
    const updateRejectedResource = profileResource.addResource('update-rejected');
    updateRejectedResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.hostProfileHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
          validateRequestParameters: true,
        },
      }
    );

    // GET /api/v1/hosts/{hostId}/profile
    profileResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.hostProfileHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestParameters: true,
        },
      }
    );

    // ========================================
    // API Gateway Routes - Subscription
    // ========================================

    // GET /api/v1/hosts/{hostId}/subscription
    const subscriptionResource = hostIdParam.addResource('subscription');
    subscriptionResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.getSubscriptionLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // API Gateway Routes - Listings
    // ========================================

    // GET /api/v1/listings/metadata (authenticated - hosts can see unpublished enum values)
    const listingsResource = v1.addResource('listings');
    const metadataResource = listingsResource.addResource('metadata');
    metadataResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.hostListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /api/v1/hosts/{hostId}/listings/submit-intent
    const hostListingsResource = hostIdParam.addResource('listings');
    const submitListingIntentResource = hostListingsResource.addResource('submit-intent');
    submitListingIntentResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.hostListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
          validateRequestParameters: true,
        },
      }
    );

    // GET /api/v1/hosts/{hostId}/listings (list all)
    hostListingsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.hostListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // Listing-specific routes: /api/v1/hosts/{hostId}/listings/{listingId}
    const listingIdParam = hostListingsResource.addResource('{listingId}');

    // GET /api/v1/hosts/{hostId}/listings/{listingId}
    listingIdParam.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.hostListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // DELETE /api/v1/hosts/{hostId}/listings/{listingId}
    listingIdParam.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(this.hostListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /api/v1/hosts/{hostId}/listings/{listingId}/confirm-submission
    const confirmListingSubmissionResource = listingIdParam.addResource('confirm-submission');
    confirmListingSubmissionResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.hostListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
          validateRequestParameters: true,
        },
      }
    );

    // POST /api/v1/hosts/{hostId}/listings/{listingId}/image-update
    const imageUpdateResource = listingIdParam.addResource('image-update');
    imageUpdateResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.hostListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
        },
      }
    );

    // POST /api/v1/hosts/{hostId}/listings/{listingId}/image-update/confirm
    const confirmImageUpdateResource = imageUpdateResource.addResource('confirm');
    confirmImageUpdateResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.hostListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
        },
      }
    );

    // PUT /api/v1/hosts/{hostId}/listings/{listingId}/update
    const updateListingResource = listingIdParam.addResource('update');
    updateListingResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.hostListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
        },
      }
    );

    // POST /api/v1/hosts/{hostId}/listings/{listingId}/resubmit
    const resubmitListingResource = listingIdParam.addResource('resubmit');
    resubmitListingResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.hostListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /api/v1/hosts/{hostId}/listings/{listingId}/publish
    const publishListingResource = listingIdParam.addResource('publish');
    publishListingResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.publishListingLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /api/v1/hosts/{hostId}/listings/{listingId}/unpublish
    const unpublishListingResource = listingIdParam.addResource('unpublish');
    unpublishListingResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.unpublishListingLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/hosts/{hostId}/listings/{listingId}/pricing
    // PUT /api/v1/hosts/{hostId}/listings/{listingId}/pricing
    const pricingResource = listingIdParam.addResource('pricing');
    pricingResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.hostListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );
    pricingResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.hostListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
        },
      }
    );

    // GET /api/v1/hosts/{hostId}/listings/{listingId}/requests
    const listingRequestsResource = listingIdParam.addResource('requests');
    listingRequestsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.hostRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // Listing request-specific routes: /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}
    const listingRequestIdParam = listingRequestsResource.addResource('{requestId}');

    // POST /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/submit-video-intent
    const submitVideoIntentResource = listingRequestIdParam.addResource('submit-video-intent');
    submitVideoIntentResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.hostRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
        },
      }
    );

    // POST /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/confirm-video
    const confirmVideoResource = listingRequestIdParam.addResource('confirm-video');
    confirmVideoResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.hostRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
        },
      }
    );

    // POST /api/v1/hosts/{hostId}/listings/{listingId}/requests/{requestId}/submit-code
    const submitCodeResource = listingRequestIdParam.addResource('submit-code');
    submitCodeResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.hostRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
        },
      }
    );

    // ========================================
    // API Gateway Routes - Requests
    // ========================================

    // GET /api/v1/hosts/{hostId}/requests
    const requestsResource = hostIdParam.addResource('requests');
    requestsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.hostRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/hosts/{hostId}/requests/{requestId}
    const requestIdParam = requestsResource.addResource('{requestId}');
    requestIdParam.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.hostRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /api/v1/hosts/{hostId}/requests/{requestId}/submit-intent
    const submitRequestIntentResource = requestIdParam.addResource('submit-intent');
    submitRequestIntentResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.hostRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
          validateRequestParameters: true,
        },
      }
    );

    // POST /api/v1/hosts/{hostId}/requests/{requestId}/confirm-submission
    const confirmRequestSubmissionResource = requestIdParam.addResource('confirm-submission');
    confirmRequestSubmissionResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.hostRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
          validateRequestParameters: true,
        },
      }
    );

    // ========================================
    // API Gateway Routes - Notifications
    // ========================================

    const notificationsResource = v1.addResource('notifications');

    // POST /api/v1/notifications/subscribe
    const subscribeResource = notificationsResource.addResource('subscribe');
    subscribeResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.subscribeNotificationLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // DELETE /api/v1/notifications/subscribe/{subscriptionId}
    const subscriptionIdParam = subscribeResource.addResource('{subscriptionId}');
    subscriptionIdParam.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(this.unsubscribeNotificationLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/notifications/subscriptions
    const subscriptionsResource = notificationsResource.addResource('subscriptions');
    subscriptionsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.listSubscriptionsLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // Stack Outputs
    // ========================================

    const capitalizedStage = this.capitalize(stage);

    // API Gateway outputs
    new cdk.CfnOutput(this, 'HostApiEndpoint', {
      value: this.api.url,
      description: 'Host API Gateway endpoint URL',
      exportName: `Localstays${capitalizedStage}HostApiEndpoint`,
    });

    new cdk.CfnOutput(this, 'HostApiId', {
      value: this.api.restApiId,
      description: 'Host API Gateway REST API ID',
      exportName: `Localstays${capitalizedStage}HostApiId`,
    });

    // Lambda outputs
    new cdk.CfnOutput(this, 'HostProfileHandlerLambdaName', {
      value: this.hostProfileHandlerLambda.functionName,
      description: 'Host Profile Handler Lambda function name',
      exportName: `Localstays${capitalizedStage}HostProfileHandlerLambda`,
    });

    new cdk.CfnOutput(this, 'HostListingsHandlerLambdaName', {
      value: this.hostListingsHandlerLambda.functionName,
      description: 'Host Listings Handler Lambda function name',
      exportName: `Localstays${capitalizedStage}HostListingsHandlerLambda`,
    });

    // Add tags
    cdk.Tags.of(this).add('Environment', stage);
    cdk.Tags.of(this).add('Project', 'Localstays');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    cdk.Tags.of(this).add('StackType', 'HostApi');
  }

  /**
   * Capitalize first letter of string (for export names)
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

