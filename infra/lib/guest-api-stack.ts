import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface GuestApiStackProps extends cdk.StackProps {
  stage: string;
  table: dynamodb.Table;
  locationsTable: dynamodb.Table;
  publicListingsTable: dynamodb.Table;
  availabilityTable: dynamodb.Table;
  rateLimitTable: dynamodb.Table;
  userPool: cognito.UserPool;
}

/**
 * Guest API Stack
 * 
 * Public-facing API for unauthenticated guests and authenticated members.
 * Supports optional authentication for pricing differentiation.
 * 
 * Endpoints:
 * - GET /api/v1/public/locations/search - Location autocomplete (no auth required)
 * - GET /api/v1/public/listings/search - Property search (optional auth)
 * - GET /api/v1/public/listings/{listingId} - Property details (optional auth)
 */
export class GuestApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: GuestApiStackProps) {
    super(scope, id, props);

    const { stage, table, locationsTable, publicListingsTable, availabilityTable, rateLimitTable, userPool } = props;

    // ========================================
    // CloudWatch Log Group for API Gateway
    // ========================================
    const logGroup = new logs.LogGroup(this, 'GuestApiLogs', {
      logGroupName: `/aws/apigateway/localstays-${stage}-guest-api`,
      retention: stage === 'prod' ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ========================================
    // API Gateway
    // ========================================
    this.api = new apigateway.RestApi(this, 'GuestApi', {
      restApiName: `localstays-${stage}-guest-api`,
      description: `Localstays Guest API (${stage}) - Public endpoints for guests and members`,
      
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
        
        // Throttling settings - conservative for public API
        throttlingRateLimit: stage === 'prod' ? 500 : 100,
        throttlingBurstLimit: stage === 'prod' ? 1000 : 200,
      },
      
      // CORS configuration - restrict to localhost and staging domain
      defaultCorsPreflightOptions: {
        allowOrigins: stage === 'prod' 
          ? ['https://localstays.me', 'https://www.localstays.me']
          : apigateway.Cors.ALL_ORIGINS, // Allow all origins in non-prod for local development (including mobile on local network)
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true,
      },
      
      // Endpoint configuration
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      
      cloudWatchRole: true,
    });

    // Note: Gateway responses use static headers, so we can't dynamically set origin
    // The Lambda will handle CORS headers dynamically based on the request origin
    // These are fallback headers for error responses
    const allowedOrigins = stage === 'prod'
      ? 'https://localstays.me,https://www.localstays.me'
      : 'http://localhost:3000,http://localhost:3001,https://staging.localstays.me';

    this.api.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      statusCode: '401',
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${allowedOrigins}'`,
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    this.api.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      statusCode: '403',
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${allowedOrigins}'`,
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    this.api.addGatewayResponse('Default4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${allowedOrigins}'`,
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    this.api.addGatewayResponse('Default5XX', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${allowedOrigins}'`,
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      },
    });

    // Create optional Cognito authorizer (for member pricing in future endpoints)
    // Note: Not used for location search, but will be used for property search
    this.authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'GuestCognitoAuthorizer',
      {
        cognitoUserPools: [userPool],
        authorizerName: `localstays-${stage}-guest-authorizer`,
        identitySource: 'method.request.header.Authorization',
        resultsCacheTtl: cdk.Duration.minutes(5),
      }
    );
    
    // Attach authorizer to API (required even if not used yet)
    this.authorizer._attachToApi(this.api);

    // ========================================
    // Common Lambda Configuration
    // ========================================
    const commonEnvironment = {
      MAIN_TABLE_NAME: table.tableName,
      LOCATIONS_TABLE_NAME: locationsTable.tableName,
      PUBLIC_LISTINGS_TABLE_NAME: publicListingsTable.tableName,
      AVAILABILITY_TABLE_NAME: availabilityTable.tableName,
      RATE_LIMIT_TABLE_NAME: rateLimitTable.tableName,
      STAGE: stage,
      // Configuration for search-listings
      MAX_RESULTS_LIMIT: '100',
      AVAILABILITY_BATCH_SIZE: '40',
      PRICING_BATCH_SIZE: '40',
    };

    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: commonEnvironment,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'es2020',
        externalModules: ['@aws-sdk/*'],
      },
    };

    // ========================================
    // API Structure: /api/v1/public
    // ========================================
    const apiRoot = this.api.root.addResource('api');
    const v1 = apiRoot.addResource('v1');
    const publicResource = v1.addResource('public');

    // ========================================
    // Location Search Endpoint
    // GET /api/v1/public/locations/search?q={query}
    // ========================================
    const locationsResource = publicResource.addResource('locations');
    const searchLocationsResource = locationsResource.addResource('search');

    const searchLocationsLambda = new nodejs.NodejsFunction(this, 'SearchLocationsFunction', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-search-locations`,
      entry: 'backend/services/api/guest/search-locations.ts',
      handler: 'handler',
      description: 'Search locations for autocomplete (no auth required)',
    });

    // Grant permissions
    locationsTable.grantReadData(searchLocationsLambda);
    rateLimitTable.grantReadWriteData(searchLocationsLambda);

    // Add method (no authorizer - public endpoint)
    // Note: Lambda handles CORS headers dynamically based on request origin
    searchLocationsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(searchLocationsLambda, {
        proxy: true,
      })
    );

    // ========================================
    // Listing Search Endpoint
    // GET /api/v1/public/listings/search?locationId={id}&checkIn={date}&checkOut={date}&adults={n}
    // ========================================
    const listingsResource = publicResource.addResource('listings');
    const searchListingsResource = listingsResource.addResource('search');

    const searchListingsLambda = new nodejs.NodejsFunction(this, 'SearchListingsFunction', {
      ...commonLambdaProps,
      functionName: `localstays-${stage}-search-listings`,
      entry: 'backend/services/api/guest/search-listings.ts',
      handler: 'handler',
      description: 'Search available listings with pricing (optional auth for member pricing)',
      timeout: cdk.Duration.seconds(30), // Longer timeout for complex queries
      memorySize: 1024, // More memory for parallel processing
    });

    // Grant permissions
    table.grantReadData(searchListingsLambda); // For pricing matrix
    locationsTable.grantReadData(searchListingsLambda); // For slug resolution
    publicListingsTable.grantReadData(searchListingsLambda);
    availabilityTable.grantReadData(searchListingsLambda);
    rateLimitTable.grantReadWriteData(searchListingsLambda);

    // Add method without authorizer (authentication is optional)
    // Lambda will check Authorization header manually if present
    // This allows both authenticated (member pricing) and anonymous (standard pricing) access
    searchListingsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(searchListingsLambda, {
        proxy: true,
      })
    );

    // ========================================
    // Outputs
    // ========================================
    new cdk.CfnOutput(this, 'GuestApiUrl', {
      value: this.api.url,
      description: 'Guest API Gateway URL',
      exportName: `localstays-${stage}-guest-api-url`,
    });

    new cdk.CfnOutput(this, 'GuestApiId', {
      value: this.api.restApiId,
      description: 'Guest API Gateway ID',
      exportName: `localstays-${stage}-guest-api-id`,
    });
  }
}

