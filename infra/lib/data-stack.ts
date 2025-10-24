import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * Properties for DataStack
 */
export interface DataStackProps extends cdk.StackProps {
  /** Environment stage (dev, dev1, staging, prod) */
  stage: string;
}

/**
 * Stack for DynamoDB tables and data layer infrastructure
 * Implements single-table design pattern for Localstays platform
 */
export class DataStack extends cdk.Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // Main DynamoDB table - single table design
    this.table = new dynamodb.Table(this, 'LocalstaysTable', {
      tableName: `localstays-${stage}`,
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
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS managed keys
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      
      // Stream configuration for future event processing
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // GSI1: Lookup entities by owner (e.g., Host by ownerUserSub)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: {
        name: 'gsi1pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi1sk',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2-4: Adding incrementally (DynamoDB allows only 1 GSI change per deployment)
    // Uncomment one at a time and redeploy
    
    // GSI2: Query entities by status (e.g., Hosts by status, Listings by status)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: {
        name: 'gsi2pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi2sk',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI3: Lookup by email (e.g., Host by email)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: {
        name: 'gsi3pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi3sk',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI4: Query by country (e.g., Hosts by country)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI4',
      partitionKey: {
        name: 'gsi4pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi4sk',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Outputs (with environment-specific export names)
    const capitalizedStage = this.capitalize(stage);
    
    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB table name',
      exportName: `Localstays${capitalizedStage}TableName`,
    });

    new cdk.CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      description: 'DynamoDB table ARN',
      exportName: `Localstays${capitalizedStage}TableArn`,
    });

    // Add tags for resource management
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

