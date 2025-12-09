/**
 * Admin Legal Documents Handler
 * 
 * Consolidated handler for all admin legal document operations:
 * - GET /admin/legal/documents - List all documents
 * - GET /admin/legal/documents/{type} - List versions for a document type
 * - GET /admin/legal/documents/{type}/{version} - Get specific document
 * - POST /admin/legal/documents - Upload new document version
 * - GET /admin/legal/acceptances - Query acceptances
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { listDocuments } from './list-documents';
import { listDocumentVersions } from './list-document-versions';
import { getDocument } from './get-document';
import { uploadDocument } from './upload-document';
import { listAcceptances } from './list-acceptances';

/**
 * Route request to appropriate handler based on path and method
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Admin Legal Handler:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
  });

  const { httpMethod, path, pathParameters } = event;

  try {
    // POST /api/v1/admin/legal/documents - Upload new document
    if (httpMethod === 'POST' && path.endsWith('/legal/documents')) {
      return await uploadDocument(event);
    }

    // GET /api/v1/admin/legal/acceptances - List acceptances
    if (httpMethod === 'GET' && path.includes('/legal/acceptances')) {
      return await listAcceptances(event);
    }

    // GET /api/v1/admin/legal/documents/{type}/{version} - Get specific document
    if (httpMethod === 'GET' && pathParameters?.type && pathParameters?.version) {
      return await getDocument(event);
    }

    // GET /api/v1/admin/legal/documents/{type} - List versions for type
    if (httpMethod === 'GET' && pathParameters?.type && !pathParameters?.version) {
      return await listDocumentVersions(event);
    }

    // GET /api/v1/admin/legal/documents - List all documents
    if (httpMethod === 'GET' && path.endsWith('/legal/documents')) {
      return await listDocuments(event);
    }

    // Unknown route
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'NOT_FOUND',
        message: `Route not found: ${httpMethod} ${path}`,
      }),
    };
  } catch (error) {
    console.error('Admin Legal Handler error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
      }),
    };
  }
};

