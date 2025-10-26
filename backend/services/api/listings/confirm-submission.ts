import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import {
  ConfirmListingSubmissionRequest,
  ConfirmListingSubmissionResponse,
} from '../../types/listing.types';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({ region: process.env.AWS_REGION });

const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;

/**
 * POST /api/v1/hosts/{hostId}/listings/{listingId}/confirm-submission
 * 
 * Step 2 of listing submission: Verify uploads and finalize submission
 * 
 * This endpoint:
 * 1. Verifies submission token
 * 2. Verifies all images were uploaded to S3
 * 3. Verifies required documents were uploaded
 * 4. Updates image records: PENDING_UPLOAD → ACTIVE
 * 5. Updates document records: PENDING_UPLOAD → PENDING_REVIEW
 * 6. Updates listing metadata: DRAFT → IN_REVIEW
 * 7. Sets submittedAt timestamp
 * 8. Updates GSI2 for admin review queue
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Confirm listing submission request:', {
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
    const body: ConfirmListingSubmissionRequest = JSON.parse(event.body || '{}');

    if (!body.submissionToken) {
      return response.badRequest('submissionToken is required');
    }

    // 3. Verify submission token (fetch from DynamoDB)
    const tokenResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `LISTING_SUBMISSION#${body.submissionToken}`,
          sk: 'META',
        },
      })
    );

    if (!tokenResult.Item) {
      return response.badRequest('Invalid or expired submission token');
    }

    const tokenData = tokenResult.Item;

    // Check if token has expired
    if (new Date(tokenData.expiresAt) < new Date()) {
      return response.badRequest('Submission token has expired');
    }

    // Verify token matches the listing and host
    if (tokenData.listingId !== listingId || tokenData.hostId !== hostId) {
      return response.badRequest('Submission token does not match listing');
    }

    // 4. Fetch listing metadata
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

    // 5. Verify listing is in DRAFT status
    if (listing.status !== 'DRAFT') {
      return response.badRequest(`Listing is not in DRAFT status (current: ${listing.status})`);
    }

    // 6. Fetch all image records
    const imagesResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `HOST#${hostId}`,
          ':sk': `LISTING_IMAGE#${listingId}#`,
        },
      })
    );

    const images = imagesResult.Items || [];

    // 7. Verify all uploaded images exist in S3
    const uploadedImageIds = new Set(body.uploadedImages);
    const missingImages: string[] = [];

    for (const img of images) {
      if (!uploadedImageIds.has(img.imageId)) {
        missingImages.push(img.imageId);
        continue;
      }

      // Verify file exists in S3
      try {
        await s3Client.send(
          new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: img.s3Key,
          })
        );
      } catch (error) {
        console.error(`Image not found in S3: ${img.imageId}`, error);
        missingImages.push(img.imageId);
      }
    }

    if (missingImages.length > 0) {
      return response.badRequest(`Images not uploaded: ${missingImages.join(', ')}`);
    }

    // 8. Verify at least one image and exactly one primary
    if (images.length === 0) {
      return response.badRequest('At least one image is required');
    }

    const primaryImages = images.filter((img) => img.isPrimary);
    if (primaryImages.length !== 1) {
      return response.badRequest('Exactly one image must be marked as primary');
    }

    // 9. Fetch all document records
    const documentsResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `HOST#${hostId}`,
          ':sk': `LISTING_DOC#${listingId}#`,
        },
      })
    );

    const documents = documentsResult.Items || [];

    // 10. Verify uploaded documents exist in S3 (if any were declared)
    if (body.uploadedDocuments && body.uploadedDocuments.length > 0) {
      const uploadedDocTypes = new Set(body.uploadedDocuments);
      const missingDocs: string[] = [];

      for (const doc of documents) {
        if (!uploadedDocTypes.has(doc.documentType)) {
          missingDocs.push(doc.documentType);
          continue;
        }

        // Verify file exists in S3
        try {
          await s3Client.send(
            new HeadObjectCommand({
              Bucket: BUCKET_NAME,
              Key: doc.s3Key,
            })
          );
        } catch (error) {
          console.error(`Document not found in S3: ${doc.documentType}`, error);
          missingDocs.push(doc.documentType);
        }
      }

      if (missingDocs.length > 0) {
        return response.badRequest(`Documents not uploaded: ${missingDocs.join(', ')}`);
      }
    }

    // 11. Update all records in a transaction
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
        UpdateExpression: 'SET #status = :status, submittedAt = :now, updatedAt = :now, gsi2pk = :gsi2pk, gsi2sk = :gsi2sk REMOVE submissionToken, submissionTokenExpiresAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'IN_REVIEW',
          ':now': now,
          ':gsi2pk': 'LISTING_STATUS#IN_REVIEW',
          ':gsi2sk': now,
        },
      },
    });

    // Update image records
    for (const img of images) {
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${hostId}`,
            sk: `LISTING_IMAGE#${listingId}#${img.imageId}`,
          },
          UpdateExpression: 'SET #status = :status',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'ACTIVE',
          },
        },
      });
    }

    // Update document records
    for (const doc of documents) {
      transactItems.push({
        Update: {
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${hostId}`,
            sk: `LISTING_DOC#${listingId}#${doc.documentType}`,
          },
          UpdateExpression: 'SET #status = :status',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'PENDING_REVIEW',
          },
        },
      });
    }

    // Execute transaction
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: transactItems,
      })
    );

    console.log('Listing submission confirmed:', {
      listingId,
      imagesUpdated: images.length,
      documentsUpdated: documents.length,
      status: 'IN_REVIEW',
    });

    // 12. Build response
    const confirmResponse: ConfirmListingSubmissionResponse = {
      success: true,
      listingId,
      status: 'IN_REVIEW',
      submittedAt: now,
      message: 'Listing submitted successfully and is now under review',
    };

    return response.success(confirmResponse);

  } catch (error: any) {
    console.error('Confirm submission error:', error);
    return response.handleError(error);
  }
}


