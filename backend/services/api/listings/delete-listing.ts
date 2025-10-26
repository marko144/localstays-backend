import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

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
 * - S3 files remain (for audit purposes)
 */
export async function handler(event: APIGatewayProxyEvent): APIGatewayProxyResult {
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

    // 3. Fetch all child records (images, documents, amenities)
    const [imagesResult, documentsResult, amenitiesResult] = await Promise.all([
      docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: {
            ':pk': `HOST#${hostId}`,
            ':sk': `LISTING_IMAGE#${listingId}#`,
          },
        })
      ),
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
      docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${hostId}`,
            sk: `LISTING_AMENITIES#${listingId}`,
          },
        })
      ),
    ]);

    const images = imagesResult.Items || [];
    const documents = documentsResult.Items || [];
    const amenities = amenitiesResult.Item;

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
            pk: `HOST#${hostId}`,
            sk: `LISTING_IMAGE#${listingId}#${img.imageId}`,
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

    // 5. Execute transaction (max 100 items, we should be well under)
    // DynamoDB TransactWrite limit is 100 items
    const MAX_TRANSACT_ITEMS = 100;
    
    if (transactItems.length > MAX_TRANSACT_ITEMS) {
      // If we somehow exceed 100 items, we'd need to batch
      // For now, log a warning (unlikely with max 15 images + 4 docs + 1 amenity + 1 listing = 21 items)
      console.warn(`Transaction has ${transactItems.length} items, may need batching`);
    }

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: transactItems,
      })
    );

    console.log('Listing soft deleted successfully:', {
      listingId,
      imagesDeleted: images.length,
      documentsDeleted: documents.length,
      amenitiesDeleted: amenities ? 1 : 0,
    });

    return response.success({
      success: true,
      listingId,
      message: 'Listing deleted successfully',
      deletedAt: now,
    });

  } catch (error: any) {
    console.error('Delete listing error:', error);
    return response.handleError(error);
  }
}







