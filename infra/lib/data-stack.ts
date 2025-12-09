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
 * 
 * ENCRYPTION POLICY:
 * All tables use TableEncryption.DEFAULT (AWS-owned keys) to avoid KMS API charges.
 * This provides the same security as AWS_MANAGED but with zero KMS costs.
 * See DYNAMODB_ENCRYPTION_POLICY.md for details.
 */
export class DataStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly locationsTable: dynamodb.Table;
  public readonly publicListingsTable: dynamodb.Table;
  public readonly publicListingMediaTable: dynamodb.Table;
  public readonly availabilityTable: dynamodb.Table;
  public readonly subscriptionPlansTable: dynamodb.Table;
  public readonly advertisingSlotsTable: dynamodb.Table;
  public readonly legalDocumentsTable: dynamodb.Table;
  public readonly legalAcceptancesTable: dynamodb.Table;

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
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      
      // TTL attribute for automatic item expiration
      // Used for: submission tokens, temporary sessions, expired documents
      timeToLiveAttribute: 'expiresAt',
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS-owned keys (no KMS charges, same security)
      // Note: Use DEFAULT instead of AWS_MANAGED to avoid KMS API charges
      // DEFAULT = AWS-owned keys (free, no KMS calls)
      // AWS_MANAGED = AWS-managed KMS key (charges per API call)
      encryption: dynamodb.TableEncryption.DEFAULT,
      
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

    // GSI7 - StripeCustomerIndex: Query HostSubscription by Stripe Customer ID
    // Used by EventBridge handler to find host when Stripe events arrive
    // pk=STRIPE_CUSTOMER#<stripeCustomerId>, sk=SUBSCRIPTION
    this.table.addGlobalSecondaryIndex({
      indexName: 'StripeCustomerIndex',
      partitionKey: {
        name: 'gsi7pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi7sk',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI8 - LocationIndex: Query listings by location ID
    // Used by admin search to find all listings in a specific location
    // pk=LOCATION#<locationId>, sk=LISTING#<listingId>
    this.table.addGlobalSecondaryIndex({
      indexName: 'LocationIndex',
      partitionKey: {
        name: 'gsi8pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi8sk',
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
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS-owned keys (no KMS charges, same security)
      // Note: Use DEFAULT instead of AWS_MANAGED to avoid KMS API charges
      encryption: dynamodb.TableEncryption.DEFAULT,
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
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS-owned keys (no KMS charges, same security)
      // Note: Use DEFAULT instead of AWS_MANAGED to avoid KMS API charges
      encryption: dynamodb.TableEncryption.DEFAULT,
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
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS-owned keys (no KMS charges, same security)
      // Note: Use DEFAULT instead of AWS_MANAGED to avoid KMS API charges
      encryption: dynamodb.TableEncryption.DEFAULT,
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
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS-owned keys (no KMS charges, same security)
      // Note: Use DEFAULT instead of AWS_MANAGED to avoid KMS API charges
      encryption: dynamodb.TableEncryption.DEFAULT,
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
    // Subscription Plans Table - Reference data for subscription tiers
    // ========================================
    
    // Stores subscription plan configurations (Basic, Standard, Pro, Agency)
    // PK: PLAN#<planId>
    // SK: CONFIG
    this.subscriptionPlansTable = new dynamodb.Table(this, 'SubscriptionPlansTable', {
      tableName: `localstays-subscription-plans-${stage}`,
      partitionKey: {
        name: 'pk', // PLAN#<planId>
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk', // CONFIG
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      
      // Point-in-time recovery for data protection
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS-owned keys (no KMS charges, same security)
      encryption: dynamodb.TableEncryption.DEFAULT,
    });

    // ========================================
    // Advertising Slots Table - Active ad slots for published listings
    // ========================================
    
    // Stores advertising slot records (one slot per published listing)
    // PK: LISTING#<listingId>
    // SK: SLOT#<slotId>
    // GSI1 (HostSlotsIndex): HOST#<hostId> / <activatedAt> - Get all slots for a host
    // GSI2 (ExpiryIndex): SLOT_EXPIRY / <expiresAt>#<listingId>#<slotId> - Query expiring slots
    this.advertisingSlotsTable = new dynamodb.Table(this, 'AdvertisingSlotsTable', {
      tableName: `localstays-advertising-slots-${stage}`,
      partitionKey: {
        name: 'pk', // LISTING#<listingId>
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk', // SLOT#<slotId>
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      
      // Point-in-time recovery for data protection
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS-owned keys (no KMS charges, same security)
      encryption: dynamodb.TableEncryption.DEFAULT,
    });

    // GSI1: HostSlotsIndex - Query all slots for a host
    // Useful for: subscription page, renewal processing, token availability checking
    this.advertisingSlotsTable.addGlobalSecondaryIndex({
      indexName: 'HostSlotsIndex',
      partitionKey: {
        name: 'gsi1pk', // HOST#<hostId>
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi1sk', // <activatedAt> (ISO timestamp for sorting)
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: ExpiryIndex - Query slots by expiry date for daily expiry job
    // Useful for: slot expiry processor, expiry warning processor
    this.advertisingSlotsTable.addGlobalSecondaryIndex({
      indexName: 'ExpiryIndex',
      partitionKey: {
        name: 'gsi2pk', // SLOT_EXPIRY (constant for all slots)
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi2sk', // <expiresAt>#<listingId>#<slotId> (sortable by expiry date)
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // Legal Documents Table - ToS and Privacy Policy versions
    // ========================================
    
    // Stores versioned legal documents (ToS, Privacy Policy)
    // PK: DOCUMENT#<documentType> (e.g., DOCUMENT#tos, DOCUMENT#privacy)
    // SK: VERSION#<version> (e.g., VERSION#1.0)
    this.legalDocumentsTable = new dynamodb.Table(this, 'LegalDocumentsTable', {
      tableName: `localstays-legal-documents-${stage}`,
      partitionKey: {
        name: 'pk', // DOCUMENT#<documentType>
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk', // VERSION#<version>
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      
      // Point-in-time recovery for data protection
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS-owned keys (no KMS charges, same security)
      encryption: dynamodb.TableEncryption.DEFAULT,
    });

    // GSI1: LatestDocumentIndex - Quick lookup for latest version of each document type
    // Only documents with isLatest=true have gsi1pk set
    this.legalDocumentsTable.addGlobalSecondaryIndex({
      indexName: 'LatestDocumentIndex',
      partitionKey: {
        name: 'gsi1pk', // LATEST#<documentType> (only set when isLatest=true)
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi1sk', // DOCUMENT
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // Legal Acceptances Table - Audit trail of ToS/Privacy acceptances
    // ========================================
    
    // Stores acceptance events for legal documents per host
    // PK: HOST#<hostId>
    // SK: ACCEPTANCE#<documentType>#<version>#<timestamp>
    this.legalAcceptancesTable = new dynamodb.Table(this, 'LegalAcceptancesTable', {
      tableName: `localstays-legal-acceptances-${stage}`,
      partitionKey: {
        name: 'pk', // HOST#<hostId>
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk', // ACCEPTANCE#<documentType>#<version>#<timestamp>
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      
      // Point-in-time recovery for data protection
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      
      // Environment-specific removal policy
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      
      // Enable deletion protection in prod
      deletionProtection: stage === 'prod',
      
      // Encryption at rest using AWS-owned keys (no KMS charges, same security)
      encryption: dynamodb.TableEncryption.DEFAULT,
    });

    // GSI1: DocumentAcceptanceIndex - Query all acceptances for a specific document version
    // Useful for: "Who accepted ToS v1.0?"
    this.legalAcceptancesTable.addGlobalSecondaryIndex({
      indexName: 'DocumentAcceptanceIndex',
      partitionKey: {
        name: 'gsi1pk', // DOCUMENT#<documentType>#<version>
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi1sk', // ACCEPTED#<timestamp>
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
      runtime: lambda.Runtime.NODEJS_22_X,
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
      logGroup: new logs.LogGroup(this, 'SeedHandlerLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-db-seed`,
        retention: stage === 'prod' 
          ? logs.RetentionDays.ONE_MONTH 
          : logs.RetentionDays.ONE_WEEK,
        removalPolicy: stage === 'prod' 
          ? cdk.RemovalPolicy.RETAIN 
          : cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Grant permissions to write to DynamoDB
    this.table.grantWriteData(seedLambda);

    // Create custom resource provider
    const seedProvider = new cr.Provider(this, 'SeedProvider', {
      onEventHandler: seedLambda,
      logGroup: new logs.LogGroup(this, 'SeedProviderLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-seed-provider`,
        retention: stage === 'prod' 
          ? logs.RetentionDays.ONE_MONTH 
          : logs.RetentionDays.ONE_WEEK,
        removalPolicy: stage === 'prod' 
          ? cdk.RemovalPolicy.RETAIN 
          : cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Create custom resource (triggers seeding on stack create)
    new cdk.CustomResource(this, 'SeedCustomResource', {
      serviceToken: seedProvider.serviceToken,
      properties: {
        TableName: this.table.tableName,
        // Change this value to trigger re-seeding
        Version: '1.13.0', // Added subscription notification templates: ADS_EXPIRING_SOON, ADS_EXPIRED, PAYMENT_FAILED, LISTING_PUBLISHED
      },
    });

    // ========================================
    // Location Variants Seeding CustomResource
    // ========================================
    
    // Lambda function to seed location name variants (e.g., Belgrade/Beograd)
    const seedLocationVariantsLambda = new nodejs.NodejsFunction(this, 'SeedLocationVariantsHandler', {
      functionName: `localstays-${stage}-location-variants-seed`,
      runtime: lambda.Runtime.NODEJS_22_X,
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
      logGroup: new logs.LogGroup(this, 'SeedLocationVariantsHandlerLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-location-variants-seed`,
        retention: stage === 'prod' 
          ? logs.RetentionDays.ONE_MONTH 
          : logs.RetentionDays.ONE_WEEK,
        removalPolicy: stage === 'prod' 
          ? cdk.RemovalPolicy.RETAIN 
          : cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Grant permissions to write to Locations table
    this.locationsTable.grantWriteData(seedLocationVariantsLambda);
    this.locationsTable.grantReadData(seedLocationVariantsLambda);

    // Create custom resource provider
    const seedLocationVariantsProvider = new cr.Provider(this, 'SeedLocationVariantsProvider', {
      onEventHandler: seedLocationVariantsLambda,
      logGroup: new logs.LogGroup(this, 'SeedLocationVariantsProviderLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-location-variants-provider`,
        retention: stage === 'prod' 
          ? logs.RetentionDays.ONE_MONTH 
          : logs.RetentionDays.ONE_WEEK,
        removalPolicy: stage === 'prod' 
          ? cdk.RemovalPolicy.RETAIN 
          : cdk.RemovalPolicy.DESTROY,
      }),
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

    // ========================================
    // Subscription Plans Seeding CustomResource
    // ========================================
    
    // Lambda function to seed subscription plans to the SubscriptionPlans table
    const seedSubscriptionPlansLambda = new nodejs.NodejsFunction(this, 'SeedSubscriptionPlansHandler', {
      functionName: `localstays-${stage}-subscription-plans-seed`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: 'backend/services/seed/seed-subscription-plans.ts',
      handler: 'handler',
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      environment: {
        SUBSCRIPTION_PLANS_TABLE_NAME: this.subscriptionPlansTable.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'es2022',
        externalModules: ['@aws-sdk/*'],
      },
      logGroup: new logs.LogGroup(this, 'SeedSubscriptionPlansHandlerLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-subscription-plans-seed`,
        retention: stage === 'prod' 
          ? logs.RetentionDays.ONE_MONTH 
          : logs.RetentionDays.ONE_WEEK,
        removalPolicy: stage === 'prod' 
          ? cdk.RemovalPolicy.RETAIN 
          : cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Grant permissions to write to SubscriptionPlans table
    this.subscriptionPlansTable.grantWriteData(seedSubscriptionPlansLambda);

    // Create custom resource provider
    const seedSubscriptionPlansProvider = new cr.Provider(this, 'SeedSubscriptionPlansProvider', {
      onEventHandler: seedSubscriptionPlansLambda,
      logGroup: new logs.LogGroup(this, 'SeedSubscriptionPlansProviderLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-subscription-plans-provider`,
        retention: stage === 'prod' 
          ? logs.RetentionDays.ONE_MONTH 
          : logs.RetentionDays.ONE_WEEK,
        removalPolicy: stage === 'prod' 
          ? cdk.RemovalPolicy.RETAIN 
          : cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Create custom resource (triggers seeding on stack create/update)
    new cdk.CustomResource(this, 'SeedSubscriptionPlansCustomResource', {
      serviceToken: seedSubscriptionPlansProvider.serviceToken,
      properties: {
        SubscriptionPlansTableName: this.subscriptionPlansTable.tableName,
        // Change this value to trigger re-seeding
        Version: '1.0.0', // Initial version with Basic, Standard, Pro, Agency plans
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

    new cdk.CfnOutput(this, 'SubscriptionPlansTableName', {
      value: this.subscriptionPlansTable.tableName,
      description: 'Subscription Plans DynamoDB table name',
      exportName: `Localstays${capitalizedStage}SubscriptionPlansTableName`,
    });

    new cdk.CfnOutput(this, 'SubscriptionPlansTableArn', {
      value: this.subscriptionPlansTable.tableArn,
      description: 'Subscription Plans DynamoDB table ARN',
      exportName: `Localstays${capitalizedStage}SubscriptionPlansTableArn`,
    });

    new cdk.CfnOutput(this, 'AdvertisingSlotsTableName', {
      value: this.advertisingSlotsTable.tableName,
      description: 'Advertising Slots DynamoDB table name',
      exportName: `Localstays${capitalizedStage}AdvertisingSlotsTableName`,
    });

    new cdk.CfnOutput(this, 'AdvertisingSlotsTableArn', {
      value: this.advertisingSlotsTable.tableArn,
      description: 'Advertising Slots DynamoDB table ARN',
      exportName: `Localstays${capitalizedStage}AdvertisingSlotsTableArn`,
    });

    new cdk.CfnOutput(this, 'LegalDocumentsTableName', {
      value: this.legalDocumentsTable.tableName,
      description: 'Legal Documents DynamoDB table name',
      exportName: `Localstays${capitalizedStage}LegalDocumentsTableName`,
    });

    new cdk.CfnOutput(this, 'LegalDocumentsTableArn', {
      value: this.legalDocumentsTable.tableArn,
      description: 'Legal Documents DynamoDB table ARN',
      exportName: `Localstays${capitalizedStage}LegalDocumentsTableArn`,
    });

    new cdk.CfnOutput(this, 'LegalAcceptancesTableName', {
      value: this.legalAcceptancesTable.tableName,
      description: 'Legal Acceptances DynamoDB table name',
      exportName: `Localstays${capitalizedStage}LegalAcceptancesTableName`,
    });

    new cdk.CfnOutput(this, 'LegalAcceptancesTableArn', {
      value: this.legalAcceptancesTable.tableArn,
      description: 'Legal Acceptances DynamoDB table ARN',
      exportName: `Localstays${capitalizedStage}LegalAcceptancesTableArn`,
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

