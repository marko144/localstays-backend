/**
 * Search Listings API
 * 
 * Public endpoint for searching available listings based on location, dates, guests, and filters.
 * Returns listings with calculated pricing based on authentication status.
 * 
 * Security: Comprehensive input validation, rate limiting, parameterized queries
 * 
 * Version: 1.0.0 - Initial deployment
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PublicListingRecord } from '../../types/public-listing.types';
import { PricingMatrixRecord, BasePriceWithDiscounts, LengthOfStayPricing } from '../../types/pricing.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

const MAIN_TABLE_NAME = process.env.MAIN_TABLE_NAME!;
const PUBLIC_LISTINGS_TABLE_NAME = process.env.PUBLIC_LISTINGS_TABLE_NAME!;
const AVAILABILITY_TABLE_NAME = process.env.AVAILABILITY_TABLE_NAME!;
const RATE_LIMIT_TABLE_NAME = process.env.RATE_LIMIT_TABLE_NAME!;
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;

// Configuration
const MAX_RESULTS_LIMIT = parseInt(process.env.MAX_RESULTS_LIMIT || '100');
const AVAILABILITY_BATCH_SIZE = parseInt(process.env.AVAILABILITY_BATCH_SIZE || '40');
const PRICING_BATCH_SIZE = parseInt(process.env.PRICING_BATCH_SIZE || '40');
const RATE_LIMIT_REQUESTS = 60;

// ============================================================================
// TYPES
// ============================================================================

interface SearchFilters {
  petsAllowed?: boolean;
  hasWIFI?: boolean;
  hasAirConditioning?: boolean;
  hasParking?: boolean;
  hasGym?: boolean;
  hasPool?: boolean;
  hasWorkspace?: boolean;
  instantBook?: boolean;
  parkingType?: string;
  checkInType?: string;
  propertyType?: string;
}

interface NightlyPriceBreakdown {
  date: string;
  basePrice: number;
  finalPrice: number;
  isMembersPrice: boolean;
  isSeasonalPrice: boolean;
}

interface ListingPricing {
  currency: string;
  totalPrice: number; // Base price (without tax)
  pricePerNight: number;
  breakdown: NightlyPriceBreakdown[];
  lengthOfStayDiscount: {
    applied: boolean;
    minNights: number;
    discountType: 'PERCENTAGE' | 'ABSOLUTE';
    discountValue: number;
    totalSavings: number;
  } | null;
  membersPricingApplied: boolean;
  
  // When taxesIncludedInPrice = false
  totalPriceWithTax?: number; // Total including tourist tax
  touristTaxAmount?: number;
  touristTaxBreakdown?: {
    adults: {
      count: number;
      perNight: number;
      total: number;
    };
    children: Array<{
      count: number;
      ageFrom: number;
      ageTo: number;
      perNight: number;
      total: number;
      displayLabel: {
        en: string;
        sr: string;
      };
    }>;
  };
  
  // When taxesIncludedInPrice = true
  taxesIncludedInPrice?: boolean;
}

interface SearchResult {
  listingId: string;
  hostId: string;
  name: string;
  shortDescription: {          // Bilingual short description
    en: string;
    sr: string;
  };
  thumbnailUrl: string;
  placeName: string;
  regionName: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  capacity: {
    maxGuests: number;
    bedrooms: number;
    singleBeds: number;
    doubleBeds: number;
    bathrooms: number;
  };
  petsAllowed: boolean;
  hasWIFI: boolean;
  hasAirConditioning: boolean;
  hasParking: boolean;
  hasGym: boolean;
  hasPool: boolean;
  hasWorkspace: boolean;
  parkingType: string;
  checkInType: string;
  propertyType: string;
  instantBook: boolean;
  hostVerified: boolean;
  listingVerified: boolean;
  officialStarRating?: number;
  pricing: ListingPricing;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Search Listings Request:', JSON.stringify(event, null, 2));

  try {
    // ========================================
    // 1. RATE LIMITING
    // ========================================
    const sourceIp = event.requestContext.identity.sourceIp;
    
    // Validate IP format
    if (!sourceIp || !/^[\d.]+$/.test(sourceIp)) {
      return errorResponse(400, 'Invalid request source');
    }

    const isRateLimited = await checkRateLimit(sourceIp);
    if (isRateLimited) {
      return errorResponse(429, 'Too many requests. Please try again later.');
    }

    // ========================================
    // 2. INPUT VALIDATION
    // ========================================
    const validationResult = validateInputs(event);
    if (!validationResult.valid) {
      return errorResponse(400, validationResult.error!);
    }

    const {
      locationIdentifier,
      isSlug,
      checkIn,
      checkOut,
      adults,
      childAges,
      totalGuests,
      daysDiff,
      daysUntilCheckIn,
      filters,
      decodedCursor,
    } = validationResult.data!;

    // ========================================
    // 2b. RESOLVE SLUG TO LOCATION ID (if needed)
    // ========================================
    let locationId: string;
    
    if (isSlug) {
      const resolvedLocationId = await resolveLocationSlug(locationIdentifier);
      if (!resolvedLocationId) {
        return errorResponse(404, `Location not found: ${locationIdentifier}`);
      }
      locationId = resolvedLocationId;
      console.log(`Resolved slug "${locationIdentifier}" to locationId: ${locationId}`);
    } else {
      locationId = locationIdentifier;
    }

    // ========================================
    // 3. CHECK AUTHENTICATION (OPTIONAL)
    // ========================================
    // Since we're not using API Gateway authorizer (to allow optional auth),
    // we check if Authorization header is present
    // For now, we'll use a simple check - in production, you'd validate the JWT
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    const isAuthenticated = !!authHeader && authHeader.startsWith('Bearer ');
    
    // Note: In a production system with optional auth, you would:
    // 1. Parse the JWT from the Authorization header
    // 2. Verify it against Cognito (using jwks-rsa or similar)
    // 3. Extract the user ID from the validated token
    // For now, we'll just use the presence of a valid-looking header as a flag
    
    console.log(`Search request - Location: ${isSlug ? locationIdentifier + ' (slug)' : locationId}, Dates: ${checkIn} to ${checkOut}, Guests: ${totalGuests}, Authenticated: ${isAuthenticated}`);

    // ========================================
    // 4. QUERY PUBLIC LISTINGS
    // ========================================
    const publicListingsResult = await docClient.send(
      new QueryCommand({
        TableName: PUBLIC_LISTINGS_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        FilterExpression: 'maxGuests >= :totalGuests',
        ExpressionAttributeValues: {
          ':pk': `LOCATION#${locationId}`,
          ':totalGuests': totalGuests,
        },
        Limit: MAX_RESULTS_LIMIT,
        ExclusiveStartKey: decodedCursor,
      })
    );

    let candidateListings = (publicListingsResult.Items || []) as PublicListingRecord[];
    console.log(`Found ${candidateListings.length} candidate listings`);

    if (candidateListings.length === 0) {
      return successResponse({
        listings: [],
        pagination: {
          hasMore: false,
          nextCursor: null,
          totalReturned: 0,
        },
        searchMeta: {
          locationId,
          checkIn,
          checkOut,
          nights: daysDiff,
          adults,
          children: childAges.length,
          totalGuests,
        },
      });
    }

    // ========================================
    // 5. APPLY BOOKING TERMS FILTERS (IN LAMBDA)
    // ========================================
    candidateListings = applyBookingTermFilters(candidateListings, daysDiff, daysUntilCheckIn);
    console.log(`After booking terms filtering: ${candidateListings.length} listings`);

    if (candidateListings.length === 0) {
      return successResponse({
        listings: [],
        pagination: {
          hasMore: !!publicListingsResult.LastEvaluatedKey,
          nextCursor: publicListingsResult.LastEvaluatedKey 
            ? encodeCursor(publicListingsResult.LastEvaluatedKey) 
            : null,
          totalReturned: 0,
        },
        searchMeta: {
          locationId,
          checkIn,
          checkOut,
          nights: daysDiff,
          adults,
          children: childAges.length,
          totalGuests,
        },
      });
    }

    // ========================================
    // 6. APPLY OPTIONAL FILTERS (IN LAMBDA)
    // ========================================
    candidateListings = applyFilters(candidateListings, filters);
    console.log(`After amenity filtering: ${candidateListings.length} listings`);

    if (candidateListings.length === 0) {
      return successResponse({
        listings: [],
        pagination: {
          hasMore: !!publicListingsResult.LastEvaluatedKey,
          nextCursor: publicListingsResult.LastEvaluatedKey 
            ? encodeCursor(publicListingsResult.LastEvaluatedKey) 
            : null,
          totalReturned: 0,
        },
        searchMeta: {
          locationId,
          checkIn,
          checkOut,
          nights: daysDiff,
          adults,
          children: childAges.length,
          totalGuests,
        },
      });
    }

    // ========================================
    // 7. CHECK AVAILABILITY (PARALLEL BATCHES)
    // ========================================
    const nightDates = generateNightDates(checkIn, checkOut);
    const lastNight = nightDates[nightDates.length - 1];
    
    const availableListings = await checkAvailabilityBatch(
      candidateListings,
      checkIn,
      lastNight
    );
    console.log(`Available listings: ${availableListings.length}`);

    if (availableListings.length === 0) {
      return successResponse({
        listings: [],
        pagination: {
          hasMore: !!publicListingsResult.LastEvaluatedKey,
          nextCursor: publicListingsResult.LastEvaluatedKey 
            ? encodeCursor(publicListingsResult.LastEvaluatedKey) 
            : null,
          totalReturned: 0,
        },
        searchMeta: {
          locationId,
          checkIn,
          checkOut,
          nights: daysDiff,
          adults,
          children: childAges.length,
          totalGuests,
        },
      });
    }

    // ========================================
    // 8. FETCH PRICING (PARALLEL BATCHES)
    // ========================================
    const pricingMap = await fetchPricingBatch(availableListings);
    console.log(`Fetched pricing for ${pricingMap.size} listings`);

    // ========================================
    // 9. CALCULATE PRICING & BUILD RESULTS
    // ========================================
    const results = availableListings
      .map((listing) => {
        const pricing = pricingMap.get(listing.listingId);
        
        if (!pricing) {
          // Skip listings without pricing
          return null;
        }

        const calculatedPricing = calculateListingPrice(
          pricing,
          nightDates,
          isAuthenticated,
          adults,
          childAges
        );

        const result: SearchResult = {
          listingId: listing.listingId,
          hostId: listing.hostId,
          name: listing.name,
          shortDescription: listing.shortDescription,
          thumbnailUrl: listing.thumbnailUrl,
          placeName: listing.placeName,
          regionName: listing.regionName,
          coordinates: {
            latitude: listing.latitude,
            longitude: listing.longitude,
          },
          capacity: {
            maxGuests: listing.maxGuests,
            bedrooms: listing.bedrooms,
            singleBeds: listing.singleBeds ?? 0,
            doubleBeds: listing.doubleBeds ?? 0,
            bathrooms: listing.bathrooms,
          },
          petsAllowed: listing.petsAllowed,
          hasWIFI: listing.hasWIFI,
          hasAirConditioning: listing.hasAirConditioning,
          hasParking: listing.hasParking,
          hasGym: listing.hasGym,
          hasPool: listing.hasPool,
          hasWorkspace: listing.hasWorkspace,
          parkingType: listing.parkingType,
          checkInType: listing.checkInType,
          propertyType: listing.propertyType,
          instantBook: listing.instantBook,
          hostVerified: listing.hostVerified,
          listingVerified: listing.listingVerified,
          officialStarRating: listing.officialStarRating,
          pricing: calculatedPricing,
        };
        return result;
      })
      .filter((l): l is SearchResult => l !== null);

    console.log(`Final results: ${results.length} listings`);

    // ========================================
    // 10. RETURN RESPONSE
    // ========================================
    return successResponse({
      listings: results,
      pagination: {
        hasMore: !!publicListingsResult.LastEvaluatedKey,
        nextCursor: publicListingsResult.LastEvaluatedKey 
          ? encodeCursor(publicListingsResult.LastEvaluatedKey) 
          : null,
        totalReturned: results.length,
      },
      searchMeta: {
        locationId,
        checkIn,
        checkOut,
        nights: daysDiff,
        adults,
        children: childAges.length,
        totalGuests,
      },
    });

  } catch (error) {
    console.error('Error searching listings:', error);
    return errorResponse(500, 'Internal server error');
  }
}

// ============================================================================
// VALIDATION
// ============================================================================

interface ValidationResult {
  valid: boolean;
  error?: string;
  data?: {
    locationIdentifier: string; // Either slug or locationId
    isSlug: boolean; // True if locationIdentifier is a slug
    checkIn: string;
    checkOut: string;
    adults: number;
    childAges: number[]; // Array of child ages (0-17)
    totalGuests: number;
    daysDiff: number;
    daysUntilCheckIn: number; // Days from today until check-in
    filters: SearchFilters;
    decodedCursor?: any;
  };
}

/**
 * Resolve location slug to locationId using SlugIndex GSI
 * Returns null if slug not found
 */
async function resolveLocationSlug(slug: string): Promise<string | null> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: LOCATIONS_TABLE_NAME,
        IndexName: 'SlugIndex',
        KeyConditionExpression: 'slug = :slug',
        ExpressionAttributeValues: {
          ':slug': slug.toLowerCase(),
        },
        Limit: 1,
      })
    );

    if (result.Items && result.Items.length > 0) {
      return result.Items[0].locationId;
    }

    return null;
  } catch (error) {
    console.error(`Error resolving slug "${slug}":`, error);
    return null;
  }
}

function validateInputs(event: APIGatewayProxyEvent): ValidationResult {
  // 1. location validation (slug or locationId for backward compatibility)
  const locationSlug = event.queryStringParameters?.location?.trim();
  const locationId = event.queryStringParameters?.locationId?.trim();
  
  if (!locationSlug && !locationId) {
    return { valid: false, error: 'location or locationId is required' };
  }
  
  // Validate slug format if provided (e.g., "zlatibor-serbia")
  if (locationSlug && !/^[a-z0-9-]{3,100}$/.test(locationSlug)) {
    return { valid: false, error: 'Invalid location slug format' };
  }
  
  // Validate locationId format if provided (backward compatibility)
  if (locationId && !/^[A-Za-z0-9_-]{10,50}$/.test(locationId)) {
    return { valid: false, error: 'Invalid locationId format' };
  }

  // 2. checkIn validation
  const checkIn = event.queryStringParameters?.checkIn?.trim();
  if (!checkIn) {
    return { valid: false, error: 'checkIn is required' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn)) {
    return { valid: false, error: 'checkIn must be in YYYY-MM-DD format' };
  }
  const checkInDate = new Date(checkIn);
  if (isNaN(checkInDate.getTime())) {
    return { valid: false, error: 'Invalid checkIn date' };
  }
  const todayForCheckIn = new Date();
  todayForCheckIn.setHours(0, 0, 0, 0);
  if (checkInDate < todayForCheckIn) {
    return { valid: false, error: 'checkIn cannot be in the past' };
  }

  // 3. checkOut validation
  const checkOut = event.queryStringParameters?.checkOut?.trim();
  if (!checkOut) {
    return { valid: false, error: 'checkOut is required' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
    return { valid: false, error: 'checkOut must be in YYYY-MM-DD format' };
  }
  const checkOutDate = new Date(checkOut);
  if (isNaN(checkOutDate.getTime())) {
    return { valid: false, error: 'Invalid checkOut date' };
  }
  if (checkOutDate <= checkInDate) {
    return { valid: false, error: 'checkOut must be after checkIn' };
  }
  const daysDiff = Math.floor(
    (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysDiff > 365) {
    return { valid: false, error: 'Date range cannot exceed 365 days' };
  }
  if (daysDiff < 1) {
    return { valid: false, error: 'Minimum stay is 1 night' };
  }

  // 4. adults validation
  const adultsStr = event.queryStringParameters?.adults?.trim();
  if (!adultsStr) {
    return { valid: false, error: 'adults is required' };
  }
  const adults = parseInt(adultsStr, 10);
  if (isNaN(adults) || adults < 1 || adults > 50) {
    return { valid: false, error: 'adults must be between 1 and 50' };
  }

  // 5. childAges validation (optional, comma-separated list of ages)
  const childAges: number[] = [];
  if (event.queryStringParameters?.childAges) {
    const childAgesStr = event.queryStringParameters.childAges.trim();
    
    if (childAgesStr.length > 0) {
      const agesArray = childAgesStr.split(',');
      
      if (agesArray.length > 50) {
        return { valid: false, error: 'Maximum 50 children allowed' };
      }
      
      for (const ageStr of agesArray) {
        const age = parseInt(ageStr.trim(), 10);
        if (isNaN(age) || age < 0 || age > 17) {
          return { valid: false, error: 'Each child age must be between 0 and 17' };
        }
        childAges.push(age);
      }
    }
  }

  // 6. Total guests validation
  const totalGuests = adults + childAges.length;
  if (totalGuests > 50) {
    return { valid: false, error: 'Total guests cannot exceed 50' };
  }

  // 7. Calculate days until check-in (for advance booking filter)
  const todayForAdvance = new Date();
  todayForAdvance.setHours(0, 0, 0, 0);
  const daysUntilCheckIn = Math.floor(
    (checkInDate.getTime() - todayForAdvance.getTime()) / (1000 * 60 * 60 * 24)
  );

  // 8. cursor validation (optional)
  let decodedCursor = undefined;
  if (event.queryStringParameters?.cursor) {
    try {
      const cursorStr = event.queryStringParameters.cursor.trim();
      if (!/^[A-Za-z0-9+/]+=*$/.test(cursorStr)) {
        return { valid: false, error: 'Invalid cursor format' };
      }
      if (cursorStr.length > 2000) {
        return { valid: false, error: 'Cursor too large' };
      }
      const decoded = Buffer.from(cursorStr, 'base64').toString('utf-8');
      decodedCursor = JSON.parse(decoded);
    } catch (error) {
      return { valid: false, error: 'Invalid cursor' };
    }
  }

  // 9. Boolean filter validation
  const filters: SearchFilters = {};
  const booleanFilters = [
    'petsAllowed',
    'hasWIFI',
    'hasAirConditioning',
    'hasParking',
    'hasGym',
    'hasPool',
    'hasWorkspace',
    'instantBook',
  ];
  
  for (const filterName of booleanFilters) {
    if (event.queryStringParameters?.[filterName]) {
      const value = event.queryStringParameters[filterName].toLowerCase();
      if (value !== 'true' && value !== 'false') {
        return { valid: false, error: `${filterName} must be 'true' or 'false'` };
      }
      (filters as any)[filterName] = value === 'true';
    }
  }

  // 10. Categorical filter validation
  const parkingType = event.queryStringParameters?.parkingType?.trim().toUpperCase();
  if (parkingType) {
    const validParkingTypes = ['NO_PARKING', 'FREE', 'PAID'];
    if (!validParkingTypes.includes(parkingType)) {
      return { valid: false, error: 'Invalid parkingType' };
    }
    filters.parkingType = parkingType as any;
  }

  const checkInType = event.queryStringParameters?.checkInType?.trim().toUpperCase();
  if (checkInType) {
    const validCheckInTypes = ['SELF_CHECKIN', 'HOST_GREETING', 'LOCKBOX', 'DOORMAN'];
    if (!validCheckInTypes.includes(checkInType)) {
      return { valid: false, error: 'Invalid checkInType' };
    }
    filters.checkInType = checkInType;
  }

  const propertyType = event.queryStringParameters?.propertyType?.trim().toUpperCase();
  if (propertyType) {
    const validPropertyTypes = ['APARTMENT', 'HOUSE', 'VILLA', 'STUDIO', 'ROOM'];
    if (!validPropertyTypes.includes(propertyType)) {
      return { valid: false, error: 'Invalid propertyType' };
    }
    filters.propertyType = propertyType;
  }

  return {
    valid: true,
    data: {
      locationIdentifier: locationSlug || locationId!, // Either slug or locationId
      isSlug: !!locationSlug, // Flag to indicate if we need to resolve slug
      checkIn,
      checkOut,
      adults,
      childAges,
      totalGuests,
      daysDiff,
      daysUntilCheckIn,
      filters,
      decodedCursor,
    },
  };
}

// ============================================================================
// FILTERING
// ============================================================================

/**
 * Apply booking terms filters (cheapest filters first)
 * Filters based on:
 * - minBookingNights: Listing's minimum stay requirement
 * - maxBookingNights: Listing's maximum stay allowance
 * - advanceBookingDays: How far in advance the listing can be booked
 */
function applyBookingTermFilters(
  listings: PublicListingRecord[],
  requestedNights: number,
  daysUntilCheckIn: number
): PublicListingRecord[] {
  return listings.filter((listing) => {
    // 1. Check minimum nights requirement
    if (listing.minBookingNights > requestedNights) {
      return false;
    }

    // 2. Check maximum nights allowance
    if (listing.maxBookingNights < requestedNights) {
      return false;
    }

    // 3. Check advance booking requirement
    if (listing.advanceBookingDays < daysUntilCheckIn) {
      return false;
    }

    return true;
  });
}

function applyFilters(
  listings: PublicListingRecord[],
  filters: SearchFilters
): PublicListingRecord[] {
  let filtered = listings;

  // Boolean filters
  if (filters.petsAllowed !== undefined) {
    filtered = filtered.filter((l) => l.petsAllowed === filters.petsAllowed);
  }
  if (filters.hasWIFI !== undefined) {
    filtered = filtered.filter((l) => l.hasWIFI === filters.hasWIFI);
  }
  if (filters.hasAirConditioning !== undefined) {
    filtered = filtered.filter((l) => l.hasAirConditioning === filters.hasAirConditioning);
  }
  if (filters.hasParking !== undefined) {
    filtered = filtered.filter((l) => l.hasParking === filters.hasParking);
  }
  if (filters.hasGym !== undefined) {
    filtered = filtered.filter((l) => l.hasGym === filters.hasGym);
  }
  if (filters.hasPool !== undefined) {
    filtered = filtered.filter((l) => l.hasPool === filters.hasPool);
  }
  if (filters.hasWorkspace !== undefined) {
    filtered = filtered.filter((l) => l.hasWorkspace === filters.hasWorkspace);
  }
  if (filters.instantBook !== undefined) {
    filtered = filtered.filter((l) => l.instantBook === filters.instantBook);
  }

  // Categorical filters
  if (filters.parkingType) {
    filtered = filtered.filter((l) => l.parkingType === filters.parkingType);
  }
  if (filters.checkInType) {
    filtered = filtered.filter((l) => l.checkInType === filters.checkInType);
  }
  if (filters.propertyType) {
    filtered = filtered.filter((l) => l.propertyType === filters.propertyType);
  }

  return filtered;
}

// ============================================================================
// AVAILABILITY CHECKING
// ============================================================================

async function checkAvailabilityBatch(
  listings: PublicListingRecord[],
  checkIn: string,
  lastNight: string
): Promise<PublicListingRecord[]> {
  const availableListings: PublicListingRecord[] = [];

  // Process in batches
  for (let i = 0; i < listings.length; i += AVAILABILITY_BATCH_SIZE) {
    const batch = listings.slice(i, i + AVAILABILITY_BATCH_SIZE);

    const availabilityChecks = batch.map(async (listing) => {
      try {
        const result = await docClient.send(
          new QueryCommand({
            TableName: AVAILABILITY_TABLE_NAME,
            KeyConditionExpression: 'pk = :pk AND sk BETWEEN :startSk AND :endSk',
            ExpressionAttributeValues: {
              ':pk': `LISTING_AVAILABILITY#${listing.listingId}`,
              ':startSk': `DATE#${checkIn}`,
              ':endSk': `DATE#${lastNight}`,
            },
            Limit: 1, // We only need to know if ANY record exists
          })
        );

        // If no records found, listing is available
        return result.Items?.length === 0 ? listing : null;
      } catch (error) {
        console.error(`Error checking availability for ${listing.listingId}:`, error);
        return null;
      }
    });

    const batchResults = await Promise.all(availabilityChecks);
    availableListings.push(...batchResults.filter((l): l is PublicListingRecord => l !== null));
  }

  return availableListings;
}

// ============================================================================
// PRICING FETCHING
// ============================================================================

async function fetchPricingBatch(
  listings: PublicListingRecord[]
): Promise<Map<string, PricingMatrixRecord>> {
  const pricingMap = new Map<string, PricingMatrixRecord>();

  // Process in batches
  for (let i = 0; i < listings.length; i += PRICING_BATCH_SIZE) {
    const batch = listings.slice(i, i + PRICING_BATCH_SIZE);

    const pricingFetches = batch.map(async (listing) => {
      try {
        const result = await docClient.send(
          new QueryCommand({
            TableName: MAIN_TABLE_NAME,
            IndexName: 'DocumentStatusIndex', // GSI3
            KeyConditionExpression: 'gsi3pk = :pk AND gsi3sk = :sk',
            ExpressionAttributeValues: {
              ':pk': `LISTING#${listing.listingId}`,
              ':sk': 'PRICING_MATRIX',
            },
            Limit: 1,
          })
        );

        if (result.Items?.[0]) {
          return {
            listingId: listing.listingId,
            pricing: result.Items[0] as PricingMatrixRecord,
          };
        }
        return null;
      } catch (error) {
        console.error(`Error fetching pricing for ${listing.listingId}:`, error);
        return null;
      }
    });

    const batchResults = await Promise.all(pricingFetches);
    batchResults.forEach((result) => {
      if (result) {
        pricingMap.set(result.listingId, result.pricing);
      }
    });
  }

  return pricingMap;
}

// ============================================================================
// TOURIST TAX CALCULATION
// ============================================================================

interface TouristTaxCalculation {
  touristTaxAmount: number;
  touristTaxBreakdown: {
    adults: {
      count: number;
      perNight: number;
      total: number;
    };
    children: Array<{
      count: number;
      ageFrom: number;
      ageTo: number;
      perNight: number;
      total: number;
      displayLabel: {
        en: string;
        sr: string;
      };
    }>;
  };
}

/**
 * Calculate tourist tax based on guest ages and pricing configuration
 * Tourist tax is always calculated per night for each guest
 */
function calculateTouristTax(
  touristTax: {
    adultAmount: number;
    childRates: Array<{
      childRateId: string;
      ageFrom: number;
      ageTo: number;
      amount: number;
      displayLabel: {
        en: string;
        sr: string;
      };
    }>;
  } | null,
  adults: number,
  childAges: number[],
  nights: number
): TouristTaxCalculation {
  // If no tourist tax configured, return zeros
  if (!touristTax) {
    return {
      touristTaxAmount: 0,
      touristTaxBreakdown: {
        adults: {
          count: adults,
          perNight: 0,
          total: 0,
        },
        children: [],
      },
    };
  }

  // Calculate adult tourist tax
  const adultTax = adults * touristTax.adultAmount * nights;

  // Group children by tax rate
  const childTaxGroups = new Map<
    string,
    {
      rate: typeof touristTax.childRates[0];
      count: number;
    }
  >();

  // Match each child age to the appropriate rate
  for (const childAge of childAges) {
    // Find the rate that covers this child's age
    const matchingRate = touristTax.childRates.find(
      (rate) => childAge >= rate.ageFrom && childAge <= rate.ageTo
    );

    if (matchingRate) {
      const existing = childTaxGroups.get(matchingRate.childRateId);
      if (existing) {
        existing.count++;
      } else {
        childTaxGroups.set(matchingRate.childRateId, {
          rate: matchingRate,
          count: 1,
        });
      }
    }
  }

  // Calculate child tax breakdown
  const childBreakdown = Array.from(childTaxGroups.values()).map((group) => {
    const perNight = group.rate.amount;
    const total = group.count * perNight * nights;

    return {
      count: group.count,
      ageFrom: group.rate.ageFrom,
      ageTo: group.rate.ageTo,
      perNight,
      total: Math.round(total * 100) / 100,
      displayLabel: group.rate.displayLabel,
    };
  });

  const totalChildTax = childBreakdown.reduce((sum, item) => sum + item.total, 0);
  const totalTax = adultTax + totalChildTax;

  return {
    touristTaxAmount: Math.round(totalTax * 100) / 100,
    touristTaxBreakdown: {
      adults: {
        count: adults,
        perNight: touristTax.adultAmount,
        total: Math.round(adultTax * 100) / 100,
      },
      children: childBreakdown,
    },
  };
}

// ============================================================================
// PRICING CALCULATION
// ============================================================================

function calculateListingPrice(
  pricingMatrix: PricingMatrixRecord,
  nightDates: string[],
  isAuthenticated: boolean,
  adults: number,
  childAges: number[]
): ListingPricing {
  const { matrix, currency, touristTax, taxesIncludedInPrice } = pricingMatrix;
  const nights = nightDates.length;

  // Step 1: Determine base price for each night
  const nightlyBreakdown = nightDates.map((date) => {
    const basePrice = findApplicableBasePrice(matrix.basePrices, date);
    const useMembersPrice = isAuthenticated && basePrice.membersDiscount !== null;
    const pricePerNight = useMembersPrice
      ? basePrice.membersDiscount!.calculatedPrice
      : basePrice.standardPrice;

    return {
      date,
      basePrice: pricePerNight,
      isMembersPrice: useMembersPrice,
      isSeasonalPrice: !basePrice.isDefault,
    };
  });

  // Step 2: Apply length-of-stay discount (if applicable)
  const losDiscount = findApplicableLengthOfStayDiscount(matrix.basePrices, nights);

  let totalPrice = 0;
  let totalSavings = 0;

  const finalBreakdown: NightlyPriceBreakdown[] = nightlyBreakdown.map((night) => {
    let finalPrice = night.basePrice;

    if (losDiscount) {
      if (losDiscount.discountType === 'PERCENTAGE') {
        const discount = (night.basePrice * losDiscount.discountValue) / 100;
        finalPrice = night.basePrice - discount;
        totalSavings += discount;
      } else {
        // ABSOLUTE
        finalPrice = night.basePrice - losDiscount.discountValue;
        totalSavings += losDiscount.discountValue;
      }
    }

    totalPrice += finalPrice;

    return {
      date: night.date,
      basePrice: night.basePrice,
      finalPrice,
      isMembersPrice: night.isMembersPrice,
      isSeasonalPrice: night.isSeasonalPrice,
    };
  });

  // Build base response
  const baseResponse: ListingPricing = {
    currency,
    totalPrice: Math.round(totalPrice * 100) / 100,
    pricePerNight: Math.round((totalPrice / nights) * 100) / 100,
    breakdown: finalBreakdown,
    lengthOfStayDiscount: losDiscount
      ? {
          applied: true,
          minNights: losDiscount.minNights,
          discountType: losDiscount.discountType,
          discountValue: losDiscount.discountValue,
          totalSavings: Math.round(totalSavings * 100) / 100,
        }
      : null,
    membersPricingApplied: isAuthenticated && nightlyBreakdown.some((n) => n.isMembersPrice),
  };

  // Step 3: Calculate tourist tax ONLY if NOT included in price
  if (taxesIncludedInPrice === true) {
    // Taxes included - return flag so frontend knows
    return {
      ...baseResponse,
      taxesIncludedInPrice: true,
    };
  }

  // Taxes NOT included - calculate and return both prices
  const taxCalculation = calculateTouristTax(
    touristTax ?? null,
    adults,
    childAges,
    nights
  );

  const totalWithTax = totalPrice + taxCalculation.touristTaxAmount;

  return {
    ...baseResponse,
    totalPriceWithTax: Math.round(totalWithTax * 100) / 100,
    touristTaxAmount: taxCalculation.touristTaxAmount,
    touristTaxBreakdown: taxCalculation.touristTaxBreakdown,
  };
}

function findApplicableBasePrice(
  basePrices: BasePriceWithDiscounts[],
  date: string
): BasePriceWithDiscounts {
  // Check seasonal prices first
  for (const basePrice of basePrices) {
    if (!basePrice.isDefault && basePrice.dateRange) {
      const { startDate, endDate } = basePrice.dateRange;
      if (date >= startDate && date <= endDate) {
        return basePrice;
      }
    }
  }

  // Fall back to default
  const defaultPrice = basePrices.find((bp) => bp.isDefault);
  if (!defaultPrice) {
    throw new Error('No default base price found');
  }
  return defaultPrice;
}

function findApplicableLengthOfStayDiscount(
  basePrices: BasePriceWithDiscounts[],
  nights: number
): { minNights: number; discountType: 'PERCENTAGE' | 'ABSOLUTE'; discountValue: number } | null {
  // Collect all LoS discounts from all base prices
  const allLosDiscounts: LengthOfStayPricing[] = [];
  basePrices.forEach((bp) => {
    allLosDiscounts.push(...bp.lengthOfStayPricing);
  });

  // Find the highest minNights threshold that the booking qualifies for
  const applicableDiscounts = allLosDiscounts
    .filter((los) => nights >= los.minNights)
    .sort((a, b) => b.minNights - a.minNights); // Highest threshold first

  if (applicableDiscounts.length === 0) {
    return null;
  }

  const bestDiscount = applicableDiscounts[0];
  return {
    minNights: bestDiscount.minNights,
    discountType: bestDiscount.discountType,
    discountValue: bestDiscount.discountValue,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateNightDates(checkIn: string, checkOut: string): string[] {
  const dates: string[] = [];
  const current = new Date(checkIn);
  const end = new Date(checkOut);

  while (current < end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function encodeCursor(lastEvaluatedKey: any): string {
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64');
}

function successResponse(data: any): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // Will be overridden by API Gateway CORS
    },
    body: JSON.stringify(data),
  };
}

function errorResponse(statusCode: number, message: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      error: message,
      code: statusCode === 400 ? 'VALIDATION_ERROR' : statusCode === 429 ? 'RATE_LIMIT_EXCEEDED' : 'INTERNAL_ERROR',
    }),
  };
}

/**
 * Check if request exceeds rate limit
 * Uses DynamoDB for distributed rate limiting
 * 
 * Strategy: Store one record per minute window with count
 * id = "listing-search:{sourceIp}:{minuteTimestamp}"
 */
async function checkRateLimit(sourceIp: string): Promise<boolean> {
  try {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000) * 60000; // Round down to minute
    const recordId = `listing-search:${sourceIp}:${currentMinute}`;

    // Check current count
    const result = await docClient.send(
      new GetCommand({
        TableName: RATE_LIMIT_TABLE_NAME,
        Key: { id: recordId },
      })
    );

    const currentCount = result.Item?.count || 0;

    console.log(`Rate limit check for ${sourceIp}: ${currentCount}/${RATE_LIMIT_REQUESTS} requests this minute`);

    if (currentCount >= RATE_LIMIT_REQUESTS) {
      return true; // Rate limited
    }

    // Increment counter (or create if doesn't exist)
    await docClient.send(
      new UpdateCommand({
        TableName: RATE_LIMIT_TABLE_NAME,
        Key: { id: recordId },
        UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :inc, #ttl = :ttl',
        ExpressionAttributeNames: {
          '#count': 'count',
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
          ':zero': 0,
          ':inc': 1,
          ':ttl': Math.floor((currentMinute + 120000) / 1000), // TTL 2 minutes after window
        },
      })
    );

    return false; // Not rate limited
  } catch (error) {
    console.error('Error checking rate limit:', error);
    // On error, allow the request (fail open)
    return false;
  }
}

