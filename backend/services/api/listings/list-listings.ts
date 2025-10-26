import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { ListListingsResponse } from '../../types/listing.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * GET /api/v1/hosts/{hostId}/listings
 * 
 * List all listings for a host
 * 
 * Query parameters:
 * - status (optional): Filter by listing status
 * 
 * Returns summary data (not full details):
 * - Listing metadata (basic info)
 * - Primary image
 * - No amenities or documents
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('List listings request:', {
    requestId: event.requestContext.requestId,
    hostId: event.pathParameters?.hostId,
    queryParams: event.queryStringParameters,
  });

  try {
    // 1. Authentication & Authorization
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;

    if (!hostId) {
      return response.badRequest('hostId is required in path');
    }

    assertCanAccessHost(auth, hostId);

    // 2. Get query parameters
    const statusFilter = event.queryStringParameters?.status;

    // 3. Fetch all listing metadata records
    let filterExpression = 'isDeleted = :notDeleted';
    const expressionAttributeValues: any = {
      ':pk': `HOST#${hostId}`,
      ':sk': 'LISTING_META#',
      ':notDeleted': false,
    };

    if (statusFilter) {
      filterExpression += ' AND #status = :status';
      expressionAttributeValues[':status'] = statusFilter;
    }

    const listingsResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: filterExpression,
        ExpressionAttributeNames: statusFilter ? { '#status': 'status' } : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );

    const listings = listingsResult.Items || [];

    // 4. For each listing, fetch primary image
    const listingsWithImages = await Promise.all(
      listings.map(async (listing) => {
        // Fetch primary image
        const imagesResult = await docClient.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
            FilterExpression: 'isPrimary = :isPrimary AND #status = :active AND isDeleted = :notDeleted',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':pk': `HOST#${hostId}`,
              ':sk': `LISTING_IMAGE#${listing.listingId}#`,
              ':isPrimary': true,
              ':active': 'ACTIVE',
              ':notDeleted': false,
            },
            Limit: 1,
          })
        );

        const primaryImage = imagesResult.Items?.[0];

        return {
          listingId: listing.listingId,
          listingName: listing.listingName,
          propertyType: {
            key: listing.propertyType.key,
            en: listing.propertyType.en,
            sr: listing.propertyType.sr,
          },
          status: listing.status,
          pricing: listing.pricing,
          address: {
            city: listing.address.city,
            country: listing.address.country,
          },
          primaryImage: primaryImage
            ? {
                imageId: primaryImage.imageId,
                s3Url: primaryImage.s3Url || '',
              }
            : undefined,
          createdAt: listing.createdAt,
          updatedAt: listing.updatedAt,
        };
      })
    );

    // 5. Sort by updatedAt (most recent first)
    listingsWithImages.sort((a, b) => {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    // 6. Build response
    const listResponse: ListListingsResponse = {
      listings: listingsWithImages,
      total: listingsWithImages.length,
    };

    console.log('Listings fetched successfully:', {
      hostId,
      total: listResponse.total,
      statusFilter: statusFilter || 'all',
    });

    return response.success(listResponse);

  } catch (error: any) {
    console.error('List listings error:', error);
    return response.handleError(error);
  }
}







