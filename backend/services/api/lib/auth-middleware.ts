/**
 * Authentication & Authorization Middleware
 * 
 * Provides utilities for enforcing role-based permissions on API endpoints.
 * Extracts user information and permissions from API Gateway event context.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * User context extracted from JWT token (injected by API Gateway authorizer)
 */
export interface UserContext {
  sub: string;                    // Cognito user ID
  email: string;
  role: string;                   // 'HOST' or 'ADMIN'
  permissions: string[];          // Array of permission strings
  hostId?: string;                // Present for HOST role
}

/**
 * Standard error response
 */
export function errorResponse(
  statusCode: number,
  code: string,
  message: string
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      success: false,
      error: {
        code,
        message,
      },
    }),
  };
}

/**
 * Extract user context from API Gateway event
 * 
 * The authorizer adds custom claims to event.requestContext.authorizer.claims
 */
export function getUserContext(event: APIGatewayProxyEvent): UserContext | null {
  try {
    const claims = event.requestContext.authorizer?.claims;
    
    if (!claims) {
      console.error('No authorizer claims found in event');
      return null;
    }

    // Extract standard Cognito claims
    const sub = claims.sub;
    const email = claims.email;
    
    // Extract custom claims (added by PreTokenGeneration Lambda)
    // Note: Claims added via claimsToAddOrOverride don't have 'custom:' prefix
    const role = claims.role;
    const permissionsString = claims.permissions;
    const hostId = claims.hostId; // Optional, only for HOST role

    if (!sub || !email || !role || !permissionsString) {
      console.error('Missing required claims:', { sub, email, role, permissionsString });
      return null;
    }

    // Parse permissions (comma-separated string)
    const permissions = permissionsString.split(',').filter((p: string) => p.length > 0);

    return {
      sub,
      email,
      role,
      permissions,
      hostId: hostId || undefined,
    };
  } catch (error) {
    console.error('Error extracting user context:', error);
    return null;
  }
}

/**
 * Check if user has a specific permission
 */
export function hasPermission(user: UserContext, permission: string): boolean {
  return user.permissions.includes(permission);
}

/**
 * Check if user has ANY of the specified permissions
 */
export function hasAnyPermission(user: UserContext, permissions: string[]): boolean {
  return permissions.some(p => user.permissions.includes(p));
}

/**
 * Check if user has ALL of the specified permissions
 */
export function hasAllPermissions(user: UserContext, permissions: string[]): boolean {
  return permissions.every(p => user.permissions.includes(p));
}

/**
 * Middleware: Require authentication
 * Returns user context or error response
 */
export function requireAuth(
  event: APIGatewayProxyEvent
): { user: UserContext } | { error: APIGatewayProxyResult } {
  const user = getUserContext(event);
  
  if (!user) {
    return {
      error: errorResponse(401, 'UNAUTHORIZED', 'Authentication required'),
    };
  }
  
  return { user };
}

/**
 * Middleware: Require specific permission
 * Returns user context or error response
 */
export function requirePermission(
  event: APIGatewayProxyEvent,
  permission: string
): { user: UserContext } | { error: APIGatewayProxyResult } {
  const authResult = requireAuth(event);
  
  if ('error' in authResult) {
    return authResult;
  }
  
  const { user } = authResult;
  
  if (!hasPermission(user, permission)) {
    console.warn(`Permission denied: User ${user.sub} missing permission ${permission}`);
    return {
      error: errorResponse(
        403,
        'FORBIDDEN',
        `Missing required permission: ${permission}`
      ),
    };
  }
  
  return { user };
}

/**
 * Middleware: Require ANY of the specified permissions
 */
export function requireAnyPermission(
  event: APIGatewayProxyEvent,
  permissions: string[]
): { user: UserContext } | { error: APIGatewayProxyResult } {
  const authResult = requireAuth(event);
  
  if ('error' in authResult) {
    return authResult;
  }
  
  const { user } = authResult;
  
  if (!hasAnyPermission(user, permissions)) {
    console.warn(`Permission denied: User ${user.sub} missing any of ${permissions.join(', ')}`);
    return {
      error: errorResponse(
        403,
        'FORBIDDEN',
        `Missing required permissions. Need one of: ${permissions.join(', ')}`
      ),
    };
  }
  
  return { user };
}

/**
 * Middleware: Require admin role
 * Convenience function for admin-only endpoints
 */
export function requireAdmin(
  event: APIGatewayProxyEvent
): { user: UserContext } | { error: APIGatewayProxyResult } {
  const authResult = requireAuth(event);
  
  if ('error' in authResult) {
    return authResult;
  }
  
  const { user } = authResult;
  
  if (user.role !== 'ADMIN') {
    console.warn(`Access denied: User ${user.sub} is not an admin (role: ${user.role})`);
    return {
      error: errorResponse(403, 'FORBIDDEN', 'Admin access required'),
    };
  }
  
  return { user };
}

/**
 * Middleware: Require host role and verify hostId matches path parameter
 * Used for host-specific endpoints to ensure hosts can only access their own data
 */
export function requireHostAccess(
  event: APIGatewayProxyEvent,
  pathHostId: string
): { user: UserContext } | { error: APIGatewayProxyResult } {
  const authResult = requireAuth(event);
  
  if ('error' in authResult) {
    return authResult;
  }
  
  const { user } = authResult;
  
  // Admins can access any host's data
  if (user.role === 'ADMIN') {
    return { user };
  }
  
  // Hosts can only access their own data
  if (user.role === 'HOST' && user.hostId === pathHostId) {
    return { user };
  }
  
  console.warn(
    `Access denied: User ${user.sub} (hostId: ${user.hostId}) attempted to access hostId: ${pathHostId}`
  );
  
  return {
    error: errorResponse(403, 'FORBIDDEN', 'Access denied'),
  };
}

/**
 * Log audit event for admin actions
 */
export function logAdminAction(
  user: UserContext,
  action: string,
  resourceType: string,
  resourceId: string,
  details?: Record<string, any>
): void {
  console.log(
    JSON.stringify({
      type: 'ADMIN_ACTION',
      timestamp: new Date().toISOString(),
      adminSub: user.sub,
      adminEmail: user.email,
      action,
      resourceType,
      resourceId,
      details: details || {},
    })
  );
}



