/**
 * Submit Verification Code Lambda Handler
 * Host endpoint to submit the address verification code
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { decryptVerificationCode } from '../../lib/pdf-generator';
import { sendAddressVerificationApprovedEmail, sendAddressVerificationRejectedEmail } from '../lib/email-service';
import { Request } from '../../types/request.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;
const MAX_ATTEMPTS = 3;

interface SubmitCodeRequest {
  code: string;
}

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Submit verification code request:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
  });

  try {
    // 1. Extract authentication context
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;
    const listingId = event.pathParameters?.listingId;
    const requestId = event.pathParameters?.requestId;

    if (!hostId || !listingId || !requestId) {
      return response.badRequest('hostId, listingId, and requestId are required in path');
    }

    // 2. Verify authorization
    assertCanAccessHost(auth, hostId);

    // 3. Parse request body
    if (!event.body) {
      return response.badRequest('Request body is required');
    }

    let requestBody: SubmitCodeRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return response.badRequest('Invalid JSON in request body');
    }

    const { code } = requestBody;

    if (!code || typeof code !== 'string') {
      return response.badRequest('code is required and must be a string');
    }

    // Normalize code (trim whitespace, preserve case)
    const submittedCode = code.trim();

    if (submittedCode.length !== 6) {
      return response.badRequest('Verification code must be exactly 6 characters');
    }

    // 4. Fetch request record
    const requestRecord = await getRequestById(requestId);

    if (!requestRecord) {
      return response.notFound('Request not found');
    }

    // 5. Validate request belongs to this listing and host
    if (requestRecord.listingId !== listingId || requestRecord.hostId !== hostId) {
      return response.forbidden('Request does not belong to this listing');
    }

    // 6. Validate request type
    if (requestRecord.requestType !== 'ADDRESS_VERIFICATION') {
      return response.badRequest('This endpoint is only for address verification requests');
    }

    // 7. Check if already approved or rejected
    if (requestRecord.status === 'VERIFIED') {
      return response.badRequest('This request has already been verified');
    }

    if (requestRecord.status === 'REJECTED') {
      return response.badRequest('This request has been rejected due to too many failed attempts');
    }

    // 8. Check if request is in correct status
    if (requestRecord.status !== 'REQUESTED') {
      return response.badRequest(`Request is in ${requestRecord.status} status and cannot accept code submissions`);
    }

    // 9. Decrypt and compare codes
    const actualCode = decryptVerificationCode(requestRecord.verificationCode!);
    const isCorrect = submittedCode === actualCode;

    const updatedAt = new Date().toISOString();

    if (isCorrect) {
      // ✅ Code is correct - approve the request
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            pk: `LISTING#${listingId}`,
            sk: `REQUEST#${requestId}`,
          },
          UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, reviewedAt = :reviewedAt, gsi2pk = :gsi2pk, gsi2sk = :gsi2sk',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': 'VERIFIED',
            ':updatedAt': updatedAt,
            ':reviewedAt': updatedAt,
            ':gsi2pk': `REQUEST#ADDRESS_VERIFICATION`,
            ':gsi2sk': `STATUS#VERIFIED#${updatedAt}`,
          },
        })
      );

      console.log(`✅ Address verification successful for request ${requestId}`);

      // Send approval email
      try {
        const host = await getHostById(hostId);
        if (host) {
          const hostName = host.hostType === 'INDIVIDUAL'
            ? `${host.forename} ${host.surname}`
            : host.legalName || host.displayName;
          const language = host.preferredLanguage === 'sr' || host.preferredLanguage === 'sr-RS' ? 'sr' : 'en';

          await sendAddressVerificationApprovedEmail(
            host.email,
            language,
            hostName,
            '' // listing address not needed for approval email
          );

          console.log(`✅ Approval email sent to ${host.email}`);
        }
      } catch (emailError: any) {
        console.error('Failed to send approval email (non-fatal):', emailError.message);
      }

      return response.success({
        success: true,
        requestId,
        status: 'VERIFIED',
        message: 'Verification code accepted. Your address has been verified!',
      });

    } else {
      // ❌ Code is incorrect - increment attempts
      const newAttempts = (requestRecord.codeAttempts || 0) + 1;
      const remainingAttempts = MAX_ATTEMPTS - newAttempts;

      if (newAttempts >= MAX_ATTEMPTS) {
        // Too many failed attempts - reject the request
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: `LISTING#${listingId}`,
              sk: `REQUEST#${requestId}`,
            },
            UpdateExpression: 'SET #status = :status, codeAttempts = :attempts, updatedAt = :updatedAt, reviewedAt = :reviewedAt, gsi2pk = :gsi2pk, gsi2sk = :gsi2sk',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': 'REJECTED',
              ':attempts': newAttempts,
              ':updatedAt': updatedAt,
              ':reviewedAt': updatedAt,
              ':gsi2pk': `REQUEST#ADDRESS_VERIFICATION`,
              ':gsi2sk': `STATUS#REJECTED#${updatedAt}`,
            },
          })
        );

        console.log(`❌ Address verification rejected for request ${requestId} - too many failed attempts`);

        // Send rejection email
        try {
          const host = await getHostById(hostId);
          if (host) {
            const hostName = host.hostType === 'INDIVIDUAL'
              ? `${host.forename} ${host.surname}`
              : host.legalName || host.displayName;
            const language = host.preferredLanguage === 'sr' || host.preferredLanguage === 'sr-RS' ? 'sr' : 'en';

            await sendAddressVerificationRejectedEmail(
              host.email,
              language,
              hostName
            );

            console.log(`✅ Rejection email sent to ${host.email}`);
          }
        } catch (emailError: any) {
          console.error('Failed to send rejection email (non-fatal):', emailError.message);
        }

        return response.success({
          success: false,
          requestId,
          status: 'REJECTED',
          message: 'Incorrect verification code. Maximum attempts exceeded. This request has been rejected.',
          attemptsUsed: newAttempts,
          maxAttempts: MAX_ATTEMPTS,
          remainingAttempts: 0,
        }, 400);

      } else {
        // Increment attempts but keep status as REQUESTED
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: `LISTING#${listingId}`,
              sk: `REQUEST#${requestId}`,
            },
            UpdateExpression: 'SET codeAttempts = :attempts, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
              ':attempts': newAttempts,
              ':updatedAt': updatedAt,
            },
          })
        );

        console.log(`❌ Incorrect code submitted for request ${requestId}. Attempts: ${newAttempts}/${MAX_ATTEMPTS}`);

        return response.success({
          success: false,
          requestId,
          status: 'REQUESTED',
          message: `Incorrect verification code. You have ${remainingAttempts} attempt(s) remaining.`,
          attemptsUsed: newAttempts,
          maxAttempts: MAX_ATTEMPTS,
          remainingAttempts,
        }, 400);
      }
    }

  } catch (error: any) {
    console.error('Submit verification code error:', error);
    return response.handleError(error);
  }
}

/**
 * Get request by ID using GSI3
 */
async function getRequestById(requestId: string): Promise<Request | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'DocumentStatusIndex', // GSI3
      KeyConditionExpression: 'gsi3pk = :gsi3pk AND begins_with(gsi3sk, :gsi3sk)',
      ExpressionAttributeValues: {
        ':gsi3pk': `REQUEST#${requestId}`,
        ':gsi3sk': 'REQUEST_META#',
      },
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0] as Request;
}

/**
 * Get host by ID
 */
async function getHostById(hostId: string): Promise<any> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk = :sk',
      ExpressionAttributeValues: {
        ':pk': `HOST#${hostId}`,
        ':sk': 'META',
      },
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0];
}

