/**
 * Authentication and Authorization Utilities
 * Extracts and validates JWT claims from API Gateway events
 */

import { APIGatewayProxyEvent } from 'aws-lambda';

export interface AuthContext {
  userId: string;              // Cognito sub
  email: string;
  hostId?: string;             // Optional - only present for HOST role
  role: 'HOST' | 'ADMIN';
  permissions: string[];
  hostStatus?: string;         // Optional - only present for HOST role
}

/**
 * Extract authentication context from API Gateway event
 * API Gateway Cognito Authorizer populates requestContext.authorizer.claims
 * 
 * @throws Error if claims are missing or invalid
 */
export function getAuthContext(event: APIGatewayProxyEvent): AuthContext {
  const claims = event.requestContext.authorizer?.claims;
  
  if (!claims) {
    throw new Error('UNAUTHORIZED: No authentication claims found');
  }
  
  // Validate required claims
  if (!claims.sub) {
    throw new Error('UNAUTHORIZED: Missing user ID in claims');
  }
  
  if (!claims.email) {
    throw new Error('UNAUTHORIZED: Missing email in claims');
  }
  
  if (!claims.role || !['HOST', 'ADMIN'].includes(claims.role)) {
    throw new Error('UNAUTHORIZED: Invalid or missing role in claims');
  }

  // hostId is only required for HOST role
  if (claims.role === 'HOST' && !claims.hostId) {
    throw new Error('UNAUTHORIZED: Missing hostId in claims for HOST user');
  }
  
  // Parse permissions (stringified array in JWT)
  let permissions: string[] = [];
  try {
    permissions = claims.permissions ? JSON.parse(claims.permissions) : [];
  } catch (error) {
    console.error('Failed to parse permissions from JWT:', error);
    permissions = [];
  }
  
  return {
    userId: claims.sub,
    email: claims.email,
    hostId: claims.hostId,
    role: claims.role as 'HOST' | 'ADMIN',
    permissions,
    hostStatus: claims.hostStatus || 'UNKNOWN',
  };
}

/**
 * Check if user has a specific permission
 */
export function hasPermission(auth: AuthContext, permission: string): boolean {
  return auth.permissions.includes(permission);
}

/**
 * Check if user can access a specific host's resources
 * Admins can access any host, hosts can only access their own
 */
export function canAccessHost(auth: AuthContext, targetHostId: string): boolean {
  if (auth.role === 'ADMIN') {
    return true;
  }
  
  return auth.hostId === targetHostId;
}

/**
 * Check if user can perform an operation on a host
 */
export function canPerformOperation(
  auth: AuthContext,
  targetHostId: string,
  operation: 'read' | 'write' | 'delete'
): boolean {
  // Admins have full access
  if (auth.role === 'ADMIN') {
    return true;
  }
  
  // Hosts can only access their own resources
  if (auth.hostId !== targetHostId) {
    return false;
  }
  
  // Check specific permissions
  const permissionMap: Record<string, string> = {
    read: 'listings:read',
    write: 'listings:write',
    delete: 'listings:delete',
  };
  
  return hasPermission(auth, permissionMap[operation]);
}

/**
 * Assert user can access host (throws if not)
 */
export function assertCanAccessHost(auth: AuthContext, targetHostId: string): void {
  if (!canAccessHost(auth, targetHostId)) {
    throw new Error(
      `FORBIDDEN: User ${auth.userId} (host: ${auth.hostId}) cannot access host ${targetHostId}`
    );
  }
}

/**
 * Assert user has permission (throws if not)
 */
export function assertHasPermission(auth: AuthContext, permission: string): void {
  if (!hasPermission(auth, permission)) {
    throw new Error(
      `FORBIDDEN: User ${auth.userId} does not have permission: ${permission}`
    );
  }
}

/**
 * Assert user is an admin (throws if not)
 */
export function assertIsAdmin(auth: AuthContext): void {
  if (auth.role !== 'ADMIN') {
    throw new Error(
      `FORBIDDEN: User ${auth.userId} is not an admin`
    );
  }
}

