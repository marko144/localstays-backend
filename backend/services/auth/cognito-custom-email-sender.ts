import { CustomEmailSenderTriggerHandler } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import * as sgMail from '@sendgrid/mail';
import { KmsKeyringNode, buildClient, CommitmentPolicy } from '@aws-crypto/client-node';

/**
 * Custom Email Sender Lambda for Cognito User Pool
 * 
 * Pattern A: Cognito manages verification codes
 * - Intercepts email sending to use SendGrid instead of SES
 * - Upserts user record to DynamoDB on signup
 * - Sends custom verification email with link to frontend
 * - Sends password reset emails
 * 
 * Trigger Sources:
 * - CustomEmailSender_SignUp: Initial signup verification
 * - CustomEmailSender_ResendCode: User requests code resend
 * - CustomEmailSender_ForgotPassword: Password reset request
 */

// Environment variables (set by CDK)
const TABLE_NAME = process.env.TABLE_NAME!;
const VERIFY_URL_BASE = process.env.VERIFY_URL_BASE!;
const RESET_PASSWORD_URL_BASE = process.env.RESET_PASSWORD_URL_BASE!;
const SENDGRID_PARAM = process.env.SENDGRID_PARAM!;
const FROM_EMAIL = process.env.FROM_EMAIL!;
const KMS_KEY_ARN = process.env.KMS_KEY_ARN!;

// AWS SDK clients (reused across invocations)
const ssmClient = new SSMClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

// Module-scoped cache for SendGrid API key
let sendGridApiKey: string | null = null;

// AWS Encryption SDK client for decrypting Cognito codes
const { decrypt } = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_ALLOW_DECRYPT);

/**
 * Decrypt the verification code sent by Cognito
 * Cognito encrypts the code using KMS before sending it to the Lambda
 */
async function decryptCode(encryptedCode: string, kmsKeyArn: string): Promise<string> {
  try {
    // Note: We need to use generatorKeyId (NOT keyIds) with the full ARN
    const keyring = new KmsKeyringNode({ generatorKeyId: kmsKeyArn });
    
    // Decode from base64 and decrypt
    const { plaintext } = await decrypt(keyring, Buffer.from(encryptedCode, 'base64'));
    
    const decryptedCode = plaintext.toString('utf-8');
    console.log('✅ Code decrypted successfully', {
      encryptedLength: encryptedCode.length,
      decryptedLength: decryptedCode.length,
    });
    
    return decryptedCode;
  } catch (error) {
    console.error('❌ Failed to decrypt verification code:', error);
    throw new Error('Failed to decrypt verification code');
  }
}

/**
 * Load SendGrid API key from SSM Parameter Store (cached)
 */
async function getSendGridApiKey(): Promise<string> {
  if (sendGridApiKey) {
    return sendGridApiKey;
  }

  try {
    const command = new GetParameterCommand({
      Name: SENDGRID_PARAM,
      WithDecryption: true,
    });

    const response = await ssmClient.send(command);
    
    if (!response.Parameter?.Value) {
      throw new Error('SendGrid API key not found in SSM Parameter Store');
    }

    sendGridApiKey = response.Parameter.Value;
    console.log('SendGrid API key loaded successfully from SSM');
    
    return sendGridApiKey;
  } catch (error) {
    console.error('Failed to load SendGrid API key from SSM:', error);
    throw new Error('Configuration error: Unable to load SendGrid API key');
  }
}

/**
 * Fetch consent data stored by PreSignUp trigger
 * Returns consent data if found, otherwise undefined
 */
async function fetchConsentData(email: string): Promise<{
  termsAccepted: boolean;
  termsAcceptedAt: string | null;
  marketingOptIn: boolean;
  marketingOptInAt: string | null;
} | undefined> {
  try {
    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `CONSENT#${email}`,
        sk: 'PENDING',
      },
    });

    const result = await docClient.send(command);
    
    if (result.Item) {
      console.log('✅ Found consent data for', email);
      
      // Delete the temporary consent record (cleanup)
      const deleteCommand = new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `CONSENT#${email}`,
          sk: 'PENDING',
        },
      });
      await docClient.send(deleteCommand);
      
      return {
        termsAccepted: result.Item.termsAccepted || false,
        termsAcceptedAt: result.Item.termsAcceptedAt || null,
        marketingOptIn: result.Item.marketingOptIn || false,
        marketingOptInAt: result.Item.marketingOptInAt || null,
      };
    }
    
    console.log('⚠️ No consent data found for', email);
    return undefined;
  } catch (error) {
    console.error('❌ Failed to fetch consent data:', error);
    return undefined;
  }
}

/**
 * Upsert user record to DynamoDB
 * Pattern: pk = USER#<sub>, sk = PROFILE
 */
async function upsertUserRecord(
  sub: string,
  email: string,
  termsAccepted?: boolean,
  marketingOptIn?: boolean,
  termsAcceptedAt?: string | null,
  marketingOptInAt?: string | null
): Promise<void> {
  const now = new Date().toISOString();

  // Base item with required fields
  const baseItem: any = {
    pk: `USER#${sub}`,
    sk: 'PROFILE',
    sub,
    email,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  };

  // Add consent fields with timestamps if provided
  if (termsAccepted !== undefined) {
    baseItem.termsAccepted = termsAccepted;
    baseItem.termsAcceptedAt = termsAcceptedAt !== undefined ? termsAcceptedAt : (termsAccepted ? now : null);
  }

  if (marketingOptIn !== undefined) {
    baseItem.marketingOptIn = marketingOptIn;
    baseItem.marketingOptInAt = marketingOptInAt !== undefined ? marketingOptInAt : (marketingOptIn ? now : null);
  }

  try {
    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: baseItem,
      // Conditional to preserve createdAt on resend/update
      ConditionExpression: 'attribute_not_exists(pk)',
    });

    await docClient.send(command);
    console.log(`User record created: ${sub}`, {
      termsAccepted,
      marketingOptIn,
    });
  } catch (error: any) {
    // ConditionalCheckFailedException means record exists - update it instead
    if (error.name === 'ConditionalCheckFailedException') {
      const updateItem: any = {
        pk: `USER#${sub}`,
        sk: 'PROFILE',
        sub,
        email,
        updatedAt: now,
        isDeleted: false,
      };

      // Preserve consent fields if not provided in update
      if (termsAccepted !== undefined) {
        updateItem.termsAccepted = termsAccepted;
        updateItem.termsAcceptedAt = termsAcceptedAt !== undefined ? termsAcceptedAt : (termsAccepted ? now : null);
      }

      if (marketingOptIn !== undefined) {
        updateItem.marketingOptIn = marketingOptIn;
        updateItem.marketingOptInAt = marketingOptInAt !== undefined ? marketingOptInAt : (marketingOptIn ? now : null);
      }

      const updateCommand = new PutCommand({
        TableName: TABLE_NAME,
        Item: updateItem,
      });

      await docClient.send(updateCommand);
      console.log(`User record updated: ${sub}`);
    } else {
      console.error('Failed to upsert user record:', error);
      throw error;
    }
  }
}

/**
 * Send verification email via SendGrid
 */
async function sendVerificationEmail(
  email: string,
  username: string,
  verificationCode: string
): Promise<void> {
  const apiKey = await getSendGridApiKey();
  sgMail.setApiKey(apiKey);

  // Build verification link
  const verifyUrl = `${VERIFY_URL_BASE}?username=${encodeURIComponent(username)}&code=${encodeURIComponent(verificationCode)}`;

  // Debug logging - log what we're sending
  console.log('Building verification URL:', {
    baseUrl: VERIFY_URL_BASE,
    username,
    codeLength: verificationCode.length,
    codeStart: verificationCode.substring(0, 20),
    codeEnd: verificationCode.substring(verificationCode.length - 20),
    encodedCodeStart: encodeURIComponent(verificationCode).substring(0, 50),
  });

  const msg = {
    to: email,
    from: FROM_EMAIL,
    subject: 'Verify your Localstays account',
    // Disable click tracking to prevent SendGrid from mangling the verification code
    trackingSettings: {
      clickTracking: {
        enable: false,
        enableText: false,
      },
    },
    text: `Welcome to Localstays!\n\nPlease verify your email address by clicking the link below:\n\n${verifyUrl}\n\nThis link will expire in 24 hours.\n\nIf you didn't create an account, please ignore this email.`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify your email</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 0;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <tr>
                    <td style="padding: 40px 40px 20px 40px;">
                      <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #333333;">Welcome to Localstays!</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 40px 20px 40px;">
                      <p style="margin: 0; font-size: 16px; line-height: 1.5; color: #666666;">
                        Thank you for signing up. Please verify your email address to get started.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 40px 30px 40px;">
                      <a href="${verifyUrl}" style="display: inline-block; padding: 14px 32px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 16px; font-weight: 500;">
                        Verify Email Address
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 40px 20px 40px; border-top: 1px solid #eeeeee;">
                      <p style="margin: 20px 0 0 0; font-size: 14px; line-height: 1.5; color: #999999;">
                        Or copy and paste this link into your browser:
                      </p>
                      <p style="margin: 10px 0 0 0; font-size: 14px; line-height: 1.5; color: #007bff; word-break: break-all;">
                        ${verifyUrl}
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 40px 40px 40px;">
                      <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #999999;">
                        This link will expire in 24 hours. If you didn't create an account, please ignore this email.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`Verification email sent successfully to ${email}`);
  } catch (error: any) {
    console.error('Failed to send verification email via SendGrid:', {
      error: error.message,
      statusCode: error.code,
      recipient: email,
    });
    throw new Error('Failed to send verification email');
  }
}

/**
 * Send password reset email via SendGrid
 */
async function sendPasswordResetEmail(
  email: string,
  username: string,
  resetCode: string
): Promise<void> {
  const apiKey = await getSendGridApiKey();
  sgMail.setApiKey(apiKey);

  // Build password reset link
  const resetUrl = `${RESET_PASSWORD_URL_BASE}?username=${encodeURIComponent(username)}&code=${encodeURIComponent(resetCode)}`;

  console.log('Building password reset URL:', {
    baseUrl: RESET_PASSWORD_URL_BASE,
    username,
    codeLength: resetCode.length,
  });

  const msg = {
    to: email,
    from: FROM_EMAIL,
    subject: 'Reset your Localstays password',
    // Disable click tracking to prevent SendGrid from mangling the code
    trackingSettings: {
      clickTracking: {
        enable: false,
        enableText: false,
      },
    },
    text: `Reset your Localstays password\n\nWe received a request to reset your password. Click the link below to set a new password:\n\n${resetUrl}\n\nThis link will expire in 1 hour.\n\nIf you didn't request a password reset, please ignore this email and your password will remain unchanged.`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset your password</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 0;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <tr>
                    <td style="padding: 40px 40px 20px 40px;">
                      <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #333333;">Reset your password</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 40px 20px 40px;">
                      <p style="margin: 0; font-size: 16px; line-height: 1.5; color: #666666;">
                        We received a request to reset your Localstays password. Click the button below to set a new password.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 40px 30px 40px;">
                      <a href="${resetUrl}" style="display: inline-block; padding: 14px 32px; background-color: #dc3545; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 16px; font-weight: 500;">
                        Reset Password
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 40px 20px 40px; border-top: 1px solid #eeeeee;">
                      <p style="margin: 20px 0 0 0; font-size: 14px; line-height: 1.5; color: #999999;">
                        Or copy and paste this link into your browser:
                      </p>
                      <p style="margin: 10px 0 0 0; font-size: 14px; line-height: 1.5; color: #007bff; word-break: break-all;">
                        ${resetUrl}
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 40px 40px 40px;">
                      <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #999999;">
                        This link will expire in 1 hour. If you didn't request a password reset, please ignore this email and your password will remain unchanged.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`Password reset email sent successfully to ${email}`);
  } catch (error: any) {
    console.error('Failed to send password reset email via SendGrid:', {
      error: error.message,
      statusCode: error.code,
      recipient: email,
    });
    throw new Error('Failed to send password reset email');
  }
}

/**
 * Main Lambda handler for Custom Email Sender trigger
 */
export const handler: CustomEmailSenderTriggerHandler = async (event) => {
  console.log('Custom Email Sender triggered', {
    triggerSource: event.triggerSource,
    username: event.userName,
    userPoolId: event.userPoolId,
  });

  // DEBUG: Log the ENTIRE event to see all available fields
  console.log('⚠️ DEBUG: FULL EVENT:', JSON.stringify(event, null, 2));

  try {
    const { request, triggerSource, userName } = event;
    
    // Type guard for request with code parameter
    if (request.type !== 'customEmailSenderRequestV1') {
      throw new Error(`Unsupported request type: ${request.type}`);
    }
    
    const { userAttributes, code: encryptedCode, clientMetadata } = request;
    
    // Cast userAttributes to the correct type (StringMap)
    const attrs = userAttributes as { [key: string]: string };
    const email = attrs['email'];
    const sub = attrs['sub'];

    // Validate required attributes
    if (!email || !sub || !encryptedCode) {
      throw new Error('Missing required user attributes or code parameter');
    }

    // Extract consent data from clientMetadata
    const termsAccepted = clientMetadata?.termsAccepted === 'true';
    const marketingOptIn = clientMetadata?.marketingOptIn === 'true';

    console.log('📋 Client Metadata:', {
      termsAccepted,
      marketingOptIn,
      rawMetadata: clientMetadata,
    });

    // DEBUG: Log encrypted code
    console.log('⚠️ DEBUG: ENCRYPTED CODE:', {
      length: encryptedCode.length,
      start: encryptedCode.substring(0, 50),
    });

    // 🔑 DECRYPT the verification code
    const code = await decryptCode(encryptedCode, KMS_KEY_ARN);
    
    console.log('✅ DECRYPTED CODE (plaintext):', {
      length: code.length,
      code: code, // This is the actual verification code
    });

    // Handle different trigger sources
    if (
      triggerSource === 'CustomEmailSender_SignUp' ||
      triggerSource === 'CustomEmailSender_ResendCode'
    ) {
      // Fetch consent data from PreSignUp trigger
      const consentData = await fetchConsentData(email);
      
      let finalTermsAccepted = termsAccepted;
      let finalMarketingOptIn = marketingOptIn;
      let termsAcceptedAt: string | null | undefined = undefined;
      let marketingOptInAt: string | null | undefined = undefined;
      
      if (consentData) {
        finalTermsAccepted = consentData.termsAccepted;
        finalMarketingOptIn = consentData.marketingOptIn;
        termsAcceptedAt = consentData.termsAcceptedAt;
        marketingOptInAt = consentData.marketingOptInAt;
      }
      
      // Upsert user record to DynamoDB with consent data
      await upsertUserRecord(sub, email, finalTermsAccepted, finalMarketingOptIn, termsAcceptedAt, marketingOptInAt);

      // Send verification email via SendGrid
      await sendVerificationEmail(email, userName, code);

      console.log('Verification email sent successfully', {
        triggerSource,
        username: userName,
        email,
        termsAccepted: finalTermsAccepted,
        marketingOptIn: finalMarketingOptIn,
      });
    } else if (triggerSource === 'CustomEmailSender_ForgotPassword') {
      // Send password reset email via SendGrid
      await sendPasswordResetEmail(email, userName, code);

      console.log('Password reset email sent successfully', {
        triggerSource,
        username: userName,
        email,
      });
    } else {
      console.warn('Unhandled trigger source:', triggerSource);
    }

    // Return event unchanged (required by Cognito)
    return event;
  } catch (error) {
    console.error('Custom Email Sender Lambda failed:', error);
    
    // Log error but don't expose internal details to Cognito
    throw new Error('Failed to send verification email. Please try again later.');
  }
};

