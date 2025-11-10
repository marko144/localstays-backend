# Staging Environment - Frontend Configuration

**Environment:** Staging  
**Region:** eu-north-1  
**Last Updated:** 2025-11-10

---

## 🔑 Environment Variables for Frontend

Copy these values to your frontend `.env.staging` or equivalent configuration file:

### **API Configuration**

```bash
# API Gateway Endpoint
REACT_APP_API_URL=https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/
REACT_APP_API_BASE_URL=https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1

# API Version
REACT_APP_API_VERSION=v1

# Environment
REACT_APP_ENV=staging
REACT_APP_STAGE=staging
```

### **AWS Cognito Configuration**

```bash
# Cognito User Pool
REACT_APP_COGNITO_USER_POOL_ID=eu-north-1_9cn2bqm2S
REACT_APP_COGNITO_CLIENT_ID=7mqvb34qogr4g031r9erf2be9u
REACT_APP_COGNITO_REGION=eu-north-1

# Cognito User Pool ARN (if needed)
REACT_APP_COGNITO_USER_POOL_ARN=arn:aws:cognito-idp:eu-north-1:041608526793:userpool/eu-north-1_9cn2bqm2S

# Cognito Groups
REACT_APP_COGNITO_ADMIN_GROUP=ADMIN
REACT_APP_COGNITO_HOST_GROUP=HOST
```

### **AWS Region**

```bash
REACT_APP_AWS_REGION=eu-north-1
```

### **S3 Configuration (if frontend uploads directly)**

```bash
# S3 Bucket for host assets
REACT_APP_S3_BUCKET=localstays-staging-host-assets
REACT_APP_S3_REGION=eu-north-1
```

---

## 📋 Complete Configuration Object

If your frontend uses a configuration object instead of environment variables:

```typescript
// config/staging.ts
export const stagingConfig = {
  api: {
    baseUrl:
      "https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1",
    endpoint:
      "https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/",
    version: "v1",
    timeout: 30000, // 30 seconds
  },
  cognito: {
    userPoolId: "eu-north-1_9cn2bqm2S",
    clientId: "7mqvb34qogr4g031r9erf2be9u",
    region: "eu-north-1",
    groups: {
      admin: "ADMIN",
      host: "HOST",
    },
  },
  aws: {
    region: "eu-north-1",
    s3: {
      bucket: "localstays-staging-host-assets",
      region: "eu-north-1",
    },
  },
  environment: "staging",
  features: {
    enableDebugMode: true,
    enableErrorReporting: true,
    enableAnalytics: false, // Disable analytics in staging
  },
};
```

---

## 🔐 Authentication Flow

### **Sign Up**

```typescript
POST https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1/auth/signup

// Or use AWS Amplify with Cognito config above
```

### **Sign In**

```typescript
POST https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1/auth/signin

// Or use AWS Amplify with Cognito config above
```

### **JWT Token**

After authentication, include the JWT token in all API requests:

```typescript
headers: {
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
}
```

---

## 📡 API Endpoints Reference

### **Base URL**

```
https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1
```

### **Common Endpoints**

```bash
# Public endpoints (no auth required)
GET  /listings/metadata

# Host endpoints (requires HOST role)
GET  /hosts/{hostId}/profile
POST /hosts/{hostId}/listings/submit-intent
GET  /hosts/{hostId}/listings
GET  /hosts/{hostId}/listings/{listingId}
PUT  /hosts/{hostId}/listings/{listingId}/update
POST /hosts/{hostId}/listings/{listingId}/resubmit

# Admin endpoints (requires ADMIN role)
GET  /admin/hosts
GET  /admin/hosts/{hostId}
GET  /admin/listings
GET  /admin/listings/pending-review
PUT  /admin/listings/{listingId}/approve
PUT  /admin/listings/{listingId}/reject
```

---

## 🧪 Test Credentials

### **Admin User**

```bash
Email: marko+admin@velocci.me
Password: Password1*
Role: ADMIN
```

**⚠️ Note:** Change password after first login in production!

---

## 🔍 CORS Configuration

The API Gateway is configured to accept requests from:

- `http://localhost:3000` (local development)
- `http://localhost:5173` (Vite default)
- Your staging frontend domain (add as needed)

If you encounter CORS errors, verify your origin is whitelisted in the API Gateway configuration.

---

## 📦 AWS Amplify Configuration (Optional)

If using AWS Amplify for authentication:

```typescript
// amplify-config.ts
import { Amplify } from "aws-amplify";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: "eu-north-1_9cn2bqm2S",
      userPoolClientId: "7mqvb34qogr4g031r9erf2be9u",
      region: "eu-north-1",
      signUpVerificationMethod: "code", // 'code' | 'link'
      loginWith: {
        email: true,
        username: false,
      },
    },
  },
  API: {
    REST: {
      LocalstaysAPI: {
        endpoint:
          "https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging",
        region: "eu-north-1",
      },
    },
  },
});
```

---

## 🎨 Environment-Specific Features

### **Staging Environment Flags**

```typescript
// Enable these in staging
const stagingFeatures = {
  showDebugInfo: true, // Show API response times, errors
  enableMockData: false, // Use real API
  logApiCalls: true, // Console log all API calls
  enableHotReload: true, // Hot module replacement
  strictMode: true, // React strict mode
  enableDevTools: true, // Redux DevTools, etc.
};
```

---

## 🔄 Image Upload Configuration

### **Image Upload Flow**

1. **Request Upload URL** from backend
2. **Upload directly to S3** using pre-signed URL
3. **Confirm upload** via API

```typescript
// 1. Request upload URL
POST /hosts/{hostId}/listings/{listingId}/image-update
Body: {
  "imageCount": 3,
  "images": [
    { "fileName": "image1.jpg", "contentType": "image/jpeg" },
    { "fileName": "image2.heic", "contentType": "image/heic" }
  ]
}

// Response includes pre-signed URLs
{
  "requestId": "req_xxx",
  "uploadUrls": [
    {
      "imageId": "img_xxx",
      "uploadUrl": "https://s3.amazonaws.com/...",
      "expiresIn": 600
    }
  ]
}

// 2. Upload to S3 using pre-signed URL
PUT {uploadUrl}
Headers: {
  'Content-Type': 'image/jpeg'
}
Body: <binary image data>

// 3. Confirm upload
POST /hosts/{hostId}/listings/{listingId}/image-update/confirm
Body: {
  "requestId": "req_xxx"
}
```

---

## 📊 API Response Format

### **Success Response**

```json
{
  "success": true,
  "data": {
    // Response data
  },
  "message": "Operation successful"
}
```

### **Error Response**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": {
      // Error details
    }
  }
}
```

---

## 🚨 Error Codes

Common error codes you may encounter:

| Code                  | HTTP Status | Description                      |
| --------------------- | ----------- | -------------------------------- |
| `UNAUTHORIZED`        | 401         | Missing or invalid JWT token     |
| `FORBIDDEN`           | 403         | Insufficient permissions         |
| `NOT_FOUND`           | 404         | Resource not found               |
| `VALIDATION_ERROR`    | 400         | Invalid request data             |
| `INTERNAL_ERROR`      | 500         | Server error                     |
| `RATE_LIMIT_EXCEEDED` | 429         | Too many requests                |
| `CONFLICT`            | 409         | Resource conflict (e.g., exists) |

---

## 🔧 Troubleshooting

### **Issue: CORS Error**

**Solution:** Verify your origin is whitelisted. Contact backend team to add your domain.

### **Issue: 401 Unauthorized**

**Solution:** Check JWT token is valid and not expired. Token expires after 1 hour.

### **Issue: 403 Forbidden**

**Solution:** Verify user has correct role (HOST or ADMIN) for the endpoint.

### **Issue: Slow API Responses**

**Solution:** Staging environment uses smaller Lambda instances. Expected response times:

- Simple GET: 100-300ms
- Complex POST: 500-1000ms
- Image processing: 5-30 seconds

---

## 📞 Support

**Backend Team Contact:**

- Slack: #backend-team
- Email: backend@localstays.com

**API Documentation:**

- Swagger/OpenAPI: (Coming soon)
- Postman Collection: (Coming soon)

---

## ✅ Verification Checklist

Before starting frontend development, verify:

- [ ] Can access API endpoint: `curl https://tr8eo3kgec.execute-api.eu-north-1.amazonaws.com/staging/api/v1/listings/metadata`
- [ ] Can sign up new user via Cognito
- [ ] Can sign in with test admin credentials
- [ ] Can make authenticated API call with JWT token
- [ ] CORS allows requests from your origin
- [ ] Image upload flow works end-to-end

---

## 🔄 Updates

When backend environment variables change, this document will be updated. Check the "Last Updated" date at the top.

**Change Log:**

- **2025-11-10:** Initial staging environment configuration

---

**Environment Status:** 🟢 **OPERATIONAL**


