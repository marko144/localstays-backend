import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';

/**
 * Properties for SharedServicesStack
 * Contains shared infrastructure used by all API stacks
 */
export interface SharedServicesStackProps extends cdk.StackProps {
  /** Environment stage (dev, dev1, staging, prod) */
  stage: string;
  /** DynamoDB table for metadata */
  table: dynamodb.Table;
  /** S3 bucket for host assets */
  bucket: s3.Bucket;
}

/**
 * SharedServicesStack - Shared Infrastructure
 * 
 * Contains infrastructure used across all API stacks:
 * - Image Processing Lambda + SQS + EventBridge
 * - Verification Processing Lambda + SQS + EventBridge
 * - CloudWatch Alarms
 * - ECR Repository reference
 * 
 * This stack must be deployed BEFORE any API stacks.
 */
export class SharedServicesStack extends cdk.Stack {
  // Expose queues and lambdas for reference by API stacks (if needed)
  public readonly imageProcessingQueue: sqs.Queue;
  public readonly verificationProcessingQueue: sqs.Queue;
  public readonly imageProcessorLambda: lambda.Function;
  public readonly verificationProcessorLambda: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: SharedServicesStackProps) {
    super(scope, id, props);

    const { stage, table, bucket } = props;

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
    this.imageProcessingQueue = new sqs.Queue(this, 'ImageProcessingQueue', {
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
    guardDutyRule.addTarget(new targets.SqsQueue(this.imageProcessingQueue));

    // ========================================
    // CloudWatch Alarms for Image Processing
    // ========================================

    // Alarm: Queue backlog (messages older than 10 minutes)
    new cloudwatch.Alarm(this, 'ImageQueueBacklogAlarm', {
      alarmName: `${stage}-image-queue-backlog`,
      alarmDescription: 'Alert when image processing queue has backlog > 10 min',
      metric: this.imageProcessingQueue.metricApproximateAgeOfOldestMessage({
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
      metric: this.imageProcessingQueue.metricApproximateAgeOfOldestMessage({
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
    // CRITICAL LESSON from DOCKER_IMAGE_DEPLOYMENT_LESSONS_LEARNED.md:
    // - MUST use --platform linux/arm64 (Lambda runs ARM64/Graviton2)
    // - MUST use --provenance=false --sbom=false (Lambda requires single-platform manifest)
    
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
    this.imageProcessorLambda.addEventSource(new SqsEventSource(this.imageProcessingQueue, {
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
    this.verificationProcessingQueue = new sqs.Queue(this, 'VerificationProcessingQueue', {
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
    guardDutyRuleVerification.addTarget(new targets.SqsQueue(this.verificationProcessingQueue));

    // CloudWatch Alarms for Verification Processing
    new cloudwatch.Alarm(this, 'VerificationQueueBacklogAlarm', {
      alarmName: `${stage}-verification-queue-backlog`,
      alarmDescription: 'Alert when verification processing queue has backlog > 10 min',
      metric: this.verificationProcessingQueue.metricApproximateAgeOfOldestMessage({
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
    this.verificationProcessorLambda.addEventSource(new SqsEventSource(this.verificationProcessingQueue, {
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
    // Stack Outputs
    // ========================================

    const capitalizedStage = this.capitalize(stage);

    new cdk.CfnOutput(this, 'ImageProcessingQueueUrl', {
      value: this.imageProcessingQueue.queueUrl,
      description: 'Image processing SQS queue URL',
      exportName: `Localstays${capitalizedStage}ImageProcessingQueueUrl`,
    });

    new cdk.CfnOutput(this, 'VerificationProcessingQueueUrl', {
      value: this.verificationProcessingQueue.queueUrl,
      description: 'Verification processing SQS queue URL',
      exportName: `Localstays${capitalizedStage}VerificationProcessingQueueUrl`,
    });

    new cdk.CfnOutput(this, 'ImageProcessorLambdaName', {
      value: this.imageProcessorLambda.functionName,
      description: 'Image processor Lambda function name',
      exportName: `Localstays${capitalizedStage}ImageProcessorLambda`,
    });

    new cdk.CfnOutput(this, 'VerificationProcessorLambdaName', {
      value: this.verificationProcessorLambda.functionName,
      description: 'Verification processor Lambda function name',
      exportName: `Localstays${capitalizedStage}VerificationProcessorLambda`,
    });

    // Add tags
    cdk.Tags.of(this).add('Environment', stage);
    cdk.Tags.of(this).add('Project', 'Localstays');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    cdk.Tags.of(this).add('StackType', 'SharedServices');
  }

  /**
   * Capitalize first letter of string (for export names)
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

