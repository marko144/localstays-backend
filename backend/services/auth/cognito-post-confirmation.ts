import { PostConfirmationTriggerHandler } from 'aws-lambda';
import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

/**
 * PostConfirmation Lambda for Cognito User Pool
 * 
 * This trigger runs AFTER the user confirms their account.
 * It performs RBAC initialization:
 * 1. Assigns user to HOST Cognito Group
 * 2. Creates minimal Host record (status=INCOMPLETE)
 * 3. Updates User record with RBAC fields (role, hostId, permissions)
 * 
 * Trigger Source: PostConfirmation_ConfirmSignUp
 */

// Environment variables (set by CDK)
const USER_POOL_ID = process.env.USER_POOL_ID!;
const TABLE_NAME = process.env.TABLE_NAME!;

// AWS SDK clients (reused across invocations)
const cognitoClient = new CognitoIdentityProviderClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

/**
 * Assign user to HOST group in Cognito
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
    throw error; // This should fail loudly
  }
}

/**
 * Get HOST role permissions from DynamoDB
 */
async function getHostPermissions(): Promise<string[]> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: 'ROLE#HOST',
          sk: 'CONFIG',
        },
      })
    );

    return result.Item?.permissions || [];
  } catch (error) {
    console.error('❌ Failed to fetch HOST permissions:', error);
    // Return default permissions if DB query fails
    return [
      'HOST_LISTING_CREATE',
      'HOST_LISTING_EDIT_DRAFT',
      'HOST_LISTING_SUBMIT_REVIEW',
      'HOST_LISTING_SET_OFFLINE',
      'HOST_LISTING_SET_ONLINE',
      'HOST_LISTING_VIEW_OWN',
      'HOST_LISTING_DELETE',
      'HOST_KYC_SUBMIT',
    ];
  }
}

/**
 * Create minimal Host record (status=INCOMPLETE)
 */
async function createHostRecord(ownerUserSub: string): Promise<string> {
  const hostId = `host_${randomUUID()}`;
  const now = new Date().toISOString();

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `HOST#${hostId}`,
          sk: 'META',
          hostId,
          status: 'INCOMPLETE',
          ownerUserSub,
          isDeleted: false,
          createdAt: now,
          updatedAt: now,
          // GSI1: Lookup Host by owner
          gsi1pk: `OWNER#${ownerUserSub}`,
          gsi1sk: `HOST#${hostId}`,
          // GSI2: Query Hosts by status
          gsi2pk: 'STATUS#INCOMPLETE',
          gsi2sk: `HOST#${hostId}`,
        },
      })
    );

    console.log(`✅ Created Host record: ${hostId}`);
    return hostId;
  } catch (error) {
    console.error('❌ Failed to create Host record:', error);
    throw error;
  }
}

/**
 * Update User record with RBAC fields
 */
async function updateUserWithRBAC(
  userSub: string,
  hostId: string,
  permissions: string[]
): Promise<void> {
  const now = new Date().toISOString();

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `USER#${userSub}`,
          sk: 'PROFILE',
        },
        UpdateExpression:
          'SET #role = :role, #hostId = :hostId, #permissions = :permissions, #status = :status, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#role': 'role',
          '#hostId': 'hostId',
          '#permissions': 'permissions',
          '#status': 'status',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':role': 'HOST',
          ':hostId': hostId,
          ':permissions': permissions,
          ':status': 'ACTIVE',
          ':updatedAt': now,
        },
      })
    );

    console.log(`✅ Updated User record with RBAC fields: ${userSub}`);
  } catch (error) {
    console.error('❌ Failed to update User record:', error);
    throw error;
  }
}

/**
 * Main Lambda handler for PostConfirmation trigger
 */
export const handler: PostConfirmationTriggerHandler = async (event) => {
  console.log('🎉 PostConfirmation triggered', {
    triggerSource: event.triggerSource,
    username: event.userName,
    email: event.request.userAttributes.email,
  });

  try {
    const { userName: userSub } = event;

    // 1. Assign user to HOST Cognito Group
    await assignToHostGroup(userSub);

    // 2. Get HOST role permissions
    const permissions = await getHostPermissions();

    // 3. Create minimal Host record (status=INCOMPLETE)
    const hostId = await createHostRecord(userSub);

    // 4. Update User record with RBAC fields
    await updateUserWithRBAC(userSub, hostId, permissions);

    console.log('✅ RBAC initialization complete', {
      userSub,
      hostId,
      role: 'HOST',
      permissionCount: permissions.length,
    });

    return event;
  } catch (error) {
    console.error('💥 PostConfirmation Lambda failed:', error);
    // Don't throw - return event to allow signup to continue
    // User will be in Cognito but without RBAC setup
    // They can retry by logging in (which will trigger PreTokenGen)
    return event;
  }
};

