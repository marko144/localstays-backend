import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Properties for ApiGatewayStack
 */
export interface ApiGatewayStackProps extends cdk.StackProps {
  /** Environment stage (dev, dev1, staging, prod) */
  stage: string;
  /** Cognito User Pool ID for authorizer */
  userPoolId: string;
  /** Cognito User Pool ARN for authorizer */
  userPoolArn: string;
}

/**
 * Stack for API Gateway REST API
 * Provides authenticated endpoints for the Localstays platform
 */
export class ApiGatewayStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: ApiGatewayStackProps) {
    super(scope, id, props);

    const { stage, userPoolId, userPoolArn } = props;

    // Import existing User Pool
    const userPool = cognito.UserPool.fromUserPoolArn(
      this,
      'UserPool',
      userPoolArn
    );

    // Create CloudWatch Log Group for API Gateway logs
    const logGroup = new logs.LogGroup(this, 'ApiGatewayLogs', {
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
      
      // Deploy options
      deploy: true,
      deployOptions: {
        stageName: stage,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true,
        }),
        
        // Throttling settings (per-stage)
        throttlingRateLimit: stage === 'prod' ? 1000 : 100,
        throttlingBurstLimit: stage === 'prod' ? 2000 : 200,
      },
      
      // CORS configuration - restrict to specific origins
      defaultCorsPreflightOptions: {
        allowOrigins: stage === 'prod' 
          ? ['https://portal.localstays.me', 'https://localstays.me', 'https://www.localstays.me']
          : [
              'http://localhost:3000',
              'http://192.168.4.54:3000',
              'https://staging.portal.localstays.me',
              'https://staging.localstays.me',
            ],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true,
      },
      
      // API key configuration (optional, for monitoring)
      apiKeySourceType: apigateway.ApiKeySourceType.HEADER,
      
      // Endpoint configuration
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      
      // Removal policy
      cloudWatchRole: true,
    });

    // Create Cognito User Pools Authorizer
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

    // Create API structure: /api/v1
    const apiRoot = this.api.root.addResource('api');
    const v1 = apiRoot.addResource('v1');

    // Create /api/v1/hosts resource
    const hosts = v1.addResource('hosts');
    const hostId = hosts.addResource('{hostId}');

    // Create /api/v1/hosts/{hostId}/profile resource
    const profile = hostId.addResource('profile');

    // Export resource for use in Lambda stack
    // Store as stack property for Lambda stack to access
    (this as any).hostsResource = hosts;
    (this as any).hostIdResource = hostId;
    (this as any).profileResource = profile;

    // Create Usage Plan for rate limiting
    const usagePlan = this.api.addUsagePlan('UsagePlan', {
      name: `localstays-${stage}-usage-plan`,
      description: `Usage plan for ${stage} environment`,
      throttle: {
        rateLimit: stage === 'prod' ? 100 : 10,  // requests per second
        burstLimit: stage === 'prod' ? 200 : 20, // burst capacity
      },
      quota: {
        limit: stage === 'prod' ? 100000 : 10000, // daily quota
        period: apigateway.Period.DAY,
      },
    });

    // Associate usage plan with deployed stage
    usagePlan.addApiStage({
      stage: this.api.deploymentStage,
    });

    // Outputs
    const capitalizedStage = this.capitalize(stage);

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

    new cdk.CfnOutput(this, 'ApiRootResourceId', {
      value: this.api.root.resourceId,
      description: 'API Gateway root resource ID',
      exportName: `Localstays${capitalizedStage}ApiRootResourceId`,
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

