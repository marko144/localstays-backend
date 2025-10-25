import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Properties for ApiLambdaStack (Combined API Gateway + Lambdas)
 */
export interface ApiLambdaStackProps extends cdk.StackProps {
  /** Environment stage (dev, dev1, staging, prod) */
  stage: string;
  /** Cognito User Pool ID for authorizer */
  userPoolId: string;
  /** Cognito User Pool ARN for authorizer */
  userPoolArn: string;
  /** DynamoDB table */
  table: dynamodb.Table;
  /** S3 bucket for host assets */
  bucket: s3.Bucket;
  /** Email templates DynamoDB table */
  emailTemplatesTable: dynamodb.Table;
  /** SSM parameter name for SendGrid API key */
  sendGridParamName: string;
}

/**
 * Stack for API Gateway and Lambda functions
 * Contains REST API, Cognito authorizer, and all endpoint handlers
 * Combined into one stack to avoid circular dependencies
 */
export class ApiLambdaStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;
  public readonly submitIntentLambda: nodejs.NodejsFunction;
  public readonly confirmSubmissionLambda: nodejs.NodejsFunction;
  public readonly getProfileLambda: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiLambdaStackProps) {
    super(scope, id, props);

    const { stage, userPoolId, userPoolArn, table, bucket, emailTemplatesTable, sendGridParamName } = props;

    // ========================================
    // API Gateway Setup
    // ========================================

    // Import existing User Pool
    const userPool = cognito.UserPool.fromUserPoolArn(
      this,
      'UserPool',
      userPoolArn
    );

    // Create CloudWatch Log Group for API Gateway logs
    const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayLogs', {
      logGroupName: `/aws/apigateway/localstays-${stage}`,
      retention: stage === 'prod' 
        ? logs.RetentionDays.ONE_YEAR 
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Create REST API
    this.api = new apigateway.RestApi(this, 'LocalstaysApi', {
      restApiName: `localstays-${stage}-api`,
      description: `Localstays Platform API (${stage})`,
      
      deploy: true,
      deployOptions: {
        stageName: stage,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        throttlingRateLimit: stage === 'prod' ? 1000 : 100,
        throttlingBurstLimit: stage === 'prod' ? 2000 : 200,
      },
      
      defaultCorsPreflightOptions: {
        allowOrigins: stage === 'prod' 
          ? ['https://app.localstays.com']
          : apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: true,
      },
      
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      
      cloudWatchRole: true,
    });

    // Create Cognito authorizer
    this.authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'CognitoAuthorizer',
      {
        cognitoUserPools: [userPool],
        authorizerName: `localstays-${stage}-authorizer`,
        identitySource: 'method.request.header.Authorization',
        resultsCacheTtl: cdk.Duration.minutes(5),
      }
    );

    // Create API structure: /api/v1/hosts/{hostId}/profile
    const apiRoot = this.api.root.addResource('api');
    const v1 = apiRoot.addResource('v1');
    const hosts = v1.addResource('hosts');
    const hostIdParam = hosts.addResource('{hostId}');
    const profileResource = hostIdParam.addResource('profile');

    // ========================================
    // Lambda Functions Setup
    // ========================================

    // Common environment variables for all Lambda functions
    const commonEnvironment = {
      TABLE_NAME: table.tableName,
      BUCKET_NAME: bucket.bucketName,
      EMAIL_TEMPLATES_TABLE: emailTemplatesTable.tableName,
      SENDGRID_PARAM: sendGridParamName,
      FROM_EMAIL: 'marko@localstays.me', // Same verified SendGrid sender as auth emails
      STAGE: stage,
      // AWS_REGION is automatically set by Lambda runtime
    };

    // Common Lambda configuration
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'es2022',
        externalModules: ['@aws-sdk/*'],
      },
      logRetention: stage === 'prod' 
        ? logs.RetentionDays.ONE_MONTH 
        : logs.RetentionDays.ONE_WEEK,
    };

    // ========================================
    // Submit Intent Lambda
    // ========================================
    this.submitIntentLambda = new nodejs.NodejsFunction(this, 'SubmitIntentLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-submit-intent`,
      entry: 'backend/services/api/hosts/submit-intent.ts',
      handler: 'handler',
      description: 'Create profile submission intent and generate upload URLs',
      environment: commonEnvironment,
    });

    // Grant DynamoDB permissions (least privilege)
    table.grantReadWriteData(this.submitIntentLambda); // For host, document, submission token CRUD

    // Grant S3 permissions for pre-signed URL generation (no actual S3 operations)
    this.submitIntentLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:PutObject', // Needed for generating pre-signed PUT URLs
      ],
      resources: [
        `${bucket.bucketArn}/*`,
      ],
    }));

    // ========================================
    // Confirm Submission Lambda
    // ========================================
    this.confirmSubmissionLambda = new nodejs.NodejsFunction(this, 'ConfirmSubmissionLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-confirm-submission`,
      entry: 'backend/services/api/hosts/confirm-submission.ts',
      handler: 'handler',
      description: 'Verify document uploads and complete profile submission',
      environment: commonEnvironment,
    });

    // Grant DynamoDB permissions (least privilege)
    table.grantReadWriteData(this.confirmSubmissionLambda); // For transactional updates
    emailTemplatesTable.grantReadData(this.confirmSubmissionLambda); // For email templates

    // Grant S3 permissions for verification (HeadObject only)
    this.confirmSubmissionLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:HeadObject',     // Verify object exists
        's3:GetObject',      // For future document validation
      ],
      resources: [
        `${bucket.bucketArn}/*`,
      ],
    }));

    // Grant SSM permissions for SendGrid API key
    this.confirmSubmissionLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter${sendGridParamName}`,
      ],
    }));

    // ========================================
    // Get Profile Lambda
    // ========================================
    this.getProfileLambda = new nodejs.NodejsFunction(this, 'GetProfileLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-get-profile`,
      entry: 'backend/services/api/hosts/get-profile.ts',
      handler: 'handler',
      description: 'Retrieve host profile and document metadata',
      environment: commonEnvironment,
    });

    // Grant DynamoDB permissions (read-only)
    table.grantReadData(this.getProfileLambda); // Only needs read access

    // ========================================
    // API Gateway Integrations
    // ========================================

    // POST /api/v1/hosts/{hostId}/profile/submit-intent
    const submitIntentResource = profileResource.addResource('submit-intent');
    submitIntentResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.submitIntentLambda, {
        proxy: true,
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
            },
          },
        ],
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        methodResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
            },
          },
        ],
        requestValidatorOptions: {
          validateRequestBody: true,
          validateRequestParameters: true,
        },
      }
    );

    // POST /api/v1/hosts/{hostId}/profile/confirm-submission
    const confirmSubmissionResource = profileResource.addResource('confirm-submission');
    confirmSubmissionResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.confirmSubmissionLambda, {
        proxy: true,
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
            },
          },
        ],
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        methodResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
            },
          },
        ],
        requestValidatorOptions: {
          validateRequestBody: true,
          validateRequestParameters: true,
        },
      }
    );

    // GET /api/v1/hosts/{hostId}/profile
    profileResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.getProfileLambda, {
        proxy: true,
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
            },
          },
        ],
      }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        methodResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
            },
          },
        ],
        requestValidatorOptions: {
          validateRequestParameters: true,
        },
      }
    );

    // Grant API Gateway permission to invoke Lambda functions
    // Note: We use a wildcard for SourceArn to avoid circular dependency
    // The specific API Gateway ID will be validated at runtime
    this.submitIntentLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.confirmSubmissionLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));
    this.getProfileLambda.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));

    // Outputs
    const capitalizedStage = this.capitalize(stage);

    // API Gateway outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.api.url,
      description: 'API Gateway endpoint URL',
      exportName: `Localstays${capitalizedStage}ApiEndpoint`,
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      description: 'API Gateway REST API ID',
      exportName: `Localstays${capitalizedStage}ApiId`,
    });

    // Lambda outputs
    new cdk.CfnOutput(this, 'SubmitIntentLambdaName', {
      value: this.submitIntentLambda.functionName,
      description: 'Submit Intent Lambda function name',
      exportName: `Localstays${capitalizedStage}SubmitIntentLambda`,
    });

    new cdk.CfnOutput(this, 'ConfirmSubmissionLambdaName', {
      value: this.confirmSubmissionLambda.functionName,
      description: 'Confirm Submission Lambda function name',
      exportName: `Localstays${capitalizedStage}ConfirmSubmissionLambda`,
    });

    new cdk.CfnOutput(this, 'GetProfileLambdaName', {
      value: this.getProfileLambda.functionName,
      description: 'Get Profile Lambda function name',
      exportName: `Localstays${capitalizedStage}GetProfileLambda`,
    });

    // API Endpoint outputs
    new cdk.CfnOutput(this, 'SubmitIntentEndpoint', {
      value: `${this.api.url}api/v1/hosts/{hostId}/profile/submit-intent`,
      description: 'Submit Intent API endpoint',
    });

    new cdk.CfnOutput(this, 'ConfirmSubmissionEndpoint', {
      value: `${this.api.url}api/v1/hosts/{hostId}/profile/confirm-submission`,
      description: 'Confirm Submission API endpoint',
    });

    new cdk.CfnOutput(this, 'GetProfileEndpoint', {
      value: `${this.api.url}api/v1/hosts/{hostId}/profile`,
      description: 'Get Profile API endpoint',
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
}

