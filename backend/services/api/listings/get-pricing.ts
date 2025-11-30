/**
 * GET /api/v1/hosts/{hostId}/listings/{listingId}/pricing
 * 
 * Get pricing configuration and matrix for a listing
 * 
 * Authorization: Host must own the listing
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import type {
  GetPricingResponse,
  BasePriceRecord,
  LengthOfStayRecord,
  PricingMatrix,
} from '../../types/pricing.types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const TABLE_NAME = process.env.TABLE_NAME!;

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Get pricing:', {
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

    // 2. Verify listing exists and belongs to host
    const listing = await getListingMetadata(hostId, listingId);
    if (!listing) {
      return response.notFound('Listing not found');
    }
    if (listing.hostId !== hostId) {
      return response.forbidden('You do not own this listing');
    }

    // 3. Get all pricing records
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
      return response.notFound('No pricing configured for this listing');
    }

    // 4. Parse records
    const basePrices: BasePriceRecord[] = [];
    const losDiscounts: LengthOfStayRecord[] = [];
    let matrix: PricingMatrix | null = null;
    let touristTax: any = null;
    let taxesIncludedInPrice: boolean = false;
    let currency: string | null = null;

    for (const item of result.Items) {
      if (item.sk.includes('#BASE#')) {
        basePrices.push(item as BasePriceRecord);
      } else if (item.sk.includes('#LENGTH_OF_STAY#')) {
        losDiscounts.push(item as LengthOfStayRecord);
      } else if (item.sk.includes('#MATRIX')) {
        matrix = item.matrix as PricingMatrix;
        touristTax = item.touristTax || null;
        taxesIncludedInPrice = item.taxesIncludedInPrice ?? false;
        currency = item.currency;  // Get currency from pricing matrix
      }
    }

    // 5. Validate required data
    const defaultBasePrice = basePrices.find((bp) => bp.isDefault);
    if (!defaultBasePrice) {
      return response.internalError('Default base price not found');
    }

    if (!currency) {
      return response.internalError('Currency not found in pricing configuration');
    }

    const seasonalPrices = basePrices
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
      lengthOfStayDiscounts: losDiscounts.map((los) => ({
        lengthOfStayId: los.lengthOfStayId,
        minNights: los.minNights,
        discountType: los.discountType,
        discountPercentage: los.discountPercentage,
        discountAbsolute: los.discountAbsolute,
      })),
      touristTax: touristTax || undefined,
      taxesIncludedInPrice,
    };

    // 6. Return configuration + matrix
    const pricingResponse: GetPricingResponse = {
      listingId,
      currency,  // From pricing matrix (set when pricing was configured)
      configuration,
      matrix: matrix || { basePrices: [] },
      lastUpdatedAt: defaultBasePrice.updatedAt,
    };

    console.log('Pricing retrieved successfully:', {
      listingId,
      basePricesCount: basePrices.length,
      losDiscountsCount: losDiscounts.length,
      hasMatrix: !!matrix,
    });

    return response.success(pricingResponse);

  } catch (err: any) {
    console.error('Failed to get pricing:', err);
    return response.internalError('Failed to get pricing', err);
  }
}

/**
 * Helper: Get listing metadata
 */
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





