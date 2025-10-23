import { PostConfirmationTriggerHandler } from 'aws-lambda';
import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';

/**
 * PostConfirmation Lambda for Cognito User Pool
 * 
 * This trigger runs AFTER the user confirms their account.
 * It automatically assigns all new users to the HOST group.
 * 
 * Trigger Source: PostConfirmation_ConfirmSignUp
 */

// Environment variables (set by CDK)
const USER_POOL_ID = process.env.USER_POOL_ID!;

// AWS SDK clients (reused across invocations)
const cognitoClient = new CognitoIdentityProviderClient({});

/**
 * Assign user to HOST group
 */
async function assignToHostGroup(username: string): Promise<void> {
  try {
    const command = new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      GroupName: 'HOST',
    });

    await cognitoClient.send(command);
    console.log(`✅ User ${username} assigned to HOST group`);
  } catch (error) {
    console.error('❌ Failed to assign user to HOST group:', error);
    // Don't throw - we don't want to block the signup flow
  }
}

/**
 * Main Lambda handler for PostConfirmation trigger
 */
export const handler: PostConfirmationTriggerHandler = async (event) => {
  console.log('PostConfirmation triggered', {
    triggerSource: event.triggerSource,
    username: event.userName,
    email: event.request.userAttributes.email,
  });

  try {
    const { userName } = event;

    // Assign user to HOST group automatically
    await assignToHostGroup(userName);

    return event;
  } catch (error) {
    console.error('PostConfirmation Lambda failed:', error);
    // Don't throw - return event to allow signup to continue
    return event;
  }
};

