# Frontend JWT Token Guide

## Overview

This guide explains how the frontend should read user role and permissions data from the Cognito JWT token after authentication.

---

## 🔑 JWT Token Structure

After a user successfully logs in via AWS Cognito, they receive a JWT **ID Token** that contains custom claims injected by our backend.

### Standard Claims (Always Present)

- `sub`: User's unique ID (Cognito user sub)
- `email`: User's email address
- `email_verified`: Boolean indicating if email is verified
- `cognito:groups`: Array of Cognito groups the user belongs to (e.g., `["HOST"]` or `["ADMIN"]`)

### Custom Claims (Injected by Backend)

These are added by our `PreTokenGeneration` Lambda trigger:

| Claim         | Type     | Description                                                               | Present For     |
| ------------- | -------- | ------------------------------------------------------------------------- | --------------- |
| `role`        | `string` | User's role: `"HOST"` or `"ADMIN"`                                        | All users       |
| `permissions` | `string` | Comma-separated list of permissions                                       | All users       |
| `status`      | `string` | User account status: `"ACTIVE"`, `"SUSPENDED"`, `"BANNED"`                | All users       |
| `hostId`      | `string` | Host identifier (e.g., `"host_<uuid>"`)                                   | HOST users only |
| `hostStatus`  | `string` | Host profile status: `"INCOMPLETE"`, `"VERIFICATION"`, `"VERIFIED"`, etc. | HOST users only |

---

## 📖 How to Read Claims from JWT

### Using AWS Amplify (Recommended)

```typescript
import { Auth } from "aws-amplify";

interface UserClaims {
  sub: string;
  email: string;
  role: "HOST" | "ADMIN";
  permissions: string; // Comma-separated
  status: string;
  hostId?: string; // Only for HOST users
  hostStatus?: string; // Only for HOST users
}

async function getUserClaims(): Promise<UserClaims | null> {
  try {
    const session = await Auth.currentSession();
    const idToken = session.getIdToken();
    const claims = idToken.payload as UserClaims;

    return claims;
  } catch (error) {
    console.error("Failed to get user claims:", error);
    return null;
  }
}
```

### Parsing Permissions

Permissions are stored as a **comma-separated string** in the JWT. Parse them into an array:

```typescript
function getPermissions(claims: UserClaims): string[] {
  if (!claims.permissions) {
    return [];
  }

  return claims.permissions
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// Usage
const claims = await getUserClaims();
if (claims) {
  const permissions = getPermissions(claims);
  console.log("User permissions:", permissions);
  // e.g., ["HOST_LISTING_CREATE", "HOST_LISTING_VIEW_OWN", ...]
}
```

### Checking Permissions

```typescript
function hasPermission(claims: UserClaims, permission: string): boolean {
  const permissions = getPermissions(claims);
  return permissions.includes(permission);
}

// Usage
const claims = await getUserClaims();
if (claims && hasPermission(claims, "ADMIN_HOST_VIEW_ALL")) {
  // User has admin permission to view all hosts
  console.log("User can view all hosts");
}
```

### Role-Based UI Display

```typescript
function isAdmin(claims: UserClaims): boolean {
  return claims.role === "ADMIN";
}

function isHost(claims: UserClaims): boolean {
  return claims.role === "HOST";
}

// Usage in React component
const claims = await getUserClaims();
if (claims) {
  if (isAdmin(claims)) {
    // Show admin dashboard
  } else if (isHost(claims)) {
    // Show host dashboard
  }
}
```

---

## 🛡️ Frontend Authorization Patterns

### 1. Route Protection

```typescript
import { Navigate } from "react-router-dom";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: "HOST" | "ADMIN";
  requiredPermission?: string;
}

function ProtectedRoute({
  children,
  requiredRole,
  requiredPermission,
}: ProtectedRouteProps) {
  const [claims, setClaims] = useState<UserClaims | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUserClaims().then((claims) => {
      setClaims(claims);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!claims) {
    return <Navigate to="/login" />;
  }

  if (requiredRole && claims.role !== requiredRole) {
    return <Navigate to="/unauthorized" />;
  }

  if (requiredPermission && !hasPermission(claims, requiredPermission)) {
    return <Navigate to="/unauthorized" />;
  }

  return <>{children}</>;
}

// Usage
<Route
  path="/admin/hosts"
  element={
    <ProtectedRoute
      requiredRole="ADMIN"
      requiredPermission="ADMIN_HOST_VIEW_ALL"
    >
      <AdminHostsPage />
    </ProtectedRoute>
  }
/>;
```

### 2. Conditional Rendering

```typescript
function HostProfileActions() {
  const [claims, setClaims] = useState<UserClaims | null>(null);

  useEffect(() => {
    getUserClaims().then(setClaims);
  }, []);

  if (!claims) return null;

  return (
    <div>
      {hasPermission(claims, "HOST_LISTING_CREATE") && (
        <button>Create New Listing</button>
      )}

      {hasPermission(claims, "HOST_LISTING_DELETE") && (
        <button>Delete Listing</button>
      )}

      {isAdmin(claims) && <button>View All Hosts</button>}
    </div>
  );
}
```

### 3. API Request Authorization

Include the JWT token in API requests:

```typescript
import { Auth } from "aws-amplify";

async function callAdminAPI(endpoint: string, options: RequestInit = {}) {
  try {
    const session = await Auth.currentSession();
    const idToken = session.getIdToken().getJwtToken();

    const response = await fetch(endpoint, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("API call failed:", error);
    throw error;
  }
}

// Usage
const hosts = await callAdminAPI(
  "https://tqaq505m83.execute-api.eu-north-1.amazonaws.com/dev1/api/v1/admin/hosts?page=1"
);
```

---

## 📋 Example JWT Payload

### HOST User

```json
{
  "sub": "e0fcd9dc-d081-703b-e548-1231aa072b75",
  "email": "host@example.com",
  "email_verified": true,
  "cognito:groups": ["HOST"],
  "role": "HOST",
  "permissions": "HOST_LISTING_CREATE,HOST_LISTING_EDIT_DRAFT,HOST_LISTING_SUBMIT_REVIEW,HOST_LISTING_SET_OFFLINE,HOST_LISTING_SET_ONLINE,HOST_LISTING_VIEW_OWN,HOST_LISTING_DELETE,HOST_KYC_SUBMIT",
  "status": "ACTIVE",
  "hostId": "host_2fd670a7-8fb6-4a86-9170-2648096f211a",
  "hostStatus": "VERIFIED"
}
```

### ADMIN User

```json
{
  "sub": "009cf92c-10f1-704f-2fd3-ae067e12f64e",
  "email": "admin@example.com",
  "email_verified": true,
  "cognito:groups": ["ADMIN"],
  "role": "ADMIN",
  "permissions": "ADMIN_HOST_VIEW_ALL,ADMIN_HOST_SEARCH,ADMIN_HOST_SUSPEND,ADMIN_HOST_REINSTATE,ADMIN_KYC_VIEW_ALL,ADMIN_KYC_APPROVE,ADMIN_KYC_REJECT,ADMIN_LISTING_VIEW_ALL,ADMIN_LISTING_APPROVE,ADMIN_LISTING_REJECT,ADMIN_LISTING_SUSPEND,ADMIN_REQUEST_VIEW_ALL,ADMIN_REQUEST_APPROVE,ADMIN_REQUEST_REJECT",
  "status": "ACTIVE"
}
```

---

## 🔄 Token Refresh

JWT tokens expire after **1 hour**. AWS Amplify automatically handles token refresh using the refresh token (valid for 30 days).

**Important**: When a token is refreshed, the `PreTokenGeneration` Lambda runs again and re-reads user data from DynamoDB. This means:

- ✅ Permission changes take effect within 1 hour (or sooner on manual logout/login)
- ✅ Role changes are reflected immediately on next token refresh
- ✅ Account status changes (SUSPENDED, BANNED) are enforced on next refresh

### Force Token Refresh (if needed)

```typescript
async function forceRefreshToken() {
  try {
    const user = await Auth.currentAuthenticatedUser();
    const session = await Auth.currentSession();

    // Force refresh
    await user.refreshSession(
      session.getRefreshToken(),
      (err: any, newSession: any) => {
        if (err) {
          console.error("Token refresh failed:", err);
        } else {
          console.log("Token refreshed successfully");
        }
      }
    );
  } catch (error) {
    console.error("Failed to refresh token:", error);
  }
}
```

---

## 🚨 Security Best Practices

### 1. Never Trust Frontend Validation Alone

- Always send the JWT token with API requests
- Backend **must** validate permissions on every request
- Frontend checks are for UX only (hiding buttons, etc.)

### 2. Handle Token Expiry Gracefully

```typescript
import { Auth } from "aws-amplify";

Auth.configure({
  // ... other config
});

// Listen for auth state changes
Hub.listen("auth", (data) => {
  const { payload } = data;

  if (payload.event === "tokenRefresh_failure") {
    // Token refresh failed - user needs to login again
    console.error("Token refresh failed");
    // Redirect to login
  }
});
```

### 3. Clear Tokens on Logout

```typescript
async function logout() {
  try {
    await Auth.signOut();
    // Clear any cached user data
    setClaims(null);
    // Redirect to login
  } catch (error) {
    console.error("Logout failed:", error);
  }
}
```

### 4. Validate Claims Structure

```typescript
function validateClaims(claims: any): claims is UserClaims {
  return (
    typeof claims === "object" &&
    typeof claims.sub === "string" &&
    typeof claims.email === "string" &&
    (claims.role === "HOST" || claims.role === "ADMIN") &&
    typeof claims.permissions === "string" &&
    typeof claims.status === "string"
  );
}

// Usage
const claims = await getUserClaims();
if (claims && validateClaims(claims)) {
  // Claims are valid
} else {
  // Invalid claims - force logout
  await logout();
}
```

---

## 📚 Complete TypeScript Helper Library

```typescript
// auth-utils.ts
import { Auth } from "aws-amplify";

export interface UserClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  "cognito:groups": string[];
  role: "HOST" | "ADMIN";
  permissions: string;
  status: "ACTIVE" | "SUSPENDED" | "BANNED";
  hostId?: string;
  hostStatus?: string;
}

export async function getUserClaims(): Promise<UserClaims | null> {
  try {
    const session = await Auth.currentSession();
    const idToken = session.getIdToken();
    return idToken.payload as UserClaims;
  } catch (error) {
    console.error("Failed to get user claims:", error);
    return null;
  }
}

export function getPermissions(claims: UserClaims): string[] {
  if (!claims.permissions) return [];
  return claims.permissions
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function hasPermission(claims: UserClaims, permission: string): boolean {
  const permissions = getPermissions(claims);
  return permissions.includes(permission);
}

export function hasAnyPermission(
  claims: UserClaims,
  permissions: string[]
): boolean {
  const userPermissions = getPermissions(claims);
  return permissions.some((p) => userPermissions.includes(p));
}

export function hasAllPermissions(
  claims: UserClaims,
  permissions: string[]
): boolean {
  const userPermissions = getPermissions(claims);
  return permissions.every((p) => userPermissions.includes(p));
}

export function isAdmin(claims: UserClaims): boolean {
  return claims.role === "ADMIN";
}

export function isHost(claims: UserClaims): boolean {
  return claims.role === "HOST";
}

export function isActive(claims: UserClaims): boolean {
  return claims.status === "ACTIVE";
}

export function isSuspended(claims: UserClaims): boolean {
  return claims.status === "SUSPENDED";
}

export function getAuthHeaders(): Promise<Record<string, string>> {
  return Auth.currentSession().then((session) => ({
    Authorization: `Bearer ${session.getIdToken().getJwtToken()}`,
    "Content-Type": "application/json",
  }));
}
```

---

## 🎯 Quick Reference

### HOST Permissions

- `HOST_LISTING_CREATE`
- `HOST_LISTING_EDIT_DRAFT`
- `HOST_LISTING_SUBMIT_REVIEW`
- `HOST_LISTING_SET_OFFLINE`
- `HOST_LISTING_SET_ONLINE`
- `HOST_LISTING_VIEW_OWN`
- `HOST_LISTING_DELETE`
- `HOST_KYC_SUBMIT`
- `HOST_REQUEST_VIEW_OWN`
- `HOST_REQUEST_SUBMIT`

### ADMIN Permissions

- `ADMIN_HOST_VIEW_ALL`
- `ADMIN_HOST_SEARCH`
- `ADMIN_HOST_SUSPEND`
- `ADMIN_HOST_REINSTATE`
- `ADMIN_KYC_VIEW_ALL`
- `ADMIN_KYC_APPROVE`
- `ADMIN_KYC_REJECT`
- `ADMIN_LISTING_VIEW_ALL`
- `ADMIN_LISTING_APPROVE`
- `ADMIN_LISTING_REJECT`
- `ADMIN_LISTING_SUSPEND`
- `ADMIN_REQUEST_VIEW_ALL`
- `ADMIN_REQUEST_APPROVE`
- `ADMIN_REQUEST_REJECT`

---

## ✅ Testing Credentials

### Admin User (dev1 environment)

```
Email: marko+admin@velocci.me
Password: Password1*
```

This admin user has all 14 admin permissions and can access all `/api/v1/admin/*` endpoints.

---

## 📞 Support

For questions or issues with JWT token handling:

1. Check CloudWatch logs for PreTokenGeneration Lambda
2. Verify user record exists in DynamoDB (`USER#<sub>` with `PROFILE` sort key)
3. Ensure ADMIN/HOST group membership in Cognito
4. Check that token hasn't expired (1 hour lifetime)

---

**Last Updated**: October 27, 2025  
**Version**: 1.0.0
