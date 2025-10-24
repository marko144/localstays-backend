import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * Properties for KmsStack
 */
export interface KmsStackProps extends cdk.StackProps {
  /** Environment stage (dev, staging, prod) */
  stage: string;
}

/**
 * Stack for KMS keys used across the application
 * 
 * This stack is separate to avoid circular dependencies:
 * - CognitoStack needs the KMS key for Custom Email Sender
 * - AuthTriggerStack needs the KMS key for decryption
 * - Both can reference this stack independently
 */
export class KmsStack extends cdk.Stack {
  public readonly cognitoCustomSenderKey: kms.Key;

  constructor(scope: Construct, id: string, props: KmsStackProps) {
    super(scope, id, props);

    const { stage } = props;

    // Create KMS key for Cognito Custom Email Sender
    // This key encrypts the verification codes sent by Cognito
    this.cognitoCustomSenderKey = new kms.Key(this, 'CognitoCustomSenderKey', {
      description: `KMS key for Cognito Custom Email Sender encryption (${stage})`,
      enableKeyRotation: true,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      alias: `localstays/${stage}/cognito-custom-sender`,
    });

    // Grant Cognito service permission to use the key
    this.cognitoCustomSenderKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'Allow Cognito to use the key',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('cognito-idp.amazonaws.com')],
        actions: ['kms:Decrypt', 'kms:CreateGrant'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'kms:ViaService': `cognito-idp.${this.region}.amazonaws.com`,
          },
        },
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'CognitoKmsKeyId', {
      value: this.cognitoCustomSenderKey.keyId,
      description: 'KMS key ID for Cognito Custom Email Sender',
      exportName: `Localstays${this.capitalize(stage)}CognitoKmsKeyId`,
    });

    new cdk.CfnOutput(this, 'CognitoKmsKeyArn', {
      value: this.cognitoCustomSenderKey.keyArn,
      description: 'KMS key ARN for Cognito Custom Email Sender',
      exportName: `Localstays${this.capitalize(stage)}CognitoKmsKeyArn`,
    });

    // Add tags
    cdk.Tags.of(this).add('Project', 'Localstays');
    cdk.Tags.of(this).add('Environment', stage);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }

  /**
   * Capitalize first letter of string (for export names)
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}


