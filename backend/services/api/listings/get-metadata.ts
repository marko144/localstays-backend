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
      verificationDocTypes,
      listingStatuses,
      amenityCategories,
    ] = await Promise.all([
      fetchEnumValues('PROPERTY_TYPE'),
      fetchEnumValues('AMENITY'),
      fetchEnumValues('CHECKIN_TYPE'),
      fetchEnumValues('PARKING_TYPE'),
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
 */
async function fetchEnumValues(enumType: string): Promise<any[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: {
        ':pk': `ENUM#${enumType}`,
        ':sk': 'VALUE#',
        ':active': true,
      },
    })
  );

  // Sort by sortOrder if present
  const items = result.Items || [];
  return items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}







