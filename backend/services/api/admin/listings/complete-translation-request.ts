/**
 * Admin API: Complete Translation Request
 * 
 * PATCH /api/v1/admin/translation-requests/{listingId}/complete
 * 
 * Marks a translation request as complete.
 * Validates that all required languages have been provided for all fields.
 * Deletes the PENDING translation request record.
 * 
 * Permission required: ADMIN_LISTING_VIEW_ALL
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import {
  TranslatableTextField,
  LanguageConfig,
  CompleteTranslationRequestResponse,
} from '../../../types/listing.types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Complete translation request:', {
    listingId: event.pathParameters?.listingId,
  });

  try {
    // 1. Require admin permission
    const authResult = requirePermission(event, 'ADMIN_LISTING_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;

    // 2. Extract listingId from path
    const listingId = event.pathParameters?.listingId;

    if (!listingId) {
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
            message: 'listingId is required',
          },
        }),
      };
    }

    console.log(`Admin ${user.email} completing translation request for listing: ${listingId}`);

    // 3. Check if translation request exists
    const translationRequestResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: 'TRANSLATION_REQUEST#PENDING',
          sk: `LISTING#${listingId}`,
        },
      })
    );

    if (!translationRequestResult.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'No pending translation request found for this listing',
          },
        }),
      };
    }

    // 4. Fetch language configuration to know required languages
    const languageConfigResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: 'CONFIG#SYSTEM',
          sk: 'LANGUAGES',
        },
      })
    );

    const languageConfig = languageConfigResult.Item as LanguageConfig | undefined;
    const requiredLanguages = languageConfig?.requiredForListings || ['en', 'sr'];

    // 5. Fetch listing to validate all translations are present
    const listingResult = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'DocumentStatusIndex',
        KeyConditionExpression: 'gsi3pk = :gsi3pk AND begins_with(gsi3sk, :gsi3sk)',
        ExpressionAttributeValues: {
          ':gsi3pk': `LISTING#${listingId}`,
          ':gsi3sk': 'LISTING_META#',
        },
        Limit: 1,
      })
    );

    if (!listingResult.Items || listingResult.Items.length === 0) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Listing not found',
          },
        }),
      };
    }

    const listing = listingResult.Items[0];

    // 6. Validate all required translations are present
    const missingTranslations = validateAllTranslationsPresent(listing, requiredLanguages);
    
    if (missingTranslations.length > 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          success: false,
          error: {
            code: 'INCOMPLETE_TRANSLATIONS',
            message: 'Not all required translations are present',
            details: missingTranslations,
          },
        }),
      };
    }

    // 7. Delete the pending translation request
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: 'TRANSLATION_REQUEST#PENDING',
          sk: `LISTING#${listingId}`,
        },
      })
    );

    const now = new Date().toISOString();
    console.log(`✅ Translation request completed for listing ${listingId}`);

    // 8. Log admin action
    logAdminAction(user, 'COMPLETE_TRANSLATION_REQUEST', 'LISTING', listingId, {
      requiredLanguages,
    });

    // 9. Return response
    const responseData: CompleteTranslationRequestResponse = {
      listingId,
      completedAt: now,
      completedBy: user.email,
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
    console.error('❌ Complete translation request error:', error);

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
          message: 'Failed to complete translation request',
        },
      }),
    };
  }
};

/**
 * Validate that all required language translations are present
 */
function validateAllTranslationsPresent(
  listing: any,
  requiredLanguages: string[]
): string[] {
  const missing: string[] = [];

  // Check description (required field)
  const descriptionField = listing.description as TranslatableTextField;
  if (descriptionField) {
    for (const lang of requiredLanguages) {
      if (!descriptionField.versions[lang]?.text) {
        missing.push(`description.${lang}`);
      }
    }
  }

  // Check checkIn description (optional field - only check if exists)
  const checkInDesc = listing.checkIn?.description as TranslatableTextField | undefined;
  if (checkInDesc) {
    for (const lang of requiredLanguages) {
      if (!checkInDesc.versions[lang]?.text) {
        missing.push(`checkInDescription.${lang}`);
      }
    }
  }

  // Check parking description (optional field - only check if exists)
  const parkingDesc = listing.parking?.description as TranslatableTextField | undefined;
  if (parkingDesc) {
    for (const lang of requiredLanguages) {
      if (!parkingDesc.versions[lang]?.text) {
        missing.push(`parkingDescription.${lang}`);
      }
    }
  }

  return missing;
}


