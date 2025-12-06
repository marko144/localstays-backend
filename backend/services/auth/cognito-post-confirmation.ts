import { PostConfirmationTriggerHandler } from 'aws-lambda';
import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

/**
 * PostConfirmation Lambda for Cognito User Pool
 * 
 * This trigger runs AFTER the user confirms their account.
 * It performs RBAC initialization:
 * 1. Assigns user to HOST Cognito Group
 * 2. Creates minimal Host record (status=INCOMPLETE)
 * 3. Creates S3 folder structure for host
 * 4. Updates User record with RBAC fields (role, hostId, permissions)
 * 
 * Trigger Source: PostConfirmation_ConfirmSignUp
 */

// Environment variables (set by CDK)
const USER_POOL_ID = process.env.USER_POOL_ID!;
const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;

// AWS SDK clients (reused across invocations)
const cognitoClient = new CognitoIdentityProviderClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const s3Client = new S3Client({});

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
 * Create S3 folder structure for host
 * Structure:
 *   {hostId}/verification/
 *   {hostId}/listings/
 */
async function createHostS3Folders(hostId: string): Promise<void> {
  const folders = [
    `${hostId}/verification/.keep`,
    `${hostId}/listings/.keep`,
  ];

  try {
    await Promise.all(
      folders.map((key) =>
        s3Client.send(
          new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            Body: '', // Empty file to create folder structure
            ContentType: 'application/octet-stream',
          })
        )
      )
    );

    console.log(`✅ Created S3 folder structure for host: ${hostId}`);
  } catch (error) {
    console.error('❌ Failed to create S3 folders:', error);
    // Don't throw - S3 folder creation is not critical
    // Folders can be created on-demand when files are uploaded
  }
}

/**
 * Create minimal Host record (status=NOT_SUBMITTED) with S3 prefix
 */
async function createHostRecord(ownerUserSub: string): Promise<string> {
  const hostId = `host_${randomUUID()}`;
  const now = new Date().toISOString();
  const s3Prefix = `${hostId}/`; // S3 prefix for this host

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `HOST#${hostId}`,
          sk: 'META',
          hostId,
          status: 'NOT_SUBMITTED', // Initial status - profile never submitted
          ownerUserSub,
          s3Prefix, // Store S3 prefix for easy reference
          isDeleted: false,
          createdAt: now,
          updatedAt: now,
          // GSI1: Lookup Host by owner
          gsi1pk: `OWNER#${ownerUserSub}`,
          gsi1sk: `HOST#${hostId}`,
          // GSI2: Query Hosts by status
          gsi2pk: 'STATUS#NOT_SUBMITTED',
          gsi2sk: `HOST#${hostId}`,
        },
      })
    );

    console.log(`✅ Created Host record: ${hostId} with S3 prefix: ${s3Prefix} (status: NOT_SUBMITTED)`);
    return hostId;
  } catch (error) {
    console.error('❌ Failed to create Host record:', error);
    throw error;
  }
}

// NOTE: Free subscription creation has been removed.
// Hosts now start with NO subscription and must purchase one via Stripe
// to publish listings. They can create unlimited draft listings without a subscription.
// The GET /api/v1/hosts/{hostId}/subscription endpoint returns status: 'NONE' 
// when no subscription exists.

/**
 * Create or update User record with RBAC fields
 * Note: Using PutCommand instead of UpdateCommand because the USER record
 * may not exist yet when post-confirmation trigger fires
 */
async function updateUserWithRBAC(
  userSub: string,
  email: string,
  hostId: string,
  permissions: string[]
): Promise<void> {
  const now = new Date().toISOString();

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `USER#${userSub}`,
          sk: 'PROFILE',
          userSub,
          email,
          role: 'HOST',
          hostId,
          permissions,
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        },
      })
    );

    console.log(`✅ Created/Updated User record with RBAC fields: ${userSub}`, {
      hostId,
      role: 'HOST',
      permissionCount: permissions.length,
    });
  } catch (error) {
    console.error('❌ Failed to create/update User record:', error);
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

  // Only run initialization on signup, not on password reset or other events
  if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') {
    console.log('⏭️  Skipping PostConfirmation for non-signup event:', event.triggerSource);
    return event;
  }

  try {
    const { userName: userSub } = event;
    const email = event.request.userAttributes.email;

    // 1. Assign user to HOST Cognito Group
    await assignToHostGroup(userSub);

    // 2. Get HOST role permissions
    const permissions = await getHostPermissions();

    // 3. Create minimal Host record (status=NOT_SUBMITTED)
    const hostId = await createHostRecord(userSub);

    // 4. Create S3 folder structure for host
    await createHostS3Folders(hostId);

    // 5. Create/Update User record with RBAC fields
    await updateUserWithRBAC(userSub, email, hostId, permissions);

    console.log('✅ RBAC initialization complete (no subscription created - hosts must purchase via Stripe)', {
      userSub,
      hostId,
      role: 'HOST',
      permissionCount: permissions.length,
      s3Prefix: `${hostId}/`,
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

