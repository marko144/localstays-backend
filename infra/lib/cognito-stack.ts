import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

/**
 * Properties for CognitoStack
 */
export interface CognitoStackProps extends cdk.StackProps {
  /** KMS key for Custom Email Sender encryption */
  kmsKey: kms.IKey;
  /** Environment stage (dev, dev1, staging, prod) */
  stage: string;
}

/**
 * Stack for Cognito User Pool with custom attributes
 * Configured for Custom Email Sender trigger and consent tracking
 */
export class CognitoStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly hostGroup: cognito.CfnUserPoolGroup;
  public readonly adminGroup: cognito.CfnUserPoolGroup;

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);

    const { kmsKey, stage } = props;

    // Create User Pool with custom attributes
    this.userPool = new cognito.UserPool(this, 'LocalstaysUserPool', {
      userPoolName: `localstays-${stage}-users`,
      
      // Sign-in configuration
      signInAliases: {
        email: true,
        username: false,
      },
      
      // Auto-verify email (required for Custom Email Sender)
      autoVerify: {
        email: true,
      },

      // Custom attributes for consent tracking
      customAttributes: {
        termsAccepted: new cognito.StringAttribute({ mutable: true }),
        termsAcceptedAt: new cognito.StringAttribute({ mutable: true }),
        marketingOptIn: new cognito.StringAttribute({ mutable: true }),
        marketingOptInAt: new cognito.StringAttribute({ mutable: true }),
      },

      // Standard attributes
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },

      // Password policy
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },

      // MFA configuration
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },

      // Account recovery
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,

      // Self-service sign up
      selfSignUpEnabled: true,

      // User verification
      userVerification: {
        emailSubject: 'Verify your Localstays account',
        emailBody: 'Your verification code is {####}',
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },

      // Device tracking
      deviceTracking: {
        challengeRequiredOnNewDevice: false,
        deviceOnlyRememberedOnUserPrompt: true,
      },

      // Deletion protection (enable for prod)
      deletionProtection: stage === 'prod',
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,

      // Custom Email Sender KMS key
      // Note: Lambda triggers will be attached after deployment via CLI
      customSenderKmsKey: kmsKey,

      // Advanced Security Mode (REQUIRED for Custom Email Sender)
      // Note: Must be enabled for CustomEmailSender to work
      // ⚠️ COMMENTED OUT FOR INITIAL DEPLOYMENT - requires Plus tier
      // After deployment, manually upgrade to Plus tier and enable ENFORCED mode via CLI:
      // aws cognito-idp update-user-pool --user-pool-id <POOL_ID> \
      //   --user-pool-add-ons AdvancedSecurityMode=ENFORCED --region eu-north-1
      // advancedSecurityMode: cognito.AdvancedSecurityMode.AUDIT,
    });

    // Create User Pool Client (for frontend)
    this.userPoolClient = new cognito.UserPoolClient(this, 'LocalstaysUserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `localstays-${stage}-web-client`,
      
      // Auth flows
      authFlows: {
        userPassword: true,
        userSrp: true,
      },

      // OAuth settings (for future use)
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
      },

      // Token validity
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),

      // Prevent user existence errors
      preventUserExistenceErrors: true,

      // Enable token revocation
      enableTokenRevocation: true,

      // Read/write attributes
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          emailVerified: true,
        })
        .withCustomAttributes('termsAccepted', 'termsAcceptedAt', 'marketingOptIn', 'marketingOptInAt'),

      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
        })
        .withCustomAttributes('termsAccepted', 'termsAcceptedAt', 'marketingOptIn', 'marketingOptInAt'),
    });

    // Create Cognito Groups for role-based access control
    this.hostGroup = new cognito.CfnUserPoolGroup(this, 'HostGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'HOST',
      description: 'Host users who can list properties',
      precedence: 10,
    });

    this.adminGroup = new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'ADMIN',
      description: 'Admin users with full system access',
      precedence: 5, // Lower precedence = higher priority
    });

    // Outputs (with environment-specific export names)
    const capitalizedStage = this.capitalize(stage);
    
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `Localstays${capitalizedStage}UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Cognito User Pool ARN',
      exportName: `Localstays${capitalizedStage}UserPoolArn`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID (for frontend)',
      exportName: `Localstays${capitalizedStage}UserPoolClientId`,
    });

    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'AWS Region',
    });

    new cdk.CfnOutput(this, 'HostGroupName', {
      value: this.hostGroup.groupName!,
      description: 'HOST group name',
      exportName: `Localstays${capitalizedStage}HostGroupName`,
    });

    new cdk.CfnOutput(this, 'AdminGroupName', {
      value: this.adminGroup.groupName!,
      description: 'ADMIN group name',
      exportName: `Localstays${capitalizedStage}AdminGroupName`,
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

