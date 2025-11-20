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
 * Properties for AdminApiStack
 */
export interface AdminApiStackProps extends cdk.StackProps {
  /** Environment stage (dev, dev1, staging, prod) */
  stage: string;
  /** Cognito User Pool ID for authorizer */
  userPoolId: string;
  /** Cognito User Pool ARN for authorizer */
  userPoolArn: string;
  /** DynamoDB table */
  table: dynamodb.Table;
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
  /** Public listings table */
  publicListingsTable: dynamodb.Table;
  /** Public listing media table */
  publicListingMediaTable: dynamodb.Table;
}

/**
 * AdminApiStack - Admin Dashboard API
 * 
 * Contains API Gateway and Lambda functions for admin operations:
 * - Host management (list, search, approve, reject, suspend, reinstate)
 * - Listing management (list, pending review, set reviewing, approve, reject, suspend)
 * - Request management (list, pending review, create requests, approve, reject)
 * - Admin notifications (send push notifications)
 */
export class AdminApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;
  
  // Lambda functions
  public readonly adminHostsHandlerLambda: nodejs.NodejsFunction;
  public readonly adminListingsHandlerLambda: nodejs.NodejsFunction;
  public readonly adminRequestsHandlerLambda: nodejs.NodejsFunction;
  public readonly sendNotificationLambda: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: AdminApiStackProps) {
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
    const apiLogGroup = new logs.LogGroup(this, 'AdminApiGatewayLogs', {
      logGroupName: `/aws/apigateway/localstays-${stage}-admin-api`,
      retention: stage === 'prod' 
        ? logs.RetentionDays.ONE_YEAR 
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Create REST API (Admin API)
    this.api = new apigateway.RestApi(this, 'AdminApi', {
      restApiName: `localstays-${stage}-admin-api`,
      description: `Localstays Admin API (${stage}) - Admin dashboard endpoints`,
      
      deploy: true,
      deployOptions: {
        stageName: stage,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        // Admin endpoints can have tighter rate limits
        throttlingRateLimit: stage === 'prod' ? 500 : 50,
        throttlingBurstLimit: stage === 'prod' ? 1000 : 100,
      },
      
      defaultCorsPreflightOptions: {
        allowOrigins: stage === 'prod' 
          ? ['https://admin.localstays.com']
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

    // Add Gateway Responses for CORS on errors
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
      'AdminCognitoAuthorizer',
      {
        cognitoUserPools: [userPool],
        authorizerName: `localstays-${stage}-admin-authorizer`,
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
      BUCKET_NAME: bucket.bucketName,
      EMAIL_TEMPLATES_TABLE: emailTemplatesTable.tableName,
      SENDGRID_PARAM: sendGridParamName,
      FROM_EMAIL: 'marko@localstays.me',
      FRONTEND_URL: frontendUrl,
      STAGE: stage,
      CLOUDFRONT_DOMAIN: props.cloudFrontDomain || '',
      USE_CLOUDFRONT: props.cloudFrontDomain ? 'true' : 'false',
      PUBLIC_LISTINGS_TABLE_NAME: props.publicListingsTable.tableName,
      PUBLIC_LISTING_MEDIA_TABLE_NAME: props.publicListingMediaTable.tableName,
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
        externalModules: ['@aws-sdk/*'],
      },
      logRetention: stage === 'prod' 
        ? logs.RetentionDays.ONE_MONTH 
        : logs.RetentionDays.ONE_WEEK,
    };

    // ========================================
    // ADMIN HOST LAMBDA (CONSOLIDATED)
    // ========================================
    // Consolidates 9 operations: list, search, get, list-documents, pending-review, approve, reject, suspend, reinstate

    this.adminHostsHandlerLambda = new nodejs.NodejsFunction(this, 'AdminHostsHandlerLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-hosts-handler`,
      entry: 'backend/services/api/admin/hosts/handler.ts',
      handler: 'handler',
      description: 'Admin: Consolidated handler for all host operations',
      environment: commonEnvironment,
    });
    
    // Grant permissions for all operations
    table.grantReadWriteData(this.adminHostsHandlerLambda);
    bucket.grantRead(this.adminHostsHandlerLambda);
    emailTemplatesTable.grantReadData(this.adminHostsHandlerLambda);
    
    // Grant SSM parameter access for email operations (approve/reject)
    this.adminHostsHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`],
    }));

    // ========================================
    // ADMIN LISTING LAMBDA (CONSOLIDATED)
    // ========================================
    // Consolidates 8 operations: list, pending-review, list-host-listings, get, set-reviewing, approve, reject, suspend

    this.adminListingsHandlerLambda = new nodejs.NodejsFunction(this, 'AdminListingsHandlerLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-listings-handler`,
      entry: 'backend/services/api/admin/listings/handler.ts',
      handler: 'handler',
      description: 'Admin: Consolidated handler for all listing operations',
      environment: commonEnvironment,
    });
    
    // Grant permissions for all operations
    table.grantReadWriteData(this.adminListingsHandlerLambda);
    bucket.grantRead(this.adminListingsHandlerLambda);
    emailTemplatesTable.grantReadData(this.adminListingsHandlerLambda);
    
    // Grant SSM parameter access for email operations (approve/reject)
    this.adminListingsHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`],
    }));

    // Grant SSM parameter access for VAPID keys (push notifications)
    this.adminListingsHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/vapid/publicKey`,
        `arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/vapid/privateKey`,
        `arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/vapid/subject`,
      ],
    }));

    // ========================================
    // ADMIN REQUEST LAMBDA (Consolidated)
    // ========================================

    this.adminRequestsHandlerLambda = new nodejs.NodejsFunction(this, 'AdminRequestsHandlerLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-requests-handler`,
      entry: 'backend/services/api/admin/requests/handler.ts',
      handler: 'handler',
      description: 'Admin: Consolidated handler for all request operations',
      environment: commonEnvironment,
      bundling: {
        ...commonLambdaProps.bundling,
        // Include font files for pdfkit (needed by create-address-verification)
        commandHooks: {
          beforeBundling(inputDir: string, outputDir: string): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            return [
              // Copy AFM fonts to /var/task/data where pdfkit looks for them
              `mkdir -p ${outputDir}/data`,
              `cp -r ${inputDir}/backend/services/lib/fonts/data/* ${outputDir}/data/`,
              // Copy TTF fonts to /var/task/fonts for Unicode support (Serbian Latin)
              `mkdir -p ${outputDir}/fonts`,
              `cp ${inputDir}/backend/services/lib/fonts/*.ttf ${outputDir}/fonts/`,
            ];
          },
          beforeInstall(): string[] {
            return [];
          },
        },
      },
    });
    
    // Grant permissions for all request operations
    table.grantReadWriteData(this.adminRequestsHandlerLambda);
    bucket.grantReadWrite(this.adminRequestsHandlerLambda);
    emailTemplatesTable.grantReadData(this.adminRequestsHandlerLambda);
    props.publicListingsTable.grantReadWriteData(this.adminRequestsHandlerLambda); // For updating PublicListings on image approval
    props.publicListingMediaTable.grantReadWriteData(this.adminRequestsHandlerLambda); // For updating PublicListingMedia on image approval
    this.adminRequestsHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`],
    }));
    // Grant SSM access for VAPID keys (for push notifications)
    this.adminRequestsHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/vapid/*`],
    }));

    // ========================================
    // SEND NOTIFICATION LAMBDA (Admin only)
    // ========================================

    this.sendNotificationLambda = new nodejs.NodejsFunction(this, 'SendNotificationLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-send-notification`,
      entry: 'backend/services/api/admin/notifications/send-notification.ts',
      handler: 'handler',
      description: 'Send push notifications (admin only)',
      environment: {
        ...commonEnvironment,
        STAGE: stage,
      },
    });

    // Grant DynamoDB read permissions (to fetch subscriptions)
    table.grantReadData(this.sendNotificationLambda);

    // Grant SSM parameter access for VAPID keys
    this.sendNotificationLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/vapid/*`],
    }));

    // ========================================
    // API Gateway Routes - Admin
    // ========================================

    const apiRoot = this.api.root.addResource('api');
    const v1 = apiRoot.addResource('v1');
    const adminResource = v1.addResource('admin');

    // ========================================
    // Admin Host Routes
    // ========================================
    const adminHostsResource = adminResource.addResource('hosts');

    // GET /api/v1/admin/hosts
    adminHostsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminHostsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/hosts/search
    const adminHostsSearchResource = adminHostsResource.addResource('search');
    adminHostsSearchResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminHostsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/hosts/pending-review
    const adminPendingReviewHostsResource = adminHostsResource.addResource('pending-review');
    adminPendingReviewHostsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminHostsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/hosts/{hostId}
    const adminHostIdParam = adminHostsResource.addResource('{hostId}');
    adminHostIdParam.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminHostsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/hosts/{hostId}/documents
    const adminHostDocumentsResource = adminHostIdParam.addResource('documents');
    adminHostDocumentsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminHostsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/hosts/{hostId}/listings
    const adminHostListingsResource = adminHostIdParam.addResource('listings');
    adminHostListingsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/hosts/{hostId}/requests
    const adminHostRequestsResource = adminHostIdParam.addResource('requests');
    adminHostRequestsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/hosts/{hostId}/approve
    const adminApproveHostResource = adminHostIdParam.addResource('approve');
    adminApproveHostResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminHostsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/hosts/{hostId}/reject
    const adminRejectHostResource = adminHostIdParam.addResource('reject');
    adminRejectHostResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminHostsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/hosts/{hostId}/suspend
    const adminSuspendHostResource = adminHostIdParam.addResource('suspend');
    adminSuspendHostResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminHostsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/hosts/{hostId}/reinstate
    const adminReinstateHostResource = adminHostIdParam.addResource('reinstate');
    adminReinstateHostResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminHostsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // Admin Listing Routes
    // ========================================
    const adminListingsResource = adminResource.addResource('listings');

    // GET /api/v1/admin/listings
    adminListingsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/listings/pending-review
    const adminPendingReviewListingsResource = adminListingsResource.addResource('pending-review');
    adminPendingReviewListingsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/listings/{listingId}
    const adminListingIdParam = adminListingsResource.addResource('{listingId}');
    adminListingIdParam.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/listings/{listingId}/reviewing
    const adminSetReviewingListingResource = adminListingIdParam.addResource('reviewing');
    adminSetReviewingListingResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/listings/{listingId}/approve
    const adminApproveListingResource = adminListingIdParam.addResource('approve');
    adminApproveListingResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/listings/{listingId}/reject
    const adminRejectListingResource = adminListingIdParam.addResource('reject');
    adminRejectListingResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/listings/{listingId}/suspend
    const adminSuspendListingResource = adminListingIdParam.addResource('suspend');
    adminSuspendListingResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminListingsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // Admin Listing Requests Routes
    // ========================================
    const adminListingRequestsResource = adminListingIdParam.addResource('requests');
    
    // GET /api/v1/admin/listings/{listingId}/requests
    adminListingRequestsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );
    
    // POST /api/v1/admin/listings/{listingId}/requests/property-video
    const adminPropertyVideoResource = adminListingRequestsResource.addResource('property-video');
    adminPropertyVideoResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.adminRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /api/v1/admin/listings/{listingId}/requests/address-verification
    const adminAddressVerificationResource = adminListingRequestsResource.addResource('address-verification');
    adminAddressVerificationResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.adminRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // Admin Request Routes
    // ========================================
    const adminRequestsResource = adminResource.addResource('requests');

    // GET /api/v1/admin/requests
    adminRequestsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/requests/pending-review
    const adminPendingReviewRequestsResource = adminRequestsResource.addResource('pending-review');
    adminPendingReviewRequestsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/requests/{requestId}
    const adminRequestIdParam = adminRequestsResource.addResource('{requestId}');
    adminRequestIdParam.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/requests/{requestId}/approve
    const adminApproveRequestResource = adminRequestIdParam.addResource('approve');
    adminApproveRequestResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/requests/{requestId}/reject
    const adminRejectRequestResource = adminRequestIdParam.addResource('reject');
    adminRejectRequestResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminRequestsHandlerLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // Admin Notification Routes
    // ========================================

    const adminNotificationsResource = adminResource.addResource('notifications');
    const adminSendNotificationResource = adminNotificationsResource.addResource('send');
    
    // POST /api/v1/admin/notifications/send
    adminSendNotificationResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.sendNotificationLambda, { proxy: true }),
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
    new cdk.CfnOutput(this, 'AdminApiEndpoint', {
      value: this.api.url,
      description: 'Admin API Gateway endpoint URL',
      exportName: `Localstays${capitalizedStage}AdminApiEndpoint`,
    });

    new cdk.CfnOutput(this, 'AdminApiId', {
      value: this.api.restApiId,
      description: 'Admin API Gateway REST API ID',
      exportName: `Localstays${capitalizedStage}AdminApiId`,
    });

    // Lambda outputs
    new cdk.CfnOutput(this, 'AdminHostsHandlerLambdaName', {
      value: this.adminHostsHandlerLambda.functionName,
      description: 'Admin Hosts Handler Lambda function name',
      exportName: `Localstays${capitalizedStage}AdminHostsHandlerLambda`,
    });

    new cdk.CfnOutput(this, 'AdminListingsHandlerLambdaName', {
      value: this.adminListingsHandlerLambda.functionName,
      description: 'Admin Listings Handler Lambda function name',
      exportName: `Localstays${capitalizedStage}AdminListingsHandlerLambda`,
    });

    // Add tags
    cdk.Tags.of(this).add('Environment', stage);
    cdk.Tags.of(this).add('Project', 'Localstays');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    cdk.Tags.of(this).add('StackType', 'AdminApi');
  }

  /**
   * Capitalize first letter of string (for export names)
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

