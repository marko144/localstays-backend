/**
 * Migration Script: Backfill locationId and GSI8 for Existing Listings
 * 
 * This script updates all existing listing metadata records to populate:
 * - locationId: Denormalized location ID for efficient querying
 * - gsi8pk: LOCATION#{locationId}
 * - gsi8sk: LISTING#{listingId}
 * 
 * Location ID is derived from:
 * - mapboxMetadata.place.mapbox_id (primary)
 * - manualLocationIds[0] (fallback - first ID is always PLACE)
 * 
 * Run with:
 * AWS_REGION=eu-north-1 TABLE_NAME=localstays-staging npx ts-node backend/services/seed/migrate-listing-location-id.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION || 'eu-north-1';
const tableName = process.env.TABLE_NAME || 'localstays-staging';

const dynamoClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface ListingMetadata {
  pk: string;
  sk: string;
  listingId: string;
  hostId: string;
  locationId?: string;
  gsi8pk?: string;
  gsi8sk?: string;
  mapboxMetadata?: {
    place?: {
      mapbox_id: string;
      name: string;
    };
  };
  manualLocationIds?: string[];
}

/**
 * Derive locationId from listing data
 */
function deriveLocationId(listing: ListingMetadata): string | null {
  // Priority 1: mapboxMetadata.place.mapbox_id
  if (listing.mapboxMetadata?.place?.mapbox_id) {
    return listing.mapboxMetadata.place.mapbox_id;
  }
  
  // Priority 2: First manual location ID (always PLACE)
  if (listing.manualLocationIds && listing.manualLocationIds.length > 0) {
    return listing.manualLocationIds[0];
  }
  
  return null;
}

/**
 * Scan for all listing metadata records
 */
async function scanListings(): Promise<ListingMetadata[]> {
  const listings: ListingMetadata[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined = undefined;

  do {
    const result: any = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(sk, :skPrefix) AND attribute_exists(listingId)',
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
 * Update a listing's locationId and GSI8 attributes
 */
async function updateListingLocationId(listing: ListingMetadata, locationId: string): Promise<void> {
  const newGsi8pk = `LOCATION#${locationId}`;
  const newGsi8sk = `LISTING#${listing.listingId}`;

  // Check if already has correct values
  if (listing.locationId === locationId && listing.gsi8pk === newGsi8pk && listing.gsi8sk === newGsi8sk) {
    console.log(`✓ Listing ${listing.listingId} already has correct locationId values`);
    return;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        pk: listing.pk,
        sk: listing.sk,
      },
      UpdateExpression: 'SET locationId = :locationId, gsi8pk = :gsi8pk, gsi8sk = :gsi8sk, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':locationId': locationId,
        ':gsi8pk': newGsi8pk,
        ':gsi8sk': newGsi8sk,
        ':updatedAt': new Date().toISOString(),
      },
    })
  );

  console.log(`✅ Updated listing ${listing.listingId}: locationId=${locationId}`);
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('='.repeat(80));
  console.log('LocationId Migration Script for Listing Metadata Records');
  console.log('='.repeat(80));
  console.log(`Region: ${region}`);
  console.log(`Table: ${tableName}`);
  console.log('');

  try {
    // Step 1: Scan for all listings
    console.log('Step 1: Scanning for listing metadata records...');
    const listings = await scanListings();
    console.log(`Found ${listings.length} listing(s)\n`);

    if (listings.length === 0) {
      console.log('No listings found. Migration complete.');
      return;
    }

    // Step 2: Update each listing
    console.log('Step 2: Updating locationId and GSI8 attributes...');
    let updatedCount = 0;
    let skippedCount = 0;
    let noLocationCount = 0;

    for (const listing of listings) {
      const locationId = deriveLocationId(listing);
      
      if (!locationId) {
        console.log(`⚠️ Listing ${listing.listingId} has no location data (no mapboxMetadata or manualLocationIds)`);
        noLocationCount++;
        continue;
      }

      const needsUpdate =
        listing.locationId !== locationId ||
        listing.gsi8pk !== `LOCATION#${locationId}` ||
        listing.gsi8sk !== `LISTING#${listing.listingId}`;

      if (needsUpdate) {
        await updateListingLocationId(listing, locationId);
        updatedCount++;
      } else {
        console.log(`✓ Listing ${listing.listingId} already correct`);
        skippedCount++;
      }
    }

    // Summary
    console.log('');
    console.log('='.repeat(80));
    console.log('Migration Summary');
    console.log('='.repeat(80));
    console.log(`Total listings found: ${listings.length}`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped (already correct): ${skippedCount}`);
    console.log(`No location data: ${noLocationCount}`);
    console.log('');
    console.log('✅ Migration completed successfully!');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run migration
migrate()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

