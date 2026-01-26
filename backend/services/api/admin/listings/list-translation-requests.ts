/**
 * Admin API: List Translation Requests
 * 
 * GET /api/v1/admin/translation-requests
 * 
 * Returns a list of pending translation requests for listings.
 * 
 * Permission required: ADMIN_LISTING_VIEW_ALL
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission } from '../../lib/auth-middleware';
import { TranslationRequest, TranslationRequestSummary } from '../../../types/listing.types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('List translation requests:', {
    queryParams: event.queryStringParameters,
  });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} listing translation requests`);

    // 2. Parse pagination parameters
    const limit = Math.min(parseInt(event.queryStringParameters?.limit || '50', 10), 100);
    const lastEvaluatedKey = event.queryStringParameters?.nextToken
      ? JSON.parse(Buffer.from(event.queryStringParameters.nextToken, 'base64').toString())
      : undefined;

    // 3. Query pending translation requests
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': 'TRANSLATION_REQUEST#PENDING',
        },
        Limit: limit,
        ExclusiveStartKey: lastEvaluatedKey,
        ScanIndexForward: false, // Most recent first
      })
    );

    const requests: TranslationRequestSummary[] = (queryResult.Items || []).map((item) => {
      const request = item as TranslationRequest;
      return {
        listingId: request.listingId,
        hostId: request.hostId,
        listingName: request.listingName,
        fieldsToTranslate: request.fieldsToTranslate,
        requestedAt: request.requestedAt,
      };
    });

    // 4. Build pagination token
    let nextToken: string | undefined;
    if (queryResult.LastEvaluatedKey) {
      nextToken = Buffer.from(JSON.stringify(queryResult.LastEvaluatedKey)).toString('base64');
    }

    // 5. Return response
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        data: {
          requests,
          pagination: {
            count: requests.length,
            hasMore: !!nextToken,
            nextToken,
          },
        },
      }),
    };
  } catch (error) {
    console.error('❌ List translation requests error:', error);

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
          message: 'Failed to list translation requests',
        },
      }),
    };
  }
};



