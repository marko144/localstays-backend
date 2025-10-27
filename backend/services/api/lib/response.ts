/**
 * Standard API Response Builders
 * Consistent response format across all API endpoints
 */

import { APIGatewayProxyResult } from 'aws-lambda';

/**
 * Standard CORS headers
 */
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*', // TODO: Configure based on environment
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

/**
 * Success response (200)
 */
export function success<T>(data: T, statusCode: number = 200): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(data),
  };
}

/**
 * Created response (201)
 */
export function created<T>(data: T): APIGatewayProxyResult {
  return success(data, 201);
}

/**
 * No content response (204)
 */
export function noContent(): APIGatewayProxyResult {
  return {
    statusCode: 204,
    headers: CORS_HEADERS,
    body: '',
  };
}

/**
 * Bad request error (400)
 */
export function badRequest(message: string, details?: unknown): APIGatewayProxyResult {
  const body: Record<string, unknown> = {
    error: 'BAD_REQUEST',
    message,
  };
  if (details) {
    body.details = details;
  }
  return {
    statusCode: 400,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Unauthorized error (401)
 */
export function unauthorized(message: string = 'Unauthorized'): APIGatewayProxyResult {
  return {
    statusCode: 401,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: 'UNAUTHORIZED',
      message,
    }),
  };
}

/**
 * Forbidden error (403)
 */
export function forbidden(message: string = 'Forbidden'): APIGatewayProxyResult {
  return {
    statusCode: 403,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: 'FORBIDDEN',
      message,
    }),
  };
}

/**
 * Not found error (404)
 */
export function notFound(message: string = 'Resource not found'): APIGatewayProxyResult {
  return {
    statusCode: 404,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: 'NOT_FOUND',
      message,
    }),
  };
}

/**
 * Conflict error (409)
 */
export function conflict(message: string, details?: unknown): APIGatewayProxyResult {
  const body: Record<string, unknown> = {
    error: 'CONFLICT',
    message,
  };
  if (details) {
    body.details = details;
  }
  return {
    statusCode: 409,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Unprocessable entity (422) - validation errors
 */
export function unprocessableEntity(message: string, validationErrors?: unknown): APIGatewayProxyResult {
  const body: Record<string, unknown> = {
    error: 'VALIDATION_ERROR',
    message,
  };
  if (validationErrors) {
    body.validationErrors = validationErrors;
  }
  return {
    statusCode: 422,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Too many requests (429) - rate limit exceeded
 */
export function tooManyRequests(message: string = 'Rate limit exceeded'): APIGatewayProxyResult {
  return {
    statusCode: 429,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: 'RATE_LIMIT_EXCEEDED',
      message,
    }),
  };
}

/**
 * Internal server error (500)
 */
export function internalError(message: string = 'Internal server error', error?: Error): APIGatewayProxyResult {
  // Log error for debugging (will appear in CloudWatch)
  if (error) {
    console.error('Internal error:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
  }
  
  return {
    statusCode: 500,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: 'INTERNAL_SERVER_ERROR',
      message,
    }),
  };
}

/**
 * Handle common errors and return appropriate response
 */
export function handleError(error: unknown): APIGatewayProxyResult {
  console.error('Error occurred:', error);
  
  if (error instanceof Error) {
    const message = error.message;
    
    // Check for specific error patterns
    if (message.includes('UNAUTHORIZED')) {
      return unauthorized(message.replace('UNAUTHORIZED: ', ''));
    }
    
    if (message.includes('FORBIDDEN')) {
      return forbidden(message.replace('FORBIDDEN: ', ''));
    }
    
    if (message.includes('NOT_FOUND')) {
      return notFound(message.replace('NOT_FOUND: ', ''));
    }
    
    if (message.includes('VALIDATION_ERROR')) {
      return badRequest(message.replace('VALIDATION_ERROR: ', ''));
    }
    
    if (message.includes('CONFLICT')) {
      return conflict(message.replace('CONFLICT: ', ''));
    }
    
    // Default to internal error
    return internalError('An unexpected error occurred', error);
  }
  
  return internalError('An unknown error occurred');
}

