/**
 * Host API: Confirm Image Update Submission
 * 
 * POST /api/v1/hosts/{hostId}/listings/{listingId}/image-update/confirm
 * 
 * Confirms that new images have been uploaded to S3.
 * Updates request status from REQUESTED to RECEIVED.
 * Updates image records from PENDING_UPLOAD to PENDING_SCAN.
 * 
 * Note: Images remain with pendingApproval=true until admin approves the request.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { ConfirmImageUpdateRequest, ConfirmImageUpdateResponse, Request } from '../../types/request.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Main handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Confirm image update request:', {
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

    // 2. Parse request body
    if (!event.body) {
      return response.badRequest('Request body is required');
    }

    const body: ConfirmImageUpdateRequest = JSON.parse(event.body);

    if (!body.submissionToken) {
      return response.badRequest('submissionToken is required');
    }

    // 3. Lookup token record (O(1) operation)
    console.log('Looking up token record:', {
      listingId,
      submissionToken: body.submissionToken,
      pk: `LISTING#${listingId}`,
      sk: `TOKEN#${body.submissionToken}`,
    });

    const tokenResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `LISTING#${listingId}`,
          sk: `TOKEN#${body.submissionToken}`,
        },
      })
    );

    if (!tokenResult.Item) {
      console.error('Token lookup record not found');
      return response.unauthorized('Invalid or expired submission token');
    }

    const tokenData = tokenResult.Item;
    const requestId = tokenData.requestId;

    console.log('✅ Found token record:', {
      requestId,
      tokenType: tokenData.tokenType,
      expiresAt: tokenData.expiresAt,
    });

    // 4. Validate token hasn't expired
    if (new Date(tokenData.expiresAt) < new Date()) {
      console.error('Token has expired:', tokenData.expiresAt);
      return response.unauthorized('Submission token has expired');
    }

    // 5. Verify token matches the host
    if (tokenData.hostId !== hostId) {
      console.error('Token hostId mismatch:', {
        tokenHostId: tokenData.hostId,
        requestHostId: hostId,
      });
      return response.unauthorized('Token does not match request context');
    }

    // 6. Fetch the actual request record
    const requestResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `LISTING#${listingId}`,
          sk: `REQUEST#${requestId}`,
        },
      })
    );

    if (!requestResult.Item) {
      console.error('Request not found:', requestId);
      return response.notFound('Request not found');
    }

    const request = requestResult.Item as Request;

    // 7. Validate request status
    if (request.status !== 'REQUESTED') {
      console.error('Request already processed:', {
        requestId,
        currentStatus: request.status,
      });
      return response.badRequest(`Request already processed. Current status: ${request.status}`);
    }

    const now = new Date().toISOString();

    // 8. Update request status to RECEIVED
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `LISTING#${listingId}`,
          sk: `REQUEST#${requestId}`,
        },
        UpdateExpression: `
          SET #status = :status,
              updatedAt = :now,
              gsi2sk = :gsi2sk
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'RECEIVED',
          ':now': now,
          ':gsi2sk': `STATUS#RECEIVED#${request.createdAt}`,
        },
      })
    );

    console.log(`✅ Updated request ${requestId} status: REQUESTED → RECEIVED`);

    // 9. Delete the token lookup record (cleanup)
    try {
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `LISTING#${listingId}`,
            sk: `TOKEN#${body.submissionToken}`,
          },
        })
      );
      console.log(`✅ Deleted token lookup record: TOKEN#${body.submissionToken}`);
    } catch (error) {
      // Non-critical error - token will be cleaned up by TTL anyway
      console.warn('Failed to delete token lookup record:', error);
    }

    // 10. Update image records from PENDING_UPLOAD to PENDING_SCAN (if any images were added)
    if (request.imagesToAdd && request.imagesToAdd.length > 0) {
      for (const imageId of request.imagesToAdd) {
        try {
          await docClient.send(
            new UpdateCommand({
              TableName: TABLE_NAME,
              Key: {
                pk: `LISTING#${listingId}`,
                sk: `IMAGE#${imageId}`,
              },
              UpdateExpression: `
                SET #status = :status,
                    updatedAt = :now
              `,
              ConditionExpression: '#status = :pendingUpload',
              ExpressionAttributeNames: {
                '#status': 'status',
              },
              ExpressionAttributeValues: {
                ':status': 'PENDING_SCAN',
                ':pendingUpload': 'PENDING_UPLOAD',
                ':now': now,
              },
            })
          );
          
          console.log(`✅ Updated image ${imageId}: PENDING_UPLOAD → PENDING_SCAN`);
        } catch (error: any) {
          if (error.name === 'ConditionalCheckFailedException') {
            console.warn(`⚠️  Image ${imageId} not in PENDING_UPLOAD state, skipping`);
          } else {
            throw error;
          }
        }
      }
    }

    // 11. Send confirmation email to host 
    console.log('🔵 Starting email sending process...');
    try {
      console.log('🔵 Importing email service...');
      const { sendListingImageUpdateSubmittedEmail } = await import('../lib/email-service');
      console.log('🔵 Email service imported successfully');
      
      // Get host info
      console.log('🔵 Fetching host info...');
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
        console.log('🔵 Host found, preparing email...');
        const host = hostResult.Item;
        const hostName = host.hostType === 'INDIVIDUAL'
          ? `${host.forename} ${host.surname}`
          : host.legalName || host.displayName || host.businessName || 'Host';
        const language = host.preferredLanguage === 'sr' || host.preferredLanguage === 'sr-RS' ? 'sr' : 'en';
        
        // Get listing name
        console.log('🔵 Fetching listing name...');
        const listingResult = await docClient.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: `HOST#${hostId}`,
              sk: `LISTING_META#${listingId}`,
            },
          })
        );
        
        const listingName = listingResult.Item?.listingName || 'Your Listing';
        
        console.log('🔵 Sending email...', { email: host.email, language, hostName, listingName });
        await sendListingImageUpdateSubmittedEmail(
          host.email,
          language,
          hostName,
          listingName
        );
        
        console.log(`📧 Confirmation email sent to ${host.email}`);
      } else {
        console.warn('⚠️  Host not found, skipping email');
      }
    } catch (emailError) {
      console.error('❌ Failed to send confirmation email:', emailError);
      console.error('❌ Email error stack:', (emailError as Error).stack);
      // Don't fail the request if email fails
    }

    // 12. Return response
    const responseData: ConfirmImageUpdateResponse = {
      requestId,
      status: 'RECEIVED',
      message: 'Image update request submitted successfully. Your changes are now pending admin review.',
    };

    console.log('Image update confirmed successfully:', {
      requestId,
      imagesUpdated: request.imagesToAdd?.length || 0,
    });

    return response.success(responseData);

  } catch (error: any) {
    console.error('Confirm image update error:', error);
    return response.handleError(error);
  }
}

