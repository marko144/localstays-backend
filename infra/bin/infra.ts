#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ParamsStack } from '../lib/params-stack';
import { DataStack } from '../lib/data-stack';
import { StorageStack } from '../lib/storage-stack';
import { KmsStack } from '../lib/kms-stack';
import { CognitoStack } from '../lib/cognito-stack';
import { AuthTriggerStack } from '../lib/auth-trigger-stack';

/**
 * Localstays Backend Infrastructure
 * AWS CDK Application Entry Point
 * 
 * Supports multiple environments: dev, dev1, staging, prod
 * Usage: npx cdk deploy --all -c env=dev1
 */

const app = new cdk.App();

// Get environment from context (default to 'dev' for backwards compatibility)
const envName = app.node.tryGetContext('env') || 'dev';

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
 * 3. StorageStack - S3 buckets
 * 4. KmsStack - KMS keys
 * 
 * Phase 2: Authentication (Dependent Stacks)
 * 5. CognitoStack - User Pool (depends on KmsStack)
 * 6. AuthTriggerStack - Lambda triggers (depends on all Phase 1 + CognitoStack)
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

// Stack 3: S3 Storage
const storageStack = new StorageStack(app, `${stackPrefix}StorageStack`, {
  env,
  description: `S3 storage for host documents and listing images (${stage})`,
  stackName: `localstays-${stage}-storage`,
  stage,
});

// Stack 4: KMS Keys
const kmsStack = new KmsStack(app, `${stackPrefix}KmsStack`, {
  env,
  description: `KMS keys for encryption (${stage})`,
  stackName: `localstays-${stage}-kms`,
  stage,
});

// Phase 2: Authentication Stacks

// Stack 5: Cognito User Pool
const cognitoStack = new CognitoStack(app, `${stackPrefix}CognitoStack`, {
  env,
  description: `Cognito User Pool with custom attributes (${stage})`,
  stackName: `localstays-${stage}-cognito`,
  stage,
  kmsKey: kmsStack.cognitoCustomSenderKey,
});
cognitoStack.addDependency(kmsStack);

// Stack 6: Auth Triggers (Lambda functions)
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

console.log(`✅ Stack dependencies configured for ${stage} environment`);
console.log('📦 Stacks to deploy:');
console.log(`   1. ${paramsStack.stackName} (SSM Parameters)`);
console.log(`   2. ${dataStack.stackName} (DynamoDB)`);
console.log(`   3. ${storageStack.stackName} (S3)`);
console.log(`   4. ${kmsStack.stackName} (KMS)`);
console.log(`   5. ${cognitoStack.stackName} (Cognito User Pool)`);
console.log(`   6. ${authTriggerStack.stackName} (Lambda Triggers)`);

// Add global tags to all resources
cdk.Tags.of(app).add('Project', 'Localstays');
cdk.Tags.of(app).add('Environment', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
cdk.Tags.of(app).add('CostCenter', 'Engineering');

app.synth();
