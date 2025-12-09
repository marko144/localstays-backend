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
  /** Availability DynamoDB table */
  availabilityTable: dynamodb.Table;
  /** Subscription Plans DynamoDB table */
  subscriptionPlansTable: dynamodb.Table;
  /** Advertising Slots DynamoDB table */
  advertisingSlotsTable: dynamodb.Table;
  /** S3 bucket for host assets */
  bucket: s3.Bucket;
  /** Email templates DynamoDB table */
  emailTemplatesTable: dynamodb.Table;
  /** Rate limit DynamoDB table */
  rateLimitTable: dynamodb.Table;
  /** SSM parameter name for SendGrid API key */
  sendGridParamName: string;
  /** CloudFront distribution domain name (optional) */
  cloudFrontDomain?: string;
  /** Frontend URL for deep links in notifications */
  frontendUrl: string;
  /** Legal Documents table */
  legalDocumentsTable: dynamodb.Table;
  /** Legal Acceptances table */
  legalAcceptancesTable: dynamodb.Table;
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
  public readonly customerPortalLambda: nodejs.NodejsFunction;
  public readonly hostListingsHandlerLambda: nodejs.NodejsFunction;
  public readonly publishListingLambda: nodejs.NodejsFunction;
  public readonly hostRequestsHandlerLambda: nodejs.NodejsFunction;
  public readonly hostAvailabilityHandlerLambda: nodejs.NodejsFunction;
  public readonly subscribeNotificationLambda: nodejs.NodejsFunction;
  public readonly unsubscribeNotificationLambda: nodejs.NodejsFunction;
  public readonly checkNotificationStatusLambda: nodejs.NodejsFunction;
  public readonly stripeHandlerLambda: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: HostApiStackProps) {
    super(scope, id, props);

    const { 
      stage, 
      userPoolId, 
      userPoolArn, 
      table, 
      bucket, 
      emailTemplatesTable, 
      rateLimitTable,
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
          ? ['https://portal.localstays.me']
          : [
              'http://localhost:3000',
              'http://192.168.4.54:3000',
              'https://staging.portal.localstays.me',
            ],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: true,
      },
      
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      
      cloudWatchRole: true,
    });

    // CORS headers for gateway responses
    // Using '*' for error responses is safe since these are error cases
    // The actual CORS preflight is handled by defaultCorsPreflightOptions above
    const corsHeaders = {
      'Access-Control-Allow-Origin': "'*'",
      'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
      'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,PATCH,OPTIONS'",
      'Access-Control-Allow-Credentials': "'true'",
    };

    // Add Gateway Responses for CORS on errors (especially 401 from authorizer)
    // This ensures CORS headers are returned even when the authorizer fails
    this.api.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      statusCode: '401',
      responseHeaders: corsHeaders,
    });

    this.api.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      statusCode: '403',
      responseHeaders: corsHeaders,
    });

    this.api.addGatewayResponse('Default4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: corsHeaders,
    });

    this.api.addGatewayResponse('Default5XX', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: corsHeaders,
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
      AVAILABILITY_TABLE_NAME: props.availabilityTable.tableName,
      SUBSCRIPTION_PLANS_TABLE_NAME: props.subscriptionPlansTable.tableName,
      ADVERTISING_SLOTS_TABLE_NAME: props.advertisingSlotsTable.tableName,
      BUCKET_NAME: bucket.bucketName,
      EMAIL_TEMPLATES_TABLE: emailTemplatesTable.tableName,
      RATE_LIMIT_TABLE_NAME: rateLimitTable.tableName,
      SENDGRID_PARAM: sendGridParamName,
      FROM_EMAIL: 'hello@localstays.me', // Same verified SendGrid sender as auth emails
      FRONTEND_URL: frontendUrl, // For deep links in notifications
      STAGE: stage,
      CLOUDFRONT_DOMAIN: props.cloudFrontDomain || '',
      USE_CLOUDFRONT: props.cloudFrontDomain ? 'true' : 'false',
      // Review compensation is controlled via SSM Parameter: /localstays/{stage}/config/review-compensation-enabled
    };

    // Common Lambda configuration
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'es2022',
        externalModules: ['@aws-sdk/*'], // Only AWS SDK is external (available in Lambda runtime)
      },
    };
    
    // Log retention configuration (applied per Lambda)
    const logRetentionDays = stage === 'prod' 
      ? logs.RetentionDays.ONE_MONTH 
      : logs.RetentionDays.ONE_WEEK;
    const logRemovalPolicy = stage === 'prod' 
      ? cdk.RemovalPolicy.RETAIN 
      : cdk.RemovalPolicy.DESTROY;

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
      logGroup: new logs.LogGroup(this, 'HostProfileHandlerLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-host-profile-handler`,
        retention: logRetentionDays,
        removalPolicy: logRemovalPolicy,
      }),
    });

    // Grant DynamoDB permissions (read + write for all operations)
    table.grantReadWriteData(this.hostProfileHandlerLambda);
    emailTemplatesTable.grantReadData(this.hostProfileHandlerLambda); // For confirm-submission emails
    rateLimitTable.grantReadWriteData(this.hostProfileHandlerLambda); // For write operation rate limiting

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
    // HOST LEGAL LAMBDA
    // ========================================
    // Handles legal status and acceptance endpoints
    const hostLegalHandlerLambda = new nodejs.NodejsFunction(this, 'HostLegalHandlerLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-host-legal-handler`,
      entry: 'backend/services/api/hosts/legal-handler.ts',
      handler: 'handler',
      description: 'Host: Legal status and acceptance operations',
      environment: {
        ...commonEnvironment,
        LEGAL_DOCUMENTS_TABLE_NAME: props.legalDocumentsTable.tableName,
        LEGAL_ACCEPTANCES_TABLE_NAME: props.legalAcceptancesTable.tableName,
      },
      logGroup: new logs.LogGroup(this, 'HostLegalHandlerLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-host-legal-handler`,
        retention: logRetentionDays,
        removalPolicy: logRemovalPolicy,
      }),
    });

    // Grant DynamoDB permissions
    table.grantReadWriteData(hostLegalHandlerLambda); // For updating host record
    props.legalDocumentsTable.grantReadData(hostLegalHandlerLambda);
    props.legalAcceptancesTable.grantReadWriteData(hostLegalHandlerLambda);

    // ========================================
    // Get Subscription Lambda
    // ========================================
    this.getSubscriptionLambda = new nodejs.NodejsFunction(this, 'GetSubscriptionLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-get-subscription`,
      entry: 'backend/services/api/hosts/get-subscription.ts',
      handler: 'handler',
      description: 'Retrieve host subscription details and entitlements',
      environment: {
        ...commonEnvironment,
        STAGE: stage,
      },
      logGroup: new logs.LogGroup(this, 'GetSubscriptionLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-get-subscription`,
        retention: logRetentionDays,
        removalPolicy: logRemovalPolicy,
      }),
    });

    // Grant DynamoDB permissions (read-only)
    table.grantReadData(this.getSubscriptionLambda);
    props.subscriptionPlansTable.grantReadData(this.getSubscriptionLambda);
    props.advertisingSlotsTable.grantReadData(this.getSubscriptionLambda);

    // Grant SSM permissions for subscriptions-enabled config
    this.getSubscriptionLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/config/subscriptions-enabled`,
      ],
    }));

    // ========================================
    // Customer Portal Session Lambda
    // ========================================
    this.customerPortalLambda = new nodejs.NodejsFunction(this, 'CustomerPortalLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-customer-portal`,
      entry: 'backend/services/api/hosts/create-customer-portal-session.ts',
      handler: 'handler',
      description: 'Create Stripe Customer Portal session for subscription management',
      environment: {
        ...commonEnvironment,
        FRONTEND_URL: props.frontendUrl,
        STAGE: stage,
      },
      logGroup: new logs.LogGroup(this, 'CustomerPortalLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-customer-portal`,
        retention: logRetentionDays,
        removalPolicy: logRemovalPolicy,
      }),
    });

    // Grant DynamoDB permissions (read-only - just needs to look up subscription)
    table.grantReadData(this.customerPortalLambda);

    // Grant SSM permissions to read Stripe secret key
    this.customerPortalLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/stripe/secret-key`],
    }));

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
      logGroup: new logs.LogGroup(this, 'HostListingsHandlerLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-host-listings-handler`,
        retention: logRetentionDays,
        removalPolicy: logRemovalPolicy,
      }),
    });

    // Grant DynamoDB permissions (read + write for all operations)
    table.grantReadWriteData(this.hostListingsHandlerLambda);
    props.publicListingsTable.grantWriteData(this.hostListingsHandlerLambda); // For syncing updates to PublicListings
    props.advertisingSlotsTable.grantReadWriteData(this.hostListingsHandlerLambda); // For reading/updating slot info on listing details
    rateLimitTable.grantReadWriteData(this.hostListingsHandlerLambda); // For write operation rate limiting

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
      logGroup: new logs.LogGroup(this, 'PublishListingLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-publish-listing`,
        retention: logRetentionDays,
        removalPolicy: logRemovalPolicy,
      }),
    });

    // Grant DynamoDB permissions (least privilege)
    table.grantReadWriteData(this.publishListingLambda); // Main table (read listing, update status)
    props.locationsTable.grantReadWriteData(this.publishListingLambda); // Locations table (check/create location, increment count)
    props.publicListingsTable.grantWriteData(this.publishListingLambda); // PublicListings table (write only)
    props.publicListingMediaTable.grantWriteData(this.publishListingLambda); // PublicListingMedia table (write only)
    props.subscriptionPlansTable.grantReadData(this.publishListingLambda); // SubscriptionPlans table (read for plan info)
    props.advertisingSlotsTable.grantReadWriteData(this.publishListingLambda); // AdvertisingSlots table (create slots)

    // Grant SSM permission for review compensation config
    this.publishListingLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/config/review-compensation-enabled`,
      ],
    }));

    // ========================================
    // HOST AVAILABILITY HANDLER LAMBDA (CONSOLIDATED)
    // ========================================
    this.hostAvailabilityHandlerLambda = new nodejs.NodejsFunction(this, 'HostAvailabilityHandlerLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-host-availability-handler`,
      entry: 'backend/services/api/availability/availability-handler.ts',
      handler: 'handler',
      description: 'Consolidated: Host availability operations (get host availability, get listing availability, block dates, unblock dates)',
      environment: commonEnvironment,
      logGroup: new logs.LogGroup(this, 'HostAvailabilityHandlerLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-host-availability-handler`,
        retention: logRetentionDays,
        removalPolicy: logRemovalPolicy,
      }),
    });

    // Grant DynamoDB permissions
    table.grantReadData(this.hostAvailabilityHandlerLambda); // Main table (read for listing ownership verification)
    props.availabilityTable.grantReadWriteData(this.hostAvailabilityHandlerLambda); // Availability table (full CRUD)

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
      logGroup: new logs.LogGroup(this, 'HostRequestsHandlerLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-host-requests-handler`,
        retention: logRetentionDays,
        removalPolicy: logRemovalPolicy,
      }),
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
      logGroup: new logs.LogGroup(this, 'SubscribeNotificationLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-subscribe-notification`,
        retention: logRetentionDays,
        removalPolicy: logRemovalPolicy,
      }),
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
      logGroup: new logs.LogGroup(this, 'UnsubscribeNotificationLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-unsubscribe-notification`,
        retention: logRetentionDays,
        removalPolicy: logRemovalPolicy,
      }),
    });

    // Check notification status for a device
    this.checkNotificationStatusLambda = new nodejs.NodejsFunction(this, 'CheckNotificationStatusLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-check-notification-status`,
      entry: 'backend/services/api/notifications/check-status.ts',
      handler: 'handler',
      description: 'Check notification status for a specific device',
      environment: {
        ...commonEnvironment,
        STAGE: stage,
      },
      logGroup: new logs.LogGroup(this, 'CheckNotificationStatusLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-check-notification-status`,
        retention: logRetentionDays,
        removalPolicy: logRemovalPolicy,
      }),
    });

    // Grant DynamoDB permissions for notification lambdas
    table.grantReadWriteData(this.subscribeNotificationLambda);
    table.grantReadWriteData(this.unsubscribeNotificationLambda);
    table.grantReadData(this.checkNotificationStatusLambda);

    // Grant SSM parameter access for VAPID keys
    const vapidPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/vapid/*`],
    });

    this.subscribeNotificationLambda.addToRolePolicy(vapidPolicyStatement);

    // ========================================
    // STRIPE HANDLER LAMBDA
    // ========================================
    this.stripeHandlerLambda = new nodejs.NodejsFunction(this, 'StripeHandlerLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-stripe-handler`,
      entry: 'backend/services/api/hosts/stripe-handler.ts',
      handler: 'handler',
      description: 'Stripe operations: fetch prices, create checkout sessions',
      environment: {
        ...commonEnvironment,
        SUBSCRIPTION_PLANS_TABLE_NAME: props.subscriptionPlansTable.tableName,
        FRONTEND_URL: frontendUrl,
        STAGE: stage,
      },
      logGroup: new logs.LogGroup(this, 'StripeHandlerLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-stripe-handler`,
        retention: logRetentionDays,
        removalPolicy: logRemovalPolicy,
      }),
    });

    // Grant DynamoDB permissions
    table.grantReadData(this.stripeHandlerLambda); // For host profile lookup
    props.subscriptionPlansTable.grantReadData(this.stripeHandlerLambda); // For prices lookup

    // Grant SSM permissions to read Stripe secret key and config parameters
    this.stripeHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/stripe/secret-key`,
        `arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/config/trial-days`,
        `arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/config/subscriptions-enabled`,
      ],
    }));

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
    // API Gateway Routes - Legal
    // ========================================
    const legalResource = hostIdParam.addResource('legal');

    // GET /api/v1/hosts/{hostId}/legal/status
    const legalStatusResource = legalResource.addResource('status');
    legalStatusResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(hostLegalHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /api/v1/hosts/{hostId}/legal/accept
    const legalAcceptResource = legalResource.addResource('accept');
    legalAcceptResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(hostLegalHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
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

    // POST /api/v1/hosts/{hostId}/subscription/customer-portal
    const customerPortalResource = subscriptionResource.addResource('customer-portal');
    customerPortalResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.customerPortalLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // API Gateway Routes - Stripe
    // ========================================

    // /api/v1/hosts/{hostId}/stripe
    const stripeResource = hostIdParam.addResource('stripe');

    // GET /api/v1/hosts/{hostId}/stripe/prices
    const stripePricesResource = stripeResource.addResource('prices');
    stripePricesResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.stripeHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /api/v1/hosts/{hostId}/stripe/checkout-session
    const stripeCheckoutResource = stripeResource.addResource('checkout-session');
    stripeCheckoutResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.stripeHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
        },
      }
    );

    // ========================================
    // API Gateway Routes - Availability (Host-Level)
    // ========================================

    // GET /api/v1/hosts/{hostId}/availability
    const hostAvailabilityResource = hostIdParam.addResource('availability');
    hostAvailabilityResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.hostAvailabilityHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // API Gateway Routes - Listings
    // ========================================

    // GET /api/v1/listings/metadata (authenticated - hosts only)
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

    // GET /api/v1/hosts/{hostId}/listings/{listingId}/availability
    const listingAvailabilityResource = listingIdParam.addResource('availability');
    listingAvailabilityResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.hostAvailabilityHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /api/v1/hosts/{hostId}/listings/{listingId}/availability/block
    const blockAvailabilityResource = listingAvailabilityResource.addResource('block');
    blockAvailabilityResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.hostAvailabilityHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
        },
      }
    );

    // DELETE /api/v1/hosts/{hostId}/listings/{listingId}/availability/unblock
    const unblockAvailabilityResource = listingAvailabilityResource.addResource('unblock');
    unblockAvailabilityResource.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(this.hostAvailabilityHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
        },
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

    // PUT /api/v1/hosts/{hostId}/listings/{listingId}/slot/do-not-renew
    const slotResource = listingIdParam.addResource('slot');
    const doNotRenewResource = slotResource.addResource('do-not-renew');
    doNotRenewResource.addMethod(
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

    // POST /api/v1/notifications/status
    const statusResource = notificationsResource.addResource('status');
    statusResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.checkNotificationStatusLambda, { proxy: true }),
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

