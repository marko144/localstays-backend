/**
 * Admin API: Bulk Approve Listings
 * 
 * POST /api/v1/admin/listings/bulk-approve
 * Query params: 
 *   - all=true (approve all ready listings)
 *   - placeId=xxx (approve only listings in this place)
 * 
 * Approves all listings marked as readyToApprove=true.
 * Can optionally filter by place (location).
 * 
 * This is used for staged bulk launch during early onboarding phase.
 * 
 * Permission required: ADMIN_LISTING_APPROVE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { ListingMetadata } from '../../../types/listing.types';
import { Host, isIndividualHost } from '../../../types/host.types';
import { sendListingApprovedEmail } from '../../lib/email-service';
import { sendTemplatedNotification } from '../../lib/notification-template-service';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME!;

interface BulkApproveResult {
  listingId: string;
  listingName: string;
  hostId: string;
  success: boolean;
  error?: string;
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Bulk approve listings request:', { queryParams: event.queryStringParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_APPROVE');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Parse query parameters
    const approveAll = event.queryStringParameters?.all === 'true';
    const placeId = event.queryStringParameters?.placeId;

    if (!approveAll && !placeId) {
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
            message: 'Must specify either all=true or placeId parameter',
          },
        }),
      };
    }

    console.log(`Admin ${user.email} bulk approving listings: all=${approveAll}, placeId=${placeId}`);

    // 3. Find all listings with readyToApprove=true
    const readyListings = await findReadyToApproveListings();
    console.log(`Found ${readyListings.length} listings marked as ready to approve`);

    if (readyListings.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: true,
          message: 'No listings found that are ready to approve',
          approved: 0,
          failed: 0,
          results: [],
        }),
      };
    }

    // 4. Filter by placeId if specified
    let listingsToApprove = readyListings;
    if (placeId) {
      listingsToApprove = readyListings.filter(listing => {
        // Check mapbox place ID
        const mapboxPlaceId = listing.mapboxMetadata?.place?.mapbox_id;
        if (mapboxPlaceId === placeId) return true;

        // Check manual location IDs (first one is always PLACE)
        const manualPlaceId = listing.manualLocationIds?.[0];
        if (manualPlaceId === placeId) return true;

        return false;
      });

      console.log(`Filtered to ${listingsToApprove.length} listings in place ${placeId}`);
    }

    if (listingsToApprove.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: true,
          message: placeId 
            ? `No listings found that are ready to approve in place ${placeId}`
            : 'No listings found that are ready to approve',
          approved: 0,
          failed: 0,
          results: [],
        }),
      };
    }

    // 5. Approve each listing
    const now = new Date().toISOString();
    const results: BulkApproveResult[] = [];
    const hostsToNotify: Map<string, { host: Host; listings: string[] }> = new Map();

    for (const listing of listingsToApprove) {
      try {
        await approveListing(listing, now);
        
        results.push({
          listingId: listing.listingId,
          listingName: listing.listingName,
          hostId: listing.hostId,
          success: true,
        });

        // Track hosts for notification grouping
        if (!hostsToNotify.has(listing.hostId)) {
          const host = await getHost(listing.hostId);
          if (host) {
            hostsToNotify.set(listing.hostId, { host, listings: [] });
          }
        }
        hostsToNotify.get(listing.hostId)?.listings.push(listing.listingName);

        console.log(`✅ Approved listing ${listing.listingId}`);
      } catch (error) {
        console.error(`❌ Failed to approve listing ${listing.listingId}:`, error);
        results.push({
          listingId: listing.listingId,
          listingName: listing.listingName,
          hostId: listing.hostId,
          success: false,
          error: (error as Error).message,
        });
      }
    }

    // 6. Send notifications to hosts (grouped by host)
    for (const [hostId, { host, listings }] of hostsToNotify) {
      try {
        const hostName = isIndividualHost(host)
          ? `${host.forename} ${host.surname}`
          : host.legalName || host.businessName || 'Host';

        // Send email for each approved listing (or could be grouped into one email)
        for (const listingName of listings) {
          await sendListingApprovedEmail(
            host.email,
            host.preferredLanguage || 'sr',
            hostName,
            listingName
          );
        }

        // Send push notification
        if (host.ownerUserSub) {
          await sendTemplatedNotification(
            host.ownerUserSub,
            'LISTING_APPROVED',
            host.preferredLanguage || 'sr',
            {
              listingName: listings.length === 1 
                ? listings[0] 
                : `${listings.length} listings`,
              listingId: '', // Not applicable for bulk
            }
          );
        }

        console.log(`📧 Notifications sent to host ${hostId} for ${listings.length} listings`);
      } catch (notifyError) {
        console.error(`Failed to notify host ${hostId}:`, notifyError);
        // Don't fail the request if notification fails
      }
    }

    // 7. Log admin action
    const approvedCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    logAdminAction(user, 'BULK_APPROVE_LISTINGS', 'LISTING', 'bulk', {
      approvedCount,
      failedCount,
      placeId: placeId || 'all',
      listingIds: results.filter(r => r.success).map(r => r.listingId),
    });

    // 8. Return response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: `Bulk approval complete: ${approvedCount} approved, ${failedCount} failed`,
        approved: approvedCount,
        failed: failedCount,
        results,
      }),
    };
  } catch (error) {
    console.error('❌ Bulk approve error:', error);

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
          message: 'Failed to bulk approve listings',
        },
      }),
    };
  }
};

/**
 * Find all listings with readyToApprove=true
 * Uses a scan with filter (acceptable for this admin operation)
 */
async function findReadyToApproveListings(): Promise<ListingMetadata[]> {
  const listings: ListingMetadata[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'readyToApprove = :ready AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':ready': true,
          ':skPrefix': 'LISTING_META#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      listings.push(...(result.Items as ListingMetadata[]));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return listings;
}

/**
 * Approve a single listing
 */
async function approveListing(listing: ListingMetadata, now: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${listing.hostId}`,
        sk: `LISTING_META#${listing.listingId}`,
      },
      UpdateExpression: `
        SET #status = :status,
            #approvedAt = :approvedAt,
            #updatedAt = :updatedAt,
            #gsi2pk = :gsi2pk,
            #gsi2sk = :gsi2sk
        REMOVE readyToApprove, readyToApproveAt, readyToApproveBy
      `,
      ExpressionAttributeNames: {
        '#status': 'status',
        '#approvedAt': 'approvedAt',
        '#updatedAt': 'updatedAt',
        '#gsi2pk': 'gsi2pk',
        '#gsi2sk': 'gsi2sk',
      },
      ExpressionAttributeValues: {
        ':status': 'APPROVED',
        ':approvedAt': now,
        ':updatedAt': now,
        ':gsi2pk': 'LISTING_STATUS#APPROVED',
        ':gsi2sk': now,
      },
    })
  );
}

/**
 * Get host by hostId
 */
async function getHost(hostId: string): Promise<Host | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: {
        ':pk': `HOST#${hostId}`,
        ':sk': 'META',
      },
    })
  );

  return (result.Items?.[0] as Host) || null;
}

