/**
 * CDK CustomResource Handler for Database Seeding
 * Seeds roles and enums on stack deployment
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

interface CustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: {
    TableName: string;
  };
}

/**
 * Lambda handler for CDK CustomResource
 */
export async function handler(event: CustomResourceEvent) {
  console.log('Seed handler invoked:', JSON.stringify(event, null, 2));

  try {
    // Seed on both Create and Update (allows re-seeding when needed)
    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      console.log(`${event.RequestType} detected - seeding database with roles and enums...`);
      
      await seedRoles();
      await seedEnums();
      
      console.log('✅ Database seeding completed successfully');
      
      return {
        PhysicalResourceId: 'localstays-db-seed',
        Data: {
          Message: 'Database seeded successfully',
        },
      };
    } else {
      console.log('Delete detected - no cleanup needed');
      return {
        PhysicalResourceId: 'localstays-db-seed',
        Data: {
          Message: 'Seed cleanup skipped',
        },
      };
    }
  } catch (error) {
    console.error('Seed handler error:', error);
    throw error;
  }
}

/**
 * Seed role configurations
 */
async function seedRoles() {
  const roles = [
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
        'ADMIN_LISTING_APPROVE',
        'ADMIN_LISTING_REJECT',
        'ADMIN_LISTING_SUSPEND',
      ],
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  await docClient.send(
    new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: roles.map((role) => ({
          PutRequest: { Item: role },
        })),
      },
    })
  );

  console.log('✅ Roles seeded');
}

/**
 * Seed enum configurations
 * Uses the dev schema: separate record per enum value with sk: VALUE#xxx
 */
async function seedEnums() {
  const now = new Date().toISOString();
  const enumRecords = [];

  // Host Status Enum (matching dev schema exactly, adding NOT_SUBMITTED)
  const hostStatuses = [
    {
      enumValue: 'NOT_SUBMITTED',
      displayLabel: 'Not Submitted',
      description: 'User created but profile never submitted',
      sortOrder: 1,
      metadata: {
        color: 'gray',
        icon: 'user-plus',
        requiresAction: true,
        allowedTransitions: ['INCOMPLETE', 'VERIFICATION'],
      },
    },
    {
      enumValue: 'INCOMPLETE',
      displayLabel: 'Profile Incomplete',
      description: 'Host profile created but not yet filled out',
      sortOrder: 2,
      metadata: {
        color: 'orange',
        icon: 'warning',
        requiresAction: true,
        allowedTransitions: ['VERIFICATION', 'SUSPENDED'],
      },
    },
    {
      enumValue: 'VERIFICATION',
      displayLabel: 'Pending Verification',
      description: 'Host profile submitted, awaiting admin verification',
      sortOrder: 3,
      metadata: {
        color: 'blue',
        icon: 'clock',
        requiresAction: false,
        allowedTransitions: ['VERIFIED', 'INFO_REQUIRED', 'SUSPENDED'],
      },
    },
    {
      enumValue: 'VERIFIED',
      displayLabel: 'Verified',
      description: 'Host profile verified and active',
      sortOrder: 4,
      metadata: {
        color: 'green',
        icon: 'check-circle',
        requiresAction: false,
        allowedTransitions: ['SUSPENDED'],
      },
    },
    {
      enumValue: 'INFO_REQUIRED',
      displayLabel: 'Information Required',
      description: 'Additional information requested by admin',
      sortOrder: 5,
      metadata: {
        color: 'yellow',
        icon: 'alert-circle',
        requiresAction: true,
        allowedTransitions: ['VERIFICATION', 'SUSPENDED'],
      },
    },
    {
      enumValue: 'SUSPENDED',
      displayLabel: 'Suspended',
      description: 'Host account suspended by admin',
      sortOrder: 6,
      metadata: {
        color: 'red',
        icon: 'ban',
        requiresAction: false,
        allowedTransitions: ['VERIFIED'],
      },
    },
  ];

  hostStatuses.forEach((status) => {
    enumRecords.push({
      pk: 'ENUM#HOST_STATUS',
      sk: `VALUE#${status.enumValue}`,
      enumType: 'HOST_STATUS',
      enumValue: status.enumValue,
      displayLabel: status.displayLabel,
      description: status.description,
      sortOrder: status.sortOrder,
      metadata: status.metadata,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  // Host Type Enum (matching dev schema exactly)
  const hostTypes = [
    {
      enumValue: 'INDIVIDUAL',
      displayLabel: 'Individual',
      description: 'Individual property owner',
      sortOrder: 1,
      metadata: {
        color: 'blue',
        icon: 'user',
        requiredFields: ['forename', 'surname', 'dateOfBirth', 'nationality'],
      },
    },
    {
      enumValue: 'BUSINESS',
      displayLabel: 'Business',
      description: 'Business or company',
      sortOrder: 2,
      metadata: {
        color: 'purple',
        icon: 'briefcase',
        requiredFields: ['legalName', 'registrationNumber', 'vatRegistered'],
      },
    },
  ];

  hostTypes.forEach((type) => {
    enumRecords.push({
      pk: 'ENUM#HOST_TYPE',
      sk: `VALUE#${type.enumValue}`,
      enumType: 'HOST_TYPE',
      enumValue: type.enumValue,
      displayLabel: type.displayLabel,
      description: type.description,
      sortOrder: type.sortOrder,
      metadata: type.metadata,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  // User Status Enum (matching dev schema exactly)
  const userStatuses = [
    {
      enumValue: 'ACTIVE',
      displayLabel: 'Active',
      description: 'User account is active',
      sortOrder: 1,
      metadata: {
        color: 'green',
        icon: 'check',
      },
    },
    {
      enumValue: 'SUSPENDED',
      displayLabel: 'Suspended',
      description: 'User account suspended',
      sortOrder: 2,
      metadata: {
        color: 'orange',
        icon: 'pause',
      },
    },
    {
      enumValue: 'BANNED',
      displayLabel: 'Banned',
      description: 'User account permanently banned',
      sortOrder: 3,
      metadata: {
        color: 'red',
        icon: 'ban',
      },
    },
  ];

  userStatuses.forEach((status) => {
    enumRecords.push({
      pk: 'ENUM#USER_STATUS',
      sk: `VALUE#${status.enumValue}`,
      enumType: 'USER_STATUS',
      enumValue: status.enumValue,
      displayLabel: status.displayLabel,
      description: status.description,
      sortOrder: status.sortOrder,
      metadata: status.metadata,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  // DynamoDB BatchWrite can only handle 25 items at a time
  await docClient.send(
    new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: enumRecords.map((enumItem) => ({
          PutRequest: { Item: enumItem },
        })),
      },
    })
  );

  console.log(`✅ Enums seeded: ${enumRecords.length} records`);
}

