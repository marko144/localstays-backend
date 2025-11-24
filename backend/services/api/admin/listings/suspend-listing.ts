/**
 * Admin API: Suspend Listing
 * 
 * PUT /api/v1/admin/listings/{listingId}/suspend
 * Body: { lockReason: string }
 * 
 * Suspends/locks a listing (ONLINE or APPROVED → LOCKED).
 * Sends suspension email notification with reason.
 * Permission required: ADMIN_LISTING_SUSPEND
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { ListingMetadata } from '../../../types/listing.types';
import { SuspendListingRequest } from '../../../types/admin.types';
import { Host, isIndividualHost } from '../../../types/host.types';
import { sendListingSuspendedEmail } from '../../lib/email-service';
import { buildPublicListingMediaPK } from '../../../types/public-listing-media.types';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const PUBLIC_LISTINGS_TABLE_NAME = process.env.PUBLIC_LISTINGS_TABLE_NAME!;
const PUBLIC_LISTING_MEDIA_TABLE_NAME = process.env.PUBLIC_LISTING_MEDIA_TABLE_NAME!;
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;
const MAX_REASON_LENGTH = 500;

/**
 * Validate request body
 */
function validateRequest(body: any): { valid: boolean; error?: string } {
  if (!body) {
    return { valid: false, error: 'Request body is required' };
  }

  if (!body.lockReason || typeof body.lockReason !== 'string') {
    return { valid: false, error: 'lockReason is required and must be a string' };
  }

  const trimmedReason = body.lockReason.trim();

  if (trimmedReason.length === 0) {
    return { valid: false, error: 'lockReason cannot be empty' };
  }

  if (trimmedReason.length > MAX_REASON_LENGTH) {
    return { 
      valid: false, 
      error: `lockReason must be ${MAX_REASON_LENGTH} characters or less` 
    };
  }

  return { valid: true };
}

/**
 * Find listing by listingId using GSI3 (DocumentStatusIndex)
 */
async function findListing(listingId: string): Promise<ListingMetadata | null> {
  const result = await docClient.send(
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

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0] as ListingMetadata;
}

/**
 * Fetch all public listing media records for a listing
 */
async function fetchPublicListingMedia(listingId: string): Promise<any[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: PUBLIC_LISTING_MEDIA_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': buildPublicListingMediaPK(listingId),
      },
    })
  );
  return result.Items || [];
}

/**
 * Decrement location listings count
 */
async function decrementLocationListingsCount(locationId: string): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: LOCATIONS_TABLE_NAME,
        Key: {
          pk: 'LOCATION',
          sk: `LOCATION#${locationId}`,
        },
        UpdateExpression: 'SET listingsCount = if_not_exists(listingsCount, :zero) - :dec',
        ExpressionAttributeValues: {
          ':dec': 1,
          ':zero': 0,
        },
      })
    );
  } catch (error) {
    console.error(`Failed to decrement listings count for location ${locationId}:`, error);
  }
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Suspend listing request:', { 
    pathParameters: event.pathParameters,
    body: event.body ? JSON.parse(event.body) : null,
  });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_SUSPEND');
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

    // 3. Parse and validate request body
    let body: SuspendListingRequest;
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

    const lockReason = body.lockReason.trim();

    console.log(`Admin ${user.email} suspending listing: ${listingId}`);

    // 4. Find listing
    const listing = await findListing(listingId);

    if (!listing) {
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

    // 5. Validate current status (can only suspend ONLINE or APPROVED listings)
    if (listing.status !== 'ONLINE' && listing.status !== 'APPROVED') {
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
            message: `Cannot suspend listing with status ${listing.status}. Expected ONLINE or APPROVED.`,
          },
        }),
      };
    }

    // 6. If listing is ONLINE, remove it from public listings table
    const isOnline = listing.status === 'ONLINE';
    const now = new Date().toISOString();

    if (isOnline) {
      console.log(`Listing is ONLINE - removing from public listings table`);

      // Get location IDs
      const placeId = listing.mapboxMetadata?.place?.mapbox_id;
      if (!placeId) {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            success: false,
            error: {
              code: 'MISSING_LOCATION_DATA',
              message: 'Listing is missing location information',
            },
          }),
        };
      }

      const hasLocality = listing.mapboxMetadata?.locality?.mapbox_id;
      const localityId = hasLocality ? listing.mapboxMetadata.locality.mapbox_id : null;

      // Fetch all media records
      const mediaRecords = await fetchPublicListingMedia(listingId);

      // Build transaction items
      const transactItems: any[] = [];

      // Delete PLACE listing record
      transactItems.push({
        Delete: {
          TableName: PUBLIC_LISTINGS_TABLE_NAME,
          Key: {
            pk: `LOCATION#${placeId}`,
            sk: `LISTING#${listingId}`,
          },
        },
      });

      // If locality exists, also delete LOCALITY listing record
      if (hasLocality && localityId) {
        transactItems.push({
          Delete: {
            TableName: PUBLIC_LISTINGS_TABLE_NAME,
            Key: {
              pk: `LOCATION#${localityId}`,
              sk: `LISTING#${listingId}`,
            },
          },
        });
        console.log(`Deleting dual public listing records: PLACE and LOCALITY`);
      } else {
        console.log(`Deleting single public listing record: PLACE only`);
      }

      // Delete all PublicListingMedia records
      mediaRecords.forEach((media) => {
        transactItems.push({
          Delete: {
            TableName: PUBLIC_LISTING_MEDIA_TABLE_NAME,
            Key: {
              pk: media.pk,
              sk: media.sk,
            },
          },
        });
      });

      // Update listing status to LOCKED
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${listing.hostId}`,
            sk: `LISTING_META#${listingId}`,
          },
          UpdateExpression: `
            SET #status = :status,
                #listingVerified = :listingVerified,
                #lockedAt = :lockedAt,
                #lockedBy = :lockedBy,
                #lockReason = :lockReason,
                #updatedAt = :updatedAt,
                #gsi2pk = :gsi2pk,
                #gsi2sk = :gsi2sk
          `,
          ExpressionAttributeNames: {
            '#status': 'status',
            '#listingVerified': 'listingVerified',
            '#lockedAt': 'lockedAt',
            '#lockedBy': 'lockedBy',
            '#lockReason': 'lockReason',
            '#updatedAt': 'updatedAt',
            '#gsi2pk': 'gsi2pk',
            '#gsi2sk': 'gsi2sk',
          },
          ExpressionAttributeValues: {
            ':status': 'LOCKED',
            ':listingVerified': false,
            ':lockedAt': now,
            ':lockedBy': user.sub,
            ':lockReason': lockReason,
            ':updatedAt': now,
            ':gsi2pk': 'LISTING_STATUS#LOCKED',
            ':gsi2sk': now,
          },
        },
      });

      // Execute transaction
      console.log(`Suspending ONLINE listing with ${transactItems.length} transaction items`);
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: transactItems,
        })
      );

      // Decrement location listings counts
      await decrementLocationListingsCount(placeId);
      if (localityId) {
        await decrementLocationListingsCount(localityId);
      }

      console.log(`✅ Listing ${listingId} suspended and removed from public listings`);
    } else {
      // Listing is APPROVED (not yet online) - just update status
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${listing.hostId}`,
            sk: `LISTING_META#${listingId}`,
          },
          UpdateExpression: `
            SET #status = :status,
                #listingVerified = :listingVerified,
                #lockedAt = :lockedAt,
                #lockedBy = :lockedBy,
                #lockReason = :lockReason,
                #updatedAt = :updatedAt,
                #gsi2pk = :gsi2pk,
                #gsi2sk = :gsi2sk
          `,
          ExpressionAttributeNames: {
            '#status': 'status',
            '#listingVerified': 'listingVerified',
            '#lockedAt': 'lockedAt',
            '#lockedBy': 'lockedBy',
            '#lockReason': 'lockReason',
            '#updatedAt': 'updatedAt',
            '#gsi2pk': 'gsi2pk',
            '#gsi2sk': 'gsi2sk',
          },
          ExpressionAttributeValues: {
            ':status': 'LOCKED',
            ':listingVerified': false,
            ':lockedAt': now,
            ':lockedBy': user.sub,
            ':lockReason': lockReason,
            ':updatedAt': now,
            ':gsi2pk': 'LISTING_STATUS#LOCKED',
            ':gsi2sk': now,
          },
        })
      );

      console.log(`✅ Listing ${listingId} suspended (was APPROVED, not yet online)`);
    }

    // 7. Send suspension email
    try {
      // Fetch host details for email
      const hostResult = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND sk = :sk',
          ExpressionAttributeValues: {
            ':pk': `HOST#${listing.hostId}`,
            ':sk': 'META',
          },
        })
      );
      
      const host = hostResult.Items?.[0] as Host;
      if (host) {
        const hostName = isIndividualHost(host)
          ? `${host.forename} ${host.surname}`
          : host.legalName || host.displayName || host.businessName || 'Host';
          
        await sendListingSuspendedEmail(
          host.email,
          host.preferredLanguage || 'sr',
          hostName,
          listing.listingName,
          lockReason
        );
        console.log(`📧 Suspension email sent to ${host.email}`);
      }
    } catch (emailError) {
      console.error('Failed to send suspension email:', emailError);
      // Don't fail the request if email fails
    }

    // 8. Log admin action
    logAdminAction(user, 'SUSPEND_LISTING', 'LISTING', listingId, {
      hostId: listing.hostId,
      lockReason,
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
        message: 'Listing suspended successfully',
      }),
    };
  } catch (error) {
    console.error('❌ Suspend listing error:', error);

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
          message: 'Failed to suspend listing',
        },
      }),
    };
  }
};

