import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Seed Enum Configurations
 * 
 * Creates enum value records in DynamoDB for:
 * - HOST_STATUS
 * - USER_STATUS
 * - HOST_TYPE
 * 
 * Run this once after initial deployment.
 */

const TABLE_NAME = process.env.TABLE_NAME || 'localstays-dev';
const dynamoClient = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const HOST_STATUSES = [
  {
    enumValue: 'INCOMPLETE',
    displayLabel: 'Profile Incomplete',
    description: 'Host profile created but not yet filled out',
    sortOrder: 1,
    metadata: {
      allowedTransitions: ['VERIFICATION', 'SUSPENDED'],
      requiresAction: true,
      color: 'orange',
      icon: 'warning',
    },
  },
  {
    enumValue: 'VERIFICATION',
    displayLabel: 'Pending Verification',
    description: 'Host profile submitted, awaiting admin verification',
    sortOrder: 2,
    metadata: {
      allowedTransitions: ['VERIFIED', 'INFO_REQUIRED', 'SUSPENDED'],
      requiresAction: false,
      color: 'blue',
      icon: 'clock',
    },
  },
  {
    enumValue: 'VERIFIED',
    displayLabel: 'Verified',
    description: 'Host profile verified and active',
    sortOrder: 3,
    metadata: {
      allowedTransitions: ['SUSPENDED', 'INFO_REQUIRED'],
      requiresAction: false,
      color: 'green',
      icon: 'check-circle',
    },
  },
  {
    enumValue: 'INFO_REQUIRED',
    displayLabel: 'Information Required',
    description: 'Additional information requested by admin',
    sortOrder: 4,
    metadata: {
      allowedTransitions: ['VERIFICATION', 'SUSPENDED'],
      requiresAction: true,
      color: 'yellow',
      icon: 'alert-circle',
    },
  },
  {
    enumValue: 'SUSPENDED',
    displayLabel: 'Suspended',
    description: 'Host account suspended by admin',
    sortOrder: 5,
    metadata: {
      allowedTransitions: ['VERIFIED'],
      requiresAction: true,
      color: 'red',
      icon: 'ban',
    },
  },
];

const USER_STATUSES = [
  {
    enumValue: 'ACTIVE',
    displayLabel: 'Active',
    description: 'User account is active and in good standing',
    sortOrder: 1,
    metadata: {
      allowedTransitions: ['SUSPENDED', 'BANNED'],
      color: 'green',
      icon: 'check-circle',
    },
  },
  {
    enumValue: 'SUSPENDED',
    displayLabel: 'Suspended',
    description: 'User account temporarily suspended',
    sortOrder: 2,
    metadata: {
      allowedTransitions: ['ACTIVE', 'BANNED'],
      color: 'orange',
      icon: 'pause-circle',
    },
  },
  {
    enumValue: 'BANNED',
    displayLabel: 'Banned',
    description: 'User account permanently banned',
    sortOrder: 3,
    metadata: {
      allowedTransitions: [],
      color: 'red',
      icon: 'x-circle',
    },
  },
];

const HOST_TYPES = [
  {
    enumValue: 'INDIVIDUAL',
    displayLabel: 'Individual',
    description: 'Individual property owner',
    sortOrder: 1,
    metadata: {
      requiredFields: ['forename', 'surname'],
      color: 'blue',
      icon: 'user',
    },
  },
  {
    enumValue: 'BUSINESS',
    displayLabel: 'Business',
    description: 'Business or company',
    sortOrder: 2,
    metadata: {
      requiredFields: ['legalName', 'registrationNumber', 'vatRegistered'],
      color: 'purple',
      icon: 'briefcase',
    },
  },
];

async function seedEnums() {
  console.log('🌱 Seeding enum configurations...');
  
  const now = new Date().toISOString();
  
  // Seed HOST_STATUS
  console.log('\n📋 Seeding HOST_STATUS enums...');
  for (const status of HOST_STATUSES) {
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            pk: 'ENUM#HOST_STATUS',
            sk: `VALUE#${status.enumValue}`,
            enumType: 'HOST_STATUS',
            ...status,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          },
        })
      );
      console.log(`  ✅ ${status.enumValue} - ${status.displayLabel}`);
    } catch (error) {
      console.error(`  ❌ Failed to seed ${status.enumValue}:`, error);
      throw error;
    }
  }
  
  // Seed USER_STATUS
  console.log('\n📋 Seeding USER_STATUS enums...');
  for (const status of USER_STATUSES) {
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            pk: 'ENUM#USER_STATUS',
            sk: `VALUE#${status.enumValue}`,
            enumType: 'USER_STATUS',
            ...status,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          },
        })
      );
      console.log(`  ✅ ${status.enumValue} - ${status.displayLabel}`);
    } catch (error) {
      console.error(`  ❌ Failed to seed ${status.enumValue}:`, error);
      throw error;
    }
  }
  
  // Seed HOST_TYPE
  console.log('\n📋 Seeding HOST_TYPE enums...');
  for (const type of HOST_TYPES) {
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            pk: 'ENUM#HOST_TYPE',
            sk: `VALUE#${type.enumValue}`,
            enumType: 'HOST_TYPE',
            ...type,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          },
        })
      );
      console.log(`  ✅ ${type.enumValue} - ${type.displayLabel}`);
    } catch (error) {
      console.error(`  ❌ Failed to seed ${type.enumValue}:`, error);
      throw error;
    }
  }
  
  console.log('\n🎉 All enums seeded successfully!');
}

// Run if called directly
if (require.main === module) {
  seedEnums()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { seedEnums };

