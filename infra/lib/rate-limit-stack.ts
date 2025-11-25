import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * Properties for RateLimitStack
 */
export interface RateLimitStackProps extends cdk.StackProps {
  /** Environment stage (dev, dev1, staging, prod) */
  stage: string;
}

/**
 * Stack for Mapbox geocoding rate limiting
 * Separate table for security isolation and independent scaling
 */
export class RateLimitStack extends cdk.Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: RateLimitStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // Rate limiting table - stores hourly and lifetime geocode usage per user
    this.table = new dynamodb.Table(this, 'GeocodeRateLimitsTable', {
      tableName: `geocode-rate-limits-${stage}`,
      
      // Simple key-value design
      // Hourly records: id = "hourly:userId:timestamp"
      // Lifetime records: id = "lifetime:userId"
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      
      // On-demand billing (no provisioned capacity)
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      
      // TTL for automatic cleanup of hourly records
      timeToLiveAttribute: 'ttl',
      
      // Encryption at rest using AWS-owned keys (no KMS charges, same security)
      // Note: Use DEFAULT instead of AWS_MANAGED to avoid KMS API charges
      encryption: dynamodb.TableEncryption.DEFAULT,
      
      // NO point-in-time recovery (data is disposable, saves cost)
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: false,
      },
      
      // Removal policy: DESTROY even in prod (rate limit data is disposable)
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
      
      // NO streams (no event processing needed)
      stream: undefined,
    });

    // Outputs
    const capitalizedStage = this.capitalize(stage);
    
    new cdk.CfnOutput(this, 'RateLimitTableName', {
      value: this.table.tableName,
      description: 'Geocode rate limits DynamoDB table name',
      exportName: `Localstays${capitalizedStage}RateLimitTableName`,
    });

    new cdk.CfnOutput(this, 'RateLimitTableArn', {
      value: this.table.tableArn,
      description: 'Geocode rate limits DynamoDB table ARN',
      exportName: `Localstays${capitalizedStage}RateLimitTableArn`,
    });

    // Add tags
    cdk.Tags.of(this).add('Environment', stage);
    cdk.Tags.of(this).add('Project', 'Localstays');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    cdk.Tags.of(this).add('Purpose', 'MapboxRateLimiting');
  }

  /**
   * Capitalize first letter of string (for export names)
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}


