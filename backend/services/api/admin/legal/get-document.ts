/**
 * Get Document
 * 
 * GET /api/v1/admin/legal/documents/{type}/{version}
 * Returns metadata for a specific document version (includes both languages)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { 
  LegalDocument, 
  LegalDocumentType,
  buildLegalDocumentPK,
  buildLegalDocumentSK,
} from '../../../types/legal.types';

const LEGAL_DOCUMENTS_TABLE = process.env.LEGAL_DOCUMENTS_TABLE_NAME!;
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || '';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export async function getDocument(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const documentType = event.pathParameters?.type as LegalDocumentType;
  const version = event.pathParameters?.version;

  // Validate inputs
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

  if (!version) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'MISSING_VERSION',
        message: 'Version is required',
      }),
    };
  }

  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: LEGAL_DOCUMENTS_TABLE,
        Key: {
          pk: buildLegalDocumentPK(documentType),
          sk: buildLegalDocumentSK(version),
        },
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'NOT_FOUND',
          message: `Document ${documentType} version ${version} not found`,
        }),
      };
    }

    const doc = result.Item as LegalDocument;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
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
      }),
    };
  } catch (error) {
    console.error('Failed to get document:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: 'Failed to get document',
      }),
    };
  }
}
