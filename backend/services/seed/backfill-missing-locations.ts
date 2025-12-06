/**
 * One-time Script: Backfill missing locationId for listings without location data
 * 
 * This assigns random existing PLACE locations to listings that have no mapboxMetadata or manualLocationIds.
 * 
 * Run with:
 * AWS_REGION=eu-north-1 TABLE_NAME=localstays-staging npx ts-node backend/services/seed/backfill-missing-locations.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION || 'eu-north-1';
const tableName = process.env.TABLE_NAME || 'localstays-staging';

const dynamoClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Available PLACE locations from the locations table
const PLACE_LOCATIONS = [
  { id: 'dXJuOm1ieHBsYzp4STQ', name: 'Podgorica' },
  { id: 'dXJuOm1ieHBsYzpBUVRC', name: 'Belgrade' },
  { id: 'dXJuOm1ieHBsYzpER2pC', name: 'Požega' },
  { id: 'dXJuOm1ieHBsYzpFT2pC', name: 'Užice' },
  { id: 'dXJuOm1ieHBsYzppd2pC', name: 'Zlatibor' },
];

interface ListingMetadata {
  pk: string;
  sk: string;
  listingId: string;
  hostId: string;
  locationId?: string;
  mapboxMetadata?: {
    place?: {
      mapbox_id: string;
    };
  };
  manualLocationIds?: string[];
}

/**
 * Get a random location from the list
 */
function getRandomLocation() {
  return PLACE_LOCATIONS[Math.floor(Math.random() * PLACE_LOCATIONS.length)];
}

/**
 * Scan for listings without location data
 */
async function scanListingsWithoutLocation(): Promise<ListingMetadata[]> {
  const listings: ListingMetadata[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined = undefined;

  do {
    const result: any = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(sk, :skPrefix) AND attribute_exists(listingId) AND attribute_not_exists(locationId)',
        ExpressionAttributeValues: {
          ':skPrefix': 'LISTING_META#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      listings.push(...(result.Items as ListingMetadata[]));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return listings;
}

/**
 * Update a listing with a random location
 */
async function updateListingWithLocation(listing: ListingMetadata, location: { id: string; name: string }): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        pk: listing.pk,
        sk: listing.sk,
      },
      UpdateExpression: 'SET locationId = :locationId, gsi8pk = :gsi8pk, gsi8sk = :gsi8sk, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':locationId': location.id,
        ':gsi8pk': `LOCATION#${location.id}`,
        ':gsi8sk': `LISTING#${listing.listingId}`,
        ':updatedAt': new Date().toISOString(),
      },
    })
  );

  console.log(`✅ Updated listing ${listing.listingId}: locationId=${location.id} (${location.name})`);
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('Backfill Missing Locations Script');
  console.log('='.repeat(80));
  console.log(`Region: ${region}`);
  console.log(`Table: ${tableName}`);
  console.log('');

  try {
    // Step 1: Find listings without locationId
    console.log('Step 1: Scanning for listings without locationId...');
    const listings = await scanListingsWithoutLocation();
    console.log(`Found ${listings.length} listing(s) without locationId\n`);

    if (listings.length === 0) {
      console.log('No listings need updating. Done!');
      return;
    }

    // Step 2: Update each listing with a random location
    console.log('Step 2: Assigning random locations...');
    
    for (const listing of listings) {
      const location = getRandomLocation();
      await updateListingWithLocation(listing, location);
    }

    // Summary
    console.log('');
    console.log('='.repeat(80));
    console.log('Summary');
    console.log('='.repeat(80));
    console.log(`Updated: ${listings.length} listings`);
    console.log('');
    console.log('✅ Backfill completed successfully!');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('❌ Script failed:', error);
    throw error;
  }
}

// Run
main()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });


