/**
 * Create Address Verification Request Lambda Handler
 * Admin endpoint to create an address verification request for a listing
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

import { getAuthContext, assertIsAdmin } from '../../lib/auth';
import * as response from '../../lib/response';
import { generateVerificationCode, encryptVerificationCode, generateAddressVerificationLetter } from '../../../lib/pdf-generator';
import { sendAddressVerificationRequestEmail } from '../../lib/email-service';
import { Request } from '../../../types/request.types';
import { ListingMetadata } from '../../../types/listing.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Create address verification request:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
  });

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

    // 4. Fetch listing details
    const listing = await getListingById(listingId);

    if (!listing) {
      return response.notFound('Listing not found');
    }

    // 5. Fetch host details
    const host = await getHostById(listing.hostId);

    if (!host) {
      return response.notFound('Host not found for this listing');
    }

    // 6. Generate verification code
    const verificationCode = generateVerificationCode();
    const encryptedCode = encryptVerificationCode(verificationCode);

    console.log('Generated verification code (will be encrypted)');

    // 7. Generate PDF letter
    const hostName = host.hostType === 'INDIVIDUAL'
      ? `${host.forename} ${host.surname}`
      : host.legalName || host.displayName;

    const pdfLetterUrl = await generateAddressVerificationLetter(
      {
        hostName,
        businessName: host.hostType === 'BUSINESS' ? (host.legalName || host.displayName) : undefined,
        address: {
          addressLine1: listing.address.street + ' ' + listing.address.streetNumber,
          addressLine2: undefined,
          locality: listing.address.city,
          administrativeArea: listing.address.municipality,
          postalCode: listing.address.postalCode,
          country: listing.address.country,
          countryCode: listing.address.countryCode,
        },
        verificationCode,
        language: host.preferredLanguage === 'sr' || host.preferredLanguage === 'sr-RS' ? 'sr' : 'en',
      },
      listing.hostId,
      listingId,
      `req_${randomUUID()}`
    );

    console.log(`PDF letter generated: ${pdfLetterUrl}`);

    // 8. Create request record
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
      requestType: 'ADDRESS_VERIFICATION',
      status: 'REQUESTED',
      description: {
        en: 'Address Verification - Enter the code sent to your property address',
        sr: 'Verifikacija Adrese - Unesite kod poslat na adresu vaše nekretnine',
      },

      // Address Verification fields
      verificationCode: encryptedCode,
      codeAttempts: 0,
      pdfLetterUrl,
      pdfLetterGeneratedAt: createdAt,

      // Audit Trail
      createdAt,
      updatedAt: createdAt,

      // GSI2: Admin queries (all requests by type/status)
      gsi2pk: `REQUEST#ADDRESS_VERIFICATION`,
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

    console.log(`✅ Address verification request created: ${requestId}`);

    // 9. Send email notification to host
    try {
      const language = host.preferredLanguage === 'sr' || host.preferredLanguage === 'sr-RS' ? 'sr' : 'en';
      const listingAddress = `${listing.address.street} ${listing.address.streetNumber}, ${listing.address.city}`;

      await sendAddressVerificationRequestEmail(
        host.email,
        language,
        hostName,
        listingAddress
      );

      console.log(`✅ Email notification sent to ${host.email}`);
    } catch (emailError: any) {
      // Log error but don't fail the request - request is already created
      console.error('Failed to send email notification (non-fatal):', {
        error: emailError.message,
        hostId: listing.hostId,
      });
    }

    // 10. Return success response (with PDF URL for admin)
    return response.success({
      success: true,
      requestId,
      requestType: 'ADDRESS_VERIFICATION',
      status: 'REQUESTED',
      listingId,
      hostId: listing.hostId,
      pdfLetterUrl,
      createdAt,
      message: 'Address verification request created successfully. PDF letter is ready for download and postal mailing.',
    });

  } catch (error: any) {
    console.error('Create address verification request error:', error);
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

