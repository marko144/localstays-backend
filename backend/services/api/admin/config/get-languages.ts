/**
 * Admin API: Get Language Configuration
 * 
 * GET /api/v1/admin/config/languages
 * 
 * Returns the system-level language configuration including:
 * - All supported languages
 * - Which languages are required for listings
 * 
 * Permission required: ADMIN_LISTING_VIEW_ALL (any admin can view)
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission } from '../../lib/auth-middleware';
import { LanguageConfig, LanguageConfigResponse } from '../../../types/listing.types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Get language configuration request');

  try {
    // 1. Require admin permission (any admin can view)
    const authResult = requirePermission(event, 'ADMIN_LISTING_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    console.log(`Admin ${user.email} fetching language configuration`);

    // 2. Fetch language configuration
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: 'CONFIG#SYSTEM',
          sk: 'LANGUAGES',
        },
      })
    );

    if (!result.Item) {
      // Return default configuration if not seeded yet
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: true,
          data: {
            languages: [
              { code: 'en', name: 'English', nativeName: 'English', isActive: true },
              { code: 'sr', name: 'Serbian', nativeName: 'Srpski', isActive: true },
            ],
            requiredForListings: ['en', 'sr'],
            updatedAt: null,
          } as LanguageConfigResponse,
        }),
      };
    }

    const config = result.Item as LanguageConfig;

    // 3. Return configuration
    const responseData: LanguageConfigResponse = {
      languages: config.languages,
      requiredForListings: config.requiredForListings,
      updatedAt: config.updatedAt,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        data: responseData,
      }),
    };
  } catch (error) {
    console.error('❌ Get language configuration error:', error);

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
          message: 'Failed to get language configuration',
        },
      }),
    };
  }
};


