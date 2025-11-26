import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Properties for PublicApiStack
 */
export interface PublicApiStackProps extends cdk.StackProps {
  /** Environment stage (dev, dev1, staging, prod) */
  stage: string;
  /** Cognito User Pool ID for authorizer */
  userPoolId: string;
  /** Cognito User Pool ARN for authorizer */
  userPoolArn: string;
  /** Main DynamoDB table */
  table: dynamodb.Table;
  /** Rate limit DynamoDB table */
  rateLimitTable: dynamodb.Table;
  /** Hourly geocode limit per user */
  geocodeHourlyLimit?: number;
  /** Lifetime geocode limit per user */
  geocodeLifetimeLimit?: number;
}

/**
 * PublicApiStack - Public/Unauthenticated API
 * 
 * Contains API Gateway and Lambda functions for public endpoints:
 * - Geocoding rate limiting (authenticated, but public-facing)
 * 
 * Future endpoints that could go here:
 * - Public listing search
 * - Public listing details
 * - Public property type metadata
 */
export class PublicApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;
  
  // Lambda functions
  public readonly checkAndIncrementRateLimitLambda: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: PublicApiStackProps) {
    super(scope, id, props);

    const { 
      stage, 
      userPoolId, 
      userPoolArn, 
      table,
      rateLimitTable,
      geocodeHourlyLimit = 20,
      geocodeLifetimeLimit = 100,
    } = props;

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
    const apiLogGroup = new logs.LogGroup(this, 'PublicApiGatewayLogs', {
      logGroupName: `/aws/apigateway/localstays-${stage}-public-api`,
      retention: stage === 'prod' 
        ? logs.RetentionDays.ONE_YEAR 
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy: stage === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Create REST API (Public API)
    this.api = new apigateway.RestApi(this, 'PublicApi', {
      restApiName: `localstays-${stage}-public-api`,
      description: `Localstays Public API (${stage}) - Public-facing endpoints`,
      
      deploy: true,
      deployOptions: {
        stageName: stage,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        // Public endpoints need higher rate limits
        throttlingRateLimit: stage === 'prod' ? 2000 : 200,
        throttlingBurstLimit: stage === 'prod' ? 4000 : 400,
      },
      
      defaultCorsPreflightOptions: {
        allowOrigins: stage === 'prod' 
          ? ['https://portal.localstays.me', 'https://localstays.me', 'https://www.localstays.me']
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

    // Add Gateway Responses for CORS on errors
    this.api.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      statusCode: '401',
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    this.api.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      statusCode: '403',
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    this.api.addGatewayResponse('Default4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    this.api.addGatewayResponse('Default5XX', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    // Create Cognito authorizer
    this.authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'PublicCognitoAuthorizer',
      {
        cognitoUserPools: [userPool],
        authorizerName: `localstays-${stage}-public-authorizer`,
        identitySource: 'method.request.header.Authorization',
        resultsCacheTtl: cdk.Duration.minutes(5),
      }
    );

    // ========================================
    // Lambda Functions Setup
    // ========================================

    // Common environment variables
    const commonEnvironment = {
      TABLE_NAME: table.tableName,
      RATE_LIMIT_TABLE_NAME: rateLimitTable.tableName,
      GEOCODE_HOURLY_LIMIT: geocodeHourlyLimit.toString(),
      GEOCODE_LIFETIME_LIMIT: geocodeLifetimeLimit.toString(),
    };

    // Common Lambda configuration
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'es2022',
        externalModules: ['@aws-sdk/*'],
      },
    };
    
    // Log retention configuration (applied per Lambda)
    const logRetentionDays = stage === 'prod' 
      ? logs.RetentionDays.ONE_MONTH 
      : logs.RetentionDays.ONE_WEEK;
    const logRemovalPolicy = stage === 'prod' 
      ? cdk.RemovalPolicy.RETAIN 
      : cdk.RemovalPolicy.DESTROY;

    // ========================================
    // RATE LIMIT LAMBDA (GEOCODING)
    // ========================================

    // Check and increment rate limit (POST /api/v1/geocode/rate-limit)
    // Atomically checks if user is under limit and increments counters if allowed
    this.checkAndIncrementRateLimitLambda = new nodejs.NodejsFunction(this, 'CheckAndIncrementRateLimitLambda', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-check-increment-rate-limit`,
      entry: 'backend/services/api/geocode/check-and-increment-rate-limit.ts',
      handler: 'handler',
      description: 'Check and increment geocoding rate limit atomically',
      environment: commonEnvironment,
      logGroup: new logs.LogGroup(this, 'CheckAndIncrementRateLimitLogs', {
        logGroupName: `/aws/lambda/localstays-${stage}-check-increment-rate-limit`,
        retention: logRetentionDays,
        removalPolicy: logRemovalPolicy,
      }),
    });

    // Grant DynamoDB permissions
    rateLimitTable.grantReadWriteData(this.checkAndIncrementRateLimitLambda);

    // ========================================
    // API Gateway Routes
    // ========================================

    const apiRoot = this.api.root.addResource('api');
    const v1 = apiRoot.addResource('v1');
    const geocodeResource = v1.addResource('geocode');
    const rateLimitResource = geocodeResource.addResource('rate-limit');

    // POST /api/v1/geocode/rate-limit
    // Atomically checks rate limit and increments if allowed
    rateLimitResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.checkAndIncrementRateLimitLambda, { proxy: true }),
      {
        authorizer: this.authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // ========================================
    // Stack Outputs
    // ========================================

    const capitalizedStage = this.capitalize(stage);

    // API Gateway outputs
    new cdk.CfnOutput(this, 'PublicApiEndpoint', {
      value: this.api.url,
      description: 'Public API Gateway endpoint URL',
      exportName: `Localstays${capitalizedStage}PublicApiEndpoint`,
    });

    new cdk.CfnOutput(this, 'PublicApiId', {
      value: this.api.restApiId,
      description: 'Public API Gateway REST API ID',
      exportName: `Localstays${capitalizedStage}PublicApiId`,
    });

    // Lambda outputs
    new cdk.CfnOutput(this, 'CheckAndIncrementRateLimitLambdaName', {
      value: this.checkAndIncrementRateLimitLambda.functionName,
      description: 'Check and Increment Rate Limit Lambda function name',
      exportName: `Localstays${capitalizedStage}CheckAndIncrementRateLimitLambda`,
    });

    // Add tags
    cdk.Tags.of(this).add('Environment', stage);
    cdk.Tags.of(this).add('Project', 'Localstays');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    cdk.Tags.of(this).add('StackType', 'PublicApi');
  }

  /**
   * Capitalize first letter of string (for export names)
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

