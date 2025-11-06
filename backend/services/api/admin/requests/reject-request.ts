/**
 * Admin API: Reject Request
 * 
 * PUT /api/v1/admin/requests/{requestId}/reject
 * Body: { rejectionReason: string }
 * 
 * Rejects a request (RECEIVED → REJECTED).
 * Sends rejection email notification with reason.
 * Permission required: ADMIN_REQUEST_REJECT
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { Request } from '../../../types/request.types';
import { RejectRequestRequest } from '../../../types/admin.types';
import { Host, isIndividualHost } from '../../../types/host.types';
import { ListingImage } from '../../../types/listing.types';
import { sendRequestRejectedEmail, sendVideoVerificationRejectedEmail, sendAddressVerificationRejectedEmail } from '../../lib/email-service';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;
const MAX_REJECTION_REASON_LENGTH = 500;

/**
 * Validate request body
 */
function validateRequest(body: any): { valid: boolean; error?: string } {
  if (!body) {
    return { valid: false, error: 'Request body is required' };
  }

  if (!body.rejectionReason || typeof body.rejectionReason !== 'string') {
    return { valid: false, error: 'rejectionReason is required and must be a string' };
  }

  const trimmedReason = body.rejectionReason.trim();

  if (trimmedReason.length === 0) {
    return { valid: false, error: 'rejectionReason cannot be empty' };
  }

  if (trimmedReason.length > MAX_REJECTION_REASON_LENGTH) {
    return { 
      valid: false, 
      error: `rejectionReason must be ${MAX_REJECTION_REASON_LENGTH} characters or less` 
    };
  }

  return { valid: true };
}

/**
 * Find request by requestId
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
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Reject request request:', { 
    pathParameters: event.pathParameters,
    body: event.body ? JSON.parse(event.body) : null,
  });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_REQUEST_REJECT');
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

    // 3. Parse and validate request body
    let body: RejectRequestRequest;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (error) {
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
            message: 'Invalid JSON in request body',
          },
        }),
      };
    }

    const validation = validateRequest(body);
    if (!validation.valid) {
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
            message: validation.error,
          },
        }),
      };
    }

    const rejectionReason = body.rejectionReason.trim();

    console.log(`Admin ${user.email} rejecting request: ${requestId}`);

    // 4. Find request
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

    // 5. Validate current status
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
            message: `Cannot reject request with status ${request.status}. Expected RECEIVED or PENDING_REVIEW.`,
          },
        }),
      };
    }

    // 6. Handle LISTING_IMAGE_UPDATE specific logic
    if (request.requestType === 'LISTING_IMAGE_UPDATE') {
      console.log('Processing LISTING_IMAGE_UPDATE rejection...');
      
      // 6a. Delete pending images (imagesToAdd) from DynamoDB and S3
      if (request.imagesToAdd && request.imagesToAdd.length > 0) {
        for (const imageId of request.imagesToAdd) {
          try {
            // Fetch image record to get S3 keys
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
              const image = imageResult.Item as ListingImage;

              // Delete from S3 (original, full WebP, thumbnail WebP if they exist)
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

              // Delete WebP files if they exist (may have been processed before rejection)
              if (image.webpUrls) {
                const fullKey = image.webpUrls.full.split('.amazonaws.com/')[1];
                const thumbKey = image.webpUrls.thumbnail.split('.amazonaws.com/')[1];
                
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

              // Delete image record from DynamoDB
              await docClient.send(
                new DeleteCommand({
                  TableName: TABLE_NAME,
                  Key: {
                    pk: `LISTING#${request.listingId}`,
                    sk: `IMAGE#${imageId}`,
                  },
                })
              );

              console.log(`✅ Deleted pending image: ${imageId}`);
            }
          } catch (error) {
            console.error(`Failed to delete pending image ${imageId}:`, error);
            // Continue with other images
          }
        }
      }

      // 6b. Keep existing images (imagesToDelete) - do nothing, they remain unchanged
      console.log('✅ LISTING_IMAGE_UPDATE rejection complete - existing images preserved');
    }

    // 7. Update request status with rejection reason
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
              #rejectionReason = :rejectionReason,
              #updatedAt = :updatedAt,
              #gsi2sk = :gsi2sk
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#reviewedAt': 'reviewedAt',
          '#reviewedBy': 'reviewedBy',
          '#rejectionReason': 'rejectionReason',
          '#updatedAt': 'updatedAt',
          '#gsi2sk': 'gsi2sk',
        },
        ExpressionAttributeValues: {
          ':status': 'REJECTED',
          ':reviewedAt': now,
          ':reviewedBy': user.sub,
          ':rejectionReason': rejectionReason,
          ':updatedAt': now,
          ':gsi2sk': `STATUS#REJECTED#${now}`,
        },
      })
    );

    console.log(`✅ Request ${requestId} rejected successfully`);

    // 8. Send rejection email
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
          await sendVideoVerificationRejectedEmail(
            host.email,
            language,
            hostName,
            rejectionReason
          );
        } else if (request.requestType === 'ADDRESS_VERIFICATION') {
          await sendAddressVerificationRejectedEmail(
            host.email,
            language,
            hostName
          );
        } else if (request.requestType === 'LISTING_IMAGE_UPDATE') {
          // Send image update rejection email
          const { sendListingImageUpdateRejectedEmail } = await import('../../lib/email-service');
          
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
          
          await sendListingImageUpdateRejectedEmail(
            host.email,
            language,
            hostName,
            listingName,
            rejectionReason
          );
        } else {
          // Default to generic request rejected email (for LIVE_ID_CHECK)
          await sendRequestRejectedEmail(
            host.email,
            language,
            hostName,
            rejectionReason
          );
        }
        console.log(`📧 Rejection email sent to ${host.email}`);
      }
    } catch (emailError) {
      console.error('Failed to send rejection email:', emailError);
      // Don't fail the request if email fails
    }

    // 9. Log admin action
    logAdminAction(user, 'REJECT_REQUEST', 'REQUEST', requestId, {
      hostId: request.hostId,
      requestType: request.requestType,
      rejectionReason,
    });

    // 10. Return success response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Request rejected successfully',
      }),
    };
  } catch (error) {
    console.error('❌ Reject request error:', error);

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
          message: 'Failed to reject request',
        },
      }),
    };
  }
};

