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
 * Properties for ApiLambdaStack (Combined API Gateway + Lambdas)
 */
export interface ApiLambdaStackProps extends cdk.StackProps {
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
}

/**
 * Stack for API Gateway and Lambda functions
 * Contains REST API, Cognito authorizer, and all endpoint handlers
 * Combined into one stack to avoid circular dependencies
 */
export class ApiLambdaStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;
  public readonly submitIntentLambda: nodejs.NodejsFunction;
  public readonly confirmSubmissionLambda: nodejs.NodejsFunction;
  public readonly updateRejectedProfileLambda: nodejs.NodejsFunction;
  public readonly getProfileLambda: nodejs.NodejsFunction;
  public readonly getSubscriptionLambda: nodejs.NodejsFunction;
  
  // Listing Lambdas
  public readonly getListingMetadataLambda: nodejs.NodejsFunction;
  public readonly submitListingIntentLambda: nodejs.NodejsFunction;
  public readonly confirmListingSubmissionLambda: nodejs.NodejsFunction;
  public readonly getListingLambda: nodejs.NodejsFunction;
  public readonly listListingsLambda: nodejs.NodejsFunction;
  public readonly deleteListingLambda: nodejs.NodejsFunction;
  
  // Request Lambdas
  public readonly listRequestsLambda: nodejs.NodejsFunction;
  public readonly getRequestLambda: nodejs.NodejsFunction;
  public readonly submitRequestIntentLambda: nodejs.NodejsFunction;
  public readonly confirmRequestSubmissionLambda: nodejs.NodejsFunction;

  // Admin Host Lambdas
  public readonly adminListHostsLambda: nodejs.NodejsFunction;
  public readonly adminSearchHostsLambda: nodejs.NodejsFunction;
  public readonly adminGetHostLambda: nodejs.NodejsFunction;
  public readonly adminListHostDocumentsLambda: nodejs.NodejsFunction;
  public readonly adminPendingReviewHostsLambda: nodejs.NodejsFunction;
  public readonly adminApproveHostLambda: nodejs.NodejsFunction;
  public readonly adminRejectHostLambda: nodejs.NodejsFunction;
  public readonly adminSuspendHostLambda: nodejs.NodejsFunction;
  public readonly adminReinstateHostLambda: nodejs.NodejsFunction;

  // Admin Listing Lambdas
  public readonly adminListListingsLambda: nodejs.NodejsFunction;
  public readonly adminPendingReviewListingsLambda: nodejs.NodejsFunction;
  public readonly adminListHostListingsLambda: nodejs.NodejsFunction;
  public readonly adminGetListingLambda: nodejs.NodejsFunction;
  public readonly adminApproveListingLambda: nodejs.NodejsFunction;
  public readonly adminRejectListingLambda: nodejs.NodejsFunction;
  public readonly adminSuspendListingLambda: nodejs.NodejsFunction;

  // Admin Request Lambdas
  public readonly adminListRequestsLambda: nodejs.NodejsFunction;
  public readonly adminPendingReviewRequestsLambda: nodejs.NodejsFunction;
  public readonly adminListHostRequestsLambda: nodejs.NodejsFunction;
  public readonly adminGetRequestLambda: nodejs.NodejsFunction;
  public readonly adminApproveRequestLambda: nodejs.NodejsFunction;
  public readonly adminRejectRequestLambda: nodejs.NodejsFunction;
  public readonly adminCreateVideoVerificationLambda: nodejs.NodejsFunction;
  public readonly adminCreateAddressVerificationLambda: nodejs.NodejsFunction;
  public readonly adminGetListingRequestsLambda: nodejs.NodejsFunction;

  // Host Verification Lambdas
  public readonly hostSubmitVideoIntentLambda: nodejs.NodejsFunction;
  public readonly hostConfirmVideoLambda: nodejs.NodejsFunction;
  public readonly hostSubmitVerificationCodeLambda: nodejs.NodejsFunction;
  public readonly hostGetListingRequestsLambda: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiLambdaStackProps) {
    super(scope, id, props);

    const { stage, userPoolId, userPoolArn, table, bucket, emailTemplatesTable, sendGridParamName } = props;

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
    const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayLogs', {
      logGroupName: `/aws/apigateway/localstays-${stage}`,
      retention: stage === 'prod' 
        ? logs.RetentionDays.ONE_YEAR 
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Create REST API
    this.api = new apigateway.RestApi(this, 'LocalstaysApi', {
      restApiName: `localstays-${stage}-api`,
      description: `Localstays Platform API (${stage})`,
      
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

    // Create Cognito authorizer
    this.authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'CognitoAuthorizer',
      {
        cognitoUserPools: [userPool],
        authorizerName: `localstays-${stage}-authorizer`,
        identitySource: 'method.request.header.Authorization',
        resultsCacheTtl: cdk.Duration.minutes(5),
      }
    );

    // Create API structure: /api/v1/hosts/{hostId}/profile
    const apiRoot = this.api.root.addResource('api');
    const v1 = apiRoot.addResource('v1');
    const hosts = v1.addResource('hosts');
    const hostIdParam = hosts.addResource('{hostId}');
    const profileResource = hostIdParam.addResource('profile');

    // ========================================
    // Lambda Functions Setup
    // ========================================

    // Common environment variables for all Lambda functions
    const commonEnvironment = {
      TABLE_NAME: table.tableName,
      BUCKET_NAME: bucket.bucketName,
      EMAIL_TEMPLATES_TABLE: emailTemplatesTable.tableName,
      SENDGRID_PARAM: sendGridParamName,
      FROM_EMAIL: 'marko@localstays.me', // Same verified SendGrid sender as auth emails
      STAGE: stage,
      // AWS_REGION is automatically set by Lambda runtime
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
    // Submit Intent Lambda
    // ========================================
    this.submitIntentLambda = new nodejs.NodejsFunction(this, 'SubmitIntentLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-submit-intent`,
      entry: 'backend/services/api/hosts/submit-intent.ts',
      handler: 'handler',
      description: 'Create profile submission intent and generate upload URLs',
      environment: commonEnvironment,
    });

    // Grant DynamoDB permissions (least privilege)
    table.grantReadWriteData(this.submitIntentLambda); // For host, document, submission token CRUD

    // Grant S3 permissions for pre-signed URL generation (no actual S3 operations)
    this.submitIntentLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:PutObject', // Needed for generating pre-signed PUT URLs
      ],
      resources: [
        `${bucket.bucketArn}/*`,
      ],
    }));

    // ========================================
    // Confirm Submission Lambda
    // ========================================
    this.confirmSubmissionLambda = new nodejs.NodejsFunction(this, 'ConfirmSubmissionLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-confirm-submission`,
      entry: 'backend/services/api/hosts/confirm-submission.ts',
      handler: 'handler',
      description: 'Verify document uploads and complete profile submission',
      environment: commonEnvironment,
    });

    // Grant DynamoDB permissions (least privilege)
    table.grantReadWriteData(this.confirmSubmissionLambda); // For transactional updates
    emailTemplatesTable.grantReadData(this.confirmSubmissionLambda); // For email templates

    // Grant S3 permissions for verification (HeadObject only)
    this.confirmSubmissionLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:HeadObject',     // Verify object exists
        's3:GetObject',      // For future document validation
      ],
      resources: [
        `${bucket.bucketArn}/*`,
      ],
    }));

    // Grant SSM permissions for SendGrid API key
    this.confirmSubmissionLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`,
      ],
    }));

    // ========================================
    // Update Rejected Profile Lambda
    // ========================================
    this.updateRejectedProfileLambda = new nodejs.NodejsFunction(this, 'UpdateRejectedProfileLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-update-rejected-profile`,
      entry: 'backend/services/api/hosts/update-rejected-profile.ts',
      handler: 'handler',
      description: 'Update rejected host profile with optional new documents',
      environment: commonEnvironment,
    });

    // Grant DynamoDB permissions
    table.grantReadWriteData(this.updateRejectedProfileLambda);
    
    // Grant S3 permissions for presigned URL generation
    this.updateRejectedProfileLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [`${bucket.bucketArn}/*`],
    }));

    // ========================================
    // Get Profile Lambda
    // ========================================
    this.getProfileLambda = new nodejs.NodejsFunction(this, 'GetProfileLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-get-profile`,
      entry: 'backend/services/api/hosts/get-profile.ts',
      handler: 'handler',
      description: 'Retrieve host profile and document metadata',
      environment: commonEnvironment,
    });

    // Grant DynamoDB permissions (read-only)
    table.grantReadData(this.getProfileLambda); // Only needs read access

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
    table.grantReadData(this.getSubscriptionLambda); // Only needs read access

    // ========================================
    // LISTING LAMBDA FUNCTIONS
    // ========================================

    // Get Listing Metadata Lambda
    this.getListingMetadataLambda = new nodejs.NodejsFunction(this, 'GetListingMetadataLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-get-listing-metadata`,
      entry: 'backend/services/api/listings/get-metadata.ts',
      handler: 'handler',
      description: 'Get listing configuration metadata (property types, amenities, etc.)',
      environment: commonEnvironment,
    });
    table.grantReadData(this.getListingMetadataLambda);

    // Submit Listing Intent Lambda
    this.submitListingIntentLambda = new nodejs.NodejsFunction(this, 'SubmitListingIntentLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-submit-listing-intent`,
      entry: 'backend/services/api/listings/submit-intent.ts',
      handler: 'handler',
      description: 'Create listing submission intent and generate upload URLs',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.submitListingIntentLambda);
    this.submitListingIntentLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [`${bucket.bucketArn}/*`],
    }));

    // Confirm Listing Submission Lambda
    this.confirmListingSubmissionLambda = new nodejs.NodejsFunction(this, 'ConfirmListingSubmissionLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-confirm-listing-submission`,
      entry: 'backend/services/api/listings/confirm-submission.ts',
      handler: 'handler',
      description: 'Verify listing uploads and complete submission',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.confirmListingSubmissionLambda);
    this.confirmListingSubmissionLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:HeadObject', 's3:GetObject'],
      resources: [`${bucket.bucketArn}/*`],
    }));

    // Get Listing Lambda
    this.getListingLambda = new nodejs.NodejsFunction(this, 'GetListingLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-get-listing`,
      entry: 'backend/services/api/listings/get-listing.ts',
      handler: 'handler',
      description: 'Get full listing details',
      environment: commonEnvironment,
    });
    table.grantReadData(this.getListingLambda);

    // List Listings Lambda
    this.listListingsLambda = new nodejs.NodejsFunction(this, 'ListListingsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-list-listings`,
      entry: 'backend/services/api/listings/list-listings.ts',
      handler: 'handler',
      description: 'List all listings for a host',
      environment: commonEnvironment,
    });
    table.grantReadData(this.listListingsLambda);

    // Delete Listing Lambda
    this.deleteListingLambda = new nodejs.NodejsFunction(this, 'DeleteListingLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-delete-listing`,
      entry: 'backend/services/api/listings/delete-listing.ts',
      handler: 'handler',
      description: 'Soft delete a listing',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.deleteListingLambda);

    // ========================================
    // REQUEST LAMBDA FUNCTIONS
    // ========================================

    // List Requests Lambda
    this.listRequestsLambda = new nodejs.NodejsFunction(this, 'ListRequestsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-list-requests`,
      entry: 'backend/services/api/requests/list-requests.ts',
      handler: 'handler',
      description: 'List all verification requests for a host',
      environment: commonEnvironment,
    });
    table.grantReadData(this.listRequestsLambda);

    // Get Request Lambda
    this.getRequestLambda = new nodejs.NodejsFunction(this, 'GetRequestLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-get-request`,
      entry: 'backend/services/api/requests/get-request.ts',
      handler: 'handler',
      description: 'Get details of a specific verification request',
      environment: commonEnvironment,
    });
    table.grantReadData(this.getRequestLambda);

    // Submit Request Intent Lambda
    this.submitRequestIntentLambda = new nodejs.NodejsFunction(this, 'SubmitRequestIntentLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-submit-request-intent`,
      entry: 'backend/services/api/requests/submit-intent.ts',
      handler: 'handler',
      description: 'Generate pre-signed URL for request file upload',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.submitRequestIntentLambda);
    bucket.grantPut(this.submitRequestIntentLambda);

    // Confirm Request Submission Lambda
    this.confirmRequestSubmissionLambda = new nodejs.NodejsFunction(this, 'ConfirmRequestSubmissionLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-confirm-request-submission`,
      entry: 'backend/services/api/requests/confirm-submission.ts',
      handler: 'handler',
      description: 'Verify request file upload and update status',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.confirmRequestSubmissionLambda);
    bucket.grantRead(this.confirmRequestSubmissionLambda);

    // ========================================
    // HOST VERIFICATION LAMBDAS
    // ========================================

    // Submit Property Video Intent
    this.hostSubmitVideoIntentLambda = new nodejs.NodejsFunction(this, 'HostSubmitVideoIntentLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-host-submit-video-intent`,
      entry: 'backend/services/api/hosts/submit-video-intent.ts',
      handler: 'handler',
      description: 'Host: Initiate property video verification upload',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.hostSubmitVideoIntentLambda);
    bucket.grantReadWrite(this.hostSubmitVideoIntentLambda);

    // Confirm Property Video Upload
    this.hostConfirmVideoLambda = new nodejs.NodejsFunction(this, 'HostConfirmVideoLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-host-confirm-video`,
      entry: 'backend/services/api/hosts/confirm-video.ts',
      handler: 'handler',
      description: 'Host: Confirm property video verification upload',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.hostConfirmVideoLambda);
    bucket.grantRead(this.hostConfirmVideoLambda);

    // Submit Address Verification Code
    this.hostSubmitVerificationCodeLambda = new nodejs.NodejsFunction(this, 'HostSubmitVerificationCodeLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-host-submit-verification-code`,
      entry: 'backend/services/api/hosts/submit-verification-code.ts',
      handler: 'handler',
      description: 'Host: Submit address verification code',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.hostSubmitVerificationCodeLambda);
    emailTemplatesTable.grantReadData(this.hostSubmitVerificationCodeLambda);
    this.hostSubmitVerificationCodeLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`],
    }));

    // Get Listing Requests
    this.hostGetListingRequestsLambda = new nodejs.NodejsFunction(this, 'HostGetListingRequestsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-host-get-listing-requests`,
      entry: 'backend/services/api/hosts/get-listing-requests.ts',
      handler: 'handler',
      description: 'Host: Get all requests for a specific listing',
      environment: commonEnvironment,
    });
    table.grantReadData(this.hostGetListingRequestsLambda);

    // ========================================
    // ADMIN HOST LAMBDAS
    // ========================================

    // List All Hosts
    this.adminListHostsLambda = new nodejs.NodejsFunction(this, 'AdminListHostsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-list-hosts`,
      entry: 'backend/services/api/admin/hosts/list-hosts.ts',
      handler: 'handler',
      description: 'Admin: List all hosts with pagination',
      environment: commonEnvironment,
    });
    table.grantReadData(this.adminListHostsLambda);

    // Search Hosts
    this.adminSearchHostsLambda = new nodejs.NodejsFunction(this, 'AdminSearchHostsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-search-hosts`,
      entry: 'backend/services/api/admin/hosts/search-hosts.ts',
      handler: 'handler',
      description: 'Admin: Search hosts by name or email',
      environment: commonEnvironment,
    });
    table.grantReadData(this.adminSearchHostsLambda);

    // Get Host Details
    this.adminGetHostLambda = new nodejs.NodejsFunction(this, 'AdminGetHostLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-get-host`,
      entry: 'backend/services/api/admin/hosts/get-host.ts',
      handler: 'handler',
      description: 'Admin: Get full host details',
      environment: commonEnvironment,
    });
    table.grantReadData(this.adminGetHostLambda);

    // List Host Documents
    this.adminListHostDocumentsLambda = new nodejs.NodejsFunction(this, 'AdminListHostDocumentsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-list-host-documents`,
      entry: 'backend/services/api/admin/hosts/list-documents.ts',
      handler: 'handler',
      description: 'Admin: List host KYC documents with pre-signed URLs',
      environment: commonEnvironment,
    });
    table.grantReadData(this.adminListHostDocumentsLambda);
    bucket.grantRead(this.adminListHostDocumentsLambda);

    // Pending Review Hosts
    this.adminPendingReviewHostsLambda = new nodejs.NodejsFunction(this, 'AdminPendingReviewHostsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-pending-review-hosts`,
      entry: 'backend/services/api/admin/hosts/pending-review.ts',
      handler: 'handler',
      description: 'Admin: Get hosts pending review (VERIFICATION status)',
      environment: commonEnvironment,
    });
    table.grantReadData(this.adminPendingReviewHostsLambda);

    // Approve Host
    this.adminApproveHostLambda = new nodejs.NodejsFunction(this, 'AdminApproveHostLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-approve-host`,
      entry: 'backend/services/api/admin/hosts/approve-host.ts',
      handler: 'handler',
      description: 'Admin: Approve host profile',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.adminApproveHostLambda);
    emailTemplatesTable.grantReadData(this.adminApproveHostLambda);
    this.adminApproveHostLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`],
    }));

    // Reject Host
    this.adminRejectHostLambda = new nodejs.NodejsFunction(this, 'AdminRejectHostLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-reject-host`,
      entry: 'backend/services/api/admin/hosts/reject-host.ts',
      handler: 'handler',
      description: 'Admin: Reject host profile',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.adminRejectHostLambda);
    emailTemplatesTable.grantReadData(this.adminRejectHostLambda);
    this.adminRejectHostLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`],
    }));

    // Suspend Host
    this.adminSuspendHostLambda = new nodejs.NodejsFunction(this, 'AdminSuspendHostLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-suspend-host`,
      entry: 'backend/services/api/admin/hosts/suspend-host.ts',
      handler: 'handler',
      description: 'Admin: Suspend host account',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.adminSuspendHostLambda);

    // Reinstate Host
    this.adminReinstateHostLambda = new nodejs.NodejsFunction(this, 'AdminReinstateHostLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-reinstate-host`,
      entry: 'backend/services/api/admin/hosts/reinstate-host.ts',
      handler: 'handler',
      description: 'Admin: Reinstate suspended host',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.adminReinstateHostLambda);

    // ========================================
    // ADMIN LISTING LAMBDAS
    // ========================================

    // List All Listings
    this.adminListListingsLambda = new nodejs.NodejsFunction(this, 'AdminListListingsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-list-listings`,
      entry: 'backend/services/api/admin/listings/list-listings.ts',
      handler: 'handler',
      description: 'Admin: List all listings with pagination',
      environment: commonEnvironment,
    });
    table.grantReadData(this.adminListListingsLambda);

    // Pending Review Listings
    this.adminPendingReviewListingsLambda = new nodejs.NodejsFunction(this, 'AdminPendingReviewListingsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-pending-review-listings`,
      entry: 'backend/services/api/admin/listings/pending-review.ts',
      handler: 'handler',
      description: 'Admin: Get listings pending review (IN_REVIEW status)',
      environment: commonEnvironment,
    });
    table.grantReadData(this.adminPendingReviewListingsLambda);

    // List Host Listings
    this.adminListHostListingsLambda = new nodejs.NodejsFunction(this, 'AdminListHostListingsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-list-host-listings`,
      entry: 'backend/services/api/admin/listings/list-host-listings.ts',
      handler: 'handler',
      description: 'Admin: Get all listings for a specific host',
      environment: commonEnvironment,
    });
    table.grantReadData(this.adminListHostListingsLambda);

    // Get Listing Details
    this.adminGetListingLambda = new nodejs.NodejsFunction(this, 'AdminGetListingLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-get-listing`,
      entry: 'backend/services/api/admin/listings/get-listing.ts',
      handler: 'handler',
      description: 'Admin: Get full listing details',
      environment: commonEnvironment,
    });
    table.grantReadData(this.adminGetListingLambda);
    bucket.grantRead(this.adminGetListingLambda);

    // Approve Listing
    this.adminApproveListingLambda = new nodejs.NodejsFunction(this, 'AdminApproveListingLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-approve-listing`,
      entry: 'backend/services/api/admin/listings/approve-listing.ts',
      handler: 'handler',
      description: 'Admin: Approve listing',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.adminApproveListingLambda);
    emailTemplatesTable.grantReadData(this.adminApproveListingLambda);
    this.adminApproveListingLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`],
    }));

    // Reject Listing
    this.adminRejectListingLambda = new nodejs.NodejsFunction(this, 'AdminRejectListingLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-reject-listing`,
      entry: 'backend/services/api/admin/listings/reject-listing.ts',
      handler: 'handler',
      description: 'Admin: Reject listing',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.adminRejectListingLambda);
    emailTemplatesTable.grantReadData(this.adminRejectListingLambda);
    this.adminRejectListingLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`],
    }));

    // Suspend Listing
    this.adminSuspendListingLambda = new nodejs.NodejsFunction(this, 'AdminSuspendListingLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-suspend-listing`,
      entry: 'backend/services/api/admin/listings/suspend-listing.ts',
      handler: 'handler',
      description: 'Admin: Suspend/lock listing',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.adminSuspendListingLambda);

    // ========================================
    // ADMIN REQUEST LAMBDAS
    // ========================================

    // List All Requests
    this.adminListRequestsLambda = new nodejs.NodejsFunction(this, 'AdminListRequestsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-list-requests`,
      entry: 'backend/services/api/admin/requests/list-requests.ts',
      handler: 'handler',
      description: 'Admin: List all requests with pagination',
      environment: commonEnvironment,
    });
    table.grantReadData(this.adminListRequestsLambda);

    // Pending Review Requests
    this.adminPendingReviewRequestsLambda = new nodejs.NodejsFunction(this, 'AdminPendingReviewRequestsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-pending-review-requests`,
      entry: 'backend/services/api/admin/requests/pending-review.ts',
      handler: 'handler',
      description: 'Admin: Get requests pending review (RECEIVED status)',
      environment: commonEnvironment,
    });
    table.grantReadData(this.adminPendingReviewRequestsLambda);

    // List Host Requests
    this.adminListHostRequestsLambda = new nodejs.NodejsFunction(this, 'AdminListHostRequestsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-list-host-requests`,
      entry: 'backend/services/api/admin/requests/list-host-requests.ts',
      handler: 'handler',
      description: 'Admin: Get all requests for a specific host',
      environment: commonEnvironment,
    });
    table.grantReadData(this.adminListHostRequestsLambda);

    // Get Request Details
    this.adminGetRequestLambda = new nodejs.NodejsFunction(this, 'AdminGetRequestLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-get-request`,
      entry: 'backend/services/api/admin/requests/get-request.ts',
      handler: 'handler',
      description: 'Admin: Get full request details with video URL',
      environment: commonEnvironment,
    });
    table.grantReadData(this.adminGetRequestLambda);
    bucket.grantRead(this.adminGetRequestLambda);

    // Approve Request
    this.adminApproveRequestLambda = new nodejs.NodejsFunction(this, 'AdminApproveRequestLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-approve-request`,
      entry: 'backend/services/api/admin/requests/approve-request.ts',
      handler: 'handler',
      description: 'Admin: Approve Live ID request',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.adminApproveRequestLambda);
    emailTemplatesTable.grantReadData(this.adminApproveRequestLambda);
    this.adminApproveRequestLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`],
    }));

    // Reject Request
    this.adminRejectRequestLambda = new nodejs.NodejsFunction(this, 'AdminRejectRequestLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-reject-request`,
      entry: 'backend/services/api/admin/requests/reject-request.ts',
      handler: 'handler',
      description: 'Admin: Reject Live ID request',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.adminRejectRequestLambda);
    emailTemplatesTable.grantReadData(this.adminRejectRequestLambda);
    this.adminRejectRequestLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`],
    }));

    // Create Property Video Verification Request
    this.adminCreateVideoVerificationLambda = new nodejs.NodejsFunction(this, 'AdminCreateVideoVerificationLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-create-video-verification`,
      entry: 'backend/services/api/admin/requests/create-property-video-verification.ts',
      handler: 'handler',
      description: 'Admin: Create property video verification request',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.adminCreateVideoVerificationLambda);
    emailTemplatesTable.grantReadData(this.adminCreateVideoVerificationLambda);
    this.adminCreateVideoVerificationLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`],
    }));

    // Create Address Verification Request
    this.adminCreateAddressVerificationLambda = new nodejs.NodejsFunction(this, 'AdminCreateAddressVerificationLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-create-address-verification`,
      entry: 'backend/services/api/admin/requests/create-address-verification.ts',
      handler: 'handler',
      description: 'Admin: Create address verification request with PDF letter',
      environment: commonEnvironment,
      bundling: {
        ...commonLambdaProps.bundling,
        // Include font files for pdfkit in the exact location it expects
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
    table.grantReadWriteData(this.adminCreateAddressVerificationLambda);
    bucket.grantReadWrite(this.adminCreateAddressVerificationLambda);
    emailTemplatesTable.grantReadData(this.adminCreateAddressVerificationLambda);
    this.adminCreateAddressVerificationLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`],
    }));

    // Get All Requests for a Listing (Admin)
    this.adminGetListingRequestsLambda = new nodejs.NodejsFunction(this, 'AdminGetListingRequestsLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-admin-get-listing-requests`,
      entry: 'backend/services/api/admin/requests/get-listing-requests.ts',
      handler: 'handler',
      description: 'Admin: Get all requests for a listing (any status)',
      environment: commonEnvironment,
    });
    table.grantReadWriteData(this.adminGetListingRequestsLambda);

    // ========================================
    // API Gateway Integrations
    // ========================================

    // POST /api/v1/hosts/{hostId}/profile/submit-intent
    const submitIntentResource = profileResource.addResource('submit-intent');
    submitIntentResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.submitIntentLambda, {
        proxy: true,
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
            },
          },
        ],
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        methodResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
            },
          },
        ],
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
      new apigateway.LambdaIntegration(this.confirmSubmissionLambda, {
        proxy: true,
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
            },
          },
        ],
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        methodResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
            },
          },
        ],
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
      new apigateway.LambdaIntegration(this.updateRejectedProfileLambda, {
        proxy: true,
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
            },
          },
        ],
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        methodResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
            },
          },
        ],
        requestValidatorOptions: {
          validateRequestBody: true,
          validateRequestParameters: true,
        },
      }
    );

    // GET /api/v1/hosts/{hostId}/profile
    profileResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.getProfileLambda, {
        proxy: true,
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
            },
          },
        ],
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        methodResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
            },
          },
        ],
        requestValidatorOptions: {
          validateRequestParameters: true,
        },
      }
    );

    // Grant API Gateway permission to invoke Lambda functions
    // GET /api/v1/hosts/{hostId}/subscription
    const subscriptionResource = hostIdParam.addResource('subscription');
    subscriptionResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.getSubscriptionLambda, {
        proxy: true,
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
            },
          },
        ],
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        methodResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
            },
          },
        ],
      }
    );

    // ========================================
    // LISTING API ROUTES
    // ========================================

    // GET /api/v1/listings/metadata (no auth required for metadata)
    const listingsResource = v1.addResource('listings');
    const metadataResource = listingsResource.addResource('metadata');
    metadataResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.getListingMetadataLambda, { proxy: true }),
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
      new apigateway.LambdaIntegration(this.submitListingIntentLambda, { proxy: true }),
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
      new apigateway.LambdaIntegration(this.listListingsLambda, { proxy: true }),
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
      new apigateway.LambdaIntegration(this.getListingLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // DELETE /api/v1/hosts/{hostId}/listings/{listingId}
    listingIdParam.addMethod(
      'DELETE',
      new apigateway.LambdaIntegration(this.deleteListingLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /api/v1/hosts/{hostId}/listings/{listingId}/confirm-submission
    const confirmListingSubmissionResource = listingIdParam.addResource('confirm-submission');
    confirmListingSubmissionResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.confirmListingSubmissionLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
          validateRequestParameters: true,
        },
      }
    );

    // GET /api/v1/hosts/{hostId}/listings/{listingId}/requests
    const listingRequestsResource = listingIdParam.addResource('requests');
    listingRequestsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.hostGetListingRequestsLambda, { proxy: true }),
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
      new apigateway.LambdaIntegration(this.hostSubmitVideoIntentLambda, { proxy: true }),
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
      new apigateway.LambdaIntegration(this.hostConfirmVideoLambda, { proxy: true }),
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
      new apigateway.LambdaIntegration(this.hostSubmitVerificationCodeLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidatorOptions: {
          validateRequestBody: true,
        },
      }
    );

    // ========================================
    // REQUEST API ROUTES
    // ========================================

    // GET /api/v1/hosts/{hostId}/requests
    const requestsResource = hostIdParam.addResource('requests');
    requestsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.listRequestsLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/hosts/{hostId}/requests/{requestId}
    const requestIdParam = requestsResource.addResource('{requestId}');
    requestIdParam.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.getRequestLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /api/v1/hosts/{hostId}/requests/{requestId}/submit-intent
    const submitRequestIntentResource = requestIdParam.addResource('submit-intent');
    submitRequestIntentResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.submitRequestIntentLambda, { proxy: true }),
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
      new apigateway.LambdaIntegration(this.confirmRequestSubmissionLambda, { proxy: true }),
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
    // ADMIN API ROUTES
    // ========================================

    const adminResource = v1.addResource('admin');

    // Admin Host Routes
    const adminHostsResource = adminResource.addResource('hosts');

    // GET /api/v1/admin/hosts
    adminHostsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminListHostsLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/hosts/search
    const adminHostsSearchResource = adminHostsResource.addResource('search');
    adminHostsSearchResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminSearchHostsLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/hosts/pending-review
    const adminPendingReviewHostsResource = adminHostsResource.addResource('pending-review');
    adminPendingReviewHostsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminPendingReviewHostsLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/hosts/{hostId}
    const adminHostIdParam = adminHostsResource.addResource('{hostId}');
    adminHostIdParam.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminGetHostLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/hosts/{hostId}/documents
    const adminHostDocumentsResource = adminHostIdParam.addResource('documents');
    adminHostDocumentsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminListHostDocumentsLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/hosts/{hostId}/listings
    const adminHostListingsResource = adminHostIdParam.addResource('listings');
    adminHostListingsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminListHostListingsLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/hosts/{hostId}/requests
    const adminHostRequestsResource = adminHostIdParam.addResource('requests');
    adminHostRequestsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminListHostRequestsLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/hosts/{hostId}/approve
    const adminApproveHostResource = adminHostIdParam.addResource('approve');
    adminApproveHostResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminApproveHostLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/hosts/{hostId}/reject
    const adminRejectHostResource = adminHostIdParam.addResource('reject');
    adminRejectHostResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminRejectHostLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/hosts/{hostId}/suspend
    const adminSuspendHostResource = adminHostIdParam.addResource('suspend');
    adminSuspendHostResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminSuspendHostLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/hosts/{hostId}/reinstate
    const adminReinstateHostResource = adminHostIdParam.addResource('reinstate');
    adminReinstateHostResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminReinstateHostLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // Admin Listing Routes
    const adminListingsResource = adminResource.addResource('listings');

    // GET /api/v1/admin/listings
    adminListingsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminListListingsLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/listings/pending-review
    const adminPendingReviewListingsResource = adminListingsResource.addResource('pending-review');
    adminPendingReviewListingsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminPendingReviewListingsLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/listings/{listingId}
    const adminListingIdParam = adminListingsResource.addResource('{listingId}');
    adminListingIdParam.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminGetListingLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/listings/{listingId}/approve
    const adminApproveListingResource = adminListingIdParam.addResource('approve');
    adminApproveListingResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminApproveListingLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/listings/{listingId}/reject
    const adminRejectListingResource = adminListingIdParam.addResource('reject');
    adminRejectListingResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminRejectListingLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/listings/{listingId}/suspend
    const adminSuspendListingResource = adminListingIdParam.addResource('suspend');
    adminSuspendListingResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminSuspendListingLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // Admin Listing Requests Routes
    const adminListingRequestsResource = adminListingIdParam.addResource('requests');
    
    // GET /api/v1/admin/listings/{listingId}/requests
    adminListingRequestsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminGetListingRequestsLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );
    
    // POST /api/v1/admin/listings/{listingId}/requests/property-video
    const adminPropertyVideoResource = adminListingRequestsResource.addResource('property-video');
    adminPropertyVideoResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.adminCreateVideoVerificationLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /api/v1/admin/listings/{listingId}/requests/address-verification
    const adminAddressVerificationResource = adminListingRequestsResource.addResource('address-verification');
    adminAddressVerificationResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.adminCreateAddressVerificationLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // Admin Request Routes
    const adminRequestsResource = adminResource.addResource('requests');

    // GET /api/v1/admin/requests
    adminRequestsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminListRequestsLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/requests/pending-review
    const adminPendingReviewRequestsResource = adminRequestsResource.addResource('pending-review');
    adminPendingReviewRequestsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminPendingReviewRequestsLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /api/v1/admin/requests/{requestId}
    const adminRequestIdParam = adminRequestsResource.addResource('{requestId}');
    adminRequestIdParam.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.adminGetRequestLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/requests/{requestId}/approve
    const adminApproveRequestResource = adminRequestIdParam.addResource('approve');
    adminApproveRequestResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminApproveRequestLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /api/v1/admin/requests/{requestId}/reject
    const adminRejectRequestResource = adminRequestIdParam.addResource('reject');
    adminRejectRequestResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(this.adminRejectRequestLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // Grant API Gateway Invoke Permissions
    // ========================================

    // Note: We use a wildcard for SourceArn to avoid circular dependency
    // The specific API Gateway ID will be validated at runtime
    this.submitIntentLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.confirmSubmissionLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.getProfileLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.getSubscriptionLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    
    // Grant invoke permissions for listing Lambdas
    this.getListingMetadataLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.submitListingIntentLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.confirmListingSubmissionLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.getListingLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.listListingsLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.deleteListingLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    
    // Grant invoke permissions for request Lambdas
    this.listRequestsLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.getRequestLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.submitRequestIntentLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.confirmRequestSubmissionLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));

    // Grant invoke permissions for admin host Lambdas
    this.adminListHostsLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminSearchHostsLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminGetHostLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminListHostDocumentsLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminPendingReviewHostsLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminApproveHostLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminRejectHostLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminSuspendHostLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminReinstateHostLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));

    // Grant invoke permissions for admin listing Lambdas
    this.adminListListingsLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminPendingReviewListingsLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminListHostListingsLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminGetListingLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminApproveListingLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminRejectListingLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminSuspendListingLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));

    // Grant invoke permissions for admin request Lambdas
    this.adminListRequestsLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminPendingReviewRequestsLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminListHostRequestsLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminGetRequestLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminApproveRequestLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.adminRejectRequestLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));

    // Outputs
    const capitalizedStage = this.capitalize(stage);

    // API Gateway outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.api.url,
      description: 'API Gateway endpoint URL',
      exportName: `Localstays${capitalizedStage}ApiEndpoint`,
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      description: 'API Gateway REST API ID',
      exportName: `Localstays${capitalizedStage}ApiId`,
    });

    // Lambda outputs
    new cdk.CfnOutput(this, 'SubmitIntentLambdaName', {
      value: this.submitIntentLambda.functionName,
      description: 'Submit Intent Lambda function name',
      exportName: `Localstays${capitalizedStage}SubmitIntentLambda`,
    });

    new cdk.CfnOutput(this, 'ConfirmSubmissionLambdaName', {
      value: this.confirmSubmissionLambda.functionName,
      description: 'Confirm Submission Lambda function name',
      exportName: `Localstays${capitalizedStage}ConfirmSubmissionLambda`,
    });

    new cdk.CfnOutput(this, 'GetProfileLambdaName', {
      value: this.getProfileLambda.functionName,
      description: 'Get Profile Lambda function name',
      exportName: `Localstays${capitalizedStage}GetProfileLambda`,
    });

    new cdk.CfnOutput(this, 'GetSubscriptionLambdaName', {
      value: this.getSubscriptionLambda.functionName,
      description: 'Get Subscription Lambda function name',
      exportName: `Localstays${capitalizedStage}GetSubscriptionLambda`,
    });

    // API Endpoint outputs
    new cdk.CfnOutput(this, 'SubmitIntentEndpoint', {
      value: `${this.api.url}api/v1/hosts/{hostId}/profile/submit-intent`,
      description: 'Submit Intent API endpoint',
    });

    new cdk.CfnOutput(this, 'ConfirmSubmissionEndpoint', {
      value: `${this.api.url}api/v1/hosts/{hostId}/profile/confirm-submission`,
      description: 'Confirm Submission API endpoint',
    });

    new cdk.CfnOutput(this, 'GetProfileEndpoint', {
      value: `${this.api.url}api/v1/hosts/{hostId}/profile`,
      description: 'Get Profile API endpoint',
    });

    new cdk.CfnOutput(this, 'GetSubscriptionEndpoint', {
      value: `${this.api.url}api/v1/hosts/{hostId}/subscription`,
      description: 'Get Subscription API endpoint',
    });

    // Add tags
    cdk.Tags.of(this).add('Environment', stage);
    cdk.Tags.of(this).add('Project', 'Localstays');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }

  /**
   * Capitalize first letter of string (for export names)
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

