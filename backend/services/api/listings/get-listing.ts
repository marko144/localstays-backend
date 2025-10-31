import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { GetListingResponse } from '../../types/listing.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * GET /api/v1/hosts/{hostId}/listings/{listingId}
 * 
 * Get full listing details including:
 * - Listing metadata
 * - All active images (excluding PENDING_UPLOAD)
 * - Amenities with bilingual data
 * - Verification documents (optional)
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Get listing request:', {
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
      return response.badRequest('hostId and listingId are required in path');
    }

    assertCanAccessHost(auth, hostId);

    // 2. Fetch listing metadata
    const listingResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
      })
    );

    if (!listingResult.Item) {
      return response.notFound(`Listing not found: ${listingId}`);
    }

    const listing = listingResult.Item;

    // Check if deleted
    if (listing.isDeleted) {
      return response.notFound(`Listing has been deleted: ${listingId}`);
    }

    // 3. Fetch images (exclude PENDING_UPLOAD and deleted)
    const imagesResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: '#status <> :pendingUpload AND isDeleted = :notDeleted',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':pk': `HOST#${hostId}`,
          ':sk': `LISTING_IMAGE#${listingId}#`,
          ':pendingUpload': 'PENDING_UPLOAD',
          ':notDeleted': false,
        },
      })
    );

    const images = (imagesResult.Items || [])
      .filter((img) => img.status === 'READY' || img.status === 'ACTIVE') // READY = new processed images, ACTIVE = legacy images
      .map((img) => ({
        imageId: img.imageId,
        thumbnailUrl: img.webpUrls?.thumbnail || img.s3Url || '', // Fallback for legacy images
        fullUrl: img.webpUrls?.full || img.s3Url || '', // Fallback for legacy images
        displayOrder: img.displayOrder,
        isPrimary: img.isPrimary,
        caption: img.caption,
        width: img.dimensions?.width || img.width || 0,
        height: img.dimensions?.height || img.height || 0,
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder);

    // 4. Fetch amenities
    const amenitiesResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_AMENITIES#${listingId}`,
        },
      })
    );

    const amenities = amenitiesResult.Item?.amenities || [];

    // 5. Fetch verification documents (optional)
    const documentsResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: 'isDeleted = :notDeleted',
        ExpressionAttributeValues: {
          ':pk': `HOST#${hostId}`,
          ':sk': `LISTING_DOC#${listingId}#`,
          ':notDeleted': false,
        },
      })
    );

    const documents = (documentsResult.Items || []).map((doc) => ({
      documentType: doc.documentType,
      status: doc.status,
      contentType: doc.contentType,
      uploadedAt: doc.uploadedAt,
    }));

    // 6. Build response
    const listingResponse: GetListingResponse = {
      listing: {
        listingId: listing.listingId,
        hostId: listing.hostId,
        listingName: listing.listingName,
        propertyType: listing.propertyType,
        status: listing.status,
        description: listing.description,
        address: listing.address,
        capacity: listing.capacity,
        pricing: listing.pricing,
        pets: listing.pets,
        checkIn: listing.checkIn,
        parking: listing.parking,
        createdAt: listing.createdAt,
        updatedAt: listing.updatedAt,
        submittedAt: listing.submittedAt,
        approvedAt: listing.approvedAt,
        rejectedAt: listing.rejectedAt,
        rejectionReason: listing.rejectionReason,
      },
      images,
      amenities,
      verificationDocuments: documents.length > 0 ? documents : undefined,
    };

    console.log('Listing fetched successfully:', {
      listingId,
      imagesCount: images.length,
      amenitiesCount: amenities.length,
      documentsCount: documents.length,
    });

    return response.success(listingResponse);

  } catch (error: any) {
    console.error('Get listing error:', error);
    return response.handleError(error);
  }
}







