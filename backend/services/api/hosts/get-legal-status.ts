/**
 * Get Legal Status
 * 
 * GET /api/v1/hosts/{hostId}/legal/status
 * Returns the current ToS and Privacy Policy versions and the host's acceptance status
 * Includes URLs for both English and Serbian versions.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { 
  LegalDocument, 
  LegalStatusResponse,
  buildLatestDocumentGSI1PK,
} from '../../types/legal.types';
import { Host } from '../../types/host.types';

const TABLE_NAME = process.env.TABLE_NAME!;
const LEGAL_DOCUMENTS_TABLE = process.env.LEGAL_DOCUMENTS_TABLE_NAME!;
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || '';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Get the latest version of a document type
 */
async function getLatestDocument(documentType: 'tos' | 'privacy'): Promise<LegalDocument | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: LEGAL_DOCUMENTS_TABLE,
      IndexName: 'LatestDocumentIndex',
      KeyConditionExpression: 'gsi1pk = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': buildLatestDocumentGSI1PK(documentType),
      },
      Limit: 1,
    })
  );

  return (result.Items?.[0] as LegalDocument) || null;
}

/**
 * Get host record
 */
async function getHost(hostId: string): Promise<Host | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: 'META',
      },
    })
  );

  return (result.Item as Host) || null;
}

export async function getLegalStatus(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const hostId = event.pathParameters?.hostId;

  if (!hostId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'MISSING_HOST_ID',
        message: 'Host ID is required',
      }),
    };
  }

  try {
    // Fetch host and latest documents in parallel
    const [host, latestTos, latestPrivacy] = await Promise.all([
      getHost(hostId),
      getLatestDocument('tos'),
      getLatestDocument('privacy'),
    ]);

    if (!host) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'HOST_NOT_FOUND',
          message: `Host ${hostId} not found`,
        }),
      };
    }

    // Build response with URLs for both languages
    const response: LegalStatusResponse = {
      tos: {
        currentVersion: latestTos?.version || null,
        urls: {
          en: {
            versioned: latestTos && CLOUDFRONT_DOMAIN 
              ? `https://${CLOUDFRONT_DOMAIN}/${latestTos.content.en.s3Key}` 
              : null,
            latest: CLOUDFRONT_DOMAIN 
              ? `https://${CLOUDFRONT_DOMAIN}/legal/tos/en/latest.html` 
              : null,
          },
          sr: {
            versioned: latestTos && CLOUDFRONT_DOMAIN 
              ? `https://${CLOUDFRONT_DOMAIN}/${latestTos.content.sr.s3Key}` 
              : null,
            latest: CLOUDFRONT_DOMAIN 
              ? `https://${CLOUDFRONT_DOMAIN}/legal/tos/sr/latest.html` 
              : null,
          },
        },
        hostAcceptedVersion: host.acceptedTosVersion || null,
        hostAcceptedAt: host.acceptedTosAt || null,
        needsAcceptance: latestTos 
          ? host.acceptedTosVersion !== latestTos.version 
          : false,
      },
      privacy: {
        currentVersion: latestPrivacy?.version || null,
        urls: {
          en: {
            versioned: latestPrivacy && CLOUDFRONT_DOMAIN 
              ? `https://${CLOUDFRONT_DOMAIN}/${latestPrivacy.content.en.s3Key}` 
              : null,
            latest: CLOUDFRONT_DOMAIN 
              ? `https://${CLOUDFRONT_DOMAIN}/legal/privacy/en/latest.html` 
              : null,
          },
          sr: {
            versioned: latestPrivacy && CLOUDFRONT_DOMAIN 
              ? `https://${CLOUDFRONT_DOMAIN}/${latestPrivacy.content.sr.s3Key}` 
              : null,
            latest: CLOUDFRONT_DOMAIN 
              ? `https://${CLOUDFRONT_DOMAIN}/legal/privacy/sr/latest.html` 
              : null,
          },
        },
        hostAcceptedVersion: host.acceptedPrivacyVersion || null,
        hostAcceptedAt: host.acceptedPrivacyAt || null,
        needsAcceptance: latestPrivacy 
          ? host.acceptedPrivacyVersion !== latestPrivacy.version 
          : false,
      },
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Failed to get legal status:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: 'Failed to get legal status',
      }),
    };
  }
}
