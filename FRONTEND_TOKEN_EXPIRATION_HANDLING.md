# Frontend: JWT Token Expiration Handling

**Date:** 2025-11-11  
**Status:** ✅ Backend CORS Fix Deployed

---

## What Was Fixed

API Gateway now returns proper CORS headers on **401 Unauthorized** and **403 Forbidden** responses. This means when a JWT token expires or is invalid, the frontend will receive a proper error response instead of a CORS error.

---

## The Problem (Before)

When a user's JWT token expired:

1. Frontend made API request with expired token
2. API Gateway authorizer rejected it with **401 Unauthorized**
3. **No CORS headers** were included in the 401 response
4. Browser blocked the response
5. Frontend saw: `"No 'Access-Control-Allow-Origin' header is present"` (CORS error)
6. **Actual error was hidden** - couldn't tell it was a token expiration

---

## The Solution (After)

API Gateway now includes CORS headers on all error responses:

- ✅ 401 Unauthorized (token expired/invalid)
- ✅ 403 Forbidden (insufficient permissions)
- ✅ All 4xx errors
- ✅ All 5xx errors

**Result:** Frontend can now see the actual error and handle it properly.

---

## How Frontend Should Handle Token Expiration

### 1. Detect 401 Responses

When you receive a **401 Unauthorized** response from the API:

```typescript
// Example API call
try {
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401) {
    // Token is expired or invalid
    handleTokenExpiration();
    return;
  }

  // ... handle success
} catch (error) {
  console.error("API Error:", error);
}
```

### 2. Implement Token Refresh

**Option A: Automatic Token Refresh (Recommended)**

Use AWS Amplify's built-in token refresh:

```typescript
import { Auth } from "aws-amplify";

async function getValidToken(): Promise<string> {
  try {
    // Amplify automatically refreshes the token if expired
    const session = await Auth.currentSession();
    return session.getIdToken().getJwtToken();
  } catch (error) {
    console.error("Failed to get valid token:", error);
    // Redirect to login
    redirectToLogin();
    throw error;
  }
}

// Use this in your API calls
const token = await getValidToken();
```

**Option B: Manual Token Refresh**

```typescript
import { Auth } from "aws-amplify";

async function refreshToken(): Promise<string> {
  try {
    const cognitoUser = await Auth.currentAuthenticatedUser();
    const session = await Auth.currentSession();

    // Force refresh
    await cognitoUser.refreshSession(
      session.getRefreshToken(),
      (err, session) => {
        if (err) {
          throw err;
        }
        return session.getIdToken().getJwtToken();
      }
    );
  } catch (error) {
    console.error("Token refresh failed:", error);
    redirectToLogin();
    throw error;
  }
}
```

### 3. Implement Axios Interceptor (If Using Axios)

Automatically retry requests with refreshed token:

```typescript
import axios from "axios";
import { Auth } from "aws-amplify";

// Request interceptor: Add token to all requests
axios.interceptors.request.use(
  async (config) => {
    try {
      const session = await Auth.currentSession();
      const token = session.getIdToken().getJwtToken();
      config.headers.Authorization = `Bearer ${token}`;
    } catch (error) {
      console.error("Failed to get token:", error);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: Handle 401 and retry
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and haven't retried yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Refresh token
        const session = await Auth.currentSession();
        const newToken = session.getIdToken().getJwtToken();

        // Update header and retry
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return axios(originalRequest);
      } catch (refreshError) {
        // Refresh failed - redirect to login
        console.error("Token refresh failed:", refreshError);
        redirectToLogin();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
```

### 4. Implement Fetch Wrapper (If Using Fetch)

```typescript
import { Auth } from "aws-amplify";

async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  try {
    // Get valid token (auto-refreshes if needed)
    const session = await Auth.currentSession();
    const token = session.getIdToken().getJwtToken();

    // Add token to headers
    const headers = {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    // Make request
    const response = await fetch(url, { ...options, headers });

    // If 401, try one more time with fresh token
    if (response.status === 401 && !options._retry) {
      console.log("Token expired, refreshing...");

      // Force refresh
      const cognitoUser = await Auth.currentAuthenticatedUser();
      const currentSession = await Auth.currentSession();

      await new Promise((resolve, reject) => {
        cognitoUser.refreshSession(
          currentSession.getRefreshToken(),
          (err, session) => {
            if (err) reject(err);
            else resolve(session);
          }
        );
      });

      // Retry with new token
      const newSession = await Auth.currentSession();
      const newToken = newSession.getIdToken().getJwtToken();

      return fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${newToken}`,
          "Content-Type": "application/json",
        },
        _retry: true, // Prevent infinite loops
      });
    }

    return response;
  } catch (error) {
    console.error("Authenticated fetch failed:", error);
    redirectToLogin();
    throw error;
  }
}

// Usage
const response = await authenticatedFetch(
  "https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1/admin/listings/...",
  { method: "PUT" }
);
```

---

## Recommended Approach

### Use AWS Amplify's Built-in Token Management

AWS Amplify automatically handles token refresh. You just need to:

1. **Always get the current session before API calls**
2. **Handle 401 responses by redirecting to login**

```typescript
import { Auth } from "aws-amplify";

// Create a reusable API client
class ApiClient {
  private baseUrl =
    "https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1";

  async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    try {
      // Get current session (auto-refreshes if needed)
      const session = await Auth.currentSession();
      const token = session.getIdToken().getJwtToken();

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      // Handle 401 - token refresh failed
      if (response.status === 401) {
        console.error("Authentication failed - redirecting to login");
        this.redirectToLogin();
        throw new Error("Authentication required");
      }

      // Handle 403 - insufficient permissions
      if (response.status === 403) {
        const error = await response.json();
        throw new Error(error.error?.message || "Access denied");
      }

      // Parse response
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "API request failed");
      }

      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  private redirectToLogin() {
    // Clear session
    Auth.signOut();
    // Redirect to login page
    window.location.href = "/login";
  }
}

// Usage
const api = new ApiClient();

// Admin: Move listing to reviewing
await api.request("/admin/listings/listing_xxx/reviewing", {
  method: "PUT",
});
```

---

## Token Expiration Times

**Cognito Default Settings:**

- **ID Token:** 1 hour (3600 seconds)
- **Access Token:** 1 hour (3600 seconds)
- **Refresh Token:** 30 days

**What This Means:**

- Users need to refresh their token every hour
- If they're inactive for 30 days, they need to log in again
- Amplify handles this automatically if you use `Auth.currentSession()`

---

## Testing Token Expiration

### Manual Testing

1. **Login to the app**
2. **Wait 1 hour** (or modify token expiration in Cognito for testing)
3. **Try to make an API call**
4. **Verify:**
   - You get a 401 response (not a CORS error)
   - Frontend redirects to login or refreshes token
   - After refresh, the request succeeds

### Quick Testing (Developer Mode)

1. **Login to the app**
2. **Open browser DevTools → Application → Local Storage**
3. **Delete the Cognito tokens** (or modify them to be invalid)
4. **Try to make an API call**
5. **Verify error handling works**

---

## Error Response Format

When you receive a 401 or 403, the response body will be:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

Or:

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient permissions"
  }
}
```

---

## Summary for Frontend Team

### ✅ What You Need to Do

1. **Use `Auth.currentSession()`** before every API call (Amplify auto-refreshes)
2. **Handle 401 responses** by redirecting to login
3. **Handle 403 responses** by showing "Access Denied" message
4. **Implement an API client wrapper** (see examples above)
5. **Test token expiration** to ensure graceful handling

### ✅ What's Already Done (Backend)

- ✅ API Gateway returns CORS headers on all error responses
- ✅ 401/403 errors are now visible to frontend (not hidden by CORS)
- ✅ Error responses include proper error codes and messages

### 🚫 What NOT to Do

- ❌ Don't store tokens in localStorage without encryption
- ❌ Don't ignore 401 responses
- ❌ Don't retry 401 requests indefinitely (max 1 retry)
- ❌ Don't show generic "Network Error" for 401/403

---

## Questions?

If you have questions about token handling, contact the backend team or check the AWS Amplify documentation:

- [AWS Amplify Auth](https://docs.amplify.aws/lib/auth/getting-started/q/platform/js/)
- [Token Refresh](https://docs.amplify.aws/lib/auth/manageusers/q/platform/js/#retrieve-current-session)

