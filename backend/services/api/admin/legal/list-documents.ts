/**
 * List Legal Documents
 * 
 * GET /api/v1/admin/legal/documents
 * Returns all legal documents (ToS and Privacy Policy) with their versions
 * Each document contains both English and Serbian versions.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { 
  LegalDocument, 
  LegalDocumentResponse,
  SUPPORTED_LANGUAGES,
} from '../../../types/legal.types';

const LEGAL_DOCUMENTS_TABLE = process.env.LEGAL_DOCUMENTS_TABLE_NAME!;
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || '';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export async function listDocuments(
  _event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    // Scan all documents (small table, scan is fine)
    const result = await docClient.send(
      new ScanCommand({
        TableName: LEGAL_DOCUMENTS_TABLE,
      })
    );

    const documents = (result.Items || []) as LegalDocument[];

    // Group by document type and sort by version descending
    const grouped: Record<string, LegalDocumentResponse[]> = {
      tos: [],
      privacy: [],
    };

    for (const doc of documents) {
      const response: LegalDocumentResponse = {
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
      };

      grouped[doc.documentType].push(response);
    }

    // Sort each group by version descending
    for (const type of Object.keys(grouped)) {
      grouped[type].sort((a, b) => {
        const [aMajor, aMinor] = a.version.split('.').map(Number);
        const [bMajor, bMinor] = b.version.split('.').map(Number);
        if (bMajor !== aMajor) return bMajor - aMajor;
        return (bMinor || 0) - (aMinor || 0);
      });
    }

    // Build latestUrls for quick reference
    const latestUrls = {
      tos: {
        en: CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/legal/tos/en/latest.html` : null,
        sr: CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/legal/tos/sr/latest.html` : null,
      },
      privacy: {
        en: CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/legal/privacy/en/latest.html` : null,
        sr: CLOUDFRONT_DOMAIN ? `https://${CLOUDFRONT_DOMAIN}/legal/privacy/sr/latest.html` : null,
      },
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        documents: grouped,
        latestUrls,
        supportedLanguages: SUPPORTED_LANGUAGES,
      }),
    };
  } catch (error) {
    console.error('Failed to list legal documents:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: 'Failed to list legal documents',
      }),
    };
  }
}
