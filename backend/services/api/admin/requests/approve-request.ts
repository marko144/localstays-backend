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
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { Request } from '../../../types/request.types';
import { Host, isIndividualHost } from '../../../types/host.types';
import { ListingImage } from '../../../types/listing.types';
import { sendRequestApprovedEmail, sendVideoVerificationApprovedEmail, sendAddressVerificationApprovedEmail } from '../../lib/email-service';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;

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
      
      // 5a. Remove pendingApproval flag from new images
      if (request.imagesToAdd && request.imagesToAdd.length > 0) {
        for (const imageId of request.imagesToAdd) {
          try {
            await docClient.send(
              new UpdateCommand({
                TableName: TABLE_NAME,
                Key: {
                  pk: `LISTING#${request.listingId}`,
                  sk: `IMAGE#${imageId}`,
                },
                UpdateExpression: 'REMOVE pendingApproval SET updatedAt = :now',
                ExpressionAttributeValues: {
                  ':now': new Date().toISOString(),
                },
              })
            );
            console.log(`✅ Approved new image: ${imageId}`);
          } catch (error) {
            console.error(`Failed to approve image ${imageId}:`, error);
            // Continue with other images
          }
        }
      }

      // 5b. Delete images marked for deletion
      if (request.imagesToDelete && request.imagesToDelete.length > 0) {
        for (const imageId of request.imagesToDelete) {
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

              // Delete from S3 (original, full WebP, thumbnail WebP)
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

              // Mark as deleted in DynamoDB
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
                    ':now': new Date().toISOString(),
                  },
                })
              );

              console.log(`✅ Deleted image: ${imageId}`);
            }
          } catch (error) {
            console.error(`Failed to delete image ${imageId}:`, error);
            // Continue with other images
          }
        }
      }

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

