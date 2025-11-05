import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Seed Role Configurations
 * 
 * Creates ROLE#HOST and ROLE#ADMIN config records in DynamoDB
 * with their respective permissions.
 * 
 * Run this once after initial deployment.
 */

const TABLE_NAME = process.env.TABLE_NAME || 'localstays-dev';
const dynamoClient = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const ROLES = [
  {
    pk: 'ROLE#HOST',
    sk: 'CONFIG',
    roleName: 'HOST',
    displayName: 'Property Host',
    description: 'Manages their own properties and KYC',
    permissions: [
      'HOST_LISTING_CREATE',
      'HOST_LISTING_EDIT_DRAFT',
      'HOST_LISTING_SUBMIT_REVIEW',
      'HOST_LISTING_SET_OFFLINE',
      'HOST_LISTING_SET_ONLINE',
      'HOST_LISTING_VIEW_OWN',
      'HOST_LISTING_DELETE',
      'HOST_KYC_SUBMIT',
    ],
    isActive: true,
  },
  {
    pk: 'ROLE#ADMIN',
    sk: 'CONFIG',
    roleName: 'ADMIN',
    displayName: 'Platform Administrator',
    description: 'Platform-wide oversight and moderation',
    permissions: [
      'ADMIN_HOST_VIEW_ALL',
      'ADMIN_HOST_SUSPEND',
      'ADMIN_HOST_REINSTATE',
      'ADMIN_KYC_VIEW_ALL',
      'ADMIN_KYC_APPROVE',
      'ADMIN_KYC_REJECT',
      'ADMIN_LISTING_VIEW_ALL',
      'ADMIN_LISTING_REVIEW',
      'ADMIN_LISTING_APPROVE',
      'ADMIN_LISTING_REJECT',
      'ADMIN_LISTING_SUSPEND',
    ],
    isActive: true,
  },
];

async function seedRoles() {
  console.log('🌱 Seeding role configurations...');
  
  const now = new Date().toISOString();
  
  for (const role of ROLES) {
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            ...role,
            createdAt: now,
            updatedAt: now,
          },
        })
      );
      console.log(`✅ Seeded role: ${role.roleName} (${role.permissions.length} permissions)`);
    } catch (error) {
      console.error(`❌ Failed to seed role ${role.roleName}:`, error);
      throw error;
    }
  }
  
  console.log('🎉 All roles seeded successfully!');
}

// Run if called directly
if (require.main === module) {
  seedRoles()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { seedRoles };

