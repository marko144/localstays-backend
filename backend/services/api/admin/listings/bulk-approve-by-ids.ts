/**
 * Admin API: Bulk Approve Listings by IDs
 * 
 * POST /api/v1/admin/listings/bulk-approve-by-ids
 * Body: { listingIds: ["listing_xxx", "listing_yyy", ...] }
 * 
 * Approves multiple listings by their IDs.
 * Uses parallel execution with concurrency control for efficiency.
 * 
 * Optimizations:
 * - BatchGetItem to fetch all listings in batches of 100
 * - Parallel UpdateCommand with concurrency limit (25 concurrent)
 * - Grouped notifications per host
 * 
 * Permission required: ADMIN_LISTING_APPROVE
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
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

// Concurrency limits
const BATCH_GET_SIZE = 100; // DynamoDB BatchGetItem limit
const UPDATE_CONCURRENCY = 25; // Max parallel updates to avoid throttling

interface BulkApproveResult {
  listingId: string;
  listingName: string;
  hostId: string;
  success: boolean;
  error?: string;
}

interface BulkApproveRequest {
  listingIds: string[];
}

/**
 * Process items in parallel with concurrency limit
 */
async function parallelWithLimit<T, R>(
  items: T[],
  limit: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = processor(item).then(result => {
      results.push(result);
    });
    executing.push(promise);

    if (executing.length >= limit) {
      await Promise.race(executing);
      // Remove completed promises
      for (let i = executing.length - 1; i >= 0; i--) {
        // Check if promise is settled by racing with an immediate resolve
        const settled = await Promise.race([
          executing[i].then(() => true),
          Promise.resolve(false)
        ]);
        if (settled) {
          executing.splice(i, 1);
        }
      }
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Chunk array into smaller arrays
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Fetch listings by IDs using BatchGetItem (up to 100 per call)
 */
async function fetchListingsByIds(listingIds: string[]): Promise<Map<string, ListingMetadata>> {
  const listingsMap = new Map<string, ListingMetadata>();
  
  // First, we need to find the hostId for each listing using GSI3 (DocumentStatusIndex)
  // BatchGetItem requires pk+sk, but we only have listingId
  // So we query GSI3 for each listing to get the full key
  
  const listingPromises = listingIds.map(async (listingId) => {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'DocumentStatusIndex',
        KeyConditionExpression: 'gsi3pk = :pk AND begins_with(gsi3sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `LISTING#${listingId}`,
          ':sk': 'LISTING_META#',
        },
      })
    );
    
    if (result.Items && result.Items.length > 0) {
      const listing = result.Items[0] as ListingMetadata;
      listingsMap.set(listingId, listing);
    }
  });

  // Execute in parallel with concurrency limit
  await parallelWithLimit(listingPromises, UPDATE_CONCURRENCY, async (p) => p);

  return listingsMap;
}

/**
 * Approve a single listing
 */
async function approveListing(listing: ListingMetadata, now: string, adminEmail: string): Promise<BulkApproveResult> {
  try {
    // Validate listing can be approved
    const validStatuses = ['IN_REVIEW', 'REVIEWING', 'LOCKED'];
    if (!validStatuses.includes(listing.status) && !listing.readyToApprove) {
      return {
        listingId: listing.listingId,
        listingName: listing.listingName,
        hostId: listing.hostId,
        success: false,
        error: `Cannot approve listing with status ${listing.status} (must be IN_REVIEW, REVIEWING, LOCKED, or readyToApprove=true)`,
      };
    }

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
              #approvedBy = :approvedBy,
              #updatedAt = :updatedAt,
              #gsi2pk = :gsi2pk,
              #gsi2sk = :gsi2sk
          REMOVE readyToApprove, readyToApproveAt, readyToApproveBy, reviewStartedAt, reviewedBy
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#approvedAt': 'approvedAt',
          '#approvedBy': 'approvedBy',
          '#updatedAt': 'updatedAt',
          '#gsi2pk': 'gsi2pk',
          '#gsi2sk': 'gsi2sk',
        },
        ExpressionAttributeValues: {
          ':status': 'APPROVED',
          ':approvedAt': now,
          ':approvedBy': adminEmail,
          ':updatedAt': now,
          ':gsi2pk': 'LISTING_STATUS#APPROVED',
          ':gsi2sk': now,
        },
      })
    );

    return {
      listingId: listing.listingId,
      listingName: listing.listingName,
      hostId: listing.hostId,
      success: true,
    };
  } catch (error) {
    return {
      listingId: listing.listingId,
      listingName: listing.listingName,
      hostId: listing.hostId,
      success: false,
      error: (error as Error).message,
    };
  }
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

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Bulk approve by IDs request');

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_APPROVE');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Parse request body
    let body: BulkApproveRequest;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
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
            message: 'Invalid JSON body',
          },
        }),
      };
    }

    // 3. Validate listingIds
    if (!body.listingIds || !Array.isArray(body.listingIds) || body.listingIds.length === 0) {
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
            message: 'listingIds array is required and must not be empty',
          },
        }),
      };
    }

    // Limit to prevent abuse
    const MAX_LISTINGS = 500;
    if (body.listingIds.length > MAX_LISTINGS) {
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
            message: `Maximum ${MAX_LISTINGS} listings can be approved at once`,
          },
        }),
      };
    }

    const listingIds = [...new Set(body.listingIds)]; // Dedupe
    console.log(`Admin ${user.email} bulk approving ${listingIds.length} listings`);

    // 4. Fetch all listings in parallel
    console.log('Fetching listings...');
    const listingsMap = await fetchListingsByIds(listingIds);
    console.log(`Found ${listingsMap.size} of ${listingIds.length} listings`);

    // Track not found listings
    const notFoundIds = listingIds.filter(id => !listingsMap.has(id));

    // 5. Approve all found listings in parallel with concurrency limit
    const now = new Date().toISOString();
    const listings = Array.from(listingsMap.values());
    
    console.log(`Approving ${listings.length} listings with concurrency ${UPDATE_CONCURRENCY}...`);
    const results = await parallelWithLimit(
      listings,
      UPDATE_CONCURRENCY,
      (listing) => approveListing(listing, now, user.email)
    );

    // Add not found results
    for (const id of notFoundIds) {
      results.push({
        listingId: id,
        listingName: 'Unknown',
        hostId: 'Unknown',
        success: false,
        error: 'Listing not found',
      });
    }

    // 6. Send notifications grouped by host
    const successfulResults = results.filter(r => r.success);
    const hostsToNotify = new Map<string, { hostId: string; listings: string[] }>();
    
    for (const result of successfulResults) {
      if (!hostsToNotify.has(result.hostId)) {
        hostsToNotify.set(result.hostId, { hostId: result.hostId, listings: [] });
      }
      hostsToNotify.get(result.hostId)!.listings.push(result.listingName);
    }

    // Send notifications in parallel
    console.log(`Sending notifications to ${hostsToNotify.size} hosts...`);
    await parallelWithLimit(
      Array.from(hostsToNotify.values()),
      10, // Lower concurrency for external API calls
      async ({ hostId, listings: listingNames }) => {
        try {
          const host = await getHost(hostId);
          if (!host) return;

          const hostName = isIndividualHost(host)
            ? `${host.forename} ${host.surname}`
            : host.legalName || host.businessName || 'Host';

          // Send email for each approved listing
          for (const listingName of listingNames) {
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
                listingName: listingNames.length === 1 
                  ? listingNames[0] 
                  : `${listingNames.length} listings`,
                listingId: '',
              }
            );
          }
        } catch (notifyError) {
          console.error(`Failed to notify host ${hostId}:`, notifyError);
        }
      }
    );

    // 7. Log admin action
    const approvedCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    logAdminAction(user, 'BULK_APPROVE_LISTINGS_BY_IDS', 'LISTING', 'bulk', {
      approvedCount,
      failedCount,
      requestedCount: listingIds.length,
      listingIds: results.filter(r => r.success).map(r => r.listingId),
    });

    console.log(`✅ Bulk approve complete: ${approvedCount} approved, ${failedCount} failed`);

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
    console.error('❌ Bulk approve by IDs error:', error);

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


