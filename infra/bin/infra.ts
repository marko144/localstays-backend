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
import { ApiGatewayStack } from '../lib/api-gateway-stack';
import { ApiLambdaStack } from '../lib/api-lambda-stack';

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
const { account, region, stage } = envConfig;

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
 * 4. StorageStack - S3 buckets
 * 5. KmsStack - KMS keys
 * 
 * Phase 2: Authentication (Dependent Stacks)
 * 6. CognitoStack - User Pool (depends on KmsStack)
 * 7. AuthTriggerStack - Lambda triggers (depends on all Phase 1 + CognitoStack)
 * 
 * Phase 3: API Layer (Dependent on Auth)
 * 8. ApiStack - REST API + Lambda handlers (depends on DataStack, EmailTemplateStack, StorageStack, CognitoStack)
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
  userPoolId: cognitoStack.userPool.userPoolId,
  userPoolArn: cognitoStack.userPool.userPoolArn,
  kmsKey: kmsStack.cognitoCustomSenderKey,
  tableName: dataStack.table.tableName,
  tableArn: dataStack.table.tableArn,
  sendGridParamName: paramsStack.sendGridParamName,
  bucketName: storageStack.bucket.bucketName,
  bucketArn: storageStack.bucket.bucketArn,
});

authTriggerStack.addDependency(paramsStack);
authTriggerStack.addDependency(dataStack);
authTriggerStack.addDependency(storageStack);
authTriggerStack.addDependency(kmsStack);
authTriggerStack.addDependency(cognitoStack);

// Phase 3: API Layer Stack (Combined Gateway + Lambdas to avoid circular dependency)

// Stack 8: API (Gateway + Lambda Functions)
const apiStack = new ApiLambdaStack(app, `${stackPrefix}ApiStack`, {
  env,
  description: `REST API Gateway and Lambda functions for host profile submission (${stage})`,
  stackName: `localstays-${stage}-api`,
  stage,
  userPoolId: cognitoStack.userPool.userPoolId,
  userPoolArn: cognitoStack.userPool.userPoolArn,
  table: dataStack.table,
  bucket: storageStack.bucket,
  emailTemplatesTable: emailTemplateStack.table,
  sendGridParamName: paramsStack.sendGridParamName,
});
apiStack.addDependency(cognitoStack);
apiStack.addDependency(dataStack);
apiStack.addDependency(emailTemplateStack);
apiStack.addDependency(storageStack);
apiStack.addDependency(paramsStack);

console.log(`✅ Stack dependencies configured for ${stage} environment`);
console.log('📦 Stacks to deploy:');
console.log(`   1. ${paramsStack.stackName} (SSM Parameters)`);
console.log(`   2. ${dataStack.stackName} (DynamoDB)`);
console.log(`   3. ${emailTemplateStack.stackName} (Email Templates)`);
console.log(`   4. ${storageStack.stackName} (S3)`);
console.log(`   5. ${kmsStack.stackName} (KMS)`);
console.log(`   6. ${cognitoStack.stackName} (Cognito User Pool)`);
console.log(`   7. ${authTriggerStack.stackName} (Lambda Triggers)`);
console.log(`   8. ${apiStack.stackName} (API Gateway + Lambda Functions)`);

// Add global tags to all resources
cdk.Tags.of(app).add('Project', 'Localstays');
cdk.Tags.of(app).add('Environment', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
cdk.Tags.of(app).add('CostCenter', 'Engineering');

app.synth();
