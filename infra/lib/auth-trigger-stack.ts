import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * Properties for AuthTriggerStack
 */
export interface AuthTriggerStackProps extends cdk.StackProps {
  /** Cognito User Pool ID from CognitoStack */
  userPoolId: string;
  /** Cognito User Pool ARN from CognitoStack */
  userPoolArn: string;
  /** KMS key for decrypting verification codes */
  kmsKey: kms.IKey;
  /** DynamoDB table name for user data */
  tableName: string;
  /** DynamoDB table ARN for IAM permissions */
  tableArn: string;
  /** SSM parameter name for SendGrid API key */
  sendGridParamName: string;
  /** S3 bucket name for host assets */
  bucketName: string;
  /** S3 bucket ARN for IAM permissions */
  bucketArn: string;
  /** Environment stage (dev, dev1, staging, prod) */
  stage: string;
}

/**
 * Stack for Cognito authentication triggers and Lambda functions
 * Implements Custom Email Sender trigger for verification emails via SendGrid
 */
export class AuthTriggerStack extends cdk.Stack {
  public readonly customEmailSenderLambda: nodejs.NodejsFunction;
  public readonly preSignUpLambda: nodejs.NodejsFunction;
  public readonly postConfirmationLambda: nodejs.NodejsFunction;
  public readonly preTokenGenerationLambda: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: AuthTriggerStackProps) {
    super(scope, id, props);

    const { userPoolId, userPoolArn, kmsKey, tableName, tableArn, sendGridParamName, bucketName, bucketArn, stage } = props;

    // Custom Email Sender Lambda
    this.customEmailSenderLambda = new nodejs.NodejsFunction(
      this,
      'CustomEmailSenderLambda',
      {
        functionName: `localstays-${stage}-custom-email-sender`,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'handler',
        entry: path.join(
          __dirname,
          '../../backend/services/auth/cognito-custom-email-sender.ts'
        ),
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        
        // Environment variables
        environment: {
          TABLE_NAME: tableName,
          VERIFY_URL_BASE: 'http://localhost:3000/en/verify',
          RESET_PASSWORD_URL_BASE: 'http://localhost:3000/en/reset-password',
          SENDGRID_PARAM: sendGridParamName,
          FROM_EMAIL: 'marko@localstays.me',
          KMS_KEY_ARN: kmsKey.keyArn,
          NODE_OPTIONS: '--enable-source-maps',
        },

        // Bundling configuration
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'es2020',
          externalModules: ['aws-sdk'], // AWS SDK v2 (not needed, we use v3)
          forceDockerBundling: false, // Use local bundling (no Docker required)
        },

        // CloudWatch Logs
        logGroup: new logs.LogGroup(this, 'CustomEmailSenderLogs', {
          logGroupName: `/aws/lambda/localstays-${stage}-custom-email-sender`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),

        // Description
        description: 'Custom Email Sender trigger for Cognito - sends verification emails via SendGrid',
      }
    );

    // Grant Lambda decrypt permission on KMS key
    kmsKey.grantDecrypt(this.customEmailSenderLambda);

    // IAM Policy: SSM Parameter Store access (least privilege)
    this.customEmailSenderLambda.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AllowGetSendGridApiKey',
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`,
        ],
      })
    );

    // IAM Policy: DynamoDB access (least privilege - read/write for consent data)
    this.customEmailSenderLambda.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AllowDynamoDBUserWrite',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem', 'dynamodb:DeleteItem'],
        resources: [tableArn],
      })
    );

    // Grant Cognito permission to invoke the Lambda
    // Note: Since we're using an existing User Pool, we can't modify it via CDK
    // The trigger must be attached manually via AWS CLI (see output command)
    this.customEmailSenderLambda.addPermission('CognitoInvokePermission', {
      principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${userPoolId}`,
    });

    // PreSignUp Lambda (captures consent data from clientMetadata)
    this.preSignUpLambda = new nodejs.NodejsFunction(
      this,
      'PreSignUpLambda',
      {
        functionName: `localstays-${stage}-pre-signup`,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'handler',
        entry: path.join(
          __dirname,
          '../../backend/services/auth/cognito-pre-signup.ts'
        ),
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        
        // Environment variables
        environment: {
          TABLE_NAME: tableName,
          NODE_OPTIONS: '--enable-source-maps',
        },

        // Bundling configuration
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'es2022',
          externalModules: ['aws-sdk'],
          forceDockerBundling: false,
        },

        // CloudWatch Logs
        logGroup: new logs.LogGroup(this, 'PreSignUpLogs', {
          logGroupName: `/aws/lambda/localstays-${stage}-pre-signup`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),

        // Description
        description: 'PreSignUp trigger for Cognito - captures consent data from clientMetadata',
      }
    );

    // IAM Policy: DynamoDB write access for consent data
    this.preSignUpLambda.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AllowDynamoDBConsentWrite',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem'],
        resources: [tableArn],
      })
    );

    // Grant Cognito permission to invoke the PreSignUp Lambda
    this.preSignUpLambda.addPermission('CognitoPreSignUpInvokePermission', {
      principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${userPoolId}`,
    });

    // PostConfirmation Lambda (auto-assigns users to HOST group)
    this.postConfirmationLambda = new nodejs.NodejsFunction(
      this,
      'PostConfirmationLambda',
      {
        functionName: `localstays-${stage}-post-confirmation`,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'handler',
        entry: path.join(
          __dirname,
          '../../backend/services/auth/cognito-post-confirmation.ts'
        ),
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        
        // Environment variables
        environment: {
          USER_POOL_ID: userPoolId,
          TABLE_NAME: tableName,
          BUCKET_NAME: bucketName,
          NODE_OPTIONS: '--enable-source-maps',
        },

        // Bundling configuration
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'es2022',
          externalModules: ['aws-sdk'],
          forceDockerBundling: false,
        },

        // CloudWatch Logs
        logGroup: new logs.LogGroup(this, 'PostConfirmationLogs', {
          logGroupName: `/aws/lambda/localstays-${stage}-post-confirmation`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),

        // Description
        description: 'PostConfirmation trigger for Cognito - auto-assigns users to HOST group',
      }
    );

    // IAM Policy: Allow adding users to groups
    this.postConfirmationLambda.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AllowAddUserToGroup',
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminAddUserToGroup'],
        resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${userPoolId}`],
      })
    );

    // IAM Policy: DynamoDB access for RBAC initialization
    this.postConfirmationLambda.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AllowDynamoDBRBACInit',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [tableArn],
      })
    );

    // IAM Policy: S3 access for creating host folder structure
    this.postConfirmationLambda.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AllowS3HostFolderCreation',
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject'],
        resources: [`${bucketArn}/*`],
      })
    );

    // Grant Cognito permission to invoke the PostConfirmation Lambda
    this.postConfirmationLambda.addPermission('CognitoPostConfirmationInvokePermission', {
      principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${userPoolId}`,
    });

    // PreTokenGeneration Lambda (injects custom claims into JWT)
    this.preTokenGenerationLambda = new nodejs.NodejsFunction(
      this,
      'PreTokenGenerationLambda',
      {
        functionName: `localstays-${stage}-pre-token-generation`,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'handler',
        entry: path.join(
          __dirname,
          '../../backend/services/auth/cognito-pre-token-generation.ts'
        ),
        timeout: cdk.Duration.seconds(5),
        memorySize: 256,
        
        // Environment variables
        environment: {
          TABLE_NAME: tableName,
          NODE_OPTIONS: '--enable-source-maps',
        },

        // Bundling configuration
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'es2022',
          externalModules: ['aws-sdk'],
          forceDockerBundling: false,
        },

        // CloudWatch Logs
        logGroup: new logs.LogGroup(this, 'PreTokenGenerationLogs', {
          logGroupName: `/aws/lambda/localstays-${stage}-pre-token-generation`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),

        // Description
        description: 'PreTokenGeneration trigger for Cognito - injects custom claims (role, hostId, permissions)',
      }
    );

    // IAM Policy: DynamoDB read access for user + role lookup
    this.preTokenGenerationLambda.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AllowDynamoDBReadForClaims',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem'],
        resources: [tableArn],
      })
    );

    // Grant Cognito permission to invoke the PreTokenGeneration Lambda
    this.preTokenGenerationLambda.addPermission('CognitoPreTokenGenerationInvokePermission', {
      principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${userPoolId}`,
    });

    // Outputs (with environment-specific export names)
    const capitalizedStage = this.capitalize(stage);
    
    new cdk.CfnOutput(this, 'CustomEmailSenderLambdaName', {
      value: this.customEmailSenderLambda.functionName,
      description: 'Custom Email Sender Lambda function name',
      exportName: `Localstays${capitalizedStage}CustomEmailSenderName`,
    });

    new cdk.CfnOutput(this, 'CustomEmailSenderLambdaArn', {
      value: this.customEmailSenderLambda.functionArn,
      description: 'Custom Email Sender Lambda function ARN',
      exportName: `Localstays${capitalizedStage}CustomEmailSenderArn`,
    });

    new cdk.CfnOutput(this, 'PreSignUpLambdaName', {
      value: this.preSignUpLambda.functionName,
      description: 'PreSignUp Lambda function name',
      exportName: `Localstays${capitalizedStage}PreSignUpLambdaName`,
    });

    new cdk.CfnOutput(this, 'PreSignUpLambdaArn', {
      value: this.preSignUpLambda.functionArn,
      description: 'PreSignUp Lambda function ARN',
      exportName: `Localstays${capitalizedStage}PreSignUpLambdaArn`,
    });

    new cdk.CfnOutput(this, 'PostConfirmationLambdaName', {
      value: this.postConfirmationLambda.functionName,
      description: 'PostConfirmation Lambda function name',
      exportName: `Localstays${capitalizedStage}PostConfirmationLambdaName`,
    });

    new cdk.CfnOutput(this, 'PostConfirmationLambdaArn', {
      value: this.postConfirmationLambda.functionArn,
      description: 'PostConfirmation Lambda function ARN',
      exportName: `Localstays${capitalizedStage}PostConfirmationLambdaArn`,
    });

    new cdk.CfnOutput(this, 'PreTokenGenerationLambdaName', {
      value: this.preTokenGenerationLambda.functionName,
      description: 'PreTokenGeneration Lambda function name',
      exportName: `Localstays${capitalizedStage}PreTokenGenerationLambdaName`,
    });

    new cdk.CfnOutput(this, 'PreTokenGenerationLambdaArn', {
      value: this.preTokenGenerationLambda.functionArn,
      description: 'PreTokenGeneration Lambda function ARN',
      exportName: `Localstays${capitalizedStage}PreTokenGenerationLambdaArn`,
    });

    // Output AWS CLI command to attach triggers (manual step required)
    new cdk.CfnOutput(this, 'AttachTriggerCommand', {
      value: this.getAttachTriggerCommand(userPoolId),
      description: 'AWS CLI command to attach Custom Email Sender trigger',
    });

    // Add tags
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

  /**
   * Generate AWS CLI command to attach Custom Email Sender trigger
   */
  private getAttachTriggerCommand(userPoolId: string): string {
    return `aws cognito-idp update-user-pool --user-pool-id ${userPoolId} --lambda-config "CustomEmailSender={LambdaVersion=V1_0,LambdaArn=${this.customEmailSenderLambda.functionArn}}" --region ${this.region}`;
  }
}

