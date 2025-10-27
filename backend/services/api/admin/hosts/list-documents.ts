/**
 * Admin API: List Host KYC Documents
 * 
 * GET /api/v1/admin/hosts/{hostId}/documents
 * 
 * Returns all KYC verification documents for a host with pre-signed download URLs.
 * Permission required: ADMIN_KYC_VIEW_ALL
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { Document } from '../../../types/document.types';
import { AdminKycDocument } from '../../../types/admin.types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;

// Pre-signed URL expiry: 15 minutes
const PRESIGNED_URL_EXPIRY = 15 * 60;

/**
 * Generate pre-signed URL for document download
 */
async function generateDownloadUrl(s3Key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    ResponseContentDisposition: 'attachment', // Force download
  });

  return await getSignedUrl(s3Client, command, {
    expiresIn: PRESIGNED_URL_EXPIRY,
  });
}

/**
 * Convert Document to AdminKycDocument with download URL
 */
async function toAdminKycDocument(doc: Document): Promise<AdminKycDocument> {
  // Generate pre-signed URL for download
  const s3Url = await generateDownloadUrl(doc.s3Key);

  return {
    documentId: doc.documentId,
    documentType: doc.documentType,
    fileName: doc.fileName,
    contentType: doc.mimeType,
    fileSize: doc.fileSize,
    s3Url,
    uploadedAt: doc.uploadedAt,
    status: doc.status,
  };
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('List host documents request:', { pathParameters: event.pathParameters });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_KYC_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Extract hostId from path
    const hostId = event.pathParameters?.hostId;

    if (!hostId) {
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
            message: 'hostId is required',
          },
        }),
      };
    }

    console.log(`Admin ${user.email} viewing documents for host: ${hostId}`);

    // 3. Query all documents for this host
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: 'isDeleted = :isDeleted',
        ExpressionAttributeValues: {
          ':pk': `HOST#${hostId}`,
          ':sk': 'DOCUMENT#',
          ':isDeleted': false,
        },
      })
    );

    const documents = (result.Items || []) as Document[];

    console.log(`Found ${documents.length} documents for host ${hostId}`);

    // 4. Convert to admin format with pre-signed URLs
    const adminDocuments = await Promise.all(
      documents.map(doc => toAdminKycDocument(doc))
    );

    // 5. Sort by upload date (newest first)
    adminDocuments.sort((a, b) => 
      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );

    // 6. Log admin action
    logAdminAction(user, 'VIEW_DOCUMENTS', 'HOST', hostId, {
      documentCount: adminDocuments.length,
    });

    // 7. Return response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        data: {
          documents: adminDocuments,
        },
      }),
    };
  } catch (error) {
    console.error('❌ List documents error:', error);

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
          message: 'Failed to list documents',
        },
      }),
    };
  }
};















