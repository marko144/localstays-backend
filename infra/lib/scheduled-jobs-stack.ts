import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * Properties for ScheduledJobsStack
 */
export interface ScheduledJobsStackProps extends cdk.StackProps {
  /** Environment stage (dev, dev1, staging, prod) */
  stage: string;
  
  /** Main DynamoDB table */
  table: dynamodb.ITable;
  
  /** Locations table */
  locationsTable: dynamodb.ITable;
  
  /** Public Listings table */
  publicListingsTable: dynamodb.ITable;
  
  /** Public Listing Media table */
  publicListingMediaTable: dynamodb.ITable;
  
  /** Advertising Slots table */
  advertisingSlotsTable: dynamodb.ITable;
  
  /** Email Templates table */
  emailTemplatesTable: dynamodb.ITable;
  
  /** SendGrid SSM parameter name */
  sendGridParamName: string;
  
  /** Frontend URL for email links */
  frontendUrl: string;
}

/**
 * Stack for scheduled background jobs
 * 
 * Jobs:
 * 1. Slot Expiry Warning - Runs daily at 8:00 AM CET, warns hosts 7 days before expiry
 * 2. Slot Expiry Processor - Runs daily at 1:00 AM CET, processes expired slots
 */
export class ScheduledJobsStack extends cdk.Stack {
  public readonly slotExpiryProcessorLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: ScheduledJobsStackProps) {
    super(scope, id, props);

    const { 
      stage, 
      table, 
      locationsTable,
      publicListingsTable,
      publicListingMediaTable,
      advertisingSlotsTable,
      emailTemplatesTable,
      sendGridParamName,
      frontendUrl,
    } = props;

    const logRetentionDays = stage === 'prod' 
      ? logs.RetentionDays.ONE_MONTH 
      : logs.RetentionDays.ONE_WEEK;
    
    const logRemovalPolicy = stage === 'prod' 
      ? cdk.RemovalPolicy.RETAIN 
      : cdk.RemovalPolicy.DESTROY;

    // ========================================
    // Slot Expiry Processor Lambda
    // ========================================
    
    this.slotExpiryProcessorLambda = new nodejs.NodejsFunction(this, 'SlotExpiryProcessor', {
      functionName: `localstays-${stage}-slot-expiry-processor`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: 'backend/services/api/scheduled/slot-expiry-processor.ts',
      handler: 'handler',
      timeout: cdk.Duration.minutes(5), // Allow time for batch processing
      memorySize: 512,
      environment: {
        TABLE_NAME: table.tableName,
        LOCATIONS_TABLE_NAME: locationsTable.tableName,
        PUBLIC_LISTINGS_TABLE_NAME: publicListingsTable.tableName,
        PUBLIC_LISTING_MEDIA_TABLE_NAME: publicListingMediaTable.tableName,
        ADVERTISING_SLOTS_TABLE_NAME: advertisingSlotsTable.tableName,
        EMAIL_TEMPLATES_TABLE: emailTemplatesTable.tableName,
        SENDGRID_PARAM: sendGridParamName,
        FRONTEND_URL: frontendUrl,
        STAGE: stage,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'es2022',
        externalModules: ['@aws-sdk/*'],
      },
      logGroup: new logs.LogGroup(this, 'SlotExpiryProcessorLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-slot-expiry-processor`,
        retention: logRetentionDays,
        removalPolicy: logRemovalPolicy,
      }),
    });

    // Grant DynamoDB permissions
    table.grantReadWriteData(this.slotExpiryProcessorLambda);
    locationsTable.grantReadWriteData(this.slotExpiryProcessorLambda);
    publicListingsTable.grantReadWriteData(this.slotExpiryProcessorLambda);
    publicListingMediaTable.grantReadWriteData(this.slotExpiryProcessorLambda);
    advertisingSlotsTable.grantReadWriteData(this.slotExpiryProcessorLambda);
    emailTemplatesTable.grantReadData(this.slotExpiryProcessorLambda);

    // Grant SSM permissions for SendGrid API key
    this.slotExpiryProcessorLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`,
        `arn:aws:ssm:${this.region}:${this.account}:parameter/localstays/${stage}/vapid/*`,
      ],
    }));

    // ========================================
    // EventBridge Scheduled Rules
    // ========================================

    // Rule 1: Expiry Warning - Daily at 8:00 AM CET (7:00 AM UTC in winter, 6:00 AM UTC in summer)
    // Using 7:00 AM UTC as a reasonable middle ground
    const expiryWarningRule = new events.Rule(this, 'ExpiryWarningRule', {
      ruleName: `localstays-${stage}-slot-expiry-warning`,
      description: 'Triggers slot expiry warning processor daily at 8:00 AM CET',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '7', // 7:00 AM UTC = 8:00 AM CET (winter) / 9:00 AM CEST (summer)
        day: '*',
        month: '*',
        year: '*',
      }),
      enabled: stage !== 'dev1', // Disable in dev1 to avoid noise
    });

    expiryWarningRule.addTarget(
      new targets.LambdaFunction(this.slotExpiryProcessorLambda, {
        event: events.RuleTargetInput.fromObject({
          'detail-type': 'EXPIRY_WARNING',
          source: 'localstays.scheduler',
        }),
        retryAttempts: 2,
      })
    );

    // Rule 2: Slot Expiry - Daily at 1:00 AM UTC
    // This ensures we're well past midnight in all European timezones
    // before processing expired slots (avoids edge cases around midnight)
    const slotExpiryRule = new events.Rule(this, 'SlotExpiryRule', {
      ruleName: `localstays-${stage}-slot-expiry`,
      description: 'Triggers slot expiry processor daily at 1:00 AM UTC (2:00 AM CET)',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '1', // 1:00 AM UTC = 2:00 AM CET (winter) / 3:00 AM CEST (summer)
        day: '*',
        month: '*',
        year: '*',
      }),
      enabled: stage !== 'dev1', // Disable in dev1 to avoid noise
    });

    slotExpiryRule.addTarget(
      new targets.LambdaFunction(this.slotExpiryProcessorLambda, {
        event: events.RuleTargetInput.fromObject({
          'detail-type': 'SLOT_EXPIRY',
          source: 'localstays.scheduler',
        }),
        retryAttempts: 2,
      })
    );

    // ========================================
    // Outputs
    // ========================================
    
    new cdk.CfnOutput(this, 'SlotExpiryProcessorArn', {
      value: this.slotExpiryProcessorLambda.functionArn,
      description: 'Slot Expiry Processor Lambda ARN',
    });

    new cdk.CfnOutput(this, 'ExpiryWarningRuleName', {
      value: expiryWarningRule.ruleName,
      description: 'EventBridge rule for expiry warnings',
    });

    new cdk.CfnOutput(this, 'SlotExpiryRuleName', {
      value: slotExpiryRule.ruleName,
      description: 'EventBridge rule for slot expiry processing',
    });

    // Add tags
    cdk.Tags.of(this).add('Environment', stage);
    cdk.Tags.of(this).add('Project', 'Localstays');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }
}

