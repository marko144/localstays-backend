/**
 * Seed Language Configuration
 * 
 * Seeds the system-level language configuration for translatable fields.
 * 
 * Run:
 * TABLE_NAME=localstays-dev npm run seed:languages
 * TABLE_NAME=localstays-staging npm run seed:languages
 * TABLE_NAME=localstays-prod npm run seed:languages
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LanguageConfig, SupportedLanguage } from '../types/listing.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME;

if (!TABLE_NAME) {
  console.error('❌ TABLE_NAME environment variable is required');
  process.exit(1);
}

/**
 * Default supported languages for LocalStays
 */
const DEFAULT_LANGUAGES: SupportedLanguage[] = [
  {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    isActive: true,
    addedAt: new Date().toISOString(),
    addedBy: 'system',
  },
  {
    code: 'sr',
    name: 'Serbian',
    nativeName: 'Srpski',
    isActive: true,
    addedAt: new Date().toISOString(),
    addedBy: 'system',
  },
];

/**
 * Languages required for listings (must have translations before publishing)
 */
const REQUIRED_FOR_LISTINGS = ['en', 'sr'];

export async function seedLanguages(): Promise<void> {
  console.log('📝 Seeding language configuration...');
  console.log(`   Table: ${TABLE_NAME}`);

  const now = new Date().toISOString();

  const languageConfig: LanguageConfig = {
    pk: 'CONFIG#SYSTEM',
    sk: 'LANGUAGES',
    languages: DEFAULT_LANGUAGES,
    requiredForListings: REQUIRED_FOR_LISTINGS,
    updatedAt: now,
    updatedBy: 'system',
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: languageConfig,
      })
    );

    console.log('✅ Language configuration seeded successfully');
    console.log(`   Supported languages: ${DEFAULT_LANGUAGES.map(l => l.code).join(', ')}`);
    console.log(`   Required for listings: ${REQUIRED_FOR_LISTINGS.join(', ')}`);
  } catch (error) {
    console.error('❌ Failed to seed language configuration:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  seedLanguages()
    .then(() => {
      console.log('\n✨ Language seeding completed!\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Language seeding failed:', error);
      process.exit(1);
    });
}


