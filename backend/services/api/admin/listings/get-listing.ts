/**
 * Admin API: Get Listing Details
 * 
 * GET /api/v1/admin/listings/{listingId}
 * 
 * Returns complete listing details including images, amenities, and verification documents.
 * All file URLs are pre-signed for download.
 * Permission required: ADMIN_LISTING_VIEW_ALL
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { ListingMetadata, ListingImage, ListingAmenities, ListingVerificationDocument } from '../../../types/listing.types';
import { AdminListingDetails } from '../../../types/admin.types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;

// Pre-signed URL expiry: 15 minutes
const PRESIGNED_URL_EXPIRY = 15 * 60;

/**
 * Generate pre-signed URL for S3 object
 */
async function generatePresignedUrl(s3Key: string, forceDownload: boolean = false): Promise<string> {
  const params: any = {
    Bucket: BUCKET_NAME,
    Key: s3Key,
  };

  if (forceDownload) {
    params.ResponseContentDisposition = 'attachment';
  }

  const command = new GetObjectCommand(params);

  return await getSignedUrl(s3Client, command, {
    expiresIn: PRESIGNED_URL_EXPIRY,
  });
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Get listing details request:', { pathParameters: event.pathParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Extract listingId from path
    const listingId = event.pathParameters?.listingId;

    if (!listingId) {
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
            message: 'listingId is required',
          },
        }),
      };
    }

    console.log(`Admin ${user.email} viewing listing: ${listingId}`);

    // 3. Find listing metadata using GSI3 (DocumentStatusIndex repurposed for listings)
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'DocumentStatusIndex',
        KeyConditionExpression: 'gsi3pk = :gsi3pk AND begins_with(gsi3sk, :gsi3sk)',
        ExpressionAttributeValues: {
          ':gsi3pk': `LISTING#${listingId}`,
          ':gsi3sk': 'LISTING_META#',
        },
        Limit: 1,
      })
    );

    if (!queryResult.Items || queryResult.Items.length === 0) {
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
            message: 'Listing not found',
          },
        }),
      };
    }

    const listing = queryResult.Items[0] as ListingMetadata;
    const hostId = listing.hostId;

    // Check if deleted
    if (listing.isDeleted) {
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
            message: 'Listing not found',
          },
        }),
      };
    }

    // 4. Fetch images
    const imagesResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: 'isDeleted = :isDeleted',
        ExpressionAttributeValues: {
          ':pk': `LISTING#${listingId}`,
          ':sk': 'IMAGE#',
          ':isDeleted': false,
        },
      })
    );

    const images = (imagesResult.Items || []) as ListingImage[];

    // Separate current images from pending approval images
    const currentImages = images.filter(img => !img.pendingApproval);
    const pendingImages = images.filter(img => img.pendingApproval);

    // Generate pre-signed URLs for current images
    const imageDetails = await Promise.all(
      currentImages.map(async (img) => ({
        imageId: img.imageId,
        s3Url: await generatePresignedUrl(img.s3Key),
        displayOrder: img.displayOrder,
        isPrimary: img.isPrimary,
        caption: img.caption,
        contentType: img.contentType,
        pendingApproval: false,
      }))
    );

    // Sort by display order
    imageDetails.sort((a, b) => a.displayOrder - b.displayOrder);

    // Generate pre-signed URLs for pending images (if any)
    const pendingImageDetails = await Promise.all(
      pendingImages.map(async (img) => ({
        imageId: img.imageId,
        s3Url: await generatePresignedUrl(img.s3Key),
        displayOrder: img.displayOrder,
        isPrimary: img.isPrimary,
        caption: img.caption,
        contentType: img.contentType,
        pendingApproval: true,
        status: img.status,
      }))
    );

    pendingImageDetails.sort((a, b) => a.displayOrder - b.displayOrder);

    // 5. Fetch amenities
    const amenitiesResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_AMENITIES#${listingId}`,
        },
      })
    );

    const amenitiesData = amenitiesResult.Item as ListingAmenities | undefined;
    const amenities = amenitiesData?.amenities || [];

    // 6. Fetch verification documents
    const docsResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: 'isDeleted = :isDeleted',
        ExpressionAttributeValues: {
          ':pk': `HOST#${hostId}`,
          ':sk': `LISTING_DOC#${listingId}#`,
          ':isDeleted': false,
        },
      })
    );

    const documents = (docsResult.Items || []) as ListingVerificationDocument[];

    // Generate pre-signed URLs for documents (force download)
    const documentDetails = await Promise.all(
      documents.map(async (doc) => ({
        documentType: doc.documentType,
        fileName: `${doc.documentType}.${doc.contentType.split('/')[1]}`,
        contentType: doc.contentType,
        fileSize: doc.fileSize,
        s3Url: await generatePresignedUrl(doc.s3Key, true),
        uploadedAt: doc.uploadedAt,
        status: doc.status,
      }))
    );

    // 7. Check for pending image update requests
    const pendingRequestsResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: 'requestType = :requestType AND #status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':pk': `LISTING#${listingId}`,
          ':sk': 'REQUEST#',
          ':requestType': 'LISTING_IMAGE_UPDATE',
          ':status': 'RECEIVED',
        },
      })
    );

    const pendingRequest = pendingRequestsResult.Items?.[0];
    let pendingImageChanges;

    if (pendingRequest) {
      // Fetch images marked for deletion
      const imagesToDeleteDetails = [];
      if (pendingRequest.imagesToDelete && pendingRequest.imagesToDelete.length > 0) {
        for (const imageId of pendingRequest.imagesToDelete) {
          const imgResult = await docClient.send(
            new GetCommand({
              TableName: TABLE_NAME,
              Key: {
                pk: `LISTING#${listingId}`,
                sk: `IMAGE#${imageId}`,
              },
            })
          );
          
          if (imgResult.Item && !imgResult.Item.isDeleted) {
            imagesToDeleteDetails.push({
              imageId: imgResult.Item.imageId,
              s3Url: await generatePresignedUrl(imgResult.Item.s3Key),
              displayOrder: imgResult.Item.displayOrder,
              isPrimary: imgResult.Item.isPrimary,
              caption: imgResult.Item.caption,
            });
          }
        }
      }

      pendingImageChanges = {
        requestId: pendingRequest.requestId,
        imagesToAdd: pendingImageDetails, // Already fetched above
        imagesToDelete: imagesToDeleteDetails,
        createdAt: pendingRequest.createdAt,
      };
    }

    // 8. Build response
    const response: AdminListingDetails = {
      listing,
      images: imageDetails,
      amenities,
      verificationDocuments: documentDetails,
      ...(pendingImageChanges && { pendingImageChanges }),
    };

    // 9. Log admin action
    logAdminAction(user, 'VIEW_LISTING', 'LISTING', listingId);

    // 10. Return response
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
    console.error('❌ Get listing error:', error);

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
          message: 'Failed to fetch listing details',
        },
      }),
    };
  }
};






