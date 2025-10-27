/**
 * Seed Admin Email Templates Script
 * 
 * Run with:
 * AWS_REGION=eu-north-1 TABLE_NAME=localstays-dev1-email-templates npx ts-node backend/services/seed/seed-admin-templates.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { adminEmailTemplates } from './admin-email-templates';

const region = process.env.AWS_REGION || 'eu-north-1';
const tableName = process.env.TABLE_NAME || 'localstays-dev1-email-templates';

const dynamoClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

async function seedTemplates() {
  console.log('='.repeat(80));
  console.log('Seeding Admin Email Templates');
  console.log('='.repeat(80));
  console.log(`Region: ${region}`);
  console.log(`Table: ${tableName}`);
  console.log(`Templates to seed: ${adminEmailTemplates.length}\n`);

  try {
    const batchSize = 25;
    for (let i = 0; i < adminEmailTemplates.length; i += batchSize) {
      const batch = adminEmailTemplates.slice(i, i + batchSize);
      
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [tableName]: batch.map((template) => ({
              PutRequest: {
                Item: template,
              },
            })),
          },
        })
      );
      
      console.log(`✅ Seeded batch ${Math.floor(i / batchSize) + 1} (${batch.length} templates)`);
    }

    console.log('\n' + '='.repeat(80));
    console.log(`✅ Successfully seeded ${adminEmailTemplates.length} admin email templates!`);
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Failed to seed templates:', error);
    process.exit(1);
  }
}

seedTemplates();




