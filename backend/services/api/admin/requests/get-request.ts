/**
 * Admin API: Get Request Details
 * 
 * GET /api/v1/admin/requests/{requestId}
 * 
 * Returns complete request details including pre-signed video download URL.
 * Permission required: ADMIN_REQUEST_VIEW_ALL
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { Request } from '../../../types/request.types';
import { Host, isIndividualHost } from '../../../types/host.types';
import { AdminRequestDetails } from '../../../types/admin.types';
import { ListingImage } from '../../../types/listing.types';
import { buildListingImageUrls } from '../../lib/cloudfront-urls';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;

// Pre-signed URL expiry: 15 minutes
const PRESIGNED_URL_EXPIRY = 15 * 60;

/**
 * Generate pre-signed URL for video download
 */
async function generateDownloadUrl(s3Key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    ResponseContentDisposition: 'attachment', // Force download
  });

  return await getSignedUrl(s3Client, command, {
    expiresIn: PRESIGNED_URL_EXPIRY,
  });
}

/**
 * Get host name
 */
async function getHostName(hostId: string): Promise<string> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: 'META',
        },
      })
    );

    if (!result.Item) {
      return 'Unknown Host';
    }

    const host = result.Item as Host;
    
    if (isIndividualHost(host)) {
      return `${host.forename} ${host.surname}`;
    } else {
      return host.legalName || host.displayName || host.businessName || 'Unknown Business';
    }
  } catch (error) {
    console.error(`Failed to fetch host ${hostId}:`, error);
    return 'Unknown Host';
  }
}

/**
 * Find request by requestId (need to scan since we don't have hostId)
 */
async function findRequest(requestId: string): Promise<Request | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'DocumentStatusIndex',  // GSI3
      KeyConditionExpression: 'gsi3pk = :gsi3pk AND begins_with(gsi3sk, :gsi3sk)',
      ExpressionAttributeValues: {
        ':gsi3pk': `REQUEST#${requestId}`,
        ':gsi3sk': 'REQUEST_META#',
      },
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0] as Request;
}

/**
 * Fetch image details with pre-signed URLs
 */
async function fetchImageDetails(listingId: string, imageIds: string[]): Promise<Array<ListingImage & { url: string; thumbnailUrl: string }>> {
  const imagePromises = imageIds.map(async (imageId) => {
    console.log(`Fetching image ${imageId} for listing ${listingId}`);
    
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `LISTING#${listingId}`,
          sk: `IMAGE#${imageId}`,
        },
      })
    );

    if (!result.Item) {
      console.warn(`Image ${imageId} not found in DynamoDB`);
      return null;
    }

    const image = result.Item as ListingImage;
    console.log(`Found image ${imageId}, s3Key: ${image.s3Key}, status: ${image.status}`);

    // Generate URLs using CloudFront or presigned URLs
    const urls = buildListingImageUrls(image.webpUrls, image.updatedAt);
    const fallbackUrl = await generateDownloadUrl(image.s3Key);

    console.log(`Generated URLs for image ${imageId}`);

    return {
      ...image,
      url: urls.fullUrl || fallbackUrl,
      thumbnailUrl: urls.thumbnailUrl || fallbackUrl,
    };
  });

  const images = await Promise.all(imagePromises);
  const filtered = images.filter((img): img is NonNullable<typeof img> => img !== null);
  console.log(`Returning ${filtered.length} of ${imageIds.length} images`);
  return filtered;
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Get request details request:', { pathParameters: event.pathParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_REQUEST_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Extract requestId from path
    const requestId = event.pathParameters?.requestId;

    if (!requestId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'requestId is required',
          },
        }),
      };
    }

    console.log(`Admin ${user.email} viewing request: ${requestId}`);

    // 3. Find request
    const request = await findRequest(requestId);

    if (!request) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Request not found',
          },
        }),
      };
    }

    // 4. Get host name
    const hostName = await getHostName(request.hostId);

    // 5. Generate pre-signed download URL if file exists
    let s3DownloadUrl = '';
    if (request.s3Key) {
      s3DownloadUrl = await generateDownloadUrl(request.s3Key);
    }

    // 6. For LISTING_IMAGE_UPDATE requests, fetch image details
    let imagesToAddDetails;
    let imagesToDeleteDetails;
    
    if (request.requestType === 'LISTING_IMAGE_UPDATE' && request.listingId) {
      console.log('Processing LISTING_IMAGE_UPDATE request:', {
        listingId: request.listingId,
        imagesToAdd: request.imagesToAdd,
        imagesToDelete: request.imagesToDelete,
      });
      
      // Fetch details for images to be added (with pendingApproval flag)
      if (request.imagesToAdd && request.imagesToAdd.length > 0) {
        console.log(`Fetching details for ${request.imagesToAdd.length} images to add`);
        imagesToAddDetails = await fetchImageDetails(request.listingId, request.imagesToAdd);
        console.log(`Fetched ${imagesToAddDetails.length} image details for imagesToAdd`);
      }
      
      // Fetch details for images to be deleted (existing images)
      if (request.imagesToDelete && request.imagesToDelete.length > 0) {
        console.log(`Fetching details for ${request.imagesToDelete.length} images to delete`);
        imagesToDeleteDetails = await fetchImageDetails(request.listingId, request.imagesToDelete);
        console.log(`Fetched ${imagesToDeleteDetails.length} image details for imagesToDelete`);
      }
    }

    // 7. Build response
    const response: AdminRequestDetails = {
      ...request,
      hostName,
      s3DownloadUrl,
      ...(imagesToAddDetails && { imagesToAddDetails }),
      ...(imagesToDeleteDetails && { imagesToDeleteDetails }),
    };

    // 8. Log admin action
    logAdminAction(user, 'VIEW_REQUEST', 'REQUEST', requestId, {
      hostId: request.hostId,
    });

    // 9. Return response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        data: response,
      }),
    };
  } catch (error) {
    console.error('❌ Get request error:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch request details',
        },
      }),
    };
  }
};













