/**
 * List Legal Acceptances
 * 
 * GET /api/v1/admin/legal/acceptances
 * Query acceptance records with optional filters
 * 
 * Query parameters:
 * - hostId: Filter by specific host
 * - documentType: Filter by document type (tos/privacy)
 * - documentVersion: Filter by specific version
 * - limit: Page size (default 50, max 200)
 * - nextToken: Pagination token
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { 
  LegalAcceptance, 
  LegalDocumentType,
  buildAcceptancePK,
  buildAcceptanceGSI1PK
} from '../../../types/legal.types';

const LEGAL_ACCEPTANCES_TABLE = process.env.LEGAL_ACCEPTANCES_TABLE_NAME!;

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export async function listAcceptances(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const queryParams = event.queryStringParameters || {};
  const hostId = queryParams.hostId;
  const documentType = queryParams.documentType as LegalDocumentType | undefined;
  const documentVersion = queryParams.documentVersion;
  const limit = Math.min(parseInt(queryParams.limit || '50', 10), 200);
  const nextToken = queryParams.nextToken;

  // Validate documentType if provided
  if (documentType && !['tos', 'privacy'].includes(documentType)) {
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
    let result;
    let exclusiveStartKey;

    // Decode pagination token if provided
    if (nextToken) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
      } catch {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            error: 'INVALID_TOKEN',
            message: 'Invalid pagination token',
          }),
        };
      }
    }

    // Query strategy depends on filters
    if (hostId) {
      // Query by host ID (primary key)
      let keyCondition = 'pk = :pk';
      const expressionValues: Record<string, any> = {
        ':pk': buildAcceptancePK(hostId),
      };

      // Add sort key prefix filter if documentType provided
      if (documentType) {
        keyCondition += ' AND begins_with(sk, :skPrefix)';
        expressionValues[':skPrefix'] = `ACCEPTANCE#${documentType}#`;
        
        if (documentVersion) {
          expressionValues[':skPrefix'] = `ACCEPTANCE#${documentType}#${documentVersion}#`;
        }
      }

      result = await docClient.send(
        new QueryCommand({
          TableName: LEGAL_ACCEPTANCES_TABLE,
          KeyConditionExpression: keyCondition,
          ExpressionAttributeValues: expressionValues,
          Limit: limit,
          ExclusiveStartKey: exclusiveStartKey,
          ScanIndexForward: false, // Most recent first
        })
      );
    } else if (documentType && documentVersion) {
      // Query by document type and version (GSI1)
      result = await docClient.send(
        new QueryCommand({
          TableName: LEGAL_ACCEPTANCES_TABLE,
          IndexName: 'DocumentAcceptanceIndex',
          KeyConditionExpression: 'gsi1pk = :gsi1pk',
          ExpressionAttributeValues: {
            ':gsi1pk': buildAcceptanceGSI1PK(documentType, documentVersion),
          },
          Limit: limit,
          ExclusiveStartKey: exclusiveStartKey,
          ScanIndexForward: false, // Most recent first
        })
      );
    } else {
      // Scan with optional filter (less efficient, but needed for broad queries)
      let filterExpression: string | undefined;
      const expressionValues: Record<string, any> = {};

      if (documentType) {
        filterExpression = 'documentType = :docType';
        expressionValues[':docType'] = documentType;
      }

      result = await docClient.send(
        new ScanCommand({
          TableName: LEGAL_ACCEPTANCES_TABLE,
          FilterExpression: filterExpression,
          ExpressionAttributeValues: Object.keys(expressionValues).length > 0 
            ? expressionValues 
            : undefined,
          Limit: limit,
          ExclusiveStartKey: exclusiveStartKey,
        })
      );
    }

    const acceptances = (result.Items || []) as LegalAcceptance[];

    // Format response
    const items = acceptances.map(acc => ({
      hostId: acc.hostId,
      acceptedByUserSub: acc.acceptedByUserSub,
      documentType: acc.documentType,
      documentVersion: acc.documentVersion,
      acceptedAt: acc.acceptedAt,
      ipAddress: acc.ipAddress,
      userAgent: acc.userAgent,
      acceptanceSource: acc.acceptanceSource,
    }));

    // Encode next token if there are more results
    let responseNextToken: string | undefined;
    if (result.LastEvaluatedKey) {
      responseNextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        items,
        nextToken: responseNextToken,
        count: items.length,
      }),
    };
  } catch (error) {
    console.error('Failed to list acceptances:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: 'Failed to list acceptances',
      }),
    };
  }
}

