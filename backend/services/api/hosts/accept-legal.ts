/**
 * Accept Legal Documents
 * 
 * POST /api/v1/hosts/{hostId}/legal/accept
 * Records acceptance of ToS and/or Privacy Policy with full audit trail
 * 
 * Request body:
 * {
 *   acceptTos?: boolean,
 *   tosVersion?: string,
 *   acceptPrivacy?: boolean,
 *   privacyVersion?: string
 * }
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { 
  LegalDocument,
  LegalAcceptance,
  AcceptLegalDocumentsRequest,
  AcceptLegalDocumentsResponse,
  LegalDocumentType,
  buildLegalDocumentPK,
  buildLegalDocumentSK,
  buildAcceptancePK,
  buildAcceptanceSK,
  buildAcceptanceGSI1PK,
  buildAcceptanceGSI1SK,
  buildLatestDocumentGSI1PK
} from '../../types/legal.types';
import { Host } from '../../types/host.types';

const TABLE_NAME = process.env.TABLE_NAME!;
const LEGAL_DOCUMENTS_TABLE = process.env.LEGAL_DOCUMENTS_TABLE_NAME!;
const LEGAL_ACCEPTANCES_TABLE = process.env.LEGAL_ACCEPTANCES_TABLE_NAME!;

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Extract user sub from Cognito claims
 */
function getUserSub(event: APIGatewayProxyEvent): string {
  const claims = event.requestContext.authorizer?.claims;
  return claims?.sub || 'unknown';
}

/**
 * Extract IP address from request headers
 */
function getIpAddress(event: APIGatewayProxyEvent): string {
  // X-Forwarded-For contains comma-separated list of IPs, first is client
  const forwardedFor = event.headers['X-Forwarded-For'] || event.headers['x-forwarded-for'];
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  return event.requestContext.identity?.sourceIp || 'unknown';
}

/**
 * Extract and parse user agent
 */
function parseUserAgent(event: APIGatewayProxyEvent): {
  userAgent: string;
  browserName: string;
  browserVersion: string;
  osName: string;
  osVersion: string;
  deviceType: string;
} {
  const userAgent = event.headers['User-Agent'] || event.headers['user-agent'] || 'unknown';
  
  // Simple parsing - for production, consider using ua-parser-js
  let browserName = 'Unknown';
  let browserVersion = '';
  let osName = 'Unknown';
  let osVersion = '';
  let deviceType = 'desktop';

  // Detect browser
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
    browserName = 'Chrome';
    const match = userAgent.match(/Chrome\/(\d+(?:\.\d+)*)/);
    browserVersion = match?.[1] || '';
  } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
    browserName = 'Safari';
    const match = userAgent.match(/Version\/(\d+(?:\.\d+)*)/);
    browserVersion = match?.[1] || '';
  } else if (userAgent.includes('Firefox')) {
    browserName = 'Firefox';
    const match = userAgent.match(/Firefox\/(\d+(?:\.\d+)*)/);
    browserVersion = match?.[1] || '';
  } else if (userAgent.includes('Edg')) {
    browserName = 'Edge';
    const match = userAgent.match(/Edg\/(\d+(?:\.\d+)*)/);
    browserVersion = match?.[1] || '';
  }

  // Detect OS
  if (userAgent.includes('Windows')) {
    osName = 'Windows';
    const match = userAgent.match(/Windows NT (\d+(?:\.\d+)*)/);
    osVersion = match?.[1] || '';
  } else if (userAgent.includes('Mac OS X')) {
    osName = 'macOS';
    const match = userAgent.match(/Mac OS X (\d+[_\.]\d+(?:[_\.]\d+)*)/);
    osVersion = match?.[1]?.replace(/_/g, '.') || '';
  } else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    osName = 'iOS';
    const match = userAgent.match(/OS (\d+[_\.]\d+(?:[_\.]\d+)*)/);
    osVersion = match?.[1]?.replace(/_/g, '.') || '';
    deviceType = userAgent.includes('iPad') ? 'tablet' : 'mobile';
  } else if (userAgent.includes('Android')) {
    osName = 'Android';
    const match = userAgent.match(/Android (\d+(?:\.\d+)*)/);
    osVersion = match?.[1] || '';
    deviceType = 'mobile';
  } else if (userAgent.includes('Linux')) {
    osName = 'Linux';
  }

  // Detect device type (if not already set)
  if (deviceType === 'desktop') {
    if (userAgent.includes('Mobile')) {
      deviceType = 'mobile';
    } else if (userAgent.includes('Tablet')) {
      deviceType = 'tablet';
    }
  }

  return { userAgent, browserName, browserVersion, osName, osVersion, deviceType };
}

/**
 * Get Accept-Language header
 */
function getAcceptLanguage(event: APIGatewayProxyEvent): string {
  return event.headers['Accept-Language'] || event.headers['accept-language'] || 'unknown';
}

/**
 * Get document by type and version
 */
async function getDocument(documentType: LegalDocumentType, version: string): Promise<LegalDocument | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: LEGAL_DOCUMENTS_TABLE,
      Key: {
        pk: buildLegalDocumentPK(documentType),
        sk: buildLegalDocumentSK(version),
      },
    })
  );
  return (result.Item as LegalDocument) || null;
}

/**
 * Get latest document version
 */
async function getLatestDocument(documentType: LegalDocumentType): Promise<LegalDocument | null> {
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

export async function acceptLegal(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const hostId = event.pathParameters?.hostId;
  const userSub = getUserSub(event);

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

  // Parse request body
  let body: AcceptLegalDocumentsRequest;
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

  const { acceptTos, tosVersion, acceptPrivacy, privacyVersion } = body;

  // Validate at least one acceptance
  if (!acceptTos && !acceptPrivacy) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'NO_ACCEPTANCE',
        message: 'Must accept at least ToS or Privacy Policy',
      }),
    };
  }

  try {
    // Get host
    const host = await getHost(hostId);
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

    // Extract audit data from request
    const ipAddress = getIpAddress(event);
    const { userAgent, browserName, browserVersion, osName, osVersion, deviceType } = parseUserAgent(event);
    const acceptLanguage = getAcceptLanguage(event);

    const now = new Date().toISOString();
    const response: AcceptLegalDocumentsResponse = {
      success: true,
      accepted: {},
    };

    // Process ToS acceptance
    if (acceptTos) {
      // Determine version to accept (provided or latest)
      let tosDoc: LegalDocument | null = null;
      if (tosVersion) {
        tosDoc = await getDocument('tos', tosVersion);
        if (!tosDoc) {
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
              error: 'INVALID_TOS_VERSION',
              message: `ToS version ${tosVersion} not found`,
            }),
          };
        }
      } else {
        tosDoc = await getLatestDocument('tos');
        if (!tosDoc) {
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
              error: 'NO_TOS_AVAILABLE',
              message: 'No Terms of Service document available',
            }),
          };
        }
      }

      // Create acceptance record
      const tosAcceptance: LegalAcceptance = {
        pk: buildAcceptancePK(hostId),
        sk: buildAcceptanceSK('tos', tosDoc.version, now),
        hostId,
        acceptedByUserSub: userSub,
        documentType: 'tos',
        documentVersion: tosDoc.version,
        documentHash: tosDoc.content.en.sha256Hash,
        acceptedAt: now,
        ipAddress,
        userAgent,
        browserName,
        browserVersion,
        osName,
        osVersion,
        deviceType,
        acceptLanguage,
        acceptanceSource: 'api',
        gsi1pk: buildAcceptanceGSI1PK('tos', tosDoc.version),
        gsi1sk: buildAcceptanceGSI1SK(now),
      };

      await docClient.send(
        new PutCommand({
          TableName: LEGAL_ACCEPTANCES_TABLE,
          Item: tosAcceptance,
        })
      );

      response.accepted.tos = {
        version: tosDoc.version,
        acceptedAt: now,
      };
    }

    // Process Privacy acceptance
    if (acceptPrivacy) {
      let privacyDoc: LegalDocument | null = null;
      if (privacyVersion) {
        privacyDoc = await getDocument('privacy', privacyVersion);
        if (!privacyDoc) {
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
              error: 'INVALID_PRIVACY_VERSION',
              message: `Privacy Policy version ${privacyVersion} not found`,
            }),
          };
        }
      } else {
        privacyDoc = await getLatestDocument('privacy');
        if (!privacyDoc) {
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
              error: 'NO_PRIVACY_AVAILABLE',
              message: 'No Privacy Policy document available',
            }),
          };
        }
      }

      // Create acceptance record
      const privacyAcceptance: LegalAcceptance = {
        pk: buildAcceptancePK(hostId),
        sk: buildAcceptanceSK('privacy', privacyDoc.version, now),
        hostId,
        acceptedByUserSub: userSub,
        documentType: 'privacy',
        documentVersion: privacyDoc.version,
        documentHash: privacyDoc.content.en.sha256Hash,
        acceptedAt: now,
        ipAddress,
        userAgent,
        browserName,
        browserVersion,
        osName,
        osVersion,
        deviceType,
        acceptLanguage,
        acceptanceSource: 'api',
        gsi1pk: buildAcceptanceGSI1PK('privacy', privacyDoc.version),
        gsi1sk: buildAcceptanceGSI1SK(now),
      };

      await docClient.send(
        new PutCommand({
          TableName: LEGAL_ACCEPTANCES_TABLE,
          Item: privacyAcceptance,
        })
      );

      response.accepted.privacy = {
        version: privacyDoc.version,
        acceptedAt: now,
      };
    }

    // Update host record with accepted versions
    const updateExpressions: string[] = ['updatedAt = :now'];
    const expressionValues: Record<string, any> = { ':now': now };

    if (response.accepted.tos) {
      updateExpressions.push('acceptedTosVersion = :tosVersion');
      updateExpressions.push('acceptedTosAt = :tosAt');
      expressionValues[':tosVersion'] = response.accepted.tos.version;
      expressionValues[':tosAt'] = response.accepted.tos.acceptedAt;
    }

    if (response.accepted.privacy) {
      updateExpressions.push('acceptedPrivacyVersion = :privacyVersion');
      updateExpressions.push('acceptedPrivacyAt = :privacyAt');
      expressionValues[':privacyVersion'] = response.accepted.privacy.version;
      expressionValues[':privacyAt'] = response.accepted.privacy.acceptedAt;
    }

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `HOST#${hostId}`,
          sk: 'META',
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeValues: expressionValues,
      })
    );

    console.log('Legal documents accepted:', {
      hostId,
      userSub,
      tos: response.accepted.tos?.version,
      privacy: response.accepted.privacy?.version,
      ipAddress,
      browserName,
      osName,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Failed to accept legal documents:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: 'Failed to accept legal documents',
      }),
    };
  }
}

