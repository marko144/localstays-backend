import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

/**
 * Stack for managing SSM Parameter Store parameters
 * Contains configuration and secrets for the Localstays platform
 */
export class ParamsStack extends cdk.Stack {
  public readonly sendGridParamName: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // SendGrid API Key parameter (SecureString)
    // Initialize with placeholder - must be updated before first use
    const sendGridParam = new ssm.StringParameter(this, 'SendGridApiKey', {
      parameterName: '/localstays/dev/sendgrid',
      description: 'SendGrid API key for sending transactional emails',
      stringValue: 'PLACEHOLDER_REPLACE_BEFORE_USE',
      tier: ssm.ParameterTier.STANDARD,
    });

    this.sendGridParamName = sendGridParam.parameterName;

    // Outputs
    new cdk.CfnOutput(this, 'SendGridParamName', {
      value: this.sendGridParamName,
      description: 'SSM Parameter name for SendGrid API key',
      exportName: 'LocalstaysDevSendGridParam',
    });

    // Add tags for resource management
    cdk.Tags.of(this).add('Environment', 'dev');
    cdk.Tags.of(this).add('Project', 'Localstays');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }
}

