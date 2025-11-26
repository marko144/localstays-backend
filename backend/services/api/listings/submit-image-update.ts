/**
 * Host API: Submit Image Update Intent
 * 
 * POST /api/v1/hosts/{hostId}/listings/{listingId}/image-update
 * 
 * Allows hosts to request adding new images and/or deleting existing images.
 * Creates a LISTING_IMAGE_UPDATE request and returns pre-signed URLs for new images.
 * 
 * Flow:
 * 1. Validate listing belongs to host and is APPROVED or ONLINE
 * 2. Create LISTING_IMAGE_UPDATE request record
 * 3. For imagesToAdd: Create placeholder ListingImage records with pendingApproval=true
 * 4. Generate pre-signed S3 URLs for new images
 * 5. Return request ID, submission token, and upload URLs
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { generateUploadUrl } from '../lib/s3-presigned';
import { checkAndIncrementWriteOperationRateLimit, extractUserId } from '../lib/write-operation-rate-limiter';
import { randomUUID } from 'crypto';
import { SubmitImageUpdateRequest, SubmitImageUpdateResponse } from '../../types/request.types';
import { ListingMetadata } from '../../types/listing.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

// const MAX_IMAGES_PER_LISTING = 15; // Reserved for future validation
const UPLOAD_URL_EXPIRY_SECONDS = 600; // 10 minutes
const SUBMISSION_TOKEN_EXPIRY_SECONDS = 1800; // 30 minutes

/**
 * Helper: Get file extension from content type
 */
function getFileExtension(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  return map[contentType.toLowerCase()] || 'jpg';
}

/**
 * Main handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Submit image update request:', {
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

    // 2. Check rate limit
    const userId = extractUserId(event);
    if (!userId) {
      return response.unauthorized('User ID not found');
    }

    const rateLimitCheck = await checkAndIncrementWriteOperationRateLimit(userId, 'image-delete');
    if (!rateLimitCheck.allowed) {
      console.warn('Rate limit exceeded for image update/delete:', { userId, hostId, listingId });
      return response.tooManyRequests(rateLimitCheck.message || 'Rate limit exceeded');
    }

    // 3. Parse request body
    if (!event.body) {
      return response.badRequest('Request body is required');
    }

    const body: SubmitImageUpdateRequest = JSON.parse(event.body);

    // 4. Validate at least one change is requested
    if ((!body.imagesToAdd || body.imagesToAdd.length === 0) && 
        (!body.imagesToDelete || body.imagesToDelete.length === 0) &&
        !body.newPrimaryImageId) {
      return response.badRequest('Must specify at least one change: imagesToAdd, imagesToDelete, or newPrimaryImageId');
    }

    // 4. Fetch listing metadata
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

    const listing = listingResult.Item as ListingMetadata;

    // 5. Validate listing status (must be APPROVED or ONLINE)
    if (!['APPROVED', 'ONLINE'].includes(listing.status)) {
      return response.badRequest(`Cannot update images for listing with status: ${listing.status}. Listing must be APPROVED or ONLINE.`);
    }

    // 6. Validate listing is not deleted
    if (listing.isDeleted) {
      return response.badRequest('Cannot update images for deleted listing');
    }

    // 7. Validate image constraints
    if (body.imagesToAdd && body.imagesToAdd.length > 0) {
      // Check display orders are unique and within range
      const displayOrders = body.imagesToAdd.map(img => img.displayOrder);
      const uniqueOrders = new Set(displayOrders);
      
      if (uniqueOrders.size !== displayOrders.length) {
        return response.badRequest('Display orders must be unique');
      }

      // Check only one primary image in imagesToAdd
      const primaryCount = body.imagesToAdd.filter(img => img.isPrimary).length;
      if (primaryCount > 1) {
        return response.badRequest('Only one image can be marked as primary in imagesToAdd');
      }

      // Cannot specify both isPrimary in imagesToAdd AND newPrimaryImageId
      if (primaryCount > 0 && body.newPrimaryImageId) {
        return response.badRequest('Cannot specify both isPrimary in imagesToAdd and newPrimaryImageId. Use one method to set primary image.');
      }

      // Validate content types
      const validContentTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
      for (const img of body.imagesToAdd) {
        if (!validContentTypes.includes(img.contentType.toLowerCase())) {
          return response.badRequest(`Invalid content type: ${img.contentType}. Must be JPEG, PNG, WebP, or HEIC.`);
        }
      }
    }

    // 7b. Validate newPrimaryImageId if provided
    if (body.newPrimaryImageId) {
      // Verify the image exists and is not being deleted
      if (body.imagesToDelete?.includes(body.newPrimaryImageId)) {
        return response.badRequest('Cannot set a deleted image as primary');
      }

      // Verify the image exists in the listing
      const imageResult = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `LISTING#${listingId}`,
            sk: `IMAGE#${body.newPrimaryImageId}`,
          },
        })
      );

      if (!imageResult.Item || imageResult.Item.isDeleted) {
        return response.badRequest(`Image not found: ${body.newPrimaryImageId}`);
      }

      if (imageResult.Item.status !== 'READY') {
        return response.badRequest(`Image must be in READY status to be set as primary. Current status: ${imageResult.Item.status}`);
      }
    }

    // 8. Generate IDs and timestamps
    const requestId = `req_${randomUUID()}`;
    const now = new Date().toISOString();
    const tokenExpiresAt = new Date(Date.now() + SUBMISSION_TOKEN_EXPIRY_SECONDS * 1000);
    const expiresAtTimestamp = Math.floor(tokenExpiresAt.getTime() / 1000);

    // Determine if we need a submission token (only if adding images)
    const hasImagesToAdd = body.imagesToAdd && body.imagesToAdd.length > 0;
    const submissionToken = hasImagesToAdd ? `sub_${randomUUID()}` : undefined;
    
    // If no images to add, set status directly to RECEIVED (no upload confirmation needed)
    const initialStatus = hasImagesToAdd ? 'REQUESTED' : 'RECEIVED';

    // 10. Create request record
    const requestItem: any = {
      pk: `LISTING#${listingId}`,
      sk: `REQUEST#${requestId}`,
      
      requestId,
      hostId,
      listingId,
      
      requestType: 'LISTING_IMAGE_UPDATE',
      status: initialStatus,
      description: {
        en: 'Listing Image Update',
        sr: 'Ažuriranje slika oglasa',
      },
      
      // Store image IDs for tracking
      imagesToAdd: body.imagesToAdd?.map(img => img.imageId) || [],
      imagesToDelete: body.imagesToDelete || [],
      newPrimaryImageId: body.newPrimaryImageId || undefined,
      
      createdAt: now,
      updatedAt: now,
      
      // GSI2: Admin queries by type/status
      gsi2pk: 'REQUEST#LISTING_IMAGE_UPDATE',
      gsi2sk: `STATUS#${initialStatus}#${now}`,
      
      // GSI3: Direct lookup by requestId
      gsi3pk: `REQUEST#${requestId}`,
      gsi3sk: `REQUEST_META#${requestId}`,
    };

    // Only add submission token fields if we have images to upload
    if (hasImagesToAdd && submissionToken) {
      requestItem.submissionToken = submissionToken;
      requestItem.submissionTokenExpiresAt = tokenExpiresAt.toISOString();
    }

    // If no images to add, set receivedAt immediately
    if (!hasImagesToAdd) {
      requestItem.receivedAt = now;
    }

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: requestItem,
      })
    );

    console.log(`✅ Created LISTING_IMAGE_UPDATE request: ${requestId} (status: ${initialStatus})`, {
      submissionToken: requestItem.submissionToken,
      hasToken: !!requestItem.submissionToken,
      tokenExpiry: requestItem.submissionTokenExpiresAt,
    });

    // 10b. Create token lookup record (if we have images to upload)
    // This allows O(1) token lookup instead of querying with FilterExpression
    if (hasImagesToAdd && submissionToken) {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            pk: `LISTING#${listingId}`,
            sk: `TOKEN#${submissionToken}`,
            requestId,
            listingId,
            hostId,
            tokenType: 'IMAGE_UPDATE_SUBMISSION',
            expiresAt: tokenExpiresAt.toISOString(),
            createdAt: now,
            // TTL for automatic cleanup (30 minutes + 1 hour buffer)
            ttl: expiresAtTimestamp + 3600,
          },
        })
      );

      console.log(`✅ Created token lookup record: TOKEN#${submissionToken}`);
    }

    // 11. Create placeholder image records and generate pre-signed URLs (if adding images)
    const imageUploadUrls: SubmitImageUpdateResponse['imageUploadUrls'] = [];
    const s3Prefix = listing.s3Prefix;

    if (body.imagesToAdd && body.imagesToAdd.length > 0) {
      for (const img of body.imagesToAdd) {
        const s3Key = `lstimg_${img.imageId}.${getFileExtension(img.contentType)}`;
        
        // Create placeholder image record with pendingApproval flag
        await docClient.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: {
              pk: `LISTING#${listingId}`,
              sk: `IMAGE#${img.imageId}`,
              
              listingId,
              imageId: img.imageId,
              hostId,
              
              s3Key,
              finalS3Prefix: `${s3Prefix}images/`,
              
              displayOrder: img.displayOrder,
              isPrimary: img.isPrimary,
              caption: img.caption,
              
              contentType: img.contentType,
              fileSize: 0,
              
              status: 'PENDING_UPLOAD',
              pendingApproval: true, // Key flag: prevents image from appearing in public queries
              
              uploadedAt: now,
              updatedAt: now, // For CloudFront cache versioning
              isDeleted: false,
            },
          })
        );

        // Generate pre-signed URL
        const uploadUrl = await generateUploadUrl(s3Key, img.contentType, UPLOAD_URL_EXPIRY_SECONDS, {
          hostId,
          listingId,
          imageId: img.imageId,
        });
        
        imageUploadUrls.push({
          imageId: img.imageId,
          uploadUrl,
          expiresAt: tokenExpiresAt.toISOString(),
        });
      }

      console.log(`✅ Created ${body.imagesToAdd.length} placeholder image records with pendingApproval=true`);
    }

    // 12. Return response
    const responseData: SubmitImageUpdateResponse = {
      requestId,
      submissionToken: submissionToken, // Will be undefined if no images to add
      expiresAt: submissionToken ? tokenExpiresAt.toISOString() : undefined, // Only include if token exists
      imageUploadUrls: imageUploadUrls.length > 0 ? imageUploadUrls : undefined,
    };

    console.log('Image update request created successfully:', {
      requestId,
      status: initialStatus,
      imagesToAddCount: body.imagesToAdd?.length || 0,
      imagesToDeleteCount: body.imagesToDelete?.length || 0,
      submissionToken: responseData.submissionToken,
      hasToken: !!responseData.submissionToken,
    });

    // 13. Send confirmation email for deletion-only requests (no upload needed)
    if (!hasImagesToAdd) {
      try {
        const { sendListingImageUpdateSubmittedEmail } = await import('../lib/email-service');
        
        // Get host info
        const hostResult = await docClient.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: `HOST#${hostId}`,
              sk: 'META',
            },
          })
        );
        
        if (hostResult.Item) {
          const host = hostResult.Item;
          const hostName = host.hostType === 'INDIVIDUAL'
            ? `${host.forename} ${host.surname}`
            : host.legalName || host.displayName || host.businessName || 'Host';
          const language = host.preferredLanguage === 'sr' || host.preferredLanguage === 'sr-RS' ? 'sr' : 'en';
          
          await sendListingImageUpdateSubmittedEmail(
            host.email,
            language,
            hostName,
            listing.listingName || 'Your Listing'
          );
          
          console.log(`📧 Confirmation email sent to ${host.email} (deletion-only request)`);
        }
      } catch (emailError) {
        console.error('Failed to send confirmation email:', emailError);
        // Don't fail the request if email fails
      }
    }

    return response.success(responseData);

  } catch (error: any) {
    console.error('Submit image update error:', error);
    return response.handleError(error);
  }
}

