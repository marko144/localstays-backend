import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface EmailTemplateStackProps extends cdk.StackProps {
  stage: string;
}

/**
 * Email Template Stack
 * 
 * Creates DynamoDB table for storing multilingual email templates
 * and seeds initial templates via CustomResource
 */
export class EmailTemplateStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly tableName: string;
  public readonly tableArn: string;

  constructor(scope: Construct, id: string, props: EmailTemplateStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // ========================================
    // DynamoDB Table for Email Templates
    // ========================================
    this.table = new dynamodb.Table(this, 'EmailTemplatesTable', {
      tableName: `localstays-${stage}-email-templates`,
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    this.tableName = this.table.tableName;
    this.tableArn = this.table.tableArn;

    // ========================================
    // Seed Lambda for Email Templates
    // ========================================
    const seedHandler = new nodejs.NodejsFunction(this, 'SeedEmailTemplatesHandler', {
      functionName: `localstays-${stage}-seed-email-templates`,
      entry: 'backend/services/seed/seed-email-templates-handler.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.tableName,
        STAGE: stage,
      },
      bundling: {
        externalModules: ['aws-sdk'],
        minify: true,
      },
    });

    // Grant permissions to seed Lambda
    this.table.grantWriteData(seedHandler);

    // ========================================
    // Custom Resource to Trigger Seeding
    // ========================================
    const seedProvider = new cr.Provider(this, 'SeedEmailTemplatesProvider', {
      onEventHandler: seedHandler,
    });

    new cdk.CustomResource(this, 'SeedEmailTemplatesCustomResource', {
      serviceToken: seedProvider.serviceToken,
      properties: {
        Version: '1.0.0', // Increment to force re-seeding
      },
    });

    // ========================================
    // Outputs
    // ========================================
    new cdk.CfnOutput(this, 'EmailTemplatesTableName', {
      value: this.tableName,
      description: 'Email templates DynamoDB table name',
      exportName: `Localstays${this.capitalize(stage)}EmailTemplatesTableName`,
    });

    new cdk.CfnOutput(this, 'EmailTemplatesTableArn', {
      value: this.tableArn,
      description: 'Email templates DynamoDB table ARN',
      exportName: `Localstays${this.capitalize(stage)}EmailTemplatesTableArn`,
    });
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}



