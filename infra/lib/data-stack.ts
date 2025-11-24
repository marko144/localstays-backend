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
  public readonly locationsTable: dynamodb.Table;
  public readonly publicListingsTable: dynamodb.Table;
  public readonly publicListingMediaTable: dynamodb.Table;
  public readonly availabilityTable: dynamodb.Table;

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

    // GSI5 - PushSubscriptionIndex: Query push subscriptions by active status
    // pk=PUSH_SUB_ACTIVE or PUSH_SUB_INACTIVE, sk=createdAt
    this.table.addGlobalSecondaryIndex({
      indexName: 'PushSubscriptionIndex',
      partitionKey: {
        name: 'gsi5pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi5sk',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI6 - EmailIndex: Query hosts by email (exact match, case-insensitive)
    // pk=lowercase email, sk=HOST#{hostId}
    this.table.addGlobalSecondaryIndex({
      indexName: 'EmailIndex',
      partitionKey: {
        name: 'gsi6pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi6sk',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // Locations Table - Separate table for location data
    // ========================================
    
    // Locations table for tracking unique places and associating them with listings
    this.locationsTable = new dynamodb.Table(this, 'LocationsTable', {
      tableName: `localstays-locations-${stage}`,
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
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS managed keys
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // GSI for slug-based lookups (e.g., "zlatibor-serbia")
    this.locationsTable.addGlobalSecondaryIndex({
      indexName: 'SlugIndex',
      partitionKey: {
        name: 'slug',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for text-based search (autocomplete)
    // Partition by entityType (constant "LOCATION" for all location records)
    // Sort by searchName for begins_with queries
    this.locationsTable.addGlobalSecondaryIndex({
      indexName: 'LocationSearchIndex',
      partitionKey: {
        name: 'entityType',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'searchName',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // Public Listings Table - Read-optimized denormalized listing data
    // ========================================
    
    // Public listings table for fast public search and browse
    // Populated when a host publishes an APPROVED listing
    this.publicListingsTable = new dynamodb.Table(this, 'PublicListingsTable', {
      tableName: `localstays-public-listings-${stage}`,
      partitionKey: {
        name: 'pk', // LOCATION#<locationId> (mapbox place ID)
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk', // LISTING#<listingId>
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      
      // Point-in-time recovery for data protection
      pointInTimeRecovery: true,
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS managed keys
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // ========================================
    // Public Listing Media Table - Image metadata for published listings
    // ========================================
    
    // Stores image metadata for published listings (separate from main listing data)
    // Populated atomically with PublicListings table during publish operation
    this.publicListingMediaTable = new dynamodb.Table(this, 'PublicListingMediaTable', {
      tableName: `localstays-public-listing-media-${stage}`,
      partitionKey: {
        name: 'pk', // LISTING_MEDIA_PUBLIC#<listingId>
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk', // IMAGE#<imageIndex> (0-based, 0 = cover image)
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      
      // Point-in-time recovery for data protection
      pointInTimeRecovery: true,
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS managed keys
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // ========================================
    // Availability Table - Listing unavailability tracking
    // ========================================
    
    // Stores unavailable dates for listings (negative availability model)
    // One record per unavailable night (bookings and blocks)
    // PK: LISTING_AVAILABILITY#<listingId>
    // SK: DATE#<YYYY-MM-DD>
    this.availabilityTable = new dynamodb.Table(this, 'AvailabilityTable', {
      tableName: `localstays-availability-${stage}`,
      partitionKey: {
        name: 'pk', // LISTING_AVAILABILITY#<listingId>
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk', // DATE#<YYYY-MM-DD>
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      
      // Point-in-time recovery for data protection
      pointInTimeRecovery: true,
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS managed keys
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // GSI1: Query all availability for a host across all their listings
    // Allows efficient queries like "show me all unavailable dates for this host"
    this.availabilityTable.addGlobalSecondaryIndex({
      indexName: 'HostAvailabilityIndex',
      partitionKey: {
        name: 'gsi1pk', // HOST_AVAILABILITY#<hostId>
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi1sk', // DATE#<YYYY-MM-DD>#LISTING#<listingId>
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
        Version: '1.12.0', // Added isFilter field to amenities
      },
    });

    // ========================================
    // Location Variants Seeding CustomResource
    // ========================================
    
    // Lambda function to seed location name variants (e.g., Belgrade/Beograd)
    const seedLocationVariantsLambda = new nodejs.NodejsFunction(this, 'SeedLocationVariantsHandler', {
      functionName: `localstays-${stage}-location-variants-seed`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'backend/services/seed/seed-location-variants.ts',
      handler: 'handler',
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      environment: {
        LOCATIONS_TABLE_NAME: this.locationsTable.tableName,
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

    // Grant permissions to write to Locations table
    this.locationsTable.grantWriteData(seedLocationVariantsLambda);
    this.locationsTable.grantReadData(seedLocationVariantsLambda);

    // Create custom resource provider
    const seedLocationVariantsProvider = new cr.Provider(this, 'SeedLocationVariantsProvider', {
      onEventHandler: seedLocationVariantsLambda,
      logRetention: stage === 'prod' 
        ? logs.RetentionDays.ONE_MONTH 
        : logs.RetentionDays.ONE_WEEK,
    });

    // Create custom resource (triggers seeding on stack create/update)
    new cdk.CustomResource(this, 'SeedLocationVariantsCustomResource', {
      serviceToken: seedLocationVariantsProvider.serviceToken,
      properties: {
        LocationsTableName: this.locationsTable.tableName,
        // Change this value to trigger re-seeding
        Version: '1.0.0', // Initial version with Belgrade/Beograd variant
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

    new cdk.CfnOutput(this, 'LocationsTableName', {
      value: this.locationsTable.tableName,
      description: 'Locations DynamoDB table name',
      exportName: `Localstays${capitalizedStage}LocationsTableName`,
    });

    new cdk.CfnOutput(this, 'LocationsTableArn', {
      value: this.locationsTable.tableArn,
      description: 'Locations DynamoDB table ARN',
      exportName: `Localstays${capitalizedStage}LocationsTableArn`,
    });

    new cdk.CfnOutput(this, 'PublicListingsTableName', {
      value: this.publicListingsTable.tableName,
      description: 'Public Listings DynamoDB table name',
      exportName: `Localstays${capitalizedStage}PublicListingsTableName`,
    });

    new cdk.CfnOutput(this, 'PublicListingsTableArn', {
      value: this.publicListingsTable.tableArn,
      description: 'Public Listings DynamoDB table ARN',
      exportName: `Localstays${capitalizedStage}PublicListingsTableArn`,
    });

    new cdk.CfnOutput(this, 'PublicListingMediaTableName', {
      value: this.publicListingMediaTable.tableName,
      description: 'Public Listing Media DynamoDB table name',
      exportName: `Localstays${capitalizedStage}PublicListingMediaTableName`,
    });

    new cdk.CfnOutput(this, 'PublicListingMediaTableArn', {
      value: this.publicListingMediaTable.tableArn,
      description: 'Public Listing Media DynamoDB table ARN',
      exportName: `Localstays${capitalizedStage}PublicListingMediaTableArn`,
    });

    new cdk.CfnOutput(this, 'AvailabilityTableName', {
      value: this.availabilityTable.tableName,
      description: 'Availability DynamoDB table name',
      exportName: `Localstays${capitalizedStage}AvailabilityTableName`,
    });

    new cdk.CfnOutput(this, 'AvailabilityTableArn', {
      value: this.availabilityTable.tableArn,
      description: 'Availability DynamoDB table ARN',
      exportName: `Localstays${capitalizedStage}AvailabilityTableArn`,
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

