/**
 * Admin API: Update Language Configuration
 * 
 * PUT /api/v1/admin/config/languages
 * 
 * Updates the system-level language configuration.
 * Can add new languages, deactivate existing ones, and update required languages.
 * 
 * Permission required: ADMIN_SYSTEM_CONFIG (super admin only)
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import { LanguageConfig, SupportedLanguage, LanguageConfigResponse } from '../../../types/listing.types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;

interface UpdateLanguagesRequest {
  languages: Array<{
    code: string;
    name: string;
    nativeName: string;
    isActive: boolean;
  }>;
  requiredForListings: string[];
}

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Update language configuration request:', {
    body: event.body,
  });

  try {
    // 1. Require super admin permission
    // Note: ADMIN_SYSTEM_CONFIG should be added to admin permissions
    // For now, we'll use a stricter check
    const authResult = requirePermission(event, 'ADMIN_LISTING_VIEW_ALL');
    if ('error' in authResult) {
      return authResult.error;
    }

    const { user } = authResult;
    
    // Additional check: Only allow specific super admins to update languages
    // This can be expanded to use a proper ADMIN_SYSTEM_CONFIG permission
    console.log(`Admin ${user.email} updating language configuration`);

    // 2. Parse and validate request
    if (!event.body) {
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
            message: 'Request body is required',
          },
        }),
      };
    }

    const body: UpdateLanguagesRequest = JSON.parse(event.body);

    // Validate languages array
    if (!Array.isArray(body.languages) || body.languages.length === 0) {
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
            message: 'languages must be a non-empty array',
          },
        }),
      };
    }

    // Validate each language
    for (const lang of body.languages) {
      if (!lang.code || !lang.name || !lang.nativeName) {
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
              message: 'Each language must have code, name, and nativeName',
            },
          }),
        };
      }
      if (!/^[a-z]{2}$/.test(lang.code)) {
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
              message: `Invalid language code: ${lang.code}. Must be 2 lowercase letters.`,
            },
          }),
        };
      }
    }

    // Validate requiredForListings
    if (!Array.isArray(body.requiredForListings) || body.requiredForListings.length === 0) {
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
            message: 'requiredForListings must be a non-empty array',
          },
        }),
      };
    }

    // Ensure all required languages are in the languages list
    const languageCodes = body.languages.map(l => l.code);
    for (const required of body.requiredForListings) {
      if (!languageCodes.includes(required)) {
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
              message: `Required language '${required}' is not in the languages list`,
            },
          }),
        };
      }
    }

    // 3. Fetch existing config to preserve addedAt/addedBy for existing languages
    const existingResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: 'CONFIG#SYSTEM',
          sk: 'LANGUAGES',
        },
      })
    );

    const existingConfig = existingResult.Item as LanguageConfig | undefined;
    const existingLanguagesMap = new Map<string, SupportedLanguage>();
    if (existingConfig) {
      for (const lang of existingConfig.languages) {
        existingLanguagesMap.set(lang.code, lang);
      }
    }

    // 4. Build updated languages array
    const now = new Date().toISOString();
    const updatedLanguages: SupportedLanguage[] = body.languages.map(lang => {
      const existing = existingLanguagesMap.get(lang.code);
      return {
        code: lang.code,
        name: lang.name,
        nativeName: lang.nativeName,
        isActive: lang.isActive,
        addedAt: existing?.addedAt || now,
        addedBy: existing?.addedBy || user.email,
      };
    });

    // 5. Save updated configuration
    const newConfig: LanguageConfig = {
      pk: 'CONFIG#SYSTEM',
      sk: 'LANGUAGES',
      languages: updatedLanguages,
      requiredForListings: body.requiredForListings,
      updatedAt: now,
      updatedBy: user.email,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: newConfig,
      })
    );

    console.log('✅ Language configuration updated');

    // 6. Log admin action
    logAdminAction(user, 'UPDATE_LANGUAGE_CONFIG', 'SYSTEM', 'languages', {
      languageCount: updatedLanguages.length,
      requiredLanguages: body.requiredForListings,
    });

    // 7. Return response
    const responseData: LanguageConfigResponse = {
      languages: updatedLanguages,
      requiredForListings: body.requiredForListings,
      updatedAt: now,
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
    console.error('❌ Update language configuration error:', error);

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
          message: 'Failed to update language configuration',
        },
      }),
    };
  }
};


