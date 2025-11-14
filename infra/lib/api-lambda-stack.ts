import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
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
  /** CloudFront distribution domain name (optional) */
  cloudFrontDomain?: string;
}

/**
 * Stack for API Gateway and Lambda functions
 * Contains REST API, Cognito authorizer, and all endpoint handlers
 * Combined into one stack to avoid circular dependencies
 */
export class ApiLambdaStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;
  
  // Host Profile Lambda (Consolidated)
  public readonly hostProfileHandlerLambda: nodejs.NodejsFunction;
  
  public readonly getSubscriptionLambda: nodejs.NodejsFunction;
  
  // Listing Lambdas (Consolidated)
  public readonly hostListingsHandlerLambda: nodejs.NodejsFunction;
  
  // Request Lambdas (Consolidated)
  public readonly hostRequestsHandlerLambda: nodejs.NodejsFunction;

  // Admin Hosts Lambda (Consolidated)
  public readonly adminHostsHandlerLambda: nodejs.NodejsFunction;

  // Admin Listings Lambda (Consolidated)
  public readonly adminListingsHandlerLambda: nodejs.NodejsFunction;

  // Admin Requests Lambda (Consolidated)
  public readonly adminRequestsHandlerLambda: nodejs.NodejsFunction;

  // Notification Lambdas
  public readonly subscribeNotificationLambda: nodejs.NodejsFunction;
  public readonly unsubscribeNotificationLambda: nodejs.NodejsFunction;
  public readonly listSubscriptionsLambda: nodejs.NodejsFunction;
  public readonly sendNotificationLambda: nodejs.NodejsFunction;

  // Host Verification Lambdas (now consolidated into hostRequestsHandlerLambda)

  // Image Processing Lambda (Container)
  public readonly imageProcessorLambda: lambda.Function;
  public readonly verificationProcessorLambda: nodejs.NodejsFunction;

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
    // Image Processing Infrastructure
    // ========================================

    // Dead Letter Queue for failed image processing
    const imageProcessingDLQ = new sqs.Queue(this, 'ImageProcessingDLQ', {
      queueName: `${stage}-image-processing-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Main image processing queue
    const imageProcessingQueue = new sqs.Queue(this, 'ImageProcessingQueue', {
      queueName: `${stage}-image-processing-queue`,
      
      // Visibility timeout: 3 minutes (2x Lambda timeout of 90s)
      visibilityTimeout: cdk.Duration.seconds(180),
      
      // Message retention: 4 days
      retentionPeriod: cdk.Duration.days(4),
      
      // Long polling to reduce empty receives
      receiveMessageWaitTime: cdk.Duration.seconds(20),
      
      // Dead Letter Queue after 3 failed attempts
      deadLetterQueue: {
        queue: imageProcessingDLQ,
        maxReceiveCount: 3,
      },
      
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // ECR Repository for image processor Lambda container
    // Reference existing repository (created manually or in previous deployment)
    const imageProcessorRepository = ecr.Repository.fromRepositoryName(
      this,
      'ImageProcessorRepo',
      `${stage}-localstays-image-processor`
    );

    // EventBridge Rule: GuardDuty Scan Results → SQS
    const guardDutyRule = new events.Rule(this, 'GuardDutyScanComplete', {
      ruleName: `${stage}-guardduty-scan-complete`,
      description: 'Capture GuardDuty malware scan completion events for listing images',
      eventPattern: {
        source: ['aws.guardduty'],
        detailType: ['GuardDuty Malware Protection Object Scan Result'],
        detail: {
          scanStatus: ['COMPLETED'],  // Matches both NO_THREATS_FOUND and THREATS_FOUND
          s3ObjectDetails: {
            bucketName: [bucket.bucketName],
            objectKey: [{ prefix: 'lstimg_' }],  // ✅ FILTER: Only listing images with lstimg_ prefix
          },
        },
      },
    });

    // Send GuardDuty events directly to SQS (no Lambda router needed)
    guardDutyRule.addTarget(new targets.SqsQueue(imageProcessingQueue));

    // ========================================
    // CloudWatch Alarms for Image Processing
    // ========================================

    // Alarm: Queue backlog (messages older than 10 minutes)
    new cloudwatch.Alarm(this, 'ImageQueueBacklogAlarm', {
      alarmName: `${stage}-image-queue-backlog`,
      alarmDescription: 'Alert when image processing queue has backlog > 10 min',
      metric: imageProcessingQueue.metricApproximateAgeOfOldestMessage({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 600, // 10 minutes in seconds
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm: Old messages in queue (indicates processing issues)
    new cloudwatch.Alarm(this, 'ImageQueueOldMessagesAlarm', {
      alarmName: `${stage}-image-queue-old-messages`,
      alarmDescription: 'Alert when images have been queued for > 30 min',
      metric: imageProcessingQueue.metricApproximateAgeOfOldestMessage({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 1800, // 30 minutes in seconds
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm: Messages in Dead Letter Queue
    new cloudwatch.Alarm(this, 'ImageDLQMessagesAlarm', {
      alarmName: `${stage}-image-dlq-messages`,
      alarmDescription: 'Alert when failed images land in DLQ',
      metric: imageProcessingDLQ.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ========================================
    // Image Processor Lambda (Container)
    // ========================================

    // NOTE: The Docker image must be pushed to ECR before first deployment
    // See: backend/services/image-processor/README.md for build/push instructions
    
    this.imageProcessorLambda = new lambda.Function(this, 'ImageProcessorLambda', {
      functionName: `${stage}-image-processor`,
      description: 'Process listing images: malware scanning + WebP conversion',
      
      // Runtime required even for container images
      runtime: lambda.Runtime.FROM_IMAGE,
      
      // Use container image from ECR
      code: lambda.Code.fromEcrImage(imageProcessorRepository, {
        tagOrDigest: 'latest',
      }),
      
      handler: lambda.Handler.FROM_IMAGE,
      
      // ARM64 for cost savings (Graviton2)
      architecture: lambda.Architecture.ARM_64,
      
      // Memory: 2048 MB (Sharp is memory-intensive)
      memorySize: 2048,
      
      // Timeout: 90 seconds (max for most image processing)
      timeout: cdk.Duration.seconds(90),
      
      // NOTE: Reserved concurrency removed due to account limit of 10 concurrent executions
      // SQS queue provides natural backpressure and rate limiting
      // Account-level limits prevent runaway costs
      
      // Environment variables
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: bucket.bucketName,
      },
    });

    // Set log retention separately (not supported in Function constructor)
    new logs.LogGroup(this, 'ImageProcessorLogGroup', {
      logGroupName: `/aws/lambda/${stage}-image-processor`,
      retention: stage === 'prod' 
        ? logs.RetentionDays.ONE_MONTH 
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Grant S3 permissions (read staging/, write images/ & quarantine/)
    bucket.grantReadWrite(this.imageProcessorLambda);

    // Grant DynamoDB permissions (update images, write malware records)
    table.grantReadWriteData(this.imageProcessorLambda);

    // Connect SQS queue to Lambda (event source mapping)
    this.imageProcessorLambda.addEventSource(new SqsEventSource(imageProcessingQueue, {
      batchSize: 1, // Process one image at a time for predictable memory usage
      maxBatchingWindow: cdk.Duration.seconds(0), // No batching delay
      reportBatchItemFailures: true, // Enable partial batch failure handling
    }));

    // Additional CloudWatch alarms for Lambda
    new cloudwatch.Alarm(this, 'ImageProcessorErrorsAlarm', {
      alarmName: `${stage}-image-processor-errors`,
      alarmDescription: 'Alert when image processor Lambda has errors',
      metric: this.imageProcessorLambda.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 5, // Alert if 5+ errors in 5 minutes
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'ImageProcessorThrottlesAlarm', {
      alarmName: `${stage}-image-processor-throttles`,
      alarmDescription: 'Alert when image processor Lambda is throttled',
      metric: this.imageProcessorLambda.metricThrottles({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10, // Alert if 10+ throttles in 5 minutes
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ========================================
    // Verification File Processing Pipeline
    // ========================================

    // Dead Letter Queue for failed verification file processing
    const verificationProcessingDLQ = new sqs.Queue(this, 'VerificationProcessingDLQ', {
      queueName: `${stage}-verification-processing-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Verification file processing queue
    const verificationProcessingQueue = new sqs.Queue(this, 'VerificationProcessingQueue', {
      queueName: `${stage}-verification-processing-queue`,
      
      // Visibility timeout: 90 seconds (Lambda timeout + buffer)
      visibilityTimeout: cdk.Duration.seconds(90),
      
      // Retention: 4 days
      retentionPeriod: cdk.Duration.days(4),
      
      // Long polling: 20 seconds (reduces empty receives)
      receiveMessageWaitTime: cdk.Duration.seconds(20),
      
      // DLQ after 3 failed attempts
      deadLetterQueue: {
        queue: verificationProcessingDLQ,
        maxReceiveCount: 3,
      },
      
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // EventBridge Rule: GuardDuty Scan Results for Verification Files → SQS
    const guardDutyRuleVerification = new events.Rule(this, 'GuardDutyScanCompleteVerification', {
      ruleName: `${stage}-guardduty-scan-complete-verification`,
      description: 'Capture GuardDuty malware scan completion events for verification files',
      eventPattern: {
        source: ['aws.guardduty'],
        detailType: ['GuardDuty Malware Protection Object Scan Result'],
        detail: {
          scanStatus: ['COMPLETED'],  // Matches both NO_THREATS_FOUND and THREATS_FOUND
          s3ObjectDetails: {
            bucketName: [bucket.bucketName],
            objectKey: [{ prefix: 'veri_' }],  // ✅ FILTER: Only verification files with veri_ prefix
          },
        },
      },
    });

    // Send GuardDuty verification events to verification processing queue
    guardDutyRuleVerification.addTarget(new targets.SqsQueue(verificationProcessingQueue));

    // CloudWatch Alarms for Verification Processing
    new cloudwatch.Alarm(this, 'VerificationQueueBacklogAlarm', {
      alarmName: `${stage}-verification-queue-backlog`,
      alarmDescription: 'Alert when verification processing queue has backlog > 10 min',
      metric: verificationProcessingQueue.metricApproximateAgeOfOldestMessage({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 600, // 10 minutes in seconds
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'VerificationDLQMessagesAlarm', {
      alarmName: `${stage}-verification-dlq-messages`,
      alarmDescription: 'Alert when failed verification files land in DLQ',
      metric: verificationProcessingDLQ.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Verification Processor Lambda
    this.verificationProcessorLambda = new nodejs.NodejsFunction(this, 'VerificationProcessorLambda', {
      functionName: `${stage}-verification-processor`,
      description: 'Process verification files: malware scanning + move to final destination',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      entry: 'backend/services/verification-processor/index.js',
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: bucket.bucketName,
      },
      bundling: {
        minify: true,
        sourceMap: false,
      },
    });

    new logs.LogGroup(this, 'VerificationProcessorLogGroup', {
      logGroupName: `/aws/lambda/${stage}-verification-processor`,
      retention: stage === 'prod' 
        ? logs.RetentionDays.ONE_MONTH 
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Grant S3 permissions
    bucket.grantReadWrite(this.verificationProcessorLambda);

    // Grant DynamoDB permissions
    table.grantReadWriteData(this.verificationProcessorLambda);

    // Connect SQS queue to Lambda
    this.verificationProcessorLambda.addEventSource(new SqsEventSource(verificationProcessingQueue, {
      batchSize: 1,
      maxBatchingWindow: cdk.Duration.seconds(0),
      reportBatchItemFailures: true,
    }));

    // CloudWatch alarms for Verification Processor Lambda
    new cloudwatch.Alarm(this, 'VerificationProcessorErrorsAlarm', {
      alarmName: `${stage}-verification-processor-errors`,
      alarmDescription: 'Alert when verification processor Lambda has errors',
      metric: this.verificationProcessorLambda.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'VerificationProcessorThrottlesAlarm', {
      alarmName: `${stage}-verification-processor-throttles`,
      alarmDescription: 'Alert when verification processor Lambda is throttled',
      metric: this.verificationProcessorLambda.metricThrottles({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

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
      CLOUDFRONT_DOMAIN: props.cloudFrontDomain || '',
      USE_CLOUDFRONT: props.cloudFrontDomain ? 'true' : 'false',
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
    table.grantReadData(this.getSubscriptionLambda); // Only needs read access

    // ========================================
    // LISTING LAMBDA FUNCTIONS
    // ========================================

    // ========================================
    // Host Listings Handler Lambda (Consolidated)
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
    // REQUEST LAMBDA FUNCTIONS
    // ========================================

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
    // ADMIN HOST LAMBDA (CONSOLIDATED)
    // ========================================
    // Consolidates 9 operations into 1 Lambda to reduce CloudFormation resources
    // Operations: list, search, get, list-documents, pending-review, approve, reject, suspend, reinstate

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
    // Consolidates 8 operations into 1 Lambda to reduce CloudFormation resources
    // Operations: list, pending-review, list-host-listings, get, set-reviewing, approve, reject, suspend

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
    this.adminRequestsHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
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

    // Send push notification (admin only)
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

    // Grant DynamoDB permissions for notification lambdas
    table.grantReadWriteData(this.subscribeNotificationLambda);
    table.grantReadWriteData(this.unsubscribeNotificationLambda);
    table.grantReadData(this.listSubscriptionsLambda);
    table.grantReadData(this.sendNotificationLambda);

    // Grant SSM parameter access for VAPID keys
    const vapidParamPrefix = `/localstays/${stage}/vapid/*`;
    const vapidPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/vapid/*`],
    });

    this.subscribeNotificationLambda.addToRolePolicy(vapidPolicyStatement);
    this.sendNotificationLambda.addToRolePolicy(vapidPolicyStatement);

    // ========================================
    // API Gateway Integrations
    // ========================================

    // POST /api/v1/hosts/{hostId}/profile/submit-intent
    const submitIntentResource = profileResource.addResource('submit-intent');
    submitIntentResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.hostProfileHandlerLambda, {
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
      new apigateway.LambdaIntegration(this.hostProfileHandlerLambda, {
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
      new apigateway.LambdaIntegration(this.hostProfileHandlerLambda, {
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
      new apigateway.LambdaIntegration(this.hostProfileHandlerLambda, {
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
    // REQUEST API ROUTES
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
    // ADMIN API ROUTES
    // ========================================

    const adminResource = v1.addResource('admin');

    // Admin Host Routes (Consolidated)
    // All routes now point to the same consolidated Lambda handler
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

    // Admin Listing Routes (Consolidated)
    // All routes now point to the same consolidated Lambda handler
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

    // Admin Listing Requests Routes
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

    // Admin Request Routes
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
    // NOTIFICATION API ROUTES
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

    // POST /api/v1/admin/notifications/send (admin only)
    const adminNotificationsResource = adminResource.addResource('notifications');
    const adminSendNotificationResource = adminNotificationsResource.addResource('send');
    adminSendNotificationResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.sendNotificationLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // Grant API Gateway Invoke Permissions
    // ========================================
    
    // NOTE: Permissions are automatically granted by LambdaIntegration in each addMethod() call
    // These explicit grants are redundant and were removed to stay under CloudFormation's 500 resource limit
    // Each LambdaIntegration creates its own Lambda::Permission resource automatically

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
    new cdk.CfnOutput(this, 'HostProfileHandlerLambdaName', {
      value: this.hostProfileHandlerLambda.functionName,
      description: 'Host Profile Handler Lambda function name (consolidated: submit-intent, confirm-submission, update-rejected, get-profile)',
      exportName: `Localstays${capitalizedStage}HostProfileHandlerLambda`,
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

