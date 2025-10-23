import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * Stack for DynamoDB tables and data layer infrastructure
 * Implements single-table design pattern for Localstays platform
 */
export class DataStack extends cdk.Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Main DynamoDB table - single table design
    this.table = new dynamodb.Table(this, 'LocalstaysTable', {
      tableName: 'localstays-dev',
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      
      // Point-in-time recovery for data protection
      pointInTimeRecovery: true,
      
      // TTL attribute for automatic item expiration (future-proof)
      timeToLiveAttribute: 'ttl',
      
      // Dev environment - allow destruction (change to RETAIN for prod)
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod (disabled for dev convenience)
      deletionProtection: false,
      
      // Encryption at rest using AWS managed keys
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      
      // Stream configuration for future event processing
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // Outputs
    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB table name',
      exportName: 'LocalstaysDevTableName',
    });

    new cdk.CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      description: 'DynamoDB table ARN',
      exportName: 'LocalstaysDevTableArn',
    });

    // Add tags for resource management
    cdk.Tags.of(this).add('Environment', 'dev');
    cdk.Tags.of(this).add('Project', 'Localstays');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }
}

