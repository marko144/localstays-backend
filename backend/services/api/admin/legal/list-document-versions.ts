/**
 * List Document Versions
 * 
 * GET /api/v1/admin/legal/documents/{type}
 * Returns all versions of a specific document type (tos or privacy)
 * Each version contains both English and Serbian content.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { 
  LegalDocument, 
  LegalDocumentResponse, 
  LegalDocumentType,
  buildLegalDocumentPK,
} from '../../../types/legal.types';

const LEGAL_DOCUMENTS_TABLE = process.env.LEGAL_DOCUMENTS_TABLE_NAME!;
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || '';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export async function listDocumentVersions(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const documentType = event.pathParameters?.type as LegalDocumentType;

  // Validate document type
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

  try {
    // Query all versions of this document type
    const result = await docClient.send(
      new QueryCommand({
        TableName: LEGAL_DOCUMENTS_TABLE,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': buildLegalDocumentPK(documentType),
        },
        ScanIndexForward: false, // Descending order by sort key
      })
    );

    const documents = (result.Items || []) as LegalDocument[];

    const versions: LegalDocumentResponse[] = documents.map(doc => ({
      documentType: doc.documentType,
      version: doc.version,
      content: {
        en: {
          s3Key: doc.content.en.s3Key,
          cloudFrontUrl: CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/${doc.content.en.s3Key}` : '',
          sha256Hash: doc.content.en.sha256Hash,
        },
        sr: {
          s3Key: doc.content.sr.s3Key,
          cloudFrontUrl: CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/${doc.content.sr.s3Key}` : '',
          sha256Hash: doc.content.sr.sha256Hash,
        },
      },
      latestUrls: {
        en: CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/legal/${doc.documentType}/en/latest.html` : '',
        sr: CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/legal/${doc.documentType}/sr/latest.html` : '',
      },
      uploadedAt: doc.uploadedAt,
      uploadedBy: doc.uploadedBy,
      isLatest: doc.isLatest,
    }));

    // Sort by version descending
    versions.sort((a, b) => {
      const [aMajor, aMinor] = a.version.split('.').map(Number);
      const [bMajor, bMinor] = b.version.split('.').map(Number);
      if (bMajor !== aMajor) return bMajor - aMajor;
      return (bMinor || 0) - (aMinor || 0);
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        documentType,
        versions,
        latestUrls: {
          en: CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/legal/${documentType}/en/latest.html` : null,
          sr: CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/legal/${documentType}/sr/latest.html` : null,
        },
      }),
    };
  } catch (error) {
    console.error('Failed to list document versions:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: 'Failed to list document versions',
      }),
    };
  }
}
