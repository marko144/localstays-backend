/**
 * PUT /api/v1/hosts/{hostId}/listings/{listingId}/pricing
 * 
 * Set/update pricing configuration for a listing
 * 
 * Full replacement strategy: Deletes all existing pricing records and creates new ones
 * 
 * Authorization: Host must own the listing
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchWriteCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { v4 as uuidv4 } from 'uuid';
import type {
  SetPricingRequest,
  SetPricingResponse,
  BasePriceRecord,
  LengthOfStayRecord,
  PricingMatrix,
  MembersDiscount,
} from '../../types/pricing.types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const TABLE_NAME = process.env.TABLE_NAME!;

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Set pricing:', {
    requestId: event.requestContext.requestId,
    hostId: event.pathParameters?.hostId,
    listingId: event.pathParameters?.listingId,
  });

  try {
    // 1. Authentication & Authorization
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;
    const listingId = event.pathParameters?.listingId;

    if (!hostId || !listingId) {
      return response.badRequest('hostId and listingId are required');
    }

    assertCanAccessHost(auth, hostId);

    // 2. Parse request body
    const body: SetPricingRequest = JSON.parse(event.body || '{}');

    // 3. Verify listing exists and belongs to host
    const listing = await getListingMetadata(hostId, listingId);
    if (!listing) {
      return response.notFound('Listing not found');
    }
    if (listing.hostId !== hostId) {
      return response.forbidden('You do not own this listing');
    }

    // 4. Validate pricing configuration (includes currency validation)
    const validationError = validatePricingConfiguration(body);
    if (validationError) {
      return response.badRequest(validationError);
    }

    // 5. Delete all existing pricing records
    await deleteAllPricingRecords(hostId, listingId);

    // 6. Create base price records
    const basePriceRecords = await createBasePriceRecords(hostId, listingId, body.basePrices);

    // 7. Create length-of-stay records
    const losRecords = await createLengthOfStayRecords(
      hostId,
      listingId,
      body.lengthOfStayDiscounts || []
    );

    // 8. Calculate pricing matrix
    const matrix = calculatePricingMatrix(basePriceRecords, losRecords);

    // 9. Store pricing matrix (including tourist tax and currency from request)
    await storePricingMatrix(hostId, listingId, matrix, body.currency, body.touristTax);

    // 10. Update listing metadata to set hasPricing flag
    await updateListingPricingFlag(hostId, listingId);

    // 11. Build response configuration
    const defaultBasePrice = basePriceRecords.find((bp) => bp.isDefault)!;
    const seasonalPrices = basePriceRecords
      .filter((bp) => !bp.isDefault)
      .map((bp) => ({
        basePriceId: bp.basePriceId,
        dateRange: {
          startDate: bp.dateRange!.displayStart,
          endDate: bp.dateRange!.displayEnd,
        },
        standardPrice: bp.standardPrice,
        membersDiscount: bp.membersDiscount
          ? {
              type: bp.membersDiscount.type,
              percentage: bp.membersDiscount.percentage,
              absolutePrice: bp.membersDiscount.absolutePrice,
            }
          : null,
      }));

    const configuration = {
      basePrice: {
        standardPrice: defaultBasePrice.standardPrice,
        membersDiscount: defaultBasePrice.membersDiscount
          ? {
              type: defaultBasePrice.membersDiscount.type,
              percentage: defaultBasePrice.membersDiscount.percentage,
              absolutePrice: defaultBasePrice.membersDiscount.absolutePrice,
            }
          : null,
      },
      seasonalPrices,
      lengthOfStayDiscounts: losRecords.map((los) => ({
        lengthOfStayId: los.lengthOfStayId,
        minNights: los.minNights,
        discountType: los.discountType,
        discountPercentage: los.discountPercentage,
        discountAbsolute: los.discountAbsolute,
      })),
      touristTax: body.touristTax || undefined,
    };

    // 12. Return complete configuration + matrix
    const pricingResponse: SetPricingResponse = {
      listingId,
      currency: body.currency,
      configuration,
      matrix,
      lastUpdatedAt: new Date().toISOString(),
    };

    console.log('Pricing saved successfully:', {
      listingId,
      basePricesCount: basePriceRecords.length,
      losDiscountsCount: losRecords.length,
    });

    return response.success(pricingResponse);

  } catch (err: any) {
    console.error('Failed to set pricing:', err);
    return response.internalError('Failed to set pricing', err);
  }
}

// ============================================================================
// VALIDATION
// ============================================================================

function validatePricingConfiguration(body: SetPricingRequest): string | null {
  // 1. Currency is required
  if (!body.currency) {
    return 'Currency is required';
  }

  // 2. Validate currency format (3-letter ISO code)
  if (!/^[A-Z]{3}$/.test(body.currency)) {
    return 'Currency must be a valid 3-letter ISO code (e.g., EUR, USD, GBP)';
  }

  // 3. Base price is required
  if (!body.basePrices?.default) {
    return 'Base price is required';
  }

  const defaultPrice = body.basePrices.default;

  // 4. Validate default base price
  if (typeof defaultPrice.standardPrice !== 'number' || defaultPrice.standardPrice <= 0) {
    return 'Base price must be a positive number';
  }

  // 5. Validate members discount (if present)
  if (defaultPrice.membersDiscount) {
    const membersError = validateMembersDiscount(
      defaultPrice.standardPrice,
      defaultPrice.membersDiscount
    );
    if (membersError) return membersError;
  }

  // 6. Validate seasonal prices (if present)
  if (body.basePrices.seasonal && body.basePrices.seasonal.length > 0) {
    const seasonalError = validateSeasonalPrices(body.basePrices.seasonal);
    if (seasonalError) return seasonalError;
  }

  // 7. Validate length-of-stay discounts (if present)
  if (body.lengthOfStayDiscounts && body.lengthOfStayDiscounts.length > 0) {
    const losError = validateLengthOfStayDiscounts(
      body.lengthOfStayDiscounts,
      defaultPrice.standardPrice
    );
    if (losError) return losError;
  }

  // 8. Validate tourist tax (if present)
  if (body.touristTax) {
    const touristTaxError = validateTouristTax(body.touristTax);
    if (touristTaxError) return touristTaxError;
  }

  return null;
}

function validateMembersDiscount(standardPrice: number, discount: any): string | null {
  if (discount.type === 'PERCENTAGE') {
    if (
      typeof discount.percentage !== 'number' ||
      discount.percentage < 0 ||
      discount.percentage > 100
    ) {
      return 'Members discount percentage must be between 0 and 100';
    }
  } else if (discount.type === 'ABSOLUTE') {
    if (
      typeof discount.absolutePrice !== 'number' ||
      discount.absolutePrice <= 0 ||
      discount.absolutePrice >= standardPrice
    ) {
      return 'Members absolute price must be positive and less than standard price';
    }
  } else {
    return 'Invalid members discount type';
  }
  return null;
}

function validateSeasonalPrices(seasonalPrices: any[]): string | null {
  const dateRanges: Array<{ start: Date; end: Date }> = [];

  for (const seasonal of seasonalPrices) {
    // Validate date range exists
    if (!seasonal.dateRange?.startDate || !seasonal.dateRange?.endDate) {
      return 'Seasonal price must have a date range';
    }

    // Parse European dates (DD-MM-YYYY)
    const startDate = parseEuropeanDate(seasonal.dateRange.startDate);
    const endDate = parseEuropeanDate(seasonal.dateRange.endDate);

    if (!startDate || !endDate) {
      return 'Invalid date format. Use DD-MM-YYYY';
    }

    // Check end date is after start date
    if (endDate <= startDate) {
      return 'End date must be after start date';
    }

    // Check for overlaps
    for (const existing of dateRanges) {
      if (
        (startDate >= existing.start && startDate <= existing.end) ||
        (endDate >= existing.start && endDate <= existing.end) ||
        (startDate <= existing.start && endDate >= existing.end)
      ) {
        return 'Seasonal date ranges cannot overlap';
      }
    }

    dateRanges.push({ start: startDate, end: endDate });

    // Validate standard price
    if (typeof seasonal.standardPrice !== 'number' || seasonal.standardPrice <= 0) {
      return 'Seasonal standard price must be a positive number';
    }

    // Validate members discount (if present)
    if (seasonal.membersDiscount) {
      const membersError = validateMembersDiscount(
        seasonal.standardPrice,
        seasonal.membersDiscount
      );
      if (membersError) return membersError;
    }
  }

  return null;
}

function validateLengthOfStayDiscounts(discounts: any[], basePrice: number): string | null {
  const minNights = new Set<number>();

  for (const discount of discounts) {
    // Validate minNights
    if (typeof discount.minNights !== 'number' || discount.minNights <= 0) {
      return 'Minimum nights must be a positive number';
    }

    // Check for duplicates
    if (minNights.has(discount.minNights)) {
      return `Duplicate length-of-stay discount for ${discount.minNights} nights`;
    }
    minNights.add(discount.minNights);

    // Validate discount type
    if (discount.discountType === 'PERCENTAGE') {
      if (
        typeof discount.discountPercentage !== 'number' ||
        discount.discountPercentage < 0 ||
        discount.discountPercentage > 100
      ) {
        return 'Length-of-stay discount percentage must be between 0 and 100';
      }
    } else if (discount.discountType === 'ABSOLUTE') {
      if (
        typeof discount.discountAbsolute !== 'number' ||
        discount.discountAbsolute <= 0 ||
        discount.discountAbsolute >= basePrice
      ) {
        return 'Length-of-stay absolute discount must be positive and less than base price';
      }
    } else {
      return 'Invalid length-of-stay discount type';
    }
  }

  return null;
}

function validateTouristTax(touristTax: any): string | null {
  // Validate type
  if (touristTax.type !== 'PER_NIGHT' && touristTax.type !== 'PER_STAY') {
    return 'Tourist tax type must be PER_NIGHT or PER_STAY';
  }

  // Validate adult amount
  if (
    typeof touristTax.adultAmount !== 'number' ||
    touristTax.adultAmount < 0
  ) {
    return 'Tourist tax adult amount must be a non-negative number';
  }

  // Validate child rates (required)
  if (!touristTax.childRates || !Array.isArray(touristTax.childRates)) {
    return 'Tourist tax must include childRates array';
  }

  if (touristTax.childRates.length === 0) {
    return 'At least one child tax rate is required';
  }

  if (touristTax.childRates.length > 10) {
    return 'Maximum 10 child tax rates allowed';
  }

  // Validate each child rate
  const childRatesError = validateChildTouristTaxRates(touristTax.childRates);
  if (childRatesError) return childRatesError;

  return null;
}

function validateChildTouristTaxRates(childRates: any[]): string | null {
  const ageRanges: Array<{ from: number; to: number }> = [];

  for (let i = 0; i < childRates.length; i++) {
    const rate = childRates[i];

    // Validate ageFrom
    if (
      typeof rate.ageFrom !== 'number' ||
      rate.ageFrom < 0 ||
      rate.ageFrom > 16
    ) {
      return `Child rate ${i + 1}: ageFrom must be between 0 and 16`;
    }

    // Validate ageTo
    if (
      typeof rate.ageTo !== 'number' ||
      rate.ageTo < 1 ||
      rate.ageTo > 17
    ) {
      return `Child rate ${i + 1}: ageTo must be between 1 and 17`;
    }

    // Validate ageTo > ageFrom
    if (rate.ageTo <= rate.ageFrom) {
      return `Child rate ${i + 1}: ageTo must be greater than ageFrom`;
    }

    // Validate amount
    if (typeof rate.amount !== 'number' || rate.amount < 0) {
      return `Child rate ${i + 1}: amount must be a non-negative number`;
    }

    // Validate display labels
    if (!rate.displayLabel || typeof rate.displayLabel !== 'object') {
      return `Child rate ${i + 1}: displayLabel is required`;
    }

    if (
      typeof rate.displayLabel.en !== 'string' ||
      rate.displayLabel.en.trim() === ''
    ) {
      return `Child rate ${i + 1}: displayLabel.en is required`;
    }

    if (
      typeof rate.displayLabel.sr !== 'string' ||
      rate.displayLabel.sr.trim() === ''
    ) {
      return `Child rate ${i + 1}: displayLabel.sr is required`;
    }

    // Check for overlapping age ranges
    for (const existingRange of ageRanges) {
      // Check if ranges overlap (inclusive)
      // Range 1: [ageFrom, ageTo] (inclusive on both ends)
      // Range 2: [existingRange.from, existingRange.to] (inclusive on both ends)
      // Overlap exists if: ageFrom <= existingRange.to AND ageTo >= existingRange.from
      if (rate.ageFrom <= existingRange.to && rate.ageTo >= existingRange.from) {
        return `Child rate ${i + 1}: age range ${rate.ageFrom}-${rate.ageTo} overlaps with existing range ${existingRange.from}-${existingRange.to}`;
      }
    }

    ageRanges.push({ from: rate.ageFrom, to: rate.ageTo });
  }

  return null;
}

function parseEuropeanDate(dateStr: string): Date | null {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // JS months are 0-indexed
  const year = parseInt(parts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

  const date = new Date(year, month, day);
  return date;
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function getListingMetadata(hostId: string, listingId: string): Promise<any> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: {
        ':pk': `HOST#${hostId}`,
        ':sk': `LISTING_META#${listingId}`,
      },
      Limit: 1,
    })
  );

  return result.Items?.[0] || null;
}

async function deleteAllPricingRecords(hostId: string, listingId: string): Promise<void> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':pk': `HOST#${hostId}`,
        ':sk': `LISTING_PRICING#${listingId}#`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    console.log('No existing pricing records to delete');
    return;
  }

  const deleteRequests = result.Items.map((item) => ({
    DeleteRequest: {
      Key: {
        pk: item.pk,
        sk: item.sk,
      },
    },
  }));

  // Batch delete (25 items per request)
  for (let i = 0; i < deleteRequests.length; i += 25) {
    const chunk = deleteRequests.slice(i, i + 25);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: chunk,
        },
      })
    );
  }

  console.log(`Deleted ${deleteRequests.length} existing pricing records`);
}

async function createBasePriceRecords(
  hostId: string,
  listingId: string,
  basePrices: any
): Promise<BasePriceRecord[]> {
  const now = new Date().toISOString();
  const records: BasePriceRecord[] = [];

  // 1. Create default base price
  const defaultRecord: BasePriceRecord = {
    pk: `HOST#${hostId}`,
    sk: `LISTING_PRICING#${listingId}#BASE#default`,
    listingId,
    basePriceId: 'default',
    isDefault: true,
    dateRange: null,
    standardPrice: basePrices.default.standardPrice,
    membersDiscount: calculateMembersDiscount(
      basePrices.default.standardPrice,
      basePrices.default.membersDiscount
    ),
    createdAt: now,
    updatedAt: now,
    gsi3pk: `LISTING#${listingId}`,
    gsi3sk: 'BASE_PRICE#default',
  };
  records.push(defaultRecord);

  // 2. Create seasonal base prices
  for (const seasonal of basePrices.seasonal || []) {
    const seasonalId = `season_${uuidv4()}`;
    const startDate = parseEuropeanDate(seasonal.dateRange.startDate);
    const endDate = parseEuropeanDate(seasonal.dateRange.endDate);

    const seasonalRecord: BasePriceRecord = {
      pk: `HOST#${hostId}`,
      sk: `LISTING_PRICING#${listingId}#BASE#${seasonalId}`,
      listingId,
      basePriceId: seasonalId,
      isDefault: false,
      dateRange: {
        startDate: startDate!.toISOString().split('T')[0], // "2025-06-01"
        endDate: endDate!.toISOString().split('T')[0],
        displayStart: seasonal.dateRange.startDate, // "01-06-2025"
        displayEnd: seasonal.dateRange.endDate,
      },
      standardPrice: seasonal.standardPrice,
      membersDiscount: calculateMembersDiscount(
        seasonal.standardPrice,
        seasonal.membersDiscount
      ),
      createdAt: now,
      updatedAt: now,
      gsi3pk: `LISTING#${listingId}`,
      gsi3sk: `BASE_PRICE#${seasonalId}`,
    };
    records.push(seasonalRecord);
  }

  // Batch write all base price records
  await batchWriteRecords(records);

  console.log(`Created ${records.length} base price records`);
  return records;
}

async function createLengthOfStayRecords(
  hostId: string,
  listingId: string,
  losDiscounts: any[]
): Promise<LengthOfStayRecord[]> {
  if (!losDiscounts || losDiscounts.length === 0) {
    console.log('No length-of-stay discounts to create');
    return [];
  }

  const now = new Date().toISOString();
  const records: LengthOfStayRecord[] = losDiscounts.map((los) => {
    const losId = `los_${uuidv4()}`;
    return {
      pk: `HOST#${hostId}`,
      sk: `LISTING_PRICING#${listingId}#LENGTH_OF_STAY#${losId}`,
      listingId,
      lengthOfStayId: losId,
      minNights: los.minNights,
      discountType: los.discountType,
      discountPercentage: los.discountPercentage || undefined,
      discountAbsolute: los.discountAbsolute || undefined,
      createdAt: now,
      updatedAt: now,
      gsi3pk: `LISTING#${listingId}`,
      gsi3sk: `LENGTH_OF_STAY#${losId}`,
    };
  });

  await batchWriteRecords(records);

  console.log(`Created ${records.length} length-of-stay records`);
  return records;
}

async function storePricingMatrix(
  hostId: string,
  listingId: string,
  matrix: PricingMatrix,
  currency: string,
  touristTax?: any
): Promise<void> {
  const now = new Date().toISOString();

  const item: any = {
    pk: `HOST#${hostId}`,
    sk: `LISTING_PRICING#${listingId}#MATRIX`,
    listingId,
    currency,
    matrix,
    lastCalculatedAt: now,
    updatedAt: now,
    gsi3pk: `LISTING#${listingId}`,
    gsi3sk: 'PRICING_MATRIX',
  };

  // Add tourist tax if provided
  if (touristTax) {
    item.touristTax = touristTax;
  }

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    })
  );

  console.log('Stored pricing matrix', touristTax ? 'with tourist tax' : '');
}

async function updateListingPricingFlag(hostId: string, listingId: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: `LISTING_META#${listingId}`,
      },
      UpdateExpression: 'SET hasPricing = :true, updatedAt = :now',
      ExpressionAttributeValues: {
        ':true': true,
        ':now': new Date().toISOString(),
      },
    })
  );

  console.log('Updated listing hasPricing flag to true');
}

async function batchWriteRecords(records: any[]): Promise<void> {
  const putRequests = records.map((item) => ({
    PutRequest: { Item: item },
  }));

  // Batch write (25 items per request)
  for (let i = 0; i < putRequests.length; i += 25) {
    const chunk = putRequests.slice(i, i + 25);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: chunk,
        },
      })
    );
  }
}

// ============================================================================
// CALCULATION HELPERS
// ============================================================================

function calculateMembersDiscount(
  standardPrice: number,
  membersDiscount: any
): MembersDiscount | null {
  if (!membersDiscount) {
    return null;
  }

  if (membersDiscount.type === 'PERCENTAGE') {
    const percentage = membersDiscount.percentage;
    const calculatedPrice = standardPrice * (1 - percentage / 100);
    return {
      type: 'PERCENTAGE',
      percentage,
      calculatedPrice: roundToTwoDecimals(calculatedPrice),
      calculatedPercentage: percentage,
    };
  } else {
    // type === 'ABSOLUTE'
    const absolutePrice = membersDiscount.absolutePrice;
    const calculatedPercentage =
      ((standardPrice - absolutePrice) / standardPrice) * 100;
    return {
      type: 'ABSOLUTE',
      absolutePrice,
      calculatedPrice: absolutePrice,
      calculatedPercentage: roundToTwoDecimals(calculatedPercentage),
    };
  }
}

function calculatePricingMatrix(
  basePriceRecords: BasePriceRecord[],
  losRecords: LengthOfStayRecord[]
): PricingMatrix {
  const matrix: PricingMatrix = {
    basePrices: basePriceRecords.map((basePrice) => {
      const lengthOfStayPricing = losRecords.map((los) => {
        // Apply length-of-stay discount to standard price
        const standardPrice = applyDiscount(
          basePrice.standardPrice,
          los.discountType,
          los.discountPercentage || los.discountAbsolute!
        );

        // Apply length-of-stay discount to members price (if exists)
        const membersBasePrice =
          basePrice.membersDiscount?.calculatedPrice || basePrice.standardPrice;
        const membersPrice = basePrice.membersDiscount
          ? applyDiscount(
              membersBasePrice,
              los.discountType,
              los.discountPercentage || los.discountAbsolute!
            )
          : null;

        return {
          minNights: los.minNights,
          discountType: los.discountType,
          discountValue: los.discountPercentage || los.discountAbsolute!,
          standardPrice: roundToTwoDecimals(standardPrice),
          membersPrice: membersPrice ? roundToTwoDecimals(membersPrice) : null,
        };
      });

      return {
        basePriceId: basePrice.basePriceId,
        isDefault: basePrice.isDefault,
        dateRange: basePrice.dateRange,
        standardPrice: basePrice.standardPrice,
        membersDiscount: basePrice.membersDiscount
          ? {
              type: basePrice.membersDiscount.type,
              inputValue:
                basePrice.membersDiscount.percentage ||
                basePrice.membersDiscount.absolutePrice!,
              calculatedPrice: basePrice.membersDiscount.calculatedPrice,
              calculatedPercentage: basePrice.membersDiscount.calculatedPercentage,
            }
          : null,
        lengthOfStayPricing,
      };
    }),
  };

  return matrix;
}

function applyDiscount(price: number, discountType: string, discountValue: number): number {
  if (discountType === 'PERCENTAGE') {
    return price * (1 - discountValue / 100);
  } else {
    return price - discountValue;
  }
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

