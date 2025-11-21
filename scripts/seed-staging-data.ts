#!/usr/bin/env ts-node
/**
 * Staging Data Seeding Script
 * 
 * This script seeds the staging environment with realistic listing data.
 * 
 * Features:
 * - Updates FREE subscription max listings from 2 to 20
 * - Ensures all hosts have complete profiles
 * - Creates 15 listings per host (or fills to 15 if they have fewer)
 * - Generates realistic content, amenities, pricing
 * - Copies images from existing listings
 * - Reuses location/address data
 * - Publishes all listings to PublicListings table
 * 
 * Usage:
 *   # Test on single host
 *   npm run seed-staging -- --hostId host_xxx
 * 
 *   # Run on all hosts
 *   npm run seed-staging
 * 
 *   # Dry run (no changes)
 *   npm run seed-staging -- --dry-run
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  BatchWriteCommand
} from '@aws-sdk/lib-dynamodb';
import { S3Client, CopyObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

// ============================================================================
// Configuration
// ============================================================================

const REGION = 'eu-north-1';
const TABLE_NAME = 'localstays-staging';
const LOCATIONS_TABLE_NAME = 'localstays-locations-staging';
const PUBLIC_LISTINGS_TABLE_NAME = 'localstays-public-listings-staging';
const PUBLIC_LISTING_MEDIA_TABLE_NAME = 'localstays-public-listing-media-staging';
const BUCKET_NAME = 'localstays-staging-host-assets';

const TARGET_LISTINGS_PER_HOST = 15;
const IMAGES_PER_LISTING = 6;

// ============================================================================
// AWS Clients
// ============================================================================

const dynamoClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({ region: REGION });

// ============================================================================
// Types
// ============================================================================

interface Host {
  hostId: string;
  email: string;
  status: string;
}

interface SourceImage {
  imageId: string;
  webpUrls: {
    thumbnail: string;
    full: string;
  };
}

interface SourceLocation {
  address: any;
  locationId: string | null;
}

// ============================================================================
// CLI Arguments
// ============================================================================

const args = process.argv.slice(2);
const targetHostId = args.find(arg => arg.startsWith('--hostId='))?.split('=')[1];
const isDryRun = args.includes('--dry-run');

console.log('🌱 Localstays Staging Data Seeding Script');
console.log('==========================================');
console.log(`Region: ${REGION}`);
console.log(`Target: ${targetHostId || 'ALL HOSTS'}`);
console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
console.log('');

// ============================================================================
// Step 1: Update FREE Subscription Limit
// ============================================================================

async function updateFreeSubscriptionLimit(): Promise<void> {
  console.log('📝 Step 1: Updating FREE subscription max listings (2 → 20)...');
  
  if (isDryRun) {
    console.log('   [DRY RUN] Would update FREE subscription');
    return;
  }

  try {
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: 'SUBSCRIPTION_PLAN#FREE',
        sk: 'META'
      },
      UpdateExpression: 'SET maxListings = :max',
      ExpressionAttributeValues: {
        ':max': 20
      }
    }));
    
    console.log('   ✅ Updated FREE subscription maxListings to 20');
  } catch (error) {
    console.error('   ❌ Failed to update subscription:', error);
    throw error;
  }
}

// ============================================================================
// Step 2: Get All Hosts
// ============================================================================

async function getAllHosts(): Promise<Host[]> {
  console.log('👥 Step 2: Fetching hosts...');
  
  const result = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'sk = :sk AND attribute_exists(email)',
    ExpressionAttributeValues: {
      ':sk': 'META'
    },
    ProjectionExpression: 'hostId, email, #status',
    ExpressionAttributeNames: {
      '#status': 'status'
    }
  }));

  const hosts = (result.Items || [])
    .filter((item: any) => item.hostId && item.email)
    .map((item: any) => ({
      hostId: item.hostId,
      email: item.email,
      status: item.status
    }));

  // Filter to single host if specified
  const filteredHosts = targetHostId 
    ? hosts.filter((h: Host) => h.hostId === targetHostId)
    : hosts;

  console.log(`   Found ${hosts.length} total hosts`);
  console.log(`   Processing ${filteredHosts.length} hosts`);
  
  return filteredHosts;
}

// ============================================================================
// Step 3: Get Existing Listings Count
// ============================================================================

async function getExistingListingsCount(hostId: string): Promise<number> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: {
      ':pk': `HOST#${hostId}`,
      ':sk': 'LISTING_META#'
    },
    Select: 'COUNT'
  }));

  return result.Count || 0;
}

// ============================================================================
// Step 4: Load Source Data (Images & Locations)
// ============================================================================

async function loadSourceImages(): Promise<SourceImage[]> {
  console.log('🖼️  Loading source images...');
  
  const result = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'begins_with(sk, :sk) AND isDeleted = :deleted AND attribute_exists(webpUrls)',
    ExpressionAttributeValues: {
      ':sk': 'IMAGE#',
      ':deleted': false
    },
    ProjectionExpression: 'imageId, webpUrls'
  }));

  const images = (result.Items || [])
    .filter((item: any) => item.webpUrls?.thumbnail && item.webpUrls?.full)
    .map((item: any) => ({
      imageId: item.imageId,
      webpUrls: {
        thumbnail: item.webpUrls.thumbnail,
        full: item.webpUrls.full
      }
    }));

  console.log(`   Found ${images.length} source images`);
  return images;
}

async function loadSourceLocations(): Promise<SourceLocation[]> {
  console.log('📍 Loading source locations...');
  
  const result = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: 'begins_with(sk, :sk) AND attribute_exists(address)',
    ExpressionAttributeValues: {
      ':sk': 'LISTING_META#'
    },
    ProjectionExpression: 'address, locationId'
  }));

  const locations = (result.Items || [])
    .filter((item: any) => item.address)
    .map((item: any) => ({
      address: item.address,
      locationId: item.locationId || null
    }));

  console.log(`   Found ${locations.length} source locations`);
  return locations;
}

// ============================================================================
// Step 5: Generate Listing Data
// ============================================================================

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function randomSample<T>(array: T[], count: number): T[] {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(count, array.length));
}

const PROPERTY_TYPES = ['APARTMENT', 'HOUSE', 'VILLA', 'STUDIO'];
const PROPERTY_NAMES = [
  'Cozy Mountain Retreat', 'Modern City Apartment', 'Charming Village House',
  'Luxury Villa with Pool', 'Peaceful Countryside Home', 'Stylish Urban Loft',
  'Traditional Stone House', 'Spacious Family Home', 'Elegant Downtown Flat',
  'Rustic Mountain Cabin', 'Contemporary Garden Apartment', 'Historic Town House'
];

const DESCRIPTIONS = [
  'Welcome to our beautiful property located in the heart of Serbia. This spacious accommodation offers everything you need for a comfortable stay, including modern amenities and stunning views.',
  'Experience authentic Serbian hospitality in this charming property. Perfect for families or groups, featuring comfortable bedrooms, a fully equipped kitchen, and a lovely outdoor space.',
  'Discover this wonderful retreat offering peace and tranquility. Ideal for those seeking relaxation, with easy access to local attractions, restaurants, and cultural sites.',
  'Enjoy your stay in this thoughtfully designed space combining traditional charm with modern comfort. Great location for exploring the region while having a cozy place to return to.',
  'This delightful property provides the perfect base for your Serbian adventure. Featuring comfortable living spaces, excellent amenities, and a warm, welcoming atmosphere.'
];

// Full amenities list with bilingual text
const AMENITIES_FULL = [
  // Basics
  { key: 'WIFI', en: 'Wi-Fi', sr: 'Bežični internet', category: 'BASICS', isFilter: true },
  { key: 'AIR_CONDITIONING', en: 'Air Conditioning', sr: 'Klima uređaj', category: 'BASICS', isFilter: true },
  { key: 'HEATING', en: 'Heating', sr: 'Grejanje', category: 'BASICS', isFilter: false },
  { key: 'HOT_WATER', en: 'Hot Water', sr: 'Topla voda', category: 'BASICS', isFilter: false },
  
  // Kitchen
  { key: 'KITCHEN', en: 'Kitchen', sr: 'Kuhinja', category: 'KITCHEN', isFilter: false },
  { key: 'REFRIGERATOR', en: 'Refrigerator', sr: 'Frižider', category: 'KITCHEN', isFilter: false },
  { key: 'MICROWAVE', en: 'Microwave', sr: 'Mikrotalasna', category: 'KITCHEN', isFilter: false },
  { key: 'OVEN', en: 'Oven', sr: 'Rerna', category: 'KITCHEN', isFilter: false },
  { key: 'STOVE', en: 'Stove', sr: 'Šporet', category: 'KITCHEN', isFilter: false },
  { key: 'DISHWASHER', en: 'Dishwasher', sr: 'Mašina za pranje sudova', category: 'KITCHEN', isFilter: false },
  { key: 'COFFEE_MAKER', en: 'Coffee Maker', sr: 'Aparat za kafu', category: 'KITCHEN', isFilter: false },
  
  // Laundry
  { key: 'WASHING_MACHINE', en: 'Washing Machine', sr: 'Mašina za pranje veša', category: 'LAUNDRY', isFilter: false },
  { key: 'DRYER', en: 'Dryer', sr: 'Mašina za sušenje', category: 'LAUNDRY', isFilter: false },
  { key: 'IRON', en: 'Iron', sr: 'Pegla', category: 'LAUNDRY', isFilter: false },
  
  // Entertainment
  { key: 'TV', en: 'TV', sr: 'Televizor', category: 'ENTERTAINMENT', isFilter: false },
  { key: 'CABLE_TV', en: 'Cable TV', sr: 'Kablovska TV', category: 'ENTERTAINMENT', isFilter: false },
  { key: 'STREAMING_SERVICES', en: 'Streaming Services', sr: 'Streaming servisi', category: 'ENTERTAINMENT', isFilter: false },
  
  // Comfort
  { key: 'BED_LINENS', en: 'Bed Linens', sr: 'Posteljina', category: 'BASICS', isFilter: false },
  { key: 'TOWELS', en: 'Towels', sr: 'Peškiri', category: 'BASICS', isFilter: false },
  { key: 'TOILETRIES', en: 'Basic Toiletries', sr: 'Osnovni toaletni pribor', category: 'BASICS', isFilter: false },
  { key: 'HAIR_DRYER', en: 'Hair Dryer', sr: 'Fen za kosu', category: 'BASICS', isFilter: false },
  
  // Outdoor
  { key: 'BALCONY', en: 'Balcony', sr: 'Balkon', category: 'OUTDOOR', isFilter: false },
  { key: 'TERRACE', en: 'Terrace', sr: 'Terasa', category: 'OUTDOOR', isFilter: false },
  { key: 'GARDEN', en: 'Garden', sr: 'Bašta', category: 'OUTDOOR', isFilter: false },
  { key: 'BBQ_GRILL', en: 'BBQ Grill', sr: 'Roštilj', category: 'OUTDOOR', isFilter: false },
  
  // Building
  { key: 'ELEVATOR', en: 'Elevator', sr: 'Lift', category: 'BUILDING', isFilter: false },
  { key: 'PARKING', en: 'Parking', sr: 'Parking', category: 'BUILDING', isFilter: true },
  { key: 'DOORMAN', en: 'Doorman', sr: 'Portir', category: 'BUILDING', isFilter: false },
  { key: 'GYM', en: 'Gym', sr: 'Teretana', category: 'BUILDING', isFilter: true },
  { key: 'POOL', en: 'Pool', sr: 'Bazen', category: 'BUILDING', isFilter: true },
  
  // Family
  { key: 'CRIB', en: 'Crib', sr: 'Krevetac', category: 'FAMILY', isFilter: false },
  { key: 'HIGH_CHAIR', en: 'High Chair', sr: 'Stolica za hranjenje', category: 'FAMILY', isFilter: false },
  { key: 'CHILD_FRIENDLY', en: 'Child Friendly', sr: 'Pogodno za decu', category: 'FAMILY', isFilter: false },
  
  // Accessibility
  { key: 'WHEELCHAIR_ACCESSIBLE', en: 'Wheelchair Accessible', sr: 'Pristupačno za invalidska kolica', category: 'ACCESSIBILITY', isFilter: false },
  { key: 'STEP_FREE_ACCESS', en: 'Step-free Access', sr: 'Pristup bez stepenica', category: 'ACCESSIBILITY', isFilter: false },
  
  // Safety
  { key: 'SMOKE_DETECTOR', en: 'Smoke Detector', sr: 'Detektor dima', category: 'SAFETY', isFilter: false },
  { key: 'CARBON_MONOXIDE_DETECTOR', en: 'Carbon Monoxide Detector', sr: 'Detektor ugljen-monoksida', category: 'SAFETY', isFilter: false },
  { key: 'FIRE_EXTINGUISHER', en: 'Fire Extinguisher', sr: 'Aparat za gašenje požara', category: 'SAFETY', isFilter: false },
  { key: 'FIRST_AID_KIT', en: 'First Aid Kit', sr: 'Komplet prve pomoći', category: 'SAFETY', isFilter: false },
  
  // Work
  { key: 'WORKSPACE', en: 'Dedicated Workspace', sr: 'Radni prostor', category: 'WORK', isFilter: true },
  { key: 'DESK', en: 'Desk', sr: 'Radni sto', category: 'WORK', isFilter: false },
  { key: 'OFFICE_CHAIR', en: 'Office Chair', sr: 'Kancelarijska stolica', category: 'WORK', isFilter: false }
];

// Amenities that affect PublicListing boolean filters
const SEARCH_RELEVANT_AMENITIES = {
  hasWIFI: 'WIFI',
  hasAirConditioning: 'AIR_CONDITIONING',
  hasParking: 'PARKING',
  hasGym: 'GYM',
  hasPool: 'POOL',
  hasWorkspace: 'WORKSPACE'
};

function generateListingData(hostId: string, location: SourceLocation) {
  const listingId = `listing_${randomUUID()}`;
  const now = new Date().toISOString();
  
  // Generate capacity
  const bedrooms = randomInt(1, 4);
  const beds = bedrooms + randomInt(0, 2);
  const bathrooms = randomInt(1, Math.max(2, bedrooms));
  const sleeps = beds + randomInt(0, 2);

  // Select amenities (ensure some search-relevant ones)
  const selectedAmenityObjects = randomSample(AMENITIES_FULL, randomInt(8, 15));
  
  // Ensure at least 50% of listings have WIFI, PARKING, AIR_CONDITIONING
  const wifiAmenity = AMENITIES_FULL.find(a => a.key === 'WIFI');
  const parkingAmenity = AMENITIES_FULL.find(a => a.key === 'PARKING');
  const airConditioningAmenity = AMENITIES_FULL.find(a => a.key === 'AIR_CONDITIONING');
  
  if (Math.random() > 0.5 && wifiAmenity && !selectedAmenityObjects.find(a => a.key === 'WIFI')) {
    selectedAmenityObjects.push(wifiAmenity);
  }
  if (Math.random() > 0.5 && parkingAmenity && !selectedAmenityObjects.find(a => a.key === 'PARKING')) {
    selectedAmenityObjects.push(parkingAmenity);
  }
  if (Math.random() > 0.6 && airConditioningAmenity && !selectedAmenityObjects.find(a => a.key === 'AIR_CONDITIONING')) {
    selectedAmenityObjects.push(airConditioningAmenity);
  }
  
  // Remove duplicates based on key
  const uniqueAmenities = selectedAmenityObjects.filter((amenity, index, self) =>
    index === self.findIndex((a) => a.key === amenity.key)
  );

  return {
    listingId,
    hostId,
    listingName: randomChoice(PROPERTY_NAMES),
    description: randomChoice(DESCRIPTIONS),
    propertyType: randomChoice(PROPERTY_TYPES),
    capacity: {
      sleeps,
      bedrooms,
      beds,
      bathrooms
    },
    amenities: uniqueAmenities,
    address: location.address,
    locationId: location.locationId,
    createdAt: now,
    updatedAt: now
  };
}

// ============================================================================
// Step 6: Copy Images to S3
// ============================================================================

async function copyImagesToS3(
  hostId: string,
  listingId: string,
  sourceImages: SourceImage[],
  count: number
): Promise<any[]> {
  const selectedImages = randomSample(sourceImages, count);
  const copiedImages = [];

  for (let i = 0; i < selectedImages.length; i++) {
    const sourceImage = selectedImages[i];
    const newImageId = randomUUID();
    const destPath = `host_${hostId}/listings/listing_${listingId}/images/`;

    if (!isDryRun) {
      // Copy thumbnail
      await s3Client.send(new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${sourceImage.webpUrls.thumbnail}`,
        Key: `${destPath}${newImageId}-thumb.webp`
      }));

      // Copy full image
      await s3Client.send(new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${sourceImage.webpUrls.full}`,
        Key: `${destPath}${newImageId}-full.webp`
      }));
    }

    copiedImages.push({
      imageId: newImageId,
      webpUrls: {
        thumbnail: `${destPath}${newImageId}-thumb.webp`,
        full: `${destPath}${newImageId}-full.webp`
      },
      displayOrder: i + 1,
      isPrimary: i === 0
    });
  }

  return copiedImages;
}

// ============================================================================
// Step 7: Create Pricing
// ============================================================================

async function createPricing(hostId: string, listingId: string): Promise<void> {
  const basePrice = randomInt(35, 65);
  const membersPrice = Math.round(basePrice * 0.9); // 10% off
  const now = new Date().toISOString();

  // Base pricing
  const basePriceRecord = {
    pk: `HOST#${hostId}`,
    sk: `LISTING_PRICING#${listingId}#BASE#default`,
    listingId,
    basePriceId: 'default',
    isDefault: true,
    dateRange: null,
    standardPrice: basePrice,
    membersDiscount: {
      type: 'PERCENTAGE',
      percentage: 10,
      calculatedPrice: membersPrice,
      calculatedPercentage: 10
    },
    createdAt: now,
    updatedAt: now,
    gsi3pk: `LISTING#${listingId}`,
    gsi3sk: 'BASE_PRICE#default'
  };

  if (!isDryRun) {
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: basePriceRecord
    }));
  }

  // December 2025 seasonal pricing (+€10, 5% members discount)
  const decPrice = basePrice + 10;
  const decMembersPrice = Math.round(decPrice * 0.95);
  
  const decPriceRecord = {
    pk: `HOST#${hostId}`,
    sk: `LISTING_PRICING#${listingId}#BASE#season_dec2025`,
    listingId,
    basePriceId: 'season_dec2025',
    isDefault: false,
    dateRange: {
      startDate: '2025-12-01',
      endDate: '2025-12-31',
      displayStart: '01-12-2025',
      displayEnd: '31-12-2025'
    },
    standardPrice: decPrice,
    membersDiscount: {
      type: 'PERCENTAGE',
      percentage: 5,
      calculatedPrice: decMembersPrice,
      calculatedPercentage: 5
    },
    createdAt: now,
    updatedAt: now,
    gsi3pk: `LISTING#${listingId}`,
    gsi3sk: 'BASE_PRICE#season_dec2025'
  };

  if (!isDryRun) {
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: decPriceRecord
    }));
  }

  // January 2026 seasonal pricing (+20%, 5% members discount)
  const janPrice = Math.round(basePrice * 1.2);
  const janMembersPrice = Math.round(janPrice * 0.95);
  
  const janPriceRecord = {
    pk: `HOST#${hostId}`,
    sk: `LISTING_PRICING#${listingId}#BASE#season_jan2026`,
    listingId,
    basePriceId: 'season_jan2026',
    isDefault: false,
    dateRange: {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      displayStart: '01-01-2026',
      displayEnd: '31-01-2026'
    },
    standardPrice: janPrice,
    membersDiscount: {
      type: 'PERCENTAGE',
      percentage: 5,
      calculatedPrice: janMembersPrice,
      calculatedPercentage: 5
    },
    createdAt: now,
    updatedAt: now,
    gsi3pk: `LISTING#${listingId}`,
    gsi3sk: 'BASE_PRICE#season_jan2026'
  };

  if (!isDryRun) {
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: janPriceRecord
    }));

    // Create pricing matrix
    const matrix = {
      basePrices: [
        {
          basePriceId: 'default',
          isDefault: true,
          dateRange: null,
          standardPrice: basePrice,
          membersDiscount: {
            type: 'PERCENTAGE',
            inputValue: 10,
            calculatedPrice: membersPrice,
            calculatedPercentage: 10
          },
          lengthOfStayPricing: []
        },
        {
          basePriceId: 'season_dec2025',
          isDefault: false,
          dateRange: {
            startDate: '2025-12-01',
            endDate: '2025-12-31',
            displayStart: '01-12-2025',
            displayEnd: '31-12-2025'
          },
          standardPrice: decPrice,
          membersDiscount: {
            type: 'PERCENTAGE',
            inputValue: 5,
            calculatedPrice: decMembersPrice,
            calculatedPercentage: 5
          },
          lengthOfStayPricing: []
        },
        {
          basePriceId: 'season_jan2026',
          isDefault: false,
          dateRange: {
            startDate: '2026-01-01',
            endDate: '2026-01-31',
            displayStart: '01-01-2026',
            displayEnd: '31-01-2026'
          },
          standardPrice: janPrice,
          membersDiscount: {
            type: 'PERCENTAGE',
            inputValue: 5,
            calculatedPrice: janMembersPrice,
            calculatedPercentage: 5
          },
          lengthOfStayPricing: []
        }
      ]
    };

    // Store pricing matrix
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `HOST#${hostId}`,
        sk: `LISTING_PRICING#${listingId}#MATRIX`,
        listingId,
        currency: 'EUR',
        matrix,
        lastCalculatedAt: now,
        updatedAt: now,
        gsi3pk: `LISTING#${listingId}`,
        gsi3sk: 'PRICING_MATRIX'
      }
    }));

    // Update listing metadata to set hasPricing flag (already set in listing creation, but keeping for consistency)
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: `LISTING_META#${listingId}`
      },
      UpdateExpression: 'SET hasPricing = :true',
      ExpressionAttributeValues: {
        ':true': true
      }
    }));
  }
}

// ============================================================================
// Step 8: Create Listing Records
// ============================================================================

async function createListing(
  listingData: any,
  images: any[],
  sourceLocations: SourceLocation[]
): Promise<void> {
  const { hostId, listingId } = listingData;
  const now = new Date().toISOString();

  // 1. Create LISTING_META record
  const propertyTypeKey = listingData.propertyType;
  const propertyTypeMap: Record<string, { key: string; en: string; sr: string; isEntirePlace: boolean }> = {
    'APARTMENT': { key: 'APARTMENT', en: 'Apartment', sr: 'Apartman', isEntirePlace: true },
    'HOUSE': { key: 'HOUSE', en: 'House', sr: 'Kuća', isEntirePlace: true },
    'VILLA': { key: 'VILLA', en: 'Villa', sr: 'Vila', isEntirePlace: true },
    'STUDIO': { key: 'STUDIO', en: 'Studio', sr: 'Studio', isEntirePlace: true }
  };

  const checkInTypeMap: Record<string, { key: string; en: string; sr: string }> = {
    'SELF_CHECKIN': { key: 'SELF_CHECKIN', en: 'Self check-in', sr: 'Samostalni prijava' },
    'HOST_GREETING': { key: 'HOST_GREETING', en: 'Host greeting', sr: 'Domaćin dočekuje' },
    'LOCKBOX': { key: 'LOCKBOX', en: 'Lockbox', sr: 'Sef za ključeve' },
    'DOORMAN': { key: 'DOORMAN', en: 'Doorman', sr: 'Portir' }
  };

  const parkingTypeMap: Record<string, { key: string; en: string; sr: string }> = {
    'NO_PARKING': { key: 'NO_PARKING', en: 'No parking', sr: 'Nema parkinga' },
    'FREE': { key: 'FREE', en: 'Free parking', sr: 'Besplatan parking' },
    'PAID': { key: 'PAID', en: 'Paid parking', sr: 'Plaćeni parking' }
  };

  const cancellationPolicyMap: Record<string, { key: string; en: string; sr: string }> = {
    'NO_CANCELLATION': { key: 'NO_CANCELLATION', en: 'No cancellation', sr: 'Bez otkazivanja' },
    '24_HOURS': { key: '24_HOURS', en: '24 hours', sr: '24 sata' },
    '2_DAYS': { key: '2_DAYS', en: '2 days', sr: '2 dana' },
    '3_DAYS': { key: '3_DAYS', en: '3 days', sr: '3 dana' },
    '4_DAYS': { key: '4_DAYS', en: '4 days', sr: '4 dana' },
    'ONE_WEEK': { key: 'ONE_WEEK', en: 'One week', sr: 'Jedna nedelja' },
    'OTHER': { key: 'OTHER', en: 'Other', sr: 'Drugo' }
  };

  const paymentTypeMap: Record<string, { key: string; en: string; sr: string }> = {
    'PAY_ONLINE': { key: 'PAY_ONLINE', en: 'Pay online', sr: 'Plati online' },
    'PAY_DEPOSIT_ONLINE': { key: 'PAY_DEPOSIT_ONLINE', en: 'Pay deposit online', sr: 'Plati depozit online' },
    'PAY_LATER_CASH': { key: 'PAY_LATER_CASH', en: 'Pay later (cash)', sr: 'Plati kasnije (gotovina)' },
    'PAY_LATER_CARD': { key: 'PAY_LATER_CARD', en: 'Pay later (card)', sr: 'Plati kasnije (kartica)' }
  };

  const selectedCheckInType = randomChoice(['SELF_CHECKIN', 'HOST_GREETING', 'LOCKBOX']);
  const hasParking = listingData.amenities.some((a: any) => a.key === 'PARKING');
  const selectedParkingType = hasParking ? 'FREE' : 'NO_PARKING';
  const selectedCancellationPolicy = randomChoice(['24_HOURS', '2_DAYS', '3_DAYS', 'ONE_WEEK']);
  const selectedPaymentType = randomChoice(['PAY_ONLINE', 'PAY_DEPOSIT_ONLINE']);

  const listingMetaRecord: any = {
    pk: `HOST#${hostId}`,
    sk: `LISTING_META#${listingId}`,
    listingId,
    hostId,
    listingName: listingData.listingName,
    description: listingData.description,
    propertyType: propertyTypeMap[propertyTypeKey],
    capacity: listingData.capacity,
    address: listingData.address,
    locationId: listingData.locationId,
    status: 'ONLINE',
    s3Prefix: `host_${hostId}/listings/listing_${listingId}/`,
    hasPricing: true, // Set to true since we're creating pricing
    pricing: {
      pricePerNight: randomInt(35, 65),
      currency: 'EUR'
    },
    pets: {
      allowed: Math.random() > 0.7,
      policy: 'Please contact host for details'
    },
    checkIn: {
      type: checkInTypeMap[selectedCheckInType],
      description: 'Check-in instructions will be provided before arrival.',
      checkInFrom: '14:00',
      checkOutBy: '11:00'
    },
    parking: {
      type: parkingTypeMap[selectedParkingType]
    },
    paymentType: paymentTypeMap[selectedPaymentType],
    smokingAllowed: false,
    cancellationPolicy: {
      type: cancellationPolicyMap[selectedCancellationPolicy]
    },
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
    gsi2pk: 'LISTING_STATUS#ONLINE',
    gsi2sk: now,
    gsi3pk: `LISTING#${listingId}`,
    gsi3sk: `LISTING_META#${listingId}`
  };

  // Add optional parking description if FREE
  if (selectedParkingType === 'FREE') {
    listingMetaRecord.parking.description = 'Free parking available on premises';
  }

  if (!isDryRun) {
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: listingMetaRecord
    }));
  }

  // 2. Create IMAGE records
  for (const image of images) {
    const imageRecord = {
      pk: `LISTING#${listingId}`,
      sk: `IMAGE#${image.imageId}`,
      listingId,
      imageId: image.imageId,
      hostId,
      s3Key: `lstimg_${image.imageId}.jpg`, // Placeholder
      finalS3Prefix: `host_${hostId}/listings/listing_${listingId}/images/`,
      webpUrls: image.webpUrls,
      displayOrder: image.displayOrder,
      isPrimary: image.isPrimary,
      caption: '',
      contentType: 'image/jpeg',
      fileSize: 0,
      dimensions: { width: 1920, height: 1080 },
      status: 'READY',
      uploadedAt: now,
      processedAt: now,
      updatedAt: now,
      isDeleted: false
    };

    if (!isDryRun) {
      await docClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: imageRecord
      }));
    }
  }

  // 3. Create LISTING_AMENITIES record
  const amenitiesRecord = {
    pk: `HOST#${hostId}`,
    sk: `LISTING_AMENITIES#${listingId}`,
    listingId,
    hostId,
    amenities: listingData.amenities,
    updatedAt: now
  };

  if (!isDryRun) {
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: amenitiesRecord
    }));
  }

  // 4. Create pricing
  await createPricing(hostId, listingId);

  // 5. Publish to PublicListings
  await publishListing(listingData, images, sourceLocations);
}

// ============================================================================
// Step 9: Publish to PublicListings
// ============================================================================

async function publishListing(
  listingData: any,
  images: any[],
  sourceLocations: SourceLocation[]
): Promise<void> {
  const { listingId, hostId, locationId } = listingData;
  const now = new Date().toISOString();

  // Get location details
  let placeName = listingData.address.city || 'Unknown';
  let regionName = listingData.address.state || 'Unknown';

  if (locationId) {
    const locationResult = await docClient.send(new GetCommand({
      TableName: LOCATIONS_TABLE_NAME,
      Key: {
        pk: `LOCATION#${locationId}`,
        sk: 'META'
      }
    }));

    if (locationResult.Item) {
      placeName = locationResult.Item.name;
      regionName = locationResult.Item.regionName;
    }
  }

  // Calculate boolean filters
  const amenities = listingData.amenities;
  const amenityKeys = amenities.map((a: any) => a.key);
  const filters = {
    petsAllowed: Math.random() > 0.7,
    hasWIFI: amenityKeys.includes('WIFI'),
    hasAirConditioning: amenityKeys.includes('AIR_CONDITIONING'),
    hasParking: amenityKeys.includes('PARKING'),
    hasGym: amenityKeys.includes('GYM'),
    hasPool: amenityKeys.includes('POOL'),
    hasWorkspace: amenityKeys.includes('WORKSPACE')
  };

  // Primary image
  const primaryImage = images.find(img => img.isPrimary) || images[0];

  // Create PublicListing record
  const publicListing = {
    pk: `LOCATION#${locationId || 'UNKNOWN'}`,
    sk: `LISTING#${listingId}`,
    listingId,
    locationId: locationId || 'UNKNOWN',
    name: listingData.listingName,
    shortDescription: listingData.description.substring(0, 150),
    placeName,
    regionName,
    maxGuests: listingData.capacity.sleeps,
    bedrooms: listingData.capacity.bedrooms,
    beds: listingData.capacity.beds,
    bathrooms: listingData.capacity.bathrooms,
    thumbnailUrl: primaryImage.webpUrls.thumbnail,
    ...filters,
    parkingType: amenityKeys.includes('PARKING') ? 'FREE' : 'NO_PARKING',
    checkInType: 'SELF_CHECKIN',
    instantBook: false,
    createdAt: now,
    updatedAt: now
  };

  if (!isDryRun) {
    await docClient.send(new PutCommand({
      TableName: PUBLIC_LISTINGS_TABLE_NAME,
      Item: publicListing
    }));
  }

  // Create PublicListingMedia records
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const mediaRecord = {
      pk: `LISTING_MEDIA#${listingId}`,
      sk: `IMAGE#${String(i).padStart(3, '0')}`,
      listingId,
      imageIndex: i,
      url: image.webpUrls.full,
      thumbnailUrl: image.webpUrls.thumbnail,
      caption: '',
      isCoverImage: i === 0,
      createdAt: now,
      updatedAt: now
    };

    if (!isDryRun) {
      await docClient.send(new PutCommand({
        TableName: PUBLIC_LISTING_MEDIA_TABLE_NAME,
        Item: mediaRecord
      }));
    }
  }

  // Update location listingsCount if locationId exists
  if (locationId && !isDryRun) {
    await docClient.send(new UpdateCommand({
      TableName: LOCATIONS_TABLE_NAME,
      Key: {
        pk: `LOCATION#${locationId}`,
        sk: 'META'
      },
      UpdateExpression: 'ADD listingsCount :inc',
      ExpressionAttributeValues: {
        ':inc': 1
      }
    }));
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  try {
    // Step 1: Update subscription limit
    await updateFreeSubscriptionLimit();
    console.log('');

    // Step 2: Get hosts
    const hosts = await getAllHosts();
    if (hosts.length === 0) {
      console.log('❌ No hosts found');
      return;
    }
    console.log('');

    // Step 3: Load source data
    const sourceImages = await loadSourceImages();
    const sourceLocations = await loadSourceLocations();
    
    if (sourceImages.length === 0 || sourceLocations.length === 0) {
      console.log('❌ Insufficient source data (need images and locations)');
      return;
    }
    console.log('');

    // Step 4: Process each host
    for (const host of hosts) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Processing: ${host.email} (${host.hostId})`);
      console.log('='.repeat(60));

      // Get existing listings count
      const existingCount = await getExistingListingsCount(host.hostId);
      const listingsToCreate = Math.max(0, TARGET_LISTINGS_PER_HOST - existingCount);

      console.log(`   Existing listings: ${existingCount}`);
      console.log(`   Need to create: ${listingsToCreate}`);

      if (listingsToCreate === 0) {
        console.log('   ✅ Host already has 15+ listings, skipping');
        continue;
      }

      // Create listings
      for (let i = 0; i < listingsToCreate; i++) {
        console.log(`\n   Creating listing ${i + 1}/${listingsToCreate}...`);

        // Generate listing data
        const location = randomChoice(sourceLocations);
        const listingData = generateListingData(host.hostId, location);

        // Copy images
        console.log(`      - Copying ${IMAGES_PER_LISTING} images...`);
        const images = await copyImagesToS3(
          host.hostId,
          listingData.listingId,
          sourceImages,
          IMAGES_PER_LISTING
        );

        // Create listing records
        console.log(`      - Creating database records...`);
        await createListing(listingData, images, sourceLocations);

        console.log(`      ✅ Created ${listingData.listingName}`);
      }

      console.log(`\n   ✅ Completed ${host.email}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 Seeding completed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    process.exit(1);
  }
}

// Run the script
main();

