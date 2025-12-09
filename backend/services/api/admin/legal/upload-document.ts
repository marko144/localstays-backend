/**
 * Upload Legal Document
 * 
 * POST /api/v1/admin/legal/documents
 * Uploads a new version of a legal document (ToS or Privacy Policy)
 * Both English and Serbian versions are required and uploaded together.
 * 
 * Request body:
 * {
 *   documentType: "tos" | "privacy",
 *   version: "1.0",
 *   contentEn: "<base64 encoded HTML content for English>",
 *   contentSr: "<base64 encoded HTML content for Serbian>"
 * }
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { 
  LegalDocument, 
  LegalDocumentType,
  UploadLegalDocumentRequest,
  buildLegalDocumentPK,
  buildLegalDocumentSK,
  buildLatestDocumentGSI1PK,
} from '../../../types/legal.types';

const LEGAL_DOCUMENTS_TABLE = process.env.LEGAL_DOCUMENTS_TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || '';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

/**
 * Get admin user ID from Cognito claims
 */
function getAdminUserId(event: APIGatewayProxyEvent): string {
  const claims = event.requestContext.authorizer?.claims;
  return claims?.sub || 'unknown';
}

/**
 * Validate version format (X.Y where X and Y are numbers)
 */
function isValidVersion(version: string): boolean {
  const parts = version.split('.');
  if (parts.length < 1 || parts.length > 2) return false;
  return parts.every(part => /^\d+$/.test(part));
}

export async function uploadDocument(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const adminUserId = getAdminUserId(event);

  // Parse request body
  let body: UploadLegalDocumentRequest;
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
        error: 'INVALID_JSON',
        message: 'Request body must be valid JSON',
      }),
    };
  }

  // Validate required fields
  const { documentType, version, contentEn, contentSr } = body;

  if (!documentType || !['tos', 'privacy'].includes(documentType)) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'INVALID_DOCUMENT_TYPE',
        message: 'Document type must be "tos" or "privacy"',
      }),
    };
  }

  if (!version || !isValidVersion(version)) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'INVALID_VERSION',
        message: 'Version must be in format X.Y (e.g., "1.0", "2.1")',
      }),
    };
  }

  if (!contentEn) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'MISSING_CONTENT_EN',
        message: 'English content (contentEn) is required (base64 encoded HTML)',
      }),
    };
  }

  if (!contentSr) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'MISSING_CONTENT_SR',
        message: 'Serbian content (contentSr) is required (base64 encoded HTML)',
      }),
    };
  }

  try {
    // Decode base64 content for both languages
    const htmlContentEn = Buffer.from(contentEn, 'base64').toString('utf-8');
    const htmlContentSr = Buffer.from(contentSr, 'base64').toString('utf-8');
    
    // Calculate SHA-256 hashes
    const sha256HashEn = createHash('sha256').update(htmlContentEn).digest('hex');
    const sha256HashSr = createHash('sha256').update(htmlContentSr).digest('hex');

    // Check if this version already exists
    const existingDoc = await docClient.send(
      new QueryCommand({
        TableName: LEGAL_DOCUMENTS_TABLE,
        KeyConditionExpression: 'pk = :pk AND sk = :sk',
        ExpressionAttributeValues: {
          ':pk': buildLegalDocumentPK(documentType as LegalDocumentType),
          ':sk': buildLegalDocumentSK(version),
        },
      })
    );

    if (existingDoc.Items && existingDoc.Items.length > 0) {
      return {
        statusCode: 409,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'VERSION_EXISTS',
          message: `Version ${version} already exists for ${documentType}`,
        }),
      };
    }

    const now = new Date().toISOString();
    
    // S3 keys for both languages
    const s3KeyEn = `legal/${documentType}/en/v${version}.html`;
    const s3KeySr = `legal/${documentType}/sr/v${version}.html`;
    const latestS3KeyEn = `legal/${documentType}/en/latest.html`;
    const latestS3KeySr = `legal/${documentType}/sr/latest.html`;

    // Upload both language versions to S3
    await Promise.all([
      // English versioned
      s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: s3KeyEn,
          Body: htmlContentEn,
          ContentType: 'text/html; charset=utf-8',
          CacheControl: 'public, max-age=31536000', // 1 year cache for versioned files
        })
      ),
      // Serbian versioned
      s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: s3KeySr,
          Body: htmlContentSr,
          ContentType: 'text/html; charset=utf-8',
          CacheControl: 'public, max-age=31536000',
        })
      ),
    ]);

    // Copy to latest.html for both languages
    await Promise.all([
      s3Client.send(
        new CopyObjectCommand({
          Bucket: BUCKET_NAME,
          CopySource: `${BUCKET_NAME}/${s3KeyEn}`,
          Key: latestS3KeyEn,
          ContentType: 'text/html; charset=utf-8',
          CacheControl: 'public, max-age=3600', // 1 hour cache for latest
          MetadataDirective: 'REPLACE',
        })
      ),
      s3Client.send(
        new CopyObjectCommand({
          Bucket: BUCKET_NAME,
          CopySource: `${BUCKET_NAME}/${s3KeySr}`,
          Key: latestS3KeySr,
          ContentType: 'text/html; charset=utf-8',
          CacheControl: 'public, max-age=3600',
          MetadataDirective: 'REPLACE',
        })
      ),
    ]);

    // Clear isLatest flag from previous latest version
    const previousLatest = await docClient.send(
      new QueryCommand({
        TableName: LEGAL_DOCUMENTS_TABLE,
        IndexName: 'LatestDocumentIndex',
        KeyConditionExpression: 'gsi1pk = :gsi1pk',
        ExpressionAttributeValues: {
          ':gsi1pk': buildLatestDocumentGSI1PK(documentType as LegalDocumentType),
        },
      })
    );

    if (previousLatest.Items && previousLatest.Items.length > 0) {
      const prevDoc = previousLatest.Items[0] as LegalDocument;
      await docClient.send(
        new UpdateCommand({
          TableName: LEGAL_DOCUMENTS_TABLE,
          Key: {
            pk: prevDoc.pk,
            sk: prevDoc.sk,
          },
          UpdateExpression: 'SET isLatest = :false REMOVE gsi1pk, gsi1sk',
          ExpressionAttributeValues: {
            ':false': false,
          },
        })
      );
    }

    // Create new document record with both languages
    const newDoc: LegalDocument = {
      pk: buildLegalDocumentPK(documentType as LegalDocumentType),
      sk: buildLegalDocumentSK(version),
      documentType: documentType as LegalDocumentType,
      version,
      content: {
        en: {
          s3Key: s3KeyEn,
          sha256Hash: sha256HashEn,
        },
        sr: {
          s3Key: s3KeySr,
          sha256Hash: sha256HashSr,
        },
      },
      uploadedAt: now,
      uploadedBy: adminUserId,
      isLatest: true,
      gsi1pk: buildLatestDocumentGSI1PK(documentType as LegalDocumentType),
      gsi1sk: 'DOCUMENT',
    };

    await docClient.send(
      new PutCommand({
        TableName: LEGAL_DOCUMENTS_TABLE,
        Item: newDoc,
      })
    );

    console.log('Legal document uploaded:', {
      documentType,
      version,
      s3KeyEn,
      s3KeySr,
      sha256HashEn,
      sha256HashSr,
      uploadedBy: adminUserId,
    });

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        documentType,
        version,
        content: {
          en: {
            s3Key: s3KeyEn,
            cloudFrontUrl: CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/${s3KeyEn}` : '',
            sha256Hash: sha256HashEn,
          },
          sr: {
            s3Key: s3KeySr,
            cloudFrontUrl: CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/${s3KeySr}` : '',
            sha256Hash: sha256HashSr,
          },
        },
        latestUrls: {
          en: CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/${latestS3KeyEn}` : '',
          sr: CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/${latestS3KeySr}` : '',
        },
        uploadedAt: now,
        isLatest: true,
      }),
    };
  } catch (error) {
    console.error('Failed to upload document:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: 'Failed to upload document',
      }),
    };
  }
}
