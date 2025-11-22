/**
 * Seed Location Name Variants
 * 
 * Creates additional name variants for locations where multiple names are commonly used.
 * Currently: Belgrade (English) / Beograd (Serbian)
 * 
 * This is part of the data deployment and should be run after the main seed.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;

// Mapbox Place ID for Belgrade
const BELGRADE_PLACE_ID = 'dXJuOm1ieHBsYzpBUVRC';

/**
 * Location name variants to seed
 * Each variant shares the same locationId (Mapbox Place ID)
 */
const LOCATION_VARIANTS = [
  {
    placeId: BELGRADE_PLACE_ID,
    name: 'Beograd', // Serbian name
    regionName: 'Belgrade', // Region name from Mapbox
    countryName: 'Serbia',
    countryCode: 'RS',
    regionId: 'dXJuOm1ieHBsYzpBUVRC', // Same as place ID for Belgrade
  },
  // Add more variants here as needed
  // Example:
  // {
  //   placeId: 'some-mapbox-id',
  //   name: 'Wien',
  //   regionName: 'Vienna',
  //   countryName: 'Austria',
  //   countryCode: 'AT',
  //   regionId: 'some-region-id',
  // },
];

/**
 * Handler for CDK CustomResource
 */
export async function handler(event: any): Promise<any> {
  console.log('Seeding location name variants...');

  try {
    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      await seedLocationVariants();
    }

    return {
      Status: 'SUCCESS',
      PhysicalResourceId: 'location-variants-seed',
      Data: {
        Message: 'Location variants seeded successfully',
      },
    };
  } catch (error) {
    console.error('Error seeding location variants:', error);
    return {
      Status: 'FAILED',
      PhysicalResourceId: 'location-variants-seed',
      Reason: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Seed all location variants
 */
async function seedLocationVariants(): Promise<void> {
  for (const variant of LOCATION_VARIANTS) {
    await seedLocationVariant(variant);
  }
  console.log(`✅ Seeded ${LOCATION_VARIANTS.length} location variant(s)`);
}

/**
 * Seed a single location variant
 */
async function seedLocationVariant(variant: {
  placeId: string;
  name: string;
  regionName: string;
  countryName: string;
  countryCode: string;
  regionId: string;
}): Promise<void> {
  const { placeId, name, regionName, countryName, countryCode, regionId } = variant;

  // Check if this specific variant already exists
  const existing = await docClient.send(
    new GetCommand({
      TableName: LOCATIONS_TABLE_NAME,
      Key: {
        pk: `LOCATION#${placeId}`,
        sk: `NAME#${name}`,
      },
    })
  );

  if (existing.Item) {
    console.log(`✓ Location variant already exists: ${name} (${placeId})`);
    return;
  }

  // Check if the primary variant exists (to inherit listingsCount)
  const primaryVariantResult = await docClient.send(
    new GetCommand({
      TableName: LOCATIONS_TABLE_NAME,
      Key: {
        pk: `LOCATION#${placeId}`,
        sk: `NAME#${regionName}`, // Assuming primary variant uses regionName as name
      },
    })
  );

  const listingsCount = primaryVariantResult.Item?.listingsCount || 0;

  // Generate slug and searchName
  const slug = generateLocationSlug(name, countryCode);
  const searchName = generateSearchName(name, regionName);

  // Create new variant
  const now = new Date().toISOString();
  const newVariant = {
    pk: `LOCATION#${placeId}`,
    sk: `NAME#${name}`,

    locationId: placeId,
    locationType: 'PLACE',
    name: name,
    regionName: regionName,
    countryName: countryName,

    mapboxPlaceId: placeId,
    mapboxRegionId: regionId,

    slug: slug,
    searchName: searchName,
    entityType: 'LOCATION',

    listingsCount: listingsCount, // Inherit from primary variant

    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: LOCATIONS_TABLE_NAME,
      Item: newVariant,
    })
  );

  console.log(`✓ Created location variant: ${name} (${placeId}) with ${listingsCount} listings`);
}

/**
 * Generate location slug: "place-name-countrycode" (e.g., "beograd-rs")
 */
function generateLocationSlug(name: string, countryCode: string): string {
  const normalize = (str: string) =>
    str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

  return `${normalize(name)}-${countryCode.toLowerCase()}`;
}

/**
 * Generate search name: "placename regionname" (lowercase, normalized, no diacritics)
 */
function generateSearchName(name: string, regionName: string): string {
  const normalize = (str: string) =>
    str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''); // Remove diacritics

  return `${normalize(name)} ${normalize(regionName)}`;
}

