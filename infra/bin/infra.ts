#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ParamsStack } from '../lib/params-stack';
import { DataStack } from '../lib/data-stack';
import { AuthTriggerStack } from '../lib/auth-trigger-stack';
import { CognitoStack } from '../lib/cognito-stack';

/**
 * Localstays Backend Infrastructure
 * AWS CDK Application Entry Point
 * 
 * Environment: Development
 * Region: eu-north-1 (Europe Stockholm)
 */

const app = new cdk.App();

// Environment configuration
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'eu-north-1', // Europe (Stockholm)
};

// Get User Pool ID from context (required for deployment, optional for bootstrap)
const userPoolId = app.node.tryGetContext('userPoolId');

// Only create auth stack if User Pool ID is provided
if (userPoolId) {
  console.log('🚀 Deploying Localstays Backend Infrastructure');
  console.log(`📍 Region: ${env.region}`);
  console.log(`👤 User Pool: ${userPoolId}`);
} else {
  console.log('⚠️  Skipping AuthTriggerStack - User Pool ID not provided');
  console.log('💡 For full deployment, use: -c userPoolId=eu-north-1_NhDbGTVZd');
}

// Stack 1: SSM Parameters
const paramsStack = new ParamsStack(app, 'LocalstaysDevParamsStack', {
  env,
  description: 'SSM Parameter Store configuration for Localstays development environment',
  stackName: 'localstays-dev-params',
});

// Stack 2: DynamoDB Data Layer
const dataStack = new DataStack(app, 'LocalstaysDevDataStack', {
  env,
  description: 'DynamoDB tables and data infrastructure for Localstays development environment',
  stackName: 'localstays-dev-data',
});

// Stack 3: Auth Triggers (Lambda functions)
const authTriggerStack = new AuthTriggerStack(app, 'LocalstaysDevAuthTriggerStack', {
  env,
  description: 'Cognito authentication triggers and Lambda functions for Localstays development environment',
  stackName: 'localstays-dev-auth-triggers',
  userPoolId: userPoolId || 'placeholder', // Placeholder for initial deployment
  tableName: dataStack.table.tableName,
  tableArn: dataStack.table.tableArn,
  sendGridParamName: paramsStack.sendGridParamName,
});

authTriggerStack.addDependency(paramsStack);
authTriggerStack.addDependency(dataStack);

// Stack 4: Cognito User Pool (NEW - with custom attributes)
const cognitoStack = new CognitoStack(app, 'LocalstaysDevCognitoStack', {
  env,
  description: 'Cognito User Pool with custom attributes for Localstays development environment',
  stackName: 'localstays-dev-cognito',
  kmsKey: authTriggerStack.kmsKey,
});

cognitoStack.addDependency(authTriggerStack);

console.log('✅ Cognito User Pool will be created with custom attributes for consent tracking');

// Add global tags to all resources
cdk.Tags.of(app).add('Project', 'Localstays');
cdk.Tags.of(app).add('Environment', 'dev');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
cdk.Tags.of(app).add('CostCenter', 'Engineering');

app.synth();

