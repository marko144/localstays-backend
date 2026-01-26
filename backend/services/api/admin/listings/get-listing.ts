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
import { ListingMetadata, ListingImage, ListingAmenities, ListingVerificationDocument, TranslationRequest } from '../../../types/listing.types';
import { AdminListingDetails } from '../../../types/admin.types';
import { buildCloudFrontUrl } from '../../lib/cloudfront-urls';

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

    // Note: Admins can view deleted/archived listings - no isDeleted check

    // 4. Fetch images (including soft-deleted for archived listings - admins see everything)
    const imagesResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `LISTING#${listingId}`,
          ':sk': 'IMAGE#',
        },
      })
    );

    const images = (imagesResult.Items || []) as ListingImage[];

    // Separate current images from pending approval images
    const currentImages = images.filter(img => !img.pendingApproval);
    const pendingImages = images.filter(img => img.pendingApproval);

    // Generate URLs for current images (CloudFront or presigned)
    const imageDetails = await Promise.all(
      currentImages.map(async (img) => {
        // Use WebP URLs if available, otherwise fall back to original s3Key
        const fullUrl = img.webpUrls?.full 
          ? buildCloudFrontUrl(img.webpUrls.full, img.updatedAt) 
          : await generatePresignedUrl(img.s3Key);
        const thumbnailUrl = img.webpUrls?.thumbnail
          ? buildCloudFrontUrl(img.webpUrls.thumbnail, img.updatedAt)
          : fullUrl; // Fallback to full URL if no thumbnail
        
        return {
          imageId: img.imageId,
          s3Url: fullUrl, // Keep field name for backward compatibility
          thumbnailUrl: thumbnailUrl,
          displayOrder: img.displayOrder,
          isPrimary: img.isPrimary,
          caption: img.caption,
          contentType: img.contentType,
          pendingApproval: false,
        };
      })
    );

    // Sort by display order
    imageDetails.sort((a, b) => a.displayOrder - b.displayOrder);

    // Generate URLs for pending images (CloudFront or presigned)
    const pendingImageDetails = await Promise.all(
      pendingImages.map(async (img) => {
        // Use WebP URLs if available, otherwise fall back to original s3Key
        const fullUrl = img.webpUrls?.full 
          ? buildCloudFrontUrl(img.webpUrls.full, img.updatedAt) 
          : await generatePresignedUrl(img.s3Key);
        const thumbnailUrl = img.webpUrls?.thumbnail
          ? buildCloudFrontUrl(img.webpUrls.thumbnail, img.updatedAt)
          : fullUrl; // Fallback to full URL if no thumbnail
        
        return {
          imageId: img.imageId,
          s3Url: fullUrl, // Keep field name for backward compatibility
          thumbnailUrl: thumbnailUrl,
          displayOrder: img.displayOrder,
          isPrimary: img.isPrimary,
          caption: img.caption,
          contentType: img.contentType,
          pendingApproval: true,
          status: img.status,
        };
      })
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

    // 6. Fetch verification documents (including soft-deleted for archived listings)
    const docsResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `HOST#${hostId}`,
          ':sk': `LISTING_DOC#${listingId}#`,
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
            const img = imgResult.Item;
            // Use WebP URLs if available, otherwise fall back to original s3Key
            const fullUrl = img.webpUrls?.full 
              ? buildCloudFrontUrl(img.webpUrls.full, img.updatedAt) 
              : await generatePresignedUrl(img.s3Key);
            const thumbnailUrl = img.webpUrls?.thumbnail
              ? buildCloudFrontUrl(img.webpUrls.thumbnail, img.updatedAt)
              : fullUrl;
            
            imagesToDeleteDetails.push({
              imageId: img.imageId,
              s3Url: fullUrl,
              thumbnailUrl: thumbnailUrl,
              displayOrder: img.displayOrder,
              isPrimary: img.isPrimary,
              caption: img.caption,
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

    // 8. Fetch translation request (if any)
    let pendingTranslationRequest: TranslationRequest['fieldsToTranslate'] | undefined;
    const translationRequestResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: 'TRANSLATION_REQUEST#PENDING',
          sk: `LISTING#${listingId}`,
        },
      })
    );

    if (translationRequestResult.Item) {
      const request = translationRequestResult.Item as TranslationRequest;
      pendingTranslationRequest = request.fieldsToTranslate;
    }

    // 9. Build response
    // Check if listing has location data for publishing (either mapbox metadata OR manual location IDs)
    const hasMapboxData = !!(listing.mapboxMetadata?.place?.mapbox_id);
    const hasManualLocationIds = !!(listing.manualLocationIds && listing.manualLocationIds.length > 0);
    const hasLocationData = hasMapboxData || hasManualLocationIds;
    
    const response: AdminListingDetails = {
      listing,
      images: imageDetails,
      amenities,
      verificationDocuments: documentDetails,
      hasMapboxLocationData: hasLocationData, // true if listing has location data (mapbox OR manual)
      ...(pendingImageChanges && { pendingImageChanges }),
      ...(pendingTranslationRequest && { pendingTranslationRequest }),
    };

    // 10. Log admin action
    logAdminAction(user, 'VIEW_LISTING', 'LISTING', listingId);

    // 11. Return response
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






