#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ParamsStack } from '../lib/params-stack';
import { DataStack } from '../lib/data-stack';
import { EmailTemplateStack } from '../lib/email-template-stack';
import { StorageStack } from '../lib/storage-stack';
import { KmsStack } from '../lib/kms-stack';
import { CognitoStack } from '../lib/cognito-stack';
import { AuthTriggerStack } from '../lib/auth-trigger-stack';
import { CloudFrontStack } from '../lib/cloudfront-stack';
import { RateLimitStack } from '../lib/rate-limit-stack';
import { SharedServicesStack } from '../lib/shared-services-stack';
import { HostApiStack } from '../lib/host-api-stack';
import { AdminApiStack } from '../lib/admin-api-stack';
import { PublicApiStack } from '../lib/public-api-stack';
import { GuestApiStack } from '../lib/guest-api-stack';
import { StripeEventBridgeStack } from '../lib/stripe-eventbridge-stack';
import { ScheduledJobsStack } from '../lib/scheduled-jobs-stack';
import { WafStack } from '../lib/waf-stack';

/**
 * Localstays Backend Infrastructure
 * AWS CDK Application Entry Point
 * 
 * Supports multiple environments: dev, dev1, staging, prod
 * Usage: npx cdk deploy --all -c env=dev1
 */

const app = new cdk.App();

// Get environment from context (default to 'dev1')
const envName = app.node.tryGetContext('env') || 'dev1';

// Get environment configuration from cdk.json
const environments = app.node.tryGetContext('environments');
if (!environments || !environments[envName]) {
  throw new Error(
    `Environment '${envName}' not found in cdk.json.\n` +
    `Available environments: ${Object.keys(environments || {}).join(', ')}\n` +
    `Usage: npx cdk deploy --all -c env=<environment>`
  );
}

const envConfig = environments[envName];
const { account, region, stage, frontendUrl } = envConfig;

console.log('🚀 Deploying Localstays Backend Infrastructure');
console.log(`📍 Environment: ${stage}`);
console.log(`📍 Region: ${region}`);
console.log(`📍 Account: ${account}`);

// Environment configuration
const env = {
  account,
  region,
};

// Stack naming convention: localstays-{stage}-{stack-type}
const stackPrefix = `Localstays${stage.charAt(0).toUpperCase() + stage.slice(1)}`;

/**
 * STACK DEPLOYMENT ORDER
 * 
 * Phase 1: Foundation (Independent Stacks)
 * 1. ParamsStack - SSM Parameters
 * 2. DataStack - DynamoDB tables
 * 3. EmailTemplateStack - Email templates DynamoDB table
 * 4. RateLimitStack - Rate limiting DynamoDB table
 * 5. StorageStack - S3 buckets
 * 6. KmsStack - KMS keys
 * 
 * Phase 2: Authentication (Dependent Stacks)
 * 7. CognitoStack - User Pool (depends on KmsStack)
 * 8. AuthTriggerStack - Lambda triggers (depends on all Phase 1 + CognitoStack)
 * 
 * Phase 3: CDN (Dependent on Storage)
 * 9. CloudFrontStack - CDN for images (depends on StorageStack)
 * 
 * Phase 4: Shared Services (Dependent on Phase 1-3)
 * 10. SharedServicesStack - Image/verification processing infrastructure
 * 
 * Phase 5: API Layer (Dependent on Phase 4)
 * 11. HostApiStack - Host-facing API Gateway + Lambda handlers
 * 12. AdminApiStack - Admin dashboard API Gateway + Lambda handlers
 * 13. PublicApiStack - Public-facing API Gateway + Lambda handlers (geocoding)
 * 14. GuestApiStack - Guest/Member API Gateway + Lambda handlers (search)
 */

// Phase 1: Foundation Stacks

// Stack 1: SSM Parameters
const paramsStack = new ParamsStack(app, `${stackPrefix}ParamsStack`, {
  env,
  description: `SSM Parameter Store configuration for Localstays ${stage} environment`,
  stackName: `localstays-${stage}-params`,
  stage,
});

// Stack 2: DynamoDB Data Layer
const dataStack = new DataStack(app, `${stackPrefix}DataStack`, {
  env,
  description: `DynamoDB tables and data infrastructure for Localstays ${stage} environment`,
  stackName: `localstays-${stage}-data`,
  stage,
});

// Stack 3: Email Templates
const emailTemplateStack = new EmailTemplateStack(app, `${stackPrefix}EmailTemplateStack`, {
  env,
  description: `Email templates DynamoDB table for multilingual emails (${stage})`,
  stackName: `localstays-${stage}-email-templates`,
  stage,
});

// Stack 3a: Rate Limit Table (Geocoding)
const rateLimitStack = new RateLimitStack(app, `${stackPrefix}RateLimitStack`, {
  env,
  description: `Rate limiting DynamoDB table for Mapbox geocoding (${stage})`,
  stackName: `localstays-${stage}-rate-limits`,
  stage,
});

// Stack 4: S3 Storage
const storageStack = new StorageStack(app, `${stackPrefix}StorageStack`, {
  env,
  description: `S3 storage for host documents and listing images (${stage})`,
  stackName: `localstays-${stage}-storage`,
  stage,
});

// Stack 5: KMS Keys
const kmsStack = new KmsStack(app, `${stackPrefix}KmsStack`, {
  env,
  description: `KMS keys for encryption (${stage})`,
  stackName: `localstays-${stage}-kms`,
  stage,
});

// Phase 2: Authentication Stacks

// Stack 6: Cognito User Pool
const cognitoStack = new CognitoStack(app, `${stackPrefix}CognitoStack`, {
  env,
  description: `Cognito User Pool with custom attributes (${stage})`,
  stackName: `localstays-${stage}-cognito`,
  stage,
  kmsKey: kmsStack.cognitoCustomSenderKey,
});
cognitoStack.addDependency(kmsStack);

// Stack 7: Auth Triggers (Lambda functions)
const authTriggerStack = new AuthTriggerStack(app, `${stackPrefix}AuthTriggerStack`, {
  env,
  description: `Cognito authentication triggers and Lambda functions (${stage})`,
  stackName: `localstays-${stage}-auth-triggers`,
  stage,
  frontendUrl,
  userPoolId: cognitoStack.userPool.userPoolId,
  userPoolArn: cognitoStack.userPool.userPoolArn,
  kmsKey: kmsStack.cognitoCustomSenderKey,
  tableName: dataStack.table.tableName,
  tableArn: dataStack.table.tableArn,
  sendGridParamName: paramsStack.sendGridParamName,
  bucketName: storageStack.bucket.bucketName,
  bucketArn: storageStack.bucket.bucketArn,
  legalDocumentsTableName: dataStack.legalDocumentsTable.tableName,
  legalDocumentsTableArn: dataStack.legalDocumentsTable.tableArn,
  legalAcceptancesTableName: dataStack.legalAcceptancesTable.tableName,
  legalAcceptancesTableArn: dataStack.legalAcceptancesTable.tableArn,
});

authTriggerStack.addDependency(paramsStack);
authTriggerStack.addDependency(dataStack);
authTriggerStack.addDependency(storageStack);
authTriggerStack.addDependency(kmsStack);
authTriggerStack.addDependency(cognitoStack);

// Phase 3: CloudFront CDN (depends on Storage)

// Stack 8: CloudFront Distribution
const cloudFrontStack = new CloudFrontStack(app, `${stackPrefix}CloudFrontStack`, {
  env,
  description: `CloudFront CDN for serving listing images and profile photos (${stage})`,
  stackName: `localstays-${stage}-cloudfront`,
  stage,
  bucket: storageStack.bucket,
});
cloudFrontStack.addDependency(storageStack);

// Phase 4: Shared Services Stack

// Stack 10: Shared Services (Image/Verification Processing)
const sharedServicesStack = new SharedServicesStack(app, `${stackPrefix}SharedServicesStack`, {
  env,
  description: `Shared infrastructure for image and verification processing (${stage})`,
  stackName: `localstays-${stage}-shared-services`,
  stage,
  table: dataStack.table,
  bucket: storageStack.bucket,
});
sharedServicesStack.addDependency(dataStack);
sharedServicesStack.addDependency(storageStack);

// Phase 5: API Layer Stacks (Split by API concern)

// Stack 11: Host API (Host-facing endpoints)
const hostApiStack = new HostApiStack(app, `${stackPrefix}HostApiStack`, {
  env,
  description: `Host API Gateway and Lambda functions (${stage})`,
  stackName: `localstays-${stage}-host-api`,
  stage,
  frontendUrl,
  userPoolId: cognitoStack.userPool.userPoolId,
  userPoolArn: cognitoStack.userPool.userPoolArn,
  table: dataStack.table,
  locationsTable: dataStack.locationsTable,
  publicListingsTable: dataStack.publicListingsTable,
  publicListingMediaTable: dataStack.publicListingMediaTable,
  availabilityTable: dataStack.availabilityTable,
  subscriptionPlansTable: dataStack.subscriptionPlansTable,
  advertisingSlotsTable: dataStack.advertisingSlotsTable,
  bucket: storageStack.bucket,
  emailTemplatesTable: emailTemplateStack.table,
  rateLimitTable: rateLimitStack.table,
  sendGridParamName: paramsStack.sendGridParamName,
  cloudFrontDomain: cloudFrontStack.distributionDomainName,
  legalDocumentsTable: dataStack.legalDocumentsTable,
  legalAcceptancesTable: dataStack.legalAcceptancesTable,
});
hostApiStack.addDependency(cognitoStack);
hostApiStack.addDependency(dataStack);
hostApiStack.addDependency(emailTemplateStack);
hostApiStack.addDependency(storageStack);
hostApiStack.addDependency(paramsStack);
hostApiStack.addDependency(cloudFrontStack);
hostApiStack.addDependency(sharedServicesStack);

// Stack 12: Admin API (Admin dashboard endpoints)
const adminApiStack = new AdminApiStack(app, `${stackPrefix}AdminApiStack`, {
  env,
  description: `Admin API Gateway and Lambda functions (${stage})`,
  stackName: `localstays-${stage}-admin-api`,
  stage,
  frontendUrl,
  userPoolId: cognitoStack.userPool.userPoolId,
  userPoolArn: cognitoStack.userPool.userPoolArn,
  table: dataStack.table,
  bucket: storageStack.bucket,
  emailTemplatesTable: emailTemplateStack.table,
  sendGridParamName: paramsStack.sendGridParamName,
  cloudFrontDomain: cloudFrontStack.distributionDomainName,
  publicListingsTable: dataStack.publicListingsTable,
  publicListingMediaTable: dataStack.publicListingMediaTable,
  locationsTable: dataStack.locationsTable,
  subscriptionPlansTable: dataStack.subscriptionPlansTable,
  advertisingSlotsTable: dataStack.advertisingSlotsTable,
  legalDocumentsTable: dataStack.legalDocumentsTable,
  legalAcceptancesTable: dataStack.legalAcceptancesTable,
});
adminApiStack.addDependency(cognitoStack);
adminApiStack.addDependency(dataStack);
adminApiStack.addDependency(emailTemplateStack);
adminApiStack.addDependency(storageStack);
adminApiStack.addDependency(paramsStack);
adminApiStack.addDependency(cloudFrontStack);
adminApiStack.addDependency(sharedServicesStack);

// Stack 13: Public API (Public-facing endpoints - geocoding)
const publicApiStack = new PublicApiStack(app, `${stackPrefix}PublicApiStack`, {
  env,
  description: `Public API Gateway and Lambda functions (${stage})`,
  stackName: `localstays-${stage}-public-api`,
  stage,
  userPoolId: cognitoStack.userPool.userPoolId,
  userPoolArn: cognitoStack.userPool.userPoolArn,
  table: dataStack.table,
  rateLimitTable: rateLimitStack.table,
  geocodeHourlyLimit: envConfig.geocodeHourlyLimit || 20,
  geocodeLifetimeLimit: envConfig.geocodeLifetimeLimit || 100,
});
publicApiStack.addDependency(cognitoStack);
publicApiStack.addDependency(dataStack);
publicApiStack.addDependency(rateLimitStack);

// Stack 14: Guest API (Guest/Member search endpoints)
const guestApiStack = new GuestApiStack(app, `${stackPrefix}GuestApiStack`, {
  env,
  description: `Guest API Gateway and Lambda functions for search (${stage})`,
  stackName: `localstays-${stage}-guest-api`,
  stage,
  table: dataStack.table,
  locationsTable: dataStack.locationsTable,
  publicListingsTable: dataStack.publicListingsTable,
  availabilityTable: dataStack.availabilityTable,
  rateLimitTable: rateLimitStack.table,
  userPool: cognitoStack.userPool,
});
guestApiStack.addDependency(cognitoStack);
guestApiStack.addDependency(dataStack);
guestApiStack.addDependency(rateLimitStack);

// Stack 15: Stripe EventBridge (Subscription event handling)
// Stripe Event Source Names per environment (from Stripe Dashboard → Developers → Webhooks → EventBridge)
const stripeEventSourceNames: Record<string, string> = {
  staging: 'aws.partner/stripe.com/ed_test_61Tk7Xvlo3KznFDAL16Tk6KN2VE9BfC6cP2LuQVWSC5I',
  // TEMPORARY: Using staging Stripe event source for prod until LIVE Stripe is configured
  // TODO: Replace with production event source when switching to sk_live_ keys
  prod: 'aws.partner/stripe.com/ed_test_61Tk7Xvlo3KznFDAL16Tk6KN2VE9BfC6cP2LuQVWSC5I',
};

const stripeEventBridgeStack = new StripeEventBridgeStack(app, `${stackPrefix}StripeEventBridgeStack`, {
  env,
  description: `Stripe EventBridge integration for subscription events (${stage})`,
  stackName: `localstays-${stage}-stripe-eventbridge`,
  stage,
  table: dataStack.table,
  subscriptionPlansTable: dataStack.subscriptionPlansTable,
  advertisingSlotsTable: dataStack.advertisingSlotsTable,
  emailTemplatesTable: emailTemplateStack.table,
  sendGridParamName: paramsStack.sendGridParamName,
  frontendUrl,
  stripeEventSourceName: stripeEventSourceNames[stage],
});
stripeEventBridgeStack.addDependency(dataStack);
stripeEventBridgeStack.addDependency(emailTemplateStack);
stripeEventBridgeStack.addDependency(paramsStack);

// Stack 16: Scheduled Jobs (Slot expiry processing)
const scheduledJobsStack = new ScheduledJobsStack(app, `${stackPrefix}ScheduledJobsStack`, {
  env,
  description: `Scheduled background jobs for slot expiry processing (${stage})`,
  stackName: `localstays-${stage}-scheduled-jobs`,
  stage,
  table: dataStack.table,
  locationsTable: dataStack.locationsTable,
  publicListingsTable: dataStack.publicListingsTable,
  publicListingMediaTable: dataStack.publicListingMediaTable,
  advertisingSlotsTable: dataStack.advertisingSlotsTable,
  emailTemplatesTable: emailTemplateStack.table,
  sendGridParamName: paramsStack.sendGridParamName,
  frontendUrl,
});
scheduledJobsStack.addDependency(dataStack);
scheduledJobsStack.addDependency(emailTemplateStack);
scheduledJobsStack.addDependency(paramsStack);

// Stack 17: WAF (Web Application Firewall) - Production only
// Protects all API Gateways with AWS managed rules + custom rate limiting
// Initially deployed in COUNT mode for monitoring before switching to BLOCK
let wafStack: WafStack | undefined;
if (stage === 'prod') {
  // Build API Gateway stage ARNs for WAF association
  // Format: arn:aws:apigateway:{region}::/restapis/{api-id}/stages/{stage-name}
  const buildApiGatewayStageArn = (apiId: string) => 
    `arn:aws:apigateway:${region}::/restapis/${apiId}/stages/${stage}`;

  wafStack = new WafStack(app, `${stackPrefix}WafStack`, {
    env,
    description: `WAF Web Application Firewall for API protection (${stage})`,
    stackName: `localstays-${stage}-waf`,
    stage,
    apiGatewayArns: [
      // We need to use Fn.join to construct ARNs from deployed API IDs
      // Since the APIs are already deployed, we'll pass them directly
      buildApiGatewayStageArn(hostApiStack.api.restApiId),
      buildApiGatewayStageArn(adminApiStack.api.restApiId),
      buildApiGatewayStageArn(publicApiStack.api.restApiId),
      buildApiGatewayStageArn(guestApiStack.api.restApiId),
    ],
  });
  wafStack.addDependency(hostApiStack);
  wafStack.addDependency(adminApiStack);
  wafStack.addDependency(publicApiStack);
  wafStack.addDependency(guestApiStack);
}

console.log(`✅ Stack dependencies configured for ${stage} environment`);
console.log('📦 Stacks to deploy:');
console.log(`   1. ${paramsStack.stackName} (SSM Parameters)`);
console.log(`   2. ${dataStack.stackName} (DynamoDB)`);
console.log(`   3. ${emailTemplateStack.stackName} (Email Templates)`);
console.log(`   4. ${rateLimitStack.stackName} (Rate Limits)`);
console.log(`   5. ${storageStack.stackName} (S3)`);
console.log(`   6. ${kmsStack.stackName} (KMS)`);
console.log(`   7. ${cognitoStack.stackName} (Cognito User Pool)`);
console.log(`   8. ${authTriggerStack.stackName} (Lambda Triggers)`);
console.log(`   9. ${cloudFrontStack.stackName} (CloudFront CDN)`);
console.log(`  10. ${sharedServicesStack.stackName} (Shared Services: Image/Verification Processing)`);
console.log(`  11. ${hostApiStack.stackName} (Host API Gateway + Lambdas)`);
console.log(`  12. ${adminApiStack.stackName} (Admin API Gateway + Lambdas)`);
console.log(`  13. ${publicApiStack.stackName} (Public API Gateway + Lambdas - Geocoding)`);
console.log(`  14. ${guestApiStack.stackName} (Guest API Gateway + Lambdas - Search)`);
console.log(`  15. ${stripeEventBridgeStack.stackName} (Stripe EventBridge - Subscriptions)`);
console.log(`  16. ${scheduledJobsStack.stackName} (Scheduled Jobs - Slot Expiry)`);
if (wafStack) {
  console.log(`  17. ${wafStack.stackName} (WAF - Web Application Firewall)`);
}

// Add global tags to all resources
cdk.Tags.of(app).add('Project', 'Localstays');
cdk.Tags.of(app).add('Environment', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
cdk.Tags.of(app).add('CostCenter', 'Engineering');

app.synth();
