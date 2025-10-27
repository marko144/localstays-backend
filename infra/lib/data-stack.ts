import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
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
      
      // TTL attribute for automatic item expiration
      // Used for: submission tokens, temporary sessions, expired documents
      timeToLiveAttribute: 'expiresAt',
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS managed keys
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      
      // Stream configuration for future event processing
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // GSI1 - HostIdIndex: Query users by hostId (pk=hostId, sk=USER#<sub>)
    this.table.addGlobalSecondaryIndex({
      indexName: 'HostIdIndex',
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

    // GSI2 - StatusIndex: Query entities by status (e.g., Hosts by status, Listings by status)
    // pk=entityType#status (e.g., "HOST#VERIFICATION"), sk=createdAt
    this.table.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
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

    // GSI3 - DocumentStatusIndex: Repurposed for direct lookup of listings by listingId
    // pk=LISTING#{listingId}, sk=LISTING_META#{listingId}
    this.table.addGlobalSecondaryIndex({
      indexName: 'DocumentStatusIndex',
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

    // GSI4 - CountryIndex: Query entities by country (e.g., Hosts by country)
    // pk=countryCode, sk=createdAt
    this.table.addGlobalSecondaryIndex({
      indexName: 'CountryIndex',
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

    // ========================================
    // Database Seeding CustomResource
    // ========================================
    
    // Lambda function to seed roles and enums
    const seedLambda = new nodejs.NodejsFunction(this, 'SeedHandler', {
      functionName: `localstays-${stage}-db-seed`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'backend/services/seed/seed-handler.ts',
      handler: 'handler',
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.table.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'es2022',
        externalModules: ['@aws-sdk/*'],
      },
      logRetention: stage === 'prod' 
        ? logs.RetentionDays.ONE_MONTH 
        : logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions to write to DynamoDB
    this.table.grantWriteData(seedLambda);

    // Create custom resource provider
    const seedProvider = new cr.Provider(this, 'SeedProvider', {
      onEventHandler: seedLambda,
      logRetention: stage === 'prod' 
        ? logs.RetentionDays.ONE_MONTH 
        : logs.RetentionDays.ONE_WEEK,
    });

    // Create custom resource (triggers seeding on stack create)
    new cdk.CustomResource(this, 'SeedCustomResource', {
      serviceToken: seedProvider.serviceToken,
      properties: {
        TableName: this.table.tableName,
        // Change this value to trigger re-seeding
        Version: '1.10.0', // Added admin request permissions + host request permissions
      },
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

