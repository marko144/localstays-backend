import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

/**
 * Properties for ParamsStack
 */
export interface ParamsStackProps extends cdk.StackProps {
  /** Environment stage (dev, dev1, staging, prod) */
  stage: string;
}

/**
 * Stack for managing SSM Parameter Store parameters
 * Contains configuration and secrets for the Localstays platform
 */
export class ParamsStack extends cdk.Stack {
  public readonly sendGridParamName: string;

  constructor(scope: Construct, id: string, props: ParamsStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // SendGrid API Key parameter name
    // Note: This parameter should be created manually or via script before deployment
    // Use: scripts/copy-sendgrid-key.sh <source_env> <target_env>
    this.sendGridParamName = `/localstays/${stage}/sendgrid`;

    // Outputs (with environment-specific export names)
    const capitalizedStage = this.capitalize(stage);
    
    new cdk.CfnOutput(this, 'SendGridParamName', {
      value: this.sendGridParamName,
      description: 'SSM Parameter name for SendGrid API key',
      exportName: `Localstays${capitalizedStage}SendGridParam`,
    });

    // Add tags for resource management
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

