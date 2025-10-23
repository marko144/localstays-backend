import { PreSignUpTriggerHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

/**
 * PreSignUp Lambda for Cognito User Pool
 * 
 * This trigger runs BEFORE the user is created in Cognito.
 * It captures consent data from custom attributes and stores it in DynamoDB.
 * 
 * Trigger Source: PreSignUp_SignUp
 */

// Environment variables (set by CDK)
const TABLE_NAME = process.env.TABLE_NAME!;

// AWS SDK clients (reused across invocations)
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

/**
 * Store consent data in DynamoDB
 * This runs BEFORE user creation, so we use email as temporary key
 * The Custom Email Sender trigger will update this with the actual sub
 */
async function storeConsentData(
  email: string,
  termsAccepted: boolean,
  marketingOptIn: boolean
): Promise<void> {
  const now = new Date().toISOString();

  const item = {
    pk: `CONSENT#${email}`,
    sk: 'PENDING',
    email,
    termsAccepted,
    termsAcceptedAt: termsAccepted ? now : null,
    marketingOptIn,
    marketingOptInAt: marketingOptIn ? now : null,
    createdAt: now,
    ttl: Math.floor(Date.now() / 1000) + 3600, // Expire in 1 hour
  };

  try {
    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    });

    await docClient.send(command);
    console.log(`✅ Consent data stored for ${email}`, {
      termsAccepted,
      marketingOptIn,
    });
  } catch (error) {
    console.error('❌ Failed to store consent data:', error);
    // Don't throw - we don't want to block signup
  }
}

/**
 * Main Lambda handler for PreSignUp trigger
 */
export const handler: PreSignUpTriggerHandler = async (event) => {
  console.log('PreSignUp triggered', {
    triggerSource: event.triggerSource,
    username: event.userName,
    email: event.request.userAttributes.email,
  });

  try {
    const { request } = event;
    const email = request.userAttributes.email;
    
    // Read consent data from CUSTOM ATTRIBUTES (passed from frontend)
    const userAttrs = request.userAttributes;
    const termsAccepted = userAttrs['custom:termsAccepted'] === 'true';
    const marketingOptIn = userAttrs['custom:marketingOptIn'] === 'true';
    const termsAcceptedAt = userAttrs['custom:termsAcceptedAt'] || null;
    const marketingOptInAt = userAttrs['custom:marketingOptInAt'] || null;

    console.log('📋 Custom attributes received:', {
      termsAccepted,
      marketingOptIn,
      termsAcceptedAt,
      marketingOptInAt,
      allCustomAttributes: {
        'custom:termsAccepted': userAttrs['custom:termsAccepted'],
        'custom:termsAcceptedAt': userAttrs['custom:termsAcceptedAt'],
        'custom:marketingOptIn': userAttrs['custom:marketingOptIn'],
        'custom:marketingOptInAt': userAttrs['custom:marketingOptInAt'],
      },
    });

    // Store consent data with email as key (temporary)
    if (email) {
      await storeConsentData(email, termsAccepted, marketingOptIn);
    }

    // Auto-confirm the user (no admin approval needed)
    event.response.autoConfirmUser = false;
    event.response.autoVerifyEmail = false;

    return event;
  } catch (error) {
    console.error('PreSignUp Lambda failed:', error);
    // Don't throw - return event to allow signup to continue
    return event;
  }
};
