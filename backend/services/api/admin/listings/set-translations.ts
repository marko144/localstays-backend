/**
 * Admin API: Set Listing Translations
 * 
 * PUT /api/v1/admin/listings/{listingId}/translations
 * 
 * Allows admin users to set translations for listing text fields.
 * Admin can ONLY set translations for languages that differ from the originalLanguage.
 * 
 * Permission required: ADMIN_LISTING_VIEW_ALL
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requirePermission, logAdminAction } from '../../lib/auth-middleware';
import {
  SetTranslationsRequest,
  SetTranslationsResponse,
  TranslatableTextField,
  AdminTranslationInput,
} from '../../../types/listing.types';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Main handler
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Set translations request:', {
    listingId: event.pathParameters?.listingId,
    body: event.body,
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

    // 3. Parse request body
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

    const body: SetTranslationsRequest = JSON.parse(event.body);

    // Validate at least one translation is provided
    if (!body.description && !body.checkInDescription && !body.parkingDescription) {
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
            message: 'At least one translation field must be provided',
          },
        }),
      };
    }

    // Validate translation inputs
    const validationError = validateTranslationInputs(body);
    if (validationError) {
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
            message: validationError,
          },
        }),
      };
    }

    console.log(`Admin ${user.email} setting translations for listing: ${listingId}`);

    // 4. Find listing metadata using GSI3
    const queryResult = await docClient.send(
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

    if (!queryResult.Items || queryResult.Items.length === 0) {
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

    const listing = queryResult.Items[0];
    const hostId = listing.hostId;
    const now = new Date().toISOString();

    // 5. Validate that admin is not setting the same language as originalLanguage
    const validationErrors = validateLanguagesAgainstOriginal(body, listing);
    if (validationErrors.length > 0) {
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
            message: validationErrors.join('; '),
          },
        }),
      };
    }

    // 6. Build update expression for each provided translation
    const updateExpressionParts: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};
    const translationsUpdated: string[] = [];

    // Always update the updatedAt timestamp
    updateExpressionParts.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = now;

    // Description translation
    if (body.description) {
      const currentDescription = listing.description as TranslatableTextField;
      const updatedDescription = addTranslationToField(
        currentDescription,
        body.description,
        now,
        user.sub
      );
      updateExpressionParts.push('#description = :description');
      expressionAttributeNames['#description'] = 'description';
      expressionAttributeValues[':description'] = updatedDescription;
      translationsUpdated.push(`description.${body.description.language}`);
    }

    // CheckIn description translation
    if (body.checkInDescription) {
      const currentCheckIn = listing.checkIn as any;
      const currentCheckInDesc = currentCheckIn?.description as TranslatableTextField | undefined;
      
      if (currentCheckInDesc) {
        const updatedCheckInDesc = addTranslationToField(
          currentCheckInDesc,
          body.checkInDescription,
          now,
          user.sub
        );
        const updatedCheckIn = {
          ...currentCheckIn,
          description: updatedCheckInDesc,
        };
        updateExpressionParts.push('#checkIn = :checkIn');
        expressionAttributeNames['#checkIn'] = 'checkIn';
        expressionAttributeValues[':checkIn'] = updatedCheckIn;
        translationsUpdated.push(`checkInDescription.${body.checkInDescription.language}`);
      }
    }

    // Parking description translation
    if (body.parkingDescription) {
      const currentParking = listing.parking as any;
      const currentParkingDesc = currentParking?.description as TranslatableTextField | undefined;
      
      if (currentParkingDesc) {
        const updatedParkingDesc = addTranslationToField(
          currentParkingDesc,
          body.parkingDescription,
          now,
          user.sub
        );
        const updatedParking = {
          ...currentParking,
          description: updatedParkingDesc,
        };
        updateExpressionParts.push('#parking = :parking');
        expressionAttributeNames['#parking'] = 'parking';
        expressionAttributeValues[':parking'] = updatedParking;
        translationsUpdated.push(`parkingDescription.${body.parkingDescription.language}`);
      }
    }

    // 7. Execute update if there are any translations to apply
    if (translationsUpdated.length > 0) {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `HOST#${hostId}`,
            sk: `LISTING_META#${listingId}`,
          },
          UpdateExpression: `SET ${updateExpressionParts.join(', ')}`,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        })
      );

      console.log(`✅ Updated translations: ${translationsUpdated.join(', ')}`);
    }

    // 8. Log admin action
    logAdminAction(user, 'SET_TRANSLATIONS', 'LISTING', listingId, {
      translationsUpdated,
    });

    // 9. Return response
    const responseData: SetTranslationsResponse = {
      listingId,
      translationsUpdated,
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
    console.error('❌ Set translations error:', error);

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
          message: 'Failed to set translations',
        },
      }),
    };
  }
};

/**
 * Validate translation input format
 */
function validateTranslationInputs(body: SetTranslationsRequest): string | null {
  const validateInput = (input: AdminTranslationInput | undefined, fieldName: string): string | null => {
    if (!input) return null;
    
    if (!input.language || !/^[a-z]{2}$/.test(input.language)) {
      return `${fieldName}.language must be a valid 2-letter language code`;
    }
    if (!input.text || input.text.trim().length === 0) {
      return `${fieldName}.text is required`;
    }
    if (input.text.trim().length > 2000) {
      return `${fieldName}.text must not exceed 2000 characters`;
    }
    return null;
  };

  const descError = validateInput(body.description, 'description');
  if (descError) return descError;

  const checkInError = validateInput(body.checkInDescription, 'checkInDescription');
  if (checkInError) return checkInError;

  const parkingError = validateInput(body.parkingDescription, 'parkingDescription');
  if (parkingError) return parkingError;

  return null;
}

/**
 * Validate that admin is not setting translation for the same language the host provided
 */
function validateLanguagesAgainstOriginal(body: SetTranslationsRequest, listing: any): string[] {
  const errors: string[] = [];

  if (body.description) {
    const descriptionField = listing.description as TranslatableTextField;
    if (body.description.language === descriptionField.originalLanguage) {
      errors.push(`Cannot set description translation in '${body.description.language}' - this is the host's original language`);
    }
  }

  if (body.checkInDescription) {
    const checkInDesc = listing.checkIn?.description as TranslatableTextField | undefined;
    if (checkInDesc && body.checkInDescription.language === checkInDesc.originalLanguage) {
      errors.push(`Cannot set checkInDescription translation in '${body.checkInDescription.language}' - this is the host's original language`);
    }
  }

  if (body.parkingDescription) {
    const parkingDesc = listing.parking?.description as TranslatableTextField | undefined;
    if (parkingDesc && body.parkingDescription.language === parkingDesc.originalLanguage) {
      errors.push(`Cannot set parkingDescription translation in '${body.parkingDescription.language}' - this is the host's original language`);
    }
  }

  return errors;
}

/**
 * Add admin translation to a TranslatableTextField
 */
function addTranslationToField(
  field: TranslatableTextField,
  input: AdminTranslationInput,
  now: string,
  adminSub: string
): TranslatableTextField {
  return {
    ...field,
    versions: {
      ...field.versions,
      [input.language]: {
        text: input.text.trim(),
        providedBy: 'ADMIN',
        updatedAt: now,
        updatedBy: adminSub,
      },
    },
  };
}
