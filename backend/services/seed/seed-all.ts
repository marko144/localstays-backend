import { seedRoles } from './seed-roles';
import { seedEnums } from './seed-enums';
import { seedLanguages } from './seed-languages';

/**
 * Master Seed Script
 * 
 * Seeds all configuration data into DynamoDB:
 * - Role configurations (HOST, ADMIN)
 * - Enum values (HOST_STATUS, USER_STATUS, HOST_TYPE)
 * - Language configuration (supported languages for translations)
 * 
 * Run this once after initial deployment:
 * ```
 * TABLE_NAME=localstays-dev npm run seed
 * ```
 */

async function seedAll() {
  console.log('🚀 Starting database seeding...\n');
  console.log('═'.repeat(60));
  
  try {
    // Seed roles
    await seedRoles();
    console.log('═'.repeat(60));
    
    // Seed enums
    await seedEnums();
    console.log('═'.repeat(60));
    
    // Seed languages
    await seedLanguages();
    console.log('═'.repeat(60));
    
    console.log('\n✨ Database seeding completed successfully!\n');
  } catch (error) {
    console.error('\n💥 Database seeding failed:', error);
    process.exit(1);
  }
}

// Run
seedAll();

