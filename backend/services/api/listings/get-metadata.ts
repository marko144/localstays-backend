import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import * as response from '../lib/response';
import { ListingMetadataResponse } from '../../types/listing.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * GET /api/v1/listings/metadata
 * 
 * Returns all configuration data needed for creating/editing listings:
 * - Property types
 * - Amenities (with categories)
 * - Check-in types
 * - Parking types
 * - Advance booking options (NEW: 2025-11-29)
 * - Max booking duration options (NEW: 2025-11-29)
 * - Verification document types
 * - Listing statuses
 * - Amenity categories
 * 
 * This endpoint is used by the frontend to populate form dropdowns and checkboxes.
 * All data is bilingual (English + Serbian).
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Get listing metadata request:', {
    requestId: event.requestContext.requestId,
  });

  try {
    // Fetch all enum types in parallel
    const [
      propertyTypes,
      amenities,
      checkInTypes,
      parkingTypes,
      paymentTypes,
      advanceBookingOptions,
      maxBookingDurationOptions,
      cancellationPolicyTypes,
      verificationDocTypes,
      listingStatuses,
      amenityCategories,
    ] = await Promise.all([
      fetchEnumValues('PROPERTY_TYPE'),
      fetchEnumValues('AMENITY'),
      fetchEnumValues('CHECKIN_TYPE'),
      fetchEnumValues('PARKING_TYPE'),
      fetchEnumValues('PAYMENT_TYPE'),
      fetchEnumValues('ADVANCE_BOOKING'),
      fetchEnumValues('MAX_BOOKING_DURATION'),
      fetchEnumValues('CANCELLATION_POLICY'),
      fetchEnumValues('VERIFICATION_DOC_TYPE'),
      fetchEnumValues('LISTING_STATUS'),
      fetchEnumValues('AMENITY_CATEGORY'),
    ]);

    // Build response
    const metadata: ListingMetadataResponse = {
      propertyTypes: propertyTypes.map((item) => ({
        key: item.enumValue,
        en: item.translations.en,
        sr: item.translations.sr,
        isEntirePlace: item.metadata?.isEntirePlace ?? false,
        sortOrder: item.sortOrder,
      })),
      
      amenities: amenities.map((item) => ({
        key: item.enumValue,
        en: item.translations.en,
        sr: item.translations.sr,
        category: item.metadata?.category || 'BASICS',
        sortOrder: item.sortOrder,
        isFilter: item.isFilter ?? false,
      })),
      
      checkInTypes: checkInTypes.map((item) => ({
        key: item.enumValue,
        en: item.translations.en,
        sr: item.translations.sr,
        sortOrder: item.sortOrder,
      })),
      
      parkingTypes: parkingTypes.map((item) => ({
        key: item.enumValue,
        en: item.translations.en,
        sr: item.translations.sr,
        sortOrder: item.sortOrder,
      })),
      
      paymentTypes: paymentTypes.map((item) => ({
        key: item.enumValue,
        en: item.translations.en,
        sr: item.translations.sr,
        sortOrder: item.sortOrder,
      })),
      
      advanceBookingOptions: advanceBookingOptions.map((item) => ({
        key: item.enumValue,
        en: item.translations.en,
        sr: item.translations.sr,
        days: item.metadata?.days || 0,
        sortOrder: item.sortOrder,
      })),
      
      maxBookingDurationOptions: maxBookingDurationOptions.map((item) => ({
        key: item.enumValue,
        en: item.translations.en,
        sr: item.translations.sr,
        nights: item.metadata?.nights || 0,
        sortOrder: item.sortOrder,
      })),
      
      cancellationPolicyTypes: cancellationPolicyTypes.map((item) => ({
        key: item.enumValue,
        en: item.translations.en,
        sr: item.translations.sr,
        sortOrder: item.sortOrder,
      })),
      
      verificationDocumentTypes: verificationDocTypes.map((item) => ({
        key: item.enumValue,
        en: item.translations.en,
        sr: item.translations.sr,
        description: item.metadata?.description || { en: '', sr: '' },
        sortOrder: item.sortOrder,
      })),
      
      listingStatuses: listingStatuses.map((item) => ({
        key: item.enumValue,
        en: item.translations.en,
        sr: item.translations.sr,
        description: item.metadata?.description || { en: '', sr: '' },
      })),
      
      amenityCategories: amenityCategories.map((item) => ({
        key: item.enumValue,
        en: item.translations.en,
        sr: item.translations.sr,
        sortOrder: item.sortOrder,
      })),
    };

    console.log('Metadata fetched successfully:', {
      propertyTypes: metadata.propertyTypes.length,
      amenities: metadata.amenities.length,
      checkInTypes: metadata.checkInTypes.length,
      parkingTypes: metadata.parkingTypes.length,
      paymentTypes: metadata.paymentTypes.length,
      advanceBookingOptions: metadata.advanceBookingOptions.length,
      maxBookingDurationOptions: metadata.maxBookingDurationOptions.length,
      cancellationPolicyTypes: metadata.cancellationPolicyTypes.length,
      verificationDocTypes: metadata.verificationDocumentTypes.length,
      listingStatuses: metadata.listingStatuses.length,
      amenityCategories: metadata.amenityCategories.length,
    });

    return response.success(metadata);

  } catch (error: any) {
    console.error('Get metadata error:', error);
    return response.handleError(error);
  }
}

/**
 * Fetch all values for a specific enum type
 * Fixed: Removed isActive filter to return all enums
 */
async function fetchEnumValues(enumType: string): Promise<any[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':pk': `ENUM#${enumType}`,
        ':sk': 'VALUE#',
      },
    })
  );

  // Sort by sortOrder if present
  const items = result.Items || [];
  return items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}







