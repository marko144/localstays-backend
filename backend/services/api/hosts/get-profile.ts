/**
 * Get Host Profile Lambda Handler
 * Retrieves host profile data and document metadata
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { getAuthContext, assertCanAccessHost } from '../lib/auth';
import * as response from '../lib/response';
import { Host } from '../../types/host.types';
import { Document } from '../../types/document.types';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('Get profile request:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
  });

  try {
    // 1. Extract authentication context
    const auth = getAuthContext(event);
    const hostId = event.pathParameters?.hostId;

    if (!hostId) {
      return response.badRequest('hostId is required in path');
    }

    // 2. Verify authorization
    assertCanAccessHost(auth, hostId);

    // 3. Fetch host record
    const hostRecord = await getHostRecord(hostId);

    if (!hostRecord) {
      return response.notFound(`Host profile not found: ${hostId}`);
    }

    // 4. Fetch associated documents
    const documents = await getHostDocuments(hostId);

    // 5. Build response based on host type
    const profileResponse = buildProfileResponse(hostRecord, documents);

    return response.success(profileResponse);

  } catch (error: any) {
    console.error('Get profile error:', error);
    return response.handleError(error);
  }
}

/**
 * Get host record from DynamoDB
 */
async function getHostRecord(hostId: string): Promise<Host | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `HOST#${hostId}`,
        sk: 'META',
      },
    })
  );

  return result.Item as Host | null;
}

/**
 * Get all documents for a host
 */
async function getHostDocuments(hostId: string): Promise<Document[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':pk': `HOST#${hostId}`,
        ':sk': 'DOCUMENT#',
      },
    })
  );

  return (result.Items || []) as Document[];
}

/**
 * Build profile response with polymorphic structure
 */
function buildProfileResponse(host: Host, documents: Document[]) {
  // Base response (common to all host types)
  const baseResponse = {
    hostId: host.hostId,
    hostType: host.hostType,
    status: host.status,
    email: host.email,
    phone: host.phone,
    preferredLanguage: host.preferredLanguage,
    countryCode: host.countryCode,
    address: host.address,
    
    // Profile photo (optional)
    profilePhoto: host.profilePhoto ? {
      photoId: host.profilePhoto.photoId,
      thumbnailUrl: host.profilePhoto.webpUrls?.thumbnail || '',
      fullUrl: host.profilePhoto.webpUrls?.full || '',
      width: host.profilePhoto.dimensions?.width || 0,
      height: host.profilePhoto.dimensions?.height || 0,
      status: host.profilePhoto.status,
    } : null,
    
    // KYC status
    kyc: {
      status: host.kyc.status,
      submittedAt: host.kyc.submittedAt,
      approvedAt: host.kyc.approvedAt,
      rejectedAt: host.kyc.rejectedAt,
      rejectReason: host.kyc.rejectReason,
      notes: host.kyc.notes,
    },
    
    // Document metadata (no S3 URLs, just metadata)
    documents: documents
      .filter(doc => !doc.isDeleted && doc.status !== 'PENDING_UPLOAD') // Exclude deleted and orphaned documents
      .map(doc => ({
        documentId: doc.documentId,
        documentType: doc.documentType,
        fileName: doc.fileName,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        status: doc.status,
        uploadedAt: doc.uploadedAt,
        reviewedAt: doc.reviewedAt,
        rejectionReason: doc.rejectionReason,
      })),
    
    // Metadata
    createdAt: host.createdAt,
    updatedAt: host.updatedAt,
  };

  // Add type-specific fields
  if (host.hostType === 'INDIVIDUAL') {
    return {
      ...baseResponse,
      forename: host.forename,
      surname: host.surname,
    };
  } else if (host.hostType === 'BUSINESS') {
    return {
      ...baseResponse,
      legalName: host.legalName,
      registrationNumber: host.registrationNumber,
      vatRegistered: host.vatRegistered,
      vatNumber: host.vatNumber,
      displayName: host.displayName,
    };
  }

  return baseResponse;
}

