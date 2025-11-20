/**
 * Admin API: Approve Request
 * 
 * PUT /api/v1/admin/requests/{requestId}/approve
 * 
 * Approves a request (RECEIVED → VERIFIED).
 * Sends approval email notification.
 * Permission required: ADMIN_REQUEST_APPROVE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { Request } from '../../../types/request.types';
import { Host, isIndividualHost } from '../../../types/host.types';
import { ListingImage, ListingMetadata } from '../../../types/listing.types';
import { sendRequestApprovedEmail, sendVideoVerificationApprovedEmail, sendAddressVerificationApprovedEmail } from '../../lib/email-service';
import { buildPublicListingMediaPK, buildPublicListingMediaSK } from '../../../types/public-listing-media.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;
const PUBLIC_LISTINGS_TABLE_NAME = process.env.PUBLIC_LISTINGS_TABLE_NAME!;
const PUBLIC_LISTING_MEDIA_TABLE_NAME = process.env.PUBLIC_LISTING_MEDIA_TABLE_NAME!;

/**
 * Find request by requestId using GSI3 (DocumentStatusIndex)
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
 * Process image update approval with transactional updates to public tables if listing is ONLINE
 */
async function processImageUpdateApproval(request: Request): Promise<void> {
  if (!request.listingId) {
    throw new Error('listingId is required for LISTING_IMAGE_UPDATE');
  }

  const now = new Date().toISOString();

  // Step 1: Fetch listing to check if it's ONLINE
  const listingResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${request.hostId}`,
        sk: `LISTING_META#${request.listingId}`,
      },
    })
  );

  if (!listingResult.Item) {
    throw new Error(`Listing not found: ${request.listingId}`);
  }

  const listing = listingResult.Item as ListingMetadata;
  const isOnline = listing.status === 'ONLINE';

  console.log(`Listing ${request.listingId} status: ${listing.status}, isOnline: ${isOnline}`);

  // Step 2: Fetch images to delete (need S3 keys for cleanup AFTER transaction)
  const imagesToDeleteData: ListingImage[] = [];
  if (request.imagesToDelete && request.imagesToDelete.length > 0) {
    for (const imageId of request.imagesToDelete) {
      const imageResult = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `LISTING#${request.listingId}`,
            sk: `IMAGE#${imageId}`,
          },
        })
      );

      if (imageResult.Item) {
        imagesToDeleteData.push(imageResult.Item as ListingImage);
      }
    }
  }

  // Step 3: Decide transaction or standard update based on listing status
  if (isOnline) {
    // ONLINE listing: Use transaction
    console.log('🔄 Listing is ONLINE, using transactional update...');
    await updateImagesWithTransaction(request, listing, now, imagesToDeleteData);
  } else {
    // NOT ONLINE: Standard update to main table only
    console.log('📝 Listing is not ONLINE, updating main table only...');
    await updateImagesStandard(request, now);
  }

  // Step 4: Delete S3 files AFTER successful DynamoDB update
  // This ensures we never have orphaned DB records pointing to missing S3 files
  console.log('🗑️ Cleaning up S3 files for deleted images...');
  for (const image of imagesToDeleteData) {
    const deletePromises = [];

    // Delete original file
    if (image.s3Key) {
      deletePromises.push(
        s3Client.send(new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: image.s3Key,
        })).catch(err => console.error(`Failed to delete ${image.s3Key}:`, err))
      );
    }

    // Delete WebP files if they exist
    if (image.webpUrls) {
      const fullKey = image.webpUrls.full.split('.amazonaws.com/')[1] || image.webpUrls.full;
      const thumbKey = image.webpUrls.thumbnail.split('.amazonaws.com/')[1] || image.webpUrls.thumbnail;

      deletePromises.push(
        s3Client.send(new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: fullKey,
        })).catch(err => console.error(`Failed to delete ${fullKey}:`, err))
      );

      deletePromises.push(
        s3Client.send(new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: thumbKey,
        })).catch(err => console.error(`Failed to delete ${thumbKey}:`, err))
      );
    }

    await Promise.all(deletePromises);
    console.log(`✅ Deleted S3 files for image: ${image.imageId}`);
  }
}

/**
 * Standard (non-transactional) image update for non-ONLINE listings
 */
async function updateImagesStandard(request: Request, now: string): Promise<void> {
  // Check if any new image is marked as primary - if so, clear old primary first
  if (request.imagesToAdd && request.imagesToAdd.length > 0) {
    // Fetch newly added images to check if any is primary
    const newImageChecks = await Promise.all(
      request.imagesToAdd.map(imageId =>
        docClient.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: `LISTING#${request.listingId}`,
              sk: `IMAGE#${imageId}`,
            },
          })
        )
      )
    );

    const hasNewPrimary = newImageChecks.some(result => result.Item?.isPrimary);

    if (hasNewPrimary) {
      console.log('New primary image detected, clearing old primary...');
      
      // Fetch all current images to find the old primary
      const allImagesResult = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          FilterExpression: '#status = :ready AND isDeleted = :notDeleted',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':pk': `LISTING#${request.listingId}`,
            ':sk': 'IMAGE#',
            ':ready': 'READY',
            ':notDeleted': false,
          },
        })
      );

      // Find old primary (excluding the new ones being added)
      const oldPrimaryImage = (allImagesResult.Items || []).find(
        (img: any) => img.isPrimary && !request.imagesToAdd?.includes(img.imageId)
      );

      // Only clear old primary if it's NOT being deleted
      // (If it's being deleted, we'll already have a Delete operation on it in the transaction)
      if (oldPrimaryImage && !request.imagesToDelete?.includes(oldPrimaryImage.imageId)) {
        console.log(`Clearing isPrimary flag from old primary: ${oldPrimaryImage.imageId}`);
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: `LISTING#${request.listingId}`,
              sk: `IMAGE#${oldPrimaryImage.imageId}`,
            },
            UpdateExpression: 'SET isPrimary = :false, updatedAt = :now',
            ExpressionAttributeValues: {
              ':false': false,
              ':now': now,
            },
          })
        );
      } else if (oldPrimaryImage) {
        console.log(`Old primary image ${oldPrimaryImage.imageId} is being deleted, skipping isPrimary clear`);
      }
    }
  }

  // Approve new images (remove pendingApproval flag)
  if (request.imagesToAdd && request.imagesToAdd.length > 0) {
    for (const imageId of request.imagesToAdd) {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `LISTING#${request.listingId}`,
            sk: `IMAGE#${imageId}`,
          },
          UpdateExpression: 'REMOVE pendingApproval SET updatedAt = :now',
          ExpressionAttributeValues: {
            ':now': now,
          },
        })
      );
      console.log(`✅ Approved new image: ${imageId}`);
    }
  }

  // Mark images as deleted
  if (request.imagesToDelete && request.imagesToDelete.length > 0) {
    for (const imageId of request.imagesToDelete) {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `LISTING#${request.listingId}`,
            sk: `IMAGE#${imageId}`,
          },
          UpdateExpression: 'SET isDeleted = :true, deletedAt = :now, updatedAt = :now',
          ExpressionAttributeValues: {
            ':true': true,
            ':now': now,
          },
        })
      );
      console.log(`✅ Marked image as deleted: ${imageId}`);
    }
  }

  // Handle primary image change if newPrimaryImageId is provided
  if (request.newPrimaryImageId) {
    console.log(`Changing primary image to: ${request.newPrimaryImageId}`);
    
    // First, fetch ALL current images to find the old primary
    const allImagesForPrimaryChange = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: '#status = :ready AND isDeleted = :notDeleted',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':pk': `LISTING#${request.listingId}`,
          ':sk': 'IMAGE#',
          ':ready': 'READY',
          ':notDeleted': false,
        },
      })
    );

    // Find and clear the old primary image
    const oldPrimaryImage = (allImagesForPrimaryChange.Items || []).find(
      (img: any) => img.isPrimary && img.imageId !== request.newPrimaryImageId
    );

    // Only clear old primary if it's NOT being deleted
    if (oldPrimaryImage && !request.imagesToDelete?.includes(oldPrimaryImage.imageId)) {
      console.log(`Clearing isPrimary flag from old primary: ${oldPrimaryImage.imageId}`);
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `LISTING#${request.listingId}`,
            sk: `IMAGE#${oldPrimaryImage.imageId}`,
          },
          UpdateExpression: 'SET isPrimary = :false, updatedAt = :now',
          ExpressionAttributeValues: {
            ':false': false,
            ':now': now,
          },
        })
      );
    } else if (oldPrimaryImage) {
      console.log(`Old primary image ${oldPrimaryImage.imageId} is being deleted, skipping isPrimary clear`);
    }

    // Set the new primary image
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `LISTING#${request.listingId}`,
          sk: `IMAGE#${request.newPrimaryImageId}`,
        },
        UpdateExpression: 'SET isPrimary = :true, updatedAt = :now',
        ExpressionAttributeValues: {
          ':true': true,
          ':now': now,
        },
      })
    );

    console.log(`✅ Changed primary image to: ${request.newPrimaryImageId}`);
  }
}

/**
 * Transactional image update for ONLINE listings
 * Updates main table + PublicListings + PublicListingMedia atomically
 */
async function updateImagesWithTransaction(
  request: Request,
  listing: ListingMetadata,
  now: string,
  _imagesToDeleteData: ListingImage[]
): Promise<void> {
  const transactItems: any[] = [];

  // 0. Check if any new image is marked as primary - if so, clear old primary first
  if (request.imagesToAdd && request.imagesToAdd.length > 0) {
    // Fetch newly added images to check if any is primary
    const newImageChecks = await Promise.all(
      request.imagesToAdd.map(imageId =>
        docClient.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: `LISTING#${request.listingId}`,
              sk: `IMAGE#${imageId}`,
            },
          })
        )
      )
    );

    const hasNewPrimary = newImageChecks.some(result => result.Item?.isPrimary);

    if (hasNewPrimary) {
      console.log('New primary image detected, clearing old primary...');
      
      // Fetch all current images to find the old primary
      const allImagesResult = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          FilterExpression: '#status = :ready AND isDeleted = :notDeleted',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':pk': `LISTING#${request.listingId}`,
            ':sk': 'IMAGE#',
            ':ready': 'READY',
            ':notDeleted': false,
          },
        })
      );

      // Find old primary (excluding the new ones being added)
      const oldPrimaryImage = (allImagesResult.Items || []).find(
        (img: any) => img.isPrimary && !request.imagesToAdd?.includes(img.imageId)
      );

      // Only clear old primary if it's NOT being deleted
      // (If it's being deleted, we'll already have a Delete operation on it in the transaction)
      if (oldPrimaryImage && !request.imagesToDelete?.includes(oldPrimaryImage.imageId)) {
        console.log(`Clearing isPrimary flag from old primary: ${oldPrimaryImage.imageId}`);
        transactItems.push({
          Update: {
            TableName: TABLE_NAME,
            Key: {
              pk: `LISTING#${request.listingId}`,
              sk: `IMAGE#${oldPrimaryImage.imageId}`,
            },
            UpdateExpression: 'SET isPrimary = :false, updatedAt = :now',
            ExpressionAttributeValues: {
              ':false': false,
              ':now': now,
            },
          },
        });
      } else if (oldPrimaryImage) {
        console.log(`Old primary image ${oldPrimaryImage.imageId} is being deleted, skipping isPrimary clear`);
      }
    }
  }

  // 1. Approve new images (remove pendingApproval flag)
  if (request.imagesToAdd && request.imagesToAdd.length > 0) {
    for (const imageId of request.imagesToAdd) {
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: {
            pk: `LISTING#${request.listingId}`,
            sk: `IMAGE#${imageId}`,
          },
          UpdateExpression: 'REMOVE pendingApproval SET updatedAt = :now',
          ExpressionAttributeValues: {
            ':now': now,
          },
        },
      });
    }
  }

  // 2. Mark images as deleted
  if (request.imagesToDelete && request.imagesToDelete.length > 0) {
    for (const imageId of request.imagesToDelete) {
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: {
            pk: `LISTING#${request.listingId}`,
            sk: `IMAGE#${imageId}`,
          },
          UpdateExpression: 'SET isDeleted = :true, deletedAt = :now, updatedAt = :now',
          ExpressionAttributeValues: {
            ':true': true,
            ':now': now,
          },
        },
      });
    }
  }

  // 2b. Handle primary image change if newPrimaryImageId is provided
  if (request.newPrimaryImageId) {
    console.log(`Changing primary image to: ${request.newPrimaryImageId}`);
    
    // First, fetch ALL current images to find the old primary
    const allImagesForPrimaryChange = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: '#status = :ready AND isDeleted = :notDeleted',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':pk': `LISTING#${request.listingId}`,
          ':sk': 'IMAGE#',
          ':ready': 'READY',
          ':notDeleted': false,
        },
      })
    );

    // Find and clear the old primary image
    const oldPrimaryImage = (allImagesForPrimaryChange.Items || []).find(
      (img: any) => img.isPrimary && img.imageId !== request.newPrimaryImageId
    );

    // Only clear old primary if it's NOT being deleted
    if (oldPrimaryImage && !request.imagesToDelete?.includes(oldPrimaryImage.imageId)) {
      console.log(`Clearing isPrimary flag from old primary: ${oldPrimaryImage.imageId}`);
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: {
            pk: `LISTING#${request.listingId}`,
            sk: `IMAGE#${oldPrimaryImage.imageId}`,
          },
          UpdateExpression: 'SET isPrimary = :false, updatedAt = :now',
          ExpressionAttributeValues: {
            ':false': false,
            ':now': now,
          },
        },
      });
    } else if (oldPrimaryImage) {
      console.log(`Old primary image ${oldPrimaryImage.imageId} is being deleted, skipping isPrimary clear`);
    }

    // Set the new primary image
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: {
          pk: `LISTING#${request.listingId}`,
          sk: `IMAGE#${request.newPrimaryImageId}`,
        },
        UpdateExpression: 'SET isPrimary = :true, updatedAt = :now',
        ExpressionAttributeValues: {
          ':true': true,
          ':now': now,
        },
      },
    });
  }

  // 3. Fetch ALL current images (after updates) to rebuild public tables
  const allImagesResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      FilterExpression: '#status = :ready AND isDeleted = :notDeleted',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':pk': `LISTING#${request.listingId}`,
        ':sk': 'IMAGE#',
        ':ready': 'READY',
        ':notDeleted': false,
      },
    })
  );

  // Filter out images that will be deleted and images still pending approval
  let currentImages = (allImagesResult.Items || [])
    .filter((img: any) => {
      // Exclude images being deleted
      if (request.imagesToDelete?.includes(img.imageId)) {
        return false;
      }
      // Exclude images still pending approval (not in imagesToAdd)
      if (img.pendingApproval && !request.imagesToAdd?.includes(img.imageId)) {
        return false;
      }
      return true;
    });

  console.log(`Found ${currentImages.length} active images after update`);

  // Sort images: Primary image first, then by displayOrder
  const primaryImage = currentImages.find((img: any) => img.isPrimary);
  const nonPrimaryImages = currentImages
    .filter((img: any) => !img.isPrimary)
    .sort((a: any, b: any) => a.displayOrder - b.displayOrder);

  // Reorder: primary image at index 0, others follow
  currentImages = primaryImage 
    ? [primaryImage, ...nonPrimaryImages]
    : nonPrimaryImages;

  console.log(`Primary image: ${primaryImage?.imageId || 'none'}`);

  // 4. Update PublicListings table (update thumbnail if primary image changed)
  if (primaryImage && primaryImage.webpUrls?.thumbnail) {
    const placeId = listing.mapboxMetadata?.place?.mapbox_id;

    if (placeId) {
      // Fetch current public listing to preserve other fields
      const publicListingResult = await docClient.send(
        new GetCommand({
          TableName: PUBLIC_LISTINGS_TABLE_NAME,
          Key: {
            pk: `LOCATION#${placeId}`,
            sk: `LISTING#${request.listingId}`,
          },
        })
      );

      if (publicListingResult.Item) {
        const publicListing = publicListingResult.Item;
        publicListing.thumbnailUrl = primaryImage.webpUrls.thumbnail;
        publicListing.updatedAt = now;

        transactItems.push({
          Put: {
            TableName: PUBLIC_LISTINGS_TABLE_NAME,
            Item: publicListing,
          },
        });
      }
    }
  }

  // 5. Fetch existing PublicListingMedia records to identify what needs to be deleted
  const existingMediaResult = await docClient.send(
    new QueryCommand({
      TableName: PUBLIC_LISTING_MEDIA_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': buildPublicListingMediaPK(request.listingId!),
      },
    })
  );

  const existingMediaKeys = new Set(
    (existingMediaResult.Items || []).map((item) => item.sk)
  );

  // 6. Create/update all current images with correct imageIndex
  // Primary image (isPrimary: true) will be at index 0, all others follow
  const newMediaKeys = new Set<string>();
  
  currentImages.forEach((image: any, index: number) => {
    if (image.webpUrls && image.status === 'READY') {
      const sk = buildPublicListingMediaSK(index);
      newMediaKeys.add(sk);
      
      transactItems.push({
        Put: {
          TableName: PUBLIC_LISTING_MEDIA_TABLE_NAME,
          Item: {
            pk: buildPublicListingMediaPK(request.listingId!),
            sk: sk,

            listingId: request.listingId,
            imageIndex: index,

            url: image.webpUrls.full,
            thumbnailUrl: image.webpUrls.thumbnail,

            caption: image.caption || undefined,
            isCoverImage: image.isPrimary || false, // Use isPrimary field

            createdAt: image.createdAt,
            updatedAt: now,
          },
        },
      });
    }
  });

  // 7. Delete media records that no longer exist (images that were removed)
  existingMediaKeys.forEach((sk) => {
    if (!newMediaKeys.has(sk)) {
      transactItems.push({
        Delete: {
          TableName: PUBLIC_LISTING_MEDIA_TABLE_NAME,
          Key: {
            pk: buildPublicListingMediaPK(request.listingId!),
            sk: sk,
          },
        },
      });
    }
  });

  // 8. Execute transaction
  console.log(`Executing transaction with ${transactItems.length} items`);

  if (transactItems.length > 100) {
    throw new Error(`Transaction size exceeds limit: ${transactItems.length} items (max 100)`);
  }

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: transactItems,
    })
  );

  console.log('✅ Transaction complete: Images updated across all tables atomically');
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Approve request request:', { pathParameters: event.pathParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_REQUEST_APPROVE');
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

    console.log(`Admin ${user.email} approving request: ${requestId}`);

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

    // 4. Validate current status
    if (request.status !== 'RECEIVED' && request.status !== 'PENDING_REVIEW') {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            message: `Cannot approve request with status ${request.status}. Expected RECEIVED or PENDING_REVIEW.`,
          },
        }),
      };
    }

    // 5. Handle LISTING_IMAGE_UPDATE specific logic
    if (request.requestType === 'LISTING_IMAGE_UPDATE') {
      console.log('Processing LISTING_IMAGE_UPDATE approval...');
      
      await processImageUpdateApproval(request);
      
      console.log('✅ LISTING_IMAGE_UPDATE processing complete');
    }

    // 6. Update request status
    const now = new Date().toISOString();

    // Determine pk based on request type (host-level vs listing-level)
    const pk = request.listingId ? `LISTING#${request.listingId}` : `HOST#${request.hostId}`;

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk,
          sk: `REQUEST#${requestId}`,
        },
        UpdateExpression: `
          SET #status = :status,
              #reviewedAt = :reviewedAt,
              #reviewedBy = :reviewedBy,
              #updatedAt = :updatedAt,
              #gsi2sk = :gsi2sk
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#reviewedAt': 'reviewedAt',
          '#reviewedBy': 'reviewedBy',
          '#updatedAt': 'updatedAt',
          '#gsi2sk': 'gsi2sk',
        },
        ExpressionAttributeValues: {
          ':status': 'VERIFIED',
          ':reviewedAt': now,
          ':reviewedBy': user.sub,
          ':updatedAt': now,
          ':gsi2sk': `STATUS#VERIFIED#${now}`,
        },
      })
    );

    console.log(`✅ Request ${requestId} approved successfully`);

    // 7. Send approval email
    try {
      // Fetch host details for email
      const hostResult = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND sk = :sk',
          ExpressionAttributeValues: {
            ':pk': `HOST#${request.hostId}`,
            ':sk': 'META',
          },
        })
      );
      
      const host = hostResult.Items?.[0] as Host;
      if (host) {
        const hostName = isIndividualHost(host)
          ? `${host.forename} ${host.surname}`
          : host.legalName || host.displayName || host.businessName || 'Host';
        
        const language = host.preferredLanguage === 'sr' || host.preferredLanguage === 'sr-RS' ? 'sr' : 'en';
        
        // Send appropriate email based on request type
        if (request.requestType === 'PROPERTY_VIDEO_VERIFICATION') {
          await sendVideoVerificationApprovedEmail(
            host.email,
            language,
            hostName,
            '' // listing address not needed for approval
          );
        } else if (request.requestType === 'ADDRESS_VERIFICATION') {
          await sendAddressVerificationApprovedEmail(
            host.email,
            language,
            hostName,
            ''
          );
        } else if (request.requestType === 'LISTING_IMAGE_UPDATE') {
          // Send image update approval email
          const { sendListingImageUpdateApprovedEmail } = await import('../../lib/email-service');
          
          // Get listing name
          const listingResult = await docClient.send(
            new GetCommand({
              TableName: TABLE_NAME,
              Key: {
                pk: `HOST#${request.hostId}`,
                sk: `LISTING_META#${request.listingId}`,
              },
            })
          );
          
          const listingName = listingResult.Item?.listingName || 'Your Listing';
          
          await sendListingImageUpdateApprovedEmail(
            host.email,
            language,
            hostName,
            listingName
          );
        } else {
          // Default to generic request approved email (for LIVE_ID_CHECK)
          await sendRequestApprovedEmail(
            host.email,
            language,
            hostName
          );
        }
        console.log(`📧 Approval email sent to ${host.email}`);
      }
    } catch (emailError) {
      console.error('Failed to send approval email:', emailError);
      // Don't fail the request if email fails
    }

    // 8. Log admin action
    logAdminAction(user, 'APPROVE_REQUEST', 'REQUEST', requestId, {
      hostId: request.hostId,
      requestType: request.requestType,
    });

    // 9. Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Request approved successfully',
      }),
    };
  } catch (error) {
    console.error('❌ Approve request error:', error);

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
          message: 'Failed to approve request',
        },
      }),
    };
  }
};

