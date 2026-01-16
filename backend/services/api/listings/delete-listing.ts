import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { 
  getSlot, 
  deleteAdvertisingSlot, 
  detachListingFromSlot 
} from '../../lib/subscription-service';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;
const PUBLIC_LISTINGS_TABLE_NAME = process.env.PUBLIC_LISTINGS_TABLE_NAME!;
const PUBLIC_LISTING_MEDIA_TABLE_NAME = process.env.PUBLIC_LISTING_MEDIA_TABLE_NAME!;
const LOCATIONS_TABLE_NAME = process.env.LOCATIONS_TABLE_NAME!;

/**
 * DELETE /api/v1/hosts/{hostId}/listings/{listingId}
 * 
 * Soft delete a listing
 * 
 * Actions:
 * - Set isDeleted: true on listing metadata
 * - Set status: ARCHIVED
 * - Set deletedAt timestamp
 * - Set deletedBy (hostId)
 * - Cascade soft delete to all child records (images, documents, amenities)
 * - Hard delete all pricing records
 * - Soft delete all requests for this listing
 * - Handle advertising slot:
 *   - Commission-based: DELETE the slot entirely
 *   - Token-based: DETACH listing (slot becomes empty/reusable)
 * - If listing was ONLINE:
 *   - Delete PublicListing records
 *   - Delete PublicListingMedia records
 * - Decrement location listingsCount (if listing was ever submitted)
 * - S3 files remain (for audit purposes)
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Delete listing request:', {
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

    // 2. Fetch listing metadata
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

    const listing = listingResult.Item;

    // Check if already deleted
    if (listing.isDeleted) {
      return response.badRequest('Listing is already deleted');
    }

    const wasOnline = listing.status === 'ONLINE';
    
    // Check if location count was incremented (happens when listing is submitted for review or later)
    // Statuses that indicate the count was incremented: IN_REVIEW, APPROVED, ONLINE, SUSPENDED, REJECTED, CHANGES_REQUESTED
    const statusesWithLocationCountIncremented = ['IN_REVIEW', 'APPROVED', 'ONLINE', 'SUSPENDED', 'REJECTED', 'CHANGES_REQUESTED'];
    const shouldDecrementLocationCount = statusesWithLocationCountIncremented.includes(listing.status);

    // 3. Fetch all child records (images, documents, amenities, pricing, requests)
    const [imagesResult, documentsResult, amenitiesResult, pricingResult, requestsResult] = await Promise.all([
      // Images
      docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': `LISTING#${listingId}`,
            ':sk': 'IMAGE#',
          },
        })
      ),
      // Documents
      docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': `HOST#${hostId}`,
            ':sk': `LISTING_DOC#${listingId}#`,
          },
        })
      ),
      // Amenities
      docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${hostId}`,
            sk: `LISTING_AMENITIES#${listingId}`,
          },
        })
      ),
      // Pricing records
      docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': `HOST#${hostId}`,
            ':sk': `LISTING_PRICING#${listingId}#`,
          },
        })
      ),
      // Requests for this listing
      docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': `LISTING#${listingId}`,
            ':sk': 'REQUEST#',
          },
        })
      ),
    ]);

    const images = imagesResult.Items || [];
    const documents = documentsResult.Items || [];
    const amenities = amenitiesResult.Item;
    const pricingRecords = pricingResult.Items || [];
    const requests = requestsResult.Items || [];

    // 4. Build transaction to soft delete all records
    const now = new Date().toISOString();
    const transactItems: any[] = [];

    // Update listing metadata
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: `LISTING_META#${listingId}`,
        },
        UpdateExpression: 'SET isDeleted = :deleted, deletedAt = :now, deletedBy = :hostId, #status = :archived, updatedAt = :now, gsi2pk = :gsi2pk',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':deleted': true,
          ':now': now,
          ':hostId': hostId,
          ':archived': 'ARCHIVED',
          ':gsi2pk': 'LISTING_STATUS#ARCHIVED',
        },
      },
    });

    // Soft delete all images
    for (const img of images) {
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: {
            pk: `LISTING#${listingId}`,
            sk: `IMAGE#${img.imageId}`,
          },
          UpdateExpression: 'SET isDeleted = :deleted, deletedAt = :now',
          ExpressionAttributeValues: {
            ':deleted': true,
            ':now': now,
          },
        },
      });
    }

    // Soft delete all documents
    for (const doc of documents) {
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${hostId}`,
            sk: `LISTING_DOC#${listingId}#${doc.documentType}`,
          },
          UpdateExpression: 'SET isDeleted = :deleted, deletedAt = :now',
          ExpressionAttributeValues: {
            ':deleted': true,
            ':now': now,
          },
        },
      });
    }

    // Soft delete amenities (if exists)
    if (amenities) {
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${hostId}`,
            sk: `LISTING_AMENITIES#${listingId}`,
          },
          UpdateExpression: 'SET isDeleted = :deleted',
          ExpressionAttributeValues: {
            ':deleted': true,
          },
        },
      });
    }

    // Soft delete all requests for this listing
    for (const req of requests) {
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: {
            pk: `LISTING#${listingId}`,
            sk: req.sk,
          },
          UpdateExpression: 'SET isDeleted = :deleted, deletedAt = :now',
          ExpressionAttributeValues: {
            ':deleted': true,
            ':now': now,
          },
        },
      });
    }

    // 5. Execute main transaction (max 100 items)
    // DynamoDB TransactWrite limit is 100 items
    const MAX_TRANSACT_ITEMS = 100;
    
    if (transactItems.length > MAX_TRANSACT_ITEMS) {
      console.warn(`Transaction has ${transactItems.length} items, may need batching`);
    }

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: transactItems,
      })
    );

    console.log('Main transaction completed:', {
      listingId,
      imagesDeleted: images.length,
      documentsDeleted: documents.length,
      amenitiesDeleted: amenities ? 1 : 0,
      requestsDeleted: requests.length,
    });

    // 6. Hard delete pricing records (outside transaction to avoid size limits)
    if (pricingRecords.length > 0) {
      console.log(`Hard deleting ${pricingRecords.length} pricing records...`);
      for (const pricing of pricingRecords) {
        try {
          await docClient.send(
            new DeleteCommand({
              TableName: TABLE_NAME,
              Key: {
                pk: pricing.pk,
                sk: pricing.sk,
              },
            })
          );
        } catch (err) {
          console.error(`Failed to delete pricing record ${pricing.sk}:`, err);
          // Continue with other deletions
        }
      }
      console.log(`Deleted ${pricingRecords.length} pricing records`);
    }

    // 6b. Handle advertising slot (if exists)
    let slotAction: 'DELETED' | 'DETACHED' | 'NONE' = 'NONE';
    
    if (listing.activeSlotId) {
      console.log(`Listing has active slot: ${listing.activeSlotId}`);
      
      try {
        const slot = await getSlot(hostId, listing.activeSlotId);
        
        if (slot) {
          if (slot.isCommissionBased) {
            // Commission-based: DELETE the slot entirely
            // Commission slots are tied to the listing and cannot be reused
            await deleteAdvertisingSlot(hostId, slot.slotId);
            slotAction = 'DELETED';
            console.log(`Deleted commission-based slot ${slot.slotId}`);
          } else {
            // Token-based: DETACH listing (slot becomes empty/reusable)
            // The slot remains and can be used for a new listing
            await detachListingFromSlot(hostId, slot.slotId);
            slotAction = 'DETACHED';
            console.log(`Detached token-based slot ${slot.slotId} - now empty and reusable`);
          }
        } else {
          console.warn(`Slot ${listing.activeSlotId} not found - may have already been deleted`);
        }
      } catch (err) {
        console.error(`Failed to handle slot ${listing.activeSlotId}:`, err);
        // Continue with deletion - slot cleanup is not critical
      }
    }

    // 7. Clean up public listings (if was ONLINE) and decrement location counts (if ever submitted)
    const countryId = listing.mapboxMetadata?.country?.mapbox_id;
    const placeId = listing.mapboxMetadata?.place?.mapbox_id;
    const hasLocality = listing.mapboxMetadata?.locality?.mapbox_id;
    const localityId = hasLocality ? listing.mapboxMetadata.locality.mapbox_id : null;

    // If listing was ONLINE, clean up public listing records
    if (wasOnline) {
      console.log('Listing was ONLINE, cleaning up public records...');

      // Delete PublicListing records
      if (placeId) {
        try {
          await docClient.send(
            new DeleteCommand({
              TableName: PUBLIC_LISTINGS_TABLE_NAME,
              Key: {
                pk: `LOCATION#${placeId}`,
                sk: `LISTING#${listingId}`,
              },
            })
          );
          console.log(`Deleted PublicListing record for PLACE: ${placeId}`);
        } catch (err) {
          console.error(`Failed to delete PublicListing for PLACE:`, err);
        }
      }

      if (localityId) {
        try {
          await docClient.send(
            new DeleteCommand({
              TableName: PUBLIC_LISTINGS_TABLE_NAME,
              Key: {
                pk: `LOCATION#${localityId}`,
                sk: `LISTING#${listingId}`,
              },
            })
          );
          console.log(`Deleted PublicListing record for LOCALITY: ${localityId}`);
        } catch (err) {
          console.error(`Failed to delete PublicListing for LOCALITY:`, err);
        }
      }

      // Delete PublicListingMedia records
      try {
        const mediaRecords = await docClient.send(
          new QueryCommand({
            TableName: PUBLIC_LISTING_MEDIA_TABLE_NAME,
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: {
              ':pk': `LISTING#${listingId}`,
            },
          })
        );

        if (mediaRecords.Items && mediaRecords.Items.length > 0) {
          console.log(`Deleting ${mediaRecords.Items.length} PublicListingMedia records...`);
          for (const media of mediaRecords.Items) {
            await docClient.send(
              new DeleteCommand({
                TableName: PUBLIC_LISTING_MEDIA_TABLE_NAME,
                Key: {
                  pk: media.pk,
                  sk: media.sk,
                },
              })
            );
          }
          console.log(`Deleted ${mediaRecords.Items.length} PublicListingMedia records`);
        }
      } catch (err) {
        console.error('Failed to delete PublicListingMedia records:', err);
      }
    }

    // Decrement location counts if listing was ever submitted (IN_REVIEW or beyond)
    // This is separate from public listing cleanup because counts are incremented at submission, not publish
    if (shouldDecrementLocationCount) {
      console.log(`Decrementing location counts (listing status was: ${listing.status})...`);

      if (placeId) {
        await decrementLocationListingsCount(placeId, now);
      }

      if (localityId) {
        await decrementLocationListingsCount(localityId, now);
      }

      if (countryId) {
        await decrementLocationListingsCount(countryId, now);
        console.log(`Decremented listings count for COUNTRY: ${countryId}`);
      }
    } else {
      console.log(`Skipping location count decrement (listing status: ${listing.status} - never submitted)`);
    }

    console.log('Listing deleted successfully:', {
      listingId,
      wasOnline,
      slotAction,
      imagesDeleted: images.length,
      documentsDeleted: documents.length,
      amenitiesDeleted: amenities ? 1 : 0,
      pricingDeleted: pricingRecords.length,
      requestsDeleted: requests.length,
    });

    return response.success({
      success: true,
      listingId,
      message: 'Listing deleted successfully',
      deletedAt: now,
      slotAction, // Inform frontend what happened to the slot
    });

  } catch (error: any) {
    console.error('Delete listing error:', error);
    return response.handleError(error);
  }
}

/**
 * Decrement listingsCount for ALL name variants of a location
 * This ensures all variants (e.g., "Belgrade" and "Beograd") have the same count
 */
async function decrementLocationListingsCount(placeId: string, timestamp: string): Promise<void> {
  try {
    // Query all name variants for this location
    const variants = await docClient.send(
      new QueryCommand({
        TableName: LOCATIONS_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `LOCATION#${placeId}`,
        },
      })
    );

    if (!variants.Items || variants.Items.length === 0) {
      console.warn(`No location variants found for placeId: ${placeId}`);
      return;
    }

    console.log(`Decrementing listingsCount for ${variants.Items.length} name variant(s) of location ${placeId}`);

    // Update each variant
    for (const variant of variants.Items) {
      await docClient.send(
        new UpdateCommand({
          TableName: LOCATIONS_TABLE_NAME,
          Key: {
            pk: variant.pk,
            sk: variant.sk,
          },
          UpdateExpression: 'ADD listingsCount :dec SET updatedAt = :now',
          ExpressionAttributeValues: {
            ':dec': -1,
            ':now': timestamp,
          },
        })
      );
    }

    console.log(`Successfully decremented listingsCount for all variants of ${placeId}`);
  } catch (error) {
    console.error(`Failed to decrement location listings count for ${placeId}:`, error);
    // Don't throw - this is not critical
  }
}
