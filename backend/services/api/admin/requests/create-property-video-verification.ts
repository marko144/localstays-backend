/**
 * Create Property Video Verification Request Lambda Handler
 * Admin endpoint to create a property video verification request for a listing
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

import { getAuthContext, assertIsAdmin } from '../../lib/auth';
import * as response from '../../lib/response';
import { sendVideoVerificationRequestEmail } from '../../lib/email-service';
import { sendTemplatedNotification } from '../../lib/notification-template-service';
import { Request } from '../../../types/request.types';
import { ListingMetadata } from '../../../types/listing.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

interface CreateVideoVerificationRequest {
  notes?: string; // Optional admin notes about what to show in video
}

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Create property video verification request:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
  });
  console.log('Lambda version check: force update');

  try {
    // 1. Extract authentication context
    const auth = getAuthContext(event);
    
    // 2. Verify admin authorization
    assertIsAdmin(auth);

    // 3. Extract listingId from path
    const listingId = event.pathParameters?.listingId;

    if (!listingId) {
      return response.badRequest('listingId is required in path');
    }

    // 4. Parse request body (optional)
    let requestBody: CreateVideoVerificationRequest = {};
    if (event.body) {
      try {
        requestBody = JSON.parse(event.body);
      } catch (error) {
        return response.badRequest('Invalid JSON in request body');
      }
    }

    // 5. Fetch listing details
    const listing = await getListingById(listingId);

    if (!listing) {
      return response.notFound('Listing not found');
    }

    // 6. Fetch host details
    const host = await getHostById(listing.hostId);

    if (!host) {
      return response.notFound('Host not found for this listing');
    }

    // 7. Create request record
    const requestId = `req_${randomUUID()}`;
    const createdAt = new Date().toISOString();

    const requestRecord: Request = {
      // Keys
      pk: `LISTING#${listingId}`,
      sk: `REQUEST#${requestId}`,

      // Identifiers
      requestId,
      hostId: listing.hostId,
      listingId,

      // Request Details
      requestType: 'PROPERTY_VIDEO_VERIFICATION',
      status: 'REQUESTED',
      description: {
        en: 'Property Video Verification - Upload a video tour of your property',
        sr: 'Verifikacija Video Snimka - Otpremite video snimak vaše nekretnine',
      },

      // Admin notes (if provided)
      rejectionReason: requestBody.notes, // Reusing this field for admin notes

      // Audit Trail
      createdAt,
      updatedAt: createdAt,

      // GSI2: Admin queries (all requests by type/status)
      gsi2pk: `REQUEST#PROPERTY_VIDEO_VERIFICATION`,
      gsi2sk: `STATUS#REQUESTED#${createdAt}`,

      // GSI3: Direct lookup by requestId
      gsi3pk: `REQUEST#${requestId}`,
      gsi3sk: `REQUEST_META#${requestId}`,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: requestRecord,
      })
    );

    console.log(`✅ Property video verification request created: ${requestId}`);

    // 8. Send email and push notification to host
    try {
      const hostName = host.hostType === 'INDIVIDUAL'
        ? `${host.forename} ${host.surname}`
        : host.legalName || host.displayName;
      const language = host.preferredLanguage === 'sr' || host.preferredLanguage === 'sr-RS' ? 'sr' : 'en';
      const listingAddress = `${listing.address.street} ${listing.address.streetNumber}, ${listing.address.city}`;

      // Send email notification
      await sendVideoVerificationRequestEmail(
        host.email,
        language,
        hostName,
        listingAddress
      );

      console.log(`✅ Email notification sent to ${host.email}`);

      // Send push notification
      if (host.ownerUserSub) {
        try {
          const pushResult = await sendTemplatedNotification(
            host.ownerUserSub,
            'VIDEO_VERIFICATION_REQUESTED',
            language,
            {
              listingName: listing.listingName,
              listingId: listingId,
            }
          );
          console.log(`📱 Push notification sent: ${pushResult.sent} sent, ${pushResult.failed} failed`);
        } catch (pushError) {
          console.error('Failed to send push notification (non-fatal):', pushError);
          // Don't fail the request if push notification fails
        }
      }
    } catch (emailError: any) {
      // Log error but don't fail the request - request is already created
      console.error('Failed to send email notification (non-fatal):', {
        error: emailError.message,
        hostId: listing.hostId,
      });
    }

    // 9. Return success response
    return response.success({
      success: true,
      requestId,
      requestType: 'PROPERTY_VIDEO_VERIFICATION',
      status: 'REQUESTED',
      listingId,
      hostId: listing.hostId,
      notes: requestBody.notes,
      createdAt,
      message: 'Property video verification request created successfully. Host has been notified.',
    });

  } catch (error: any) {
    console.error('Create property video verification request error:', error);
    return response.handleError(error);
  }
}

/**
 * Get listing by ID using GSI3
 */
async function getListingById(listingId: string): Promise<ListingMetadata | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'DocumentStatusIndex', // GSI3
      KeyConditionExpression: 'gsi3pk = :gsi3pk AND begins_with(gsi3sk, :gsi3sk)',
      ExpressionAttributeValues: {
        ':gsi3pk': `LISTING#${listingId}`,
        ':gsi3sk': 'LISTING_META#',
      },
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0] as ListingMetadata;
}

/**
 * Get host by ID
 */
async function getHostById(hostId: string): Promise<any> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: 'META',
      },
    })
  );

  return result.Item || null;
}




