import { PreTokenGenerationTriggerHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

/**
 * PreTokenGeneration Lambda for Cognito User Pool
 * 
 * This trigger runs BEFORE Cognito issues JWT tokens.
 * It injects custom claims into the token:
 * - role: "HOST" or "ADMIN" (from Cognito Groups)
 * - hostId: Host ID for HOST users
 * - permissions: Array of permission strings
 * - status: User account status
 * 
 * These claims are used for authorization in the frontend and backend.
 * 
 * Trigger Source: TokenGeneration_NewPasswordChallenge, TokenGeneration_Authentication, TokenGeneration_RefreshTokens
 */

// Environment variables (set by CDK)
const TABLE_NAME = process.env.TABLE_NAME!;

// AWS SDK clients (reused across invocations)
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Get user record from DynamoDB
 */
async function getUserRecord(userSub: string) {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `USER#${userSub}`,
          sk: 'PROFILE',
        },
      })
    );

    return result.Item;
  } catch (error) {
    console.error('❌ Failed to fetch user record:', error);
    return null;
  }
}

/**
 * Get role configuration from DynamoDB
 */
async function getRoleConfig(roleName: string) {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `ROLE#${roleName}`,
          sk: 'CONFIG',
        },
      })
    );

    return result.Item;
  } catch (error) {
    console.error('❌ Failed to fetch role config:', error);
    return null;
  }
}

/**
 * Determine role from Cognito Groups
 * ADMIN wins if user is in both groups
 */
function determineRole(groups: string[]): string | null {
  if (groups.includes('ADMIN')) return 'ADMIN';
  if (groups.includes('HOST')) return 'HOST';
  return null;
}

/**
 * Main Lambda handler for PreTokenGeneration trigger
 */
export const handler: PreTokenGenerationTriggerHandler = async (event) => {
  const { sub } = event.request.userAttributes;
  
  console.log('🔑 PreTokenGeneration triggered', {
    triggerSource: event.triggerSource,
    username: event.userName,
    sub,
  });

  try {
    // 1. Get user record from DynamoDB
    const user = await getUserRecord(sub);
    
    if (!user) {
      console.warn('⚠️  User not found in DynamoDB', { sub });
      // Return event unchanged - Cognito will use defaults
      return event;
    }

    // 2. Determine role from Cognito Groups (source of truth)
    const groups = event.request.groupConfiguration?.groupsToOverride || [];
    const role = determineRole(groups);

    if (!role) {
      console.warn('⚠️  User has no role assigned', { sub, groups });
      return event;
    }

    // 3. Get permissions (use user's custom permissions OR role defaults)
    let permissions = user.permissions;
    
    if (!permissions || permissions.length === 0) {
      // Fallback to role config permissions
      const roleConfig = await getRoleConfig(role);
      permissions = roleConfig?.permissions || [];
    }

    // 4. Build custom claims
    // Note: Cognito requires claims to be strings or numbers, not arrays
    // So we JSON-stringify the permissions array
    const customClaims: Record<string, string> = {
      role,
      permissions: JSON.stringify(permissions),
      status: user.status || 'ACTIVE',
    };

    // Add hostId and hostStatus for HOST users
    if (role === 'HOST' && user.hostId) {
      customClaims.hostId = user.hostId;
      
      // Fetch Host record to get host status
      try {
        const hostRecord = await docClient.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: `HOST#${user.hostId}`,
              sk: 'META',
            },
          })
        );
        
        if (hostRecord.Item) {
          customClaims.hostStatus = hostRecord.Item.status;
        }
      } catch (error) {
        console.error('⚠️  Failed to fetch Host status:', error);
        // Don't fail the whole login, just omit hostStatus
      }
    }

    // 5. Inject claims into token
    event.response = {
      claimsOverrideDetails: {
        claimsToAddOrOverride: customClaims,
      },
    };

    console.log('✅ Claims injected', {
      sub,
      role,
      hostId: customClaims.hostId || 'N/A',
      hostStatus: customClaims.hostStatus || 'N/A',
      permissionCount: permissions.length,
      userStatus: customClaims.status,
    });

    return event;
  } catch (error) {
    console.error('💥 PreTokenGeneration failed:', error);
    // Return event unchanged to allow authentication to proceed
    // User will get token without custom claims (frontend should handle this)
    return event;
  }
};

