import { 
  CognitoIdentityProviderClient, 
  AdminCreateUserCommand, 
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminUpdateUserAttributesCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Script to seed the first admin user
 * 
 * Creates:
 * 1. Admin user in Cognito (confirmed & verified)
 * 2. User record in DynamoDB with ADMIN role
 * 
 * Admin users do NOT have host profiles.
 */

const REGION = process.env.AWS_REGION || 'eu-north-1';
const USER_POOL_ID = process.env.USER_POOL_ID!;
const TABLE_NAME = process.env.TABLE_NAME!;

// Admin user details
const ADMIN_EMAIL = 'marko+admin@velocci.me';
const ADMIN_PASSWORD = 'Password1*';

const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });
const dynamoClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

/**
 * Get ADMIN role permissions from DynamoDB
 */
async function getAdminPermissions(): Promise<string[]> {
  try {
    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: 'ROLE#ADMIN',
        sk: 'CONFIG',
      },
    });

    const result = await docClient.send(command);
    
    if (!result.Item) {
      console.error('❌ ADMIN role not found in database. Run seed-handler first!');
      throw new Error('ADMIN role not seeded');
    }

    return result.Item.permissions as string[];
  } catch (error) {
    console.error('❌ Failed to fetch ADMIN permissions:', error);
    throw error;
  }
}

/**
 * Create admin user in Cognito
 */
async function createAdminUserInCognito(email: string, password: string): Promise<string> {
  try {
    // Step 1: Create user (with temporary password)
    console.log(`📝 Creating admin user in Cognito: ${email}`);
    
    const createCommand = new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
      MessageAction: 'SUPPRESS', // Don't send welcome email
    });

    const createResult = await cognitoClient.send(createCommand);
    const userSub = createResult.User?.Attributes?.find(attr => attr.Name === 'sub')?.Value;

    if (!userSub) {
      throw new Error('Failed to get user sub from Cognito response');
    }

    console.log(`✅ Admin user created in Cognito with sub: ${userSub}`);

    // Step 2: Set permanent password
    console.log('🔐 Setting permanent password...');
    
    const setPasswordCommand = new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      Password: password,
      Permanent: true, // Make it a permanent password
    });

    await cognitoClient.send(setPasswordCommand);
    console.log('✅ Permanent password set');

    // Step 3: Add to ADMIN group
    console.log('👥 Adding user to ADMIN group...');
    
    const addToGroupCommand = new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      GroupName: 'ADMIN',
    });

    await cognitoClient.send(addToGroupCommand);
    console.log('✅ User added to ADMIN group');

    // Step 4: Mark email as verified
    console.log('📧 Marking email as verified...');
    
    const updateAttributesCommand = new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: 'email_verified', Value: 'true' },
      ],
    });

    await cognitoClient.send(updateAttributesCommand);
    console.log('✅ Email verified');

    return userSub;
  } catch (error: any) {
    if (error.name === 'UsernameExistsException') {
      console.warn('⚠️  User already exists in Cognito, fetching existing user...');
      // User exists, we need to get their sub
      // For now, we'll throw and handle this in the main function
      throw error;
    }
    console.error('❌ Failed to create admin user in Cognito:', error);
    throw error;
  }
}

/**
 * Create admin user record in DynamoDB
 */
async function createAdminUserInDynamoDB(
  userSub: string,
  email: string,
  permissions: string[]
): Promise<void> {
  try {
    console.log('💾 Creating admin user record in DynamoDB...');

    const now = new Date().toISOString();

    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `USER#${userSub}`,
        sk: 'PROFILE',
        sub: userSub,
        email,
        role: 'ADMIN',
        hostId: null, // Admin users don't have host profiles
        permissions,
        status: 'ACTIVE',
        termsAccepted: true,
        termsAcceptedAt: now,
        marketingOptIn: false,
        marketingOptInAt: null,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      },
      // Don't overwrite if user already exists
      ConditionExpression: 'attribute_not_exists(pk)',
    });

    await docClient.send(command);
    console.log('✅ Admin user record created in DynamoDB');
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.warn('⚠️  User record already exists in DynamoDB');
      return;
    }
    console.error('❌ Failed to create admin user in DynamoDB:', error);
    throw error;
  }
}

/**
 * Main function to seed admin user
 */
async function seedAdminUser() {
  console.log('🚀 Starting admin user seed process...\n');

  try {
    // Validate environment variables
    if (!USER_POOL_ID || !TABLE_NAME) {
      throw new Error('Missing required environment variables: USER_POOL_ID, TABLE_NAME');
    }

    console.log('📊 Configuration:');
    console.log(`   Region: ${REGION}`);
    console.log(`   User Pool ID: ${USER_POOL_ID}`);
    console.log(`   Table Name: ${TABLE_NAME}`);
    console.log(`   Admin Email: ${ADMIN_EMAIL}\n`);

    // Step 1: Get ADMIN permissions
    console.log('1️⃣  Fetching ADMIN role permissions...');
    const permissions = await getAdminPermissions();
    console.log(`✅ Found ${permissions.length} permissions\n`);

    // Step 2: Create user in Cognito
    console.log('2️⃣  Creating admin user in Cognito...');
    const userSub = await createAdminUserInCognito(ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log(`✅ User sub: ${userSub}\n`);

    // Step 3: Create user in DynamoDB
    console.log('3️⃣  Creating admin user in DynamoDB...');
    await createAdminUserInDynamoDB(userSub, ADMIN_EMAIL, permissions);
    console.log('');

    console.log('✅ ✅ ✅ Admin user seeding complete! ✅ ✅ ✅\n');
    console.log('🔑 Login credentials:');
    console.log(`   Email: ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);
    console.log(`   User Sub: ${userSub}`);
    console.log(`   Role: ADMIN`);
    console.log(`   Permissions: ${permissions.length} permissions`);
    console.log('');
  } catch (error: any) {
    console.error('\n💥 Admin user seeding failed:', error);
    if (error.name === 'UsernameExistsException') {
      console.log('\n⚠️  User already exists. To recreate, delete the user first:');
      console.log(`   aws cognito-idp admin-delete-user --user-pool-id ${USER_POOL_ID} --username ${ADMIN_EMAIL}`);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  seedAdminUser();
}

export { seedAdminUser };

