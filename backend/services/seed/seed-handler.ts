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
    // Only seed on Create, not Update or Delete
    if (event.RequestType === 'Create') {
      console.log('Seeding database with roles and enums...');
      
      await seedRoles();
      await seedEnums();
      
      console.log('✅ Database seeding completed successfully');
      
      return {
        PhysicalResourceId: 'localstays-db-seed',
        Data: {
          Message: 'Database seeded successfully',
        },
      };
    } else if (event.RequestType === 'Update') {
      console.log('Update detected - skipping seed (data already exists)');
      return {
        PhysicalResourceId: 'localstays-db-seed',
        Data: {
          Message: 'Seed skipped on update',
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
      sk: 'META',
      roleId: 'HOST',
      roleName: 'Host',
      description: 'Property host with access to manage their own listings',
      permissions: [
        'listings:read',
        'listings:write',
        'listings:delete',
        'bookings:read',
        'profile:read',
        'profile:write',
      ],
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      pk: 'ROLE#ADMIN',
      sk: 'META',
      roleId: 'ADMIN',
      roleName: 'Administrator',
      description: 'Platform administrator with full access',
      permissions: [
        'listings:read',
        'listings:write',
        'listings:delete',
        'listings:approve',
        'bookings:read',
        'bookings:write',
        'bookings:delete',
        'users:read',
        'users:write',
        'users:delete',
        'profile:read',
        'profile:write',
        'reports:read',
        'settings:read',
        'settings:write',
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
 */
async function seedEnums() {
  const enums = [
    // Host Status Enum
    {
      pk: 'ENUM#HOST_STATUS',
      sk: 'META',
      enumType: 'HOST_STATUS',
      enumName: 'Host Status',
      description: 'Valid status values for host profiles',
      values: [
        {
          value: 'NOT_SUBMITTED',
          label: 'Not Submitted',
          description: 'Initial status - user created but profile never submitted',
          order: 1,
        },
        {
          value: 'INCOMPLETE',
          label: 'Incomplete',
          description: 'Profile started but incomplete, not yet submitted',
          order: 2,
        },
        {
          value: 'VERIFICATION',
          label: 'Under Verification',
          description: 'Profile submitted, pending admin review',
          order: 3,
        },
        {
          value: 'VERIFIED',
          label: 'Verified',
          description: 'Profile verified and active',
          order: 4,
        },
        {
          value: 'REJECTED',
          label: 'Rejected',
          description: 'Profile rejected during verification',
          order: 5,
        },
        {
          value: 'SUSPENDED',
          label: 'Suspended',
          description: 'Account suspended',
          order: 6,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Document Type Enum
    {
      pk: 'ENUM#DOCUMENT_TYPE',
      sk: 'META',
      enumType: 'DOCUMENT_TYPE',
      enumName: 'Document Type',
      description: 'Valid document types for verification',
      values: [
        {
          value: 'PASSPORT',
          label: 'Passport',
          description: 'Government-issued passport',
          order: 1,
        },
        {
          value: 'ID_CARD',
          label: 'National ID Card',
          description: 'Government-issued national identity card',
          order: 2,
        },
        {
          value: 'DRIVERS_LICENSE',
          label: "Driver's License",
          description: "Government-issued driver's license",
          order: 3,
        },
        {
          value: 'PROOF_OF_ADDRESS',
          label: 'Proof of Address',
          description: 'Utility bill or bank statement',
          order: 4,
        },
        {
          value: 'BUSINESS_REGISTRATION',
          label: 'Business Registration',
          description: 'Company registration certificate',
          order: 5,
        },
        {
          value: 'VAT_CERTIFICATE',
          label: 'VAT Certificate',
          description: 'VAT registration certificate',
          order: 6,
        },
        {
          value: 'OTHER',
          label: 'Other',
          description: 'Other supporting document',
          order: 7,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Document Status Enum
    {
      pk: 'ENUM#DOCUMENT_STATUS',
      sk: 'META',
      enumType: 'DOCUMENT_STATUS',
      enumName: 'Document Status',
      description: 'Valid status values for documents',
      values: [
        {
          value: 'PENDING_UPLOAD',
          label: 'Pending Upload',
          description: 'Pre-signed URL generated, not yet uploaded',
          order: 1,
        },
        {
          value: 'PENDING',
          label: 'Pending Review',
          description: 'Document uploaded, awaiting admin review',
          order: 2,
        },
        {
          value: 'APPROVED',
          label: 'Approved',
          description: 'Document approved by admin',
          order: 3,
        },
        {
          value: 'REJECTED',
          label: 'Rejected',
          description: 'Document rejected by admin',
          order: 4,
        },
        {
          value: 'EXPIRED',
          label: 'Expired',
          description: 'Document has expired',
          order: 5,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Host Type Enum
    {
      pk: 'ENUM#HOST_TYPE',
      sk: 'META',
      enumType: 'HOST_TYPE',
      enumName: 'Host Type',
      description: 'Valid host types',
      values: [
        {
          value: 'INDIVIDUAL',
          label: 'Individual',
          description: 'Individual property owner',
          order: 1,
        },
        {
          value: 'BUSINESS',
          label: 'Business',
          description: 'Business entity or company',
          order: 2,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  // DynamoDB BatchWrite can only handle 25 items at a time
  await docClient.send(
    new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: enums.map((enumItem) => ({
          PutRequest: { Item: enumItem },
        })),
      },
    })
  );

  console.log('✅ Enums seeded');
}

