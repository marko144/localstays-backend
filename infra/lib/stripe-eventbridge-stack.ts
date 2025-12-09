import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';

/**
 * Properties for StripeEventBridgeStack
 */
export interface StripeEventBridgeStackProps extends cdk.StackProps {
  /** Environment stage (dev, dev1, staging, prod) */
  stage: string;
  
  /** Main DynamoDB table (for HostSubscription) */
  table: dynamodb.ITable;
  
  /** Subscription Plans table */
  subscriptionPlansTable: dynamodb.ITable;
  
  /** Advertising Slots table */
  advertisingSlotsTable: dynamodb.ITable;
  
  /** Email Templates table (for sending subscription emails) */
  emailTemplatesTable: dynamodb.ITable;
  
  /** SSM parameter name for SendGrid API key */
  sendGridParamName: string;
  
  /** Frontend URL for email links */
  frontendUrl: string;
  
  /** Stripe EventBridge partner event source name (from Stripe dashboard) */
  stripeEventSourceName?: string;
}

/**
 * Stack for Stripe EventBridge integration
 * 
 * Architecture: EventBridge → SQS Queue → Lambda
 * 
 * This provides:
 * - Buffering for burst traffic (e.g., 500 renewals on the same day)
 * - Dead Letter Queue for failed events (never lose an event)
 * - Cost-effective polling with maxBatchingWindow
 * - Automatic retries with visibility timeout
 * 
 * Setup:
 * 1. In Stripe Dashboard → Developers → Webhooks → Add destination
 * 2. Choose "Amazon EventBridge"
 * 3. Enter AWS Account ID and region
 * 4. Stripe creates a partner event source in EventBridge
 * 5. Accept the partner event source in AWS Console
 * 6. Set STRIPE_EVENT_SOURCE_NAME env var to the event source name
 * 
 * @see https://stripe.com/docs/stripe-apps/build-backend#eventbridge
 */
export class StripeEventBridgeStack extends cdk.Stack {
  public readonly stripeEventHandlerLambda: lambda.Function;
  public readonly stripeEventQueue: sqs.Queue;
  public readonly stripeEventDLQ: sqs.Queue;

  constructor(scope: Construct, id: string, props: StripeEventBridgeStackProps) {
    super(scope, id, props);

    const { 
      stage, 
      table, 
      subscriptionPlansTable, 
      advertisingSlotsTable,
      emailTemplatesTable,
      sendGridParamName,
      frontendUrl,
      stripeEventSourceName,
    } = props;

    // ========================================
    // SQS Queues for Event Buffering
    // ========================================

    // Dead Letter Queue for failed Stripe event processing
    // Events that fail 3 times end up here for manual inspection
    this.stripeEventDLQ = new sqs.Queue(this, 'StripeEventDLQ', {
      queueName: `${stage}-stripe-event-dlq`,
      retentionPeriod: cdk.Duration.days(14), // Keep failed events for 2 weeks
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Main Stripe event processing queue
    // Buffers events between EventBridge and Lambda for resilience
    this.stripeEventQueue = new sqs.Queue(this, 'StripeEventQueue', {
      queueName: `${stage}-stripe-event-queue`,
      
      // Visibility timeout: 2x Lambda timeout (30s * 2 = 60s)
      // Ensures message isn't reprocessed while Lambda is still working
      visibilityTimeout: cdk.Duration.seconds(60),
      
      // Message retention: 4 days (same as other queues)
      retentionPeriod: cdk.Duration.days(4),
      
      // Long polling: 20 seconds
      // Reduces empty receives and SQS costs
      receiveMessageWaitTime: cdk.Duration.seconds(20),
      
      // Dead Letter Queue after 3 failed attempts
      deadLetterQueue: {
        queue: this.stripeEventDLQ,
        maxReceiveCount: 3,
      },
      
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // ========================================
    // Stripe EventBridge Handler Lambda
    // ========================================
    
    this.stripeEventHandlerLambda = new nodejs.NodejsFunction(this, 'StripeEventHandler', {
      functionName: `localstays-${stage}-stripe-eventbridge-handler`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: 'backend/services/api/webhooks/stripe-eventbridge-handler.ts',
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      // Reserved concurrency prevents runaway scaling and protects downstream services
      // 10 concurrent = can process ~20 events/second sustained
      reservedConcurrentExecutions: 10,
      environment: {
        TABLE_NAME: table.tableName,
        SUBSCRIPTION_PLANS_TABLE_NAME: subscriptionPlansTable.tableName,
        ADVERTISING_SLOTS_TABLE_NAME: advertisingSlotsTable.tableName,
        EMAIL_TEMPLATES_TABLE: emailTemplatesTable.tableName,
        SENDGRID_PARAM: sendGridParamName,
        FROM_EMAIL: 'hello@localstays.me',
        FRONTEND_URL: frontendUrl,
        STAGE: stage,
        // Review compensation is controlled via SSM Parameter: /localstays/{stage}/config/review-compensation-enabled
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'es2022',
        externalModules: ['@aws-sdk/*'],
      },
      logGroup: new logs.LogGroup(this, 'StripeEventHandlerLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-stripe-eventbridge-handler`,
        retention: stage === 'prod' 
          ? logs.RetentionDays.ONE_MONTH 
          : logs.RetentionDays.ONE_WEEK,
        removalPolicy: stage === 'prod' 
          ? cdk.RemovalPolicy.RETAIN 
          : cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Grant permissions to DynamoDB tables
    table.grantReadWriteData(this.stripeEventHandlerLambda);
    subscriptionPlansTable.grantReadWriteData(this.stripeEventHandlerLambda); // Write for product/price sync
    advertisingSlotsTable.grantReadWriteData(this.stripeEventHandlerLambda);
    emailTemplatesTable.grantReadData(this.stripeEventHandlerLambda); // For sending subscription emails

    // Grant SSM permission for review compensation config (used in slot renewal logic),
    // Stripe secret key (used to fetch subscription details from Stripe API),
    // and SendGrid API key (used for sending emails)
    this.stripeEventHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/config/review-compensation-enabled`,
        `arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/stripe/secret-key`,
        `arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`,
      ],
    }));

    // ========================================
    // Connect SQS Queue to Lambda
    // ========================================

    // Lambda polls SQS queue for events
    // Cost-saving configuration matches other queues
    this.stripeEventHandlerLambda.addEventSource(new SqsEventSource(this.stripeEventQueue, {
      // Process one event at a time for predictable behavior
      // Stripe events often need sequential processing (checkout before subscription.created)
      batchSize: 1,
      
      // Wait up to 60s between polls when queue is empty
      // Reduces SQS costs by ~85% during idle periods
      maxBatchingWindow: cdk.Duration.seconds(60),
      
      // Enable partial batch failure handling
      // If processing fails, only that message goes back to queue
      reportBatchItemFailures: true,
    }));

    // ========================================
    // EventBridge Rule for Stripe Events
    // ========================================
    
    // The event source name is provided by Stripe when you set up EventBridge integration
    // Format: aws.partner/stripe.com/<event_destination_id>
    // 
    // IMPORTANT: The rule must be on the partner event bus, not the default bus!
    // The partner event bus name matches the event source name.
    
    if (!stripeEventSourceName) {
      console.warn('WARNING: stripeEventSourceName not provided. Stripe EventBridge integration will not work until configured.');
    }
    
    const eventSourceName = stripeEventSourceName || `aws.partner/stripe.com/${this.account}/${stage}`;
    
    // Reference the partner event bus (created when you accept the Stripe event source)
    // The partner event bus name is the same as the event source name
    const partnerEventBus = stripeEventSourceName 
      ? events.EventBus.fromEventBusName(this, 'StripePartnerEventBus', stripeEventSourceName)
      : undefined;
    
    // Create the EventBridge rule to match Stripe events
    // For partner event sources, events come with source matching the event source name
    // and detail-type matching the Stripe event type (e.g., "checkout.session.completed")
    const stripeEventRule = new events.Rule(this, 'StripeEventRule', {
      ruleName: `localstays-${stage}-stripe-events`,
      description: 'Routes Stripe subscription and product events to SQS queue',
      eventBus: partnerEventBus, // CRITICAL: Must be on the partner event bus!
      eventPattern: {
        // For partner event buses, we match on detail-type only
        // The source will automatically be the partner source
        detailType: [
          // Subscription lifecycle events
          'checkout.session.completed',
          'customer.subscription.created',
          'customer.subscription.updated',
          'customer.subscription.deleted',
          'invoice.paid',
          'invoice.payment_failed',
          // Customer lifecycle events
          'customer.deleted',
          // Product/Price catalog events (for keeping local data in sync)
          'product.created',
          'product.updated',
          'product.deleted',
          'price.created',
          'price.updated',
          'price.deleted',
        ],
      },
    });

    // Route events to SQS queue (not directly to Lambda)
    // This provides buffering, DLQ, and retry capabilities
    stripeEventRule.addTarget(new targets.SqsQueue(this.stripeEventQueue));

    // ========================================
    // CloudWatch Alarms
    // ========================================

    // Alert when events are failing and going to DLQ
    new cloudwatch.Alarm(this, 'StripeEventDLQAlarm', {
      alarmName: `${stage}-stripe-event-dlq-messages`,
      alarmDescription: 'Alert when Stripe events are failing and going to DLQ',
      metric: this.stripeEventDLQ.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1, // Alert on any failed event
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alert when Lambda is having errors
    new cloudwatch.Alarm(this, 'StripeEventHandlerErrorsAlarm', {
      alarmName: `${stage}-stripe-event-handler-errors`,
      alarmDescription: 'Alert when Stripe event handler Lambda has errors',
      metric: this.stripeEventHandlerLambda.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 5, // Alert if 5+ errors in 5 minutes
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alert when queue is backing up (events not being processed fast enough)
    new cloudwatch.Alarm(this, 'StripeEventQueueBacklogAlarm', {
      alarmName: `${stage}-stripe-event-queue-backlog`,
      alarmDescription: 'Alert when Stripe event queue has a backlog',
      metric: this.stripeEventQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 100, // Alert if 100+ messages waiting
      evaluationPeriods: 2, // For 10 minutes
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ========================================
    // Outputs
    // ========================================
    
    new cdk.CfnOutput(this, 'StripeEventHandlerArn', {
      value: this.stripeEventHandlerLambda.functionArn,
      description: 'Stripe EventBridge Handler Lambda ARN',
    });

    new cdk.CfnOutput(this, 'StripeEventQueueUrl', {
      value: this.stripeEventQueue.queueUrl,
      description: 'Stripe Event SQS Queue URL',
    });

    new cdk.CfnOutput(this, 'StripeEventDLQUrl', {
      value: this.stripeEventDLQ.queueUrl,
      description: 'Stripe Event Dead Letter Queue URL',
    });

    new cdk.CfnOutput(this, 'StripeEventRuleName', {
      value: stripeEventRule.ruleName,
      description: 'EventBridge rule name for Stripe events',
    });

    new cdk.CfnOutput(this, 'ExpectedEventSource', {
      value: eventSourceName,
      description: 'Expected Stripe event source name (configure in Stripe Dashboard)',
    });

    // Add tags
    cdk.Tags.of(this).add('Environment', stage);
    cdk.Tags.of(this).add('Project', 'Localstays');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }
}
