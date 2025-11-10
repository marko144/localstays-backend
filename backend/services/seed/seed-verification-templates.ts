/**
 * Seed Verification Email Templates
 * Inserts property verification email templates into DynamoDB
 * Run with: npm run build && node dist/services/seed/seed-verification-templates.js
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { verificationEmailTemplates } from './verification-email-templates';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || 'localstays-dev1-email-templates';

async function seedVerificationTemplates() {
  console.log(`\n🌱 Seeding ${verificationEmailTemplates.length} verification email templates to ${TABLE_NAME}...\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const template of verificationEmailTemplates) {
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: template,
        })
      );

      console.log(`✅ ${template.templateName} (${template.language})`);
      successCount++;
    } catch (error: any) {
      console.error(`❌ Failed to insert ${template.templateName} (${template.language}):`, error.message);
      errorCount++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);
  console.log(`   📝 Total: ${verificationEmailTemplates.length}\n`);

  if (errorCount === 0) {
    console.log('🎉 All verification email templates seeded successfully!\n');
  } else {
    console.error(`⚠️  ${errorCount} template(s) failed to seed.\n`);
    process.exit(1);
  }
}

// Run the seed function
seedVerificationTemplates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });




