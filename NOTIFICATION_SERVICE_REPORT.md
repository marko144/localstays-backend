# Notification Service Investigation Report

## Overview

The notification service provides push notification functionality for authenticated users. It's built on Web Push API standards and stores subscription data in DynamoDB.

---

## 📋 **Available Endpoints**

### ✅ **1. Subscribe to Push Notifications**

**Endpoint**: `POST /api/v1/notifications/subscribe`  
**Auth**: Required (Cognito)  
**Lambda**: `subscribeNotificationLambda`  
**File**: `backend/services/api/notifications/subscribe.ts`

**Purpose**: Register a device/browser for push notifications

**Request Body**:

```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/...",
    "keys": {
      "p256dh": "base64-encoded-key",
      "auth": "base64-encoded-auth"
    }
  },
  "deviceInfo": {
    "type": "desktop" | "mobile" | "tablet",  // Optional, auto-detected
    "platform": "string",                      // Optional, from User-Agent
    "browser": "string"                        // Optional, auto-detected
  }
}
```

**Response**:

```json
{
  "subscriptionId": "sub_uuid",
  "message": "Successfully subscribed to push notifications"
}
```

**Behavior**:

- ✅ Checks if subscription already exists (by endpoint)
- ✅ If exists, updates `lastUsedAt` and sets `isActive: true`
- ✅ If new, creates subscription record with unique `subscriptionId`
- ✅ Auto-detects device type, platform, and browser from User-Agent if not provided
- ✅ Stores subscription in format: `PK: USER#<userId>`, `SK: PUSH_SUB#<subscriptionId>`

---

### ✅ **2. Unsubscribe from Push Notifications**

**Endpoint**: `DELETE /api/v1/notifications/subscribe/{subscriptionId}`  
**Auth**: Required (Cognito)  
**Lambda**: `unsubscribeNotificationLambda`  
**File**: `backend/services/api/notifications/unsubscribe.ts`

**Purpose**: Disable push notifications for a specific device/subscription

**Path Parameters**:

- `subscriptionId` - The subscription ID to unsubscribe

**Response**:

```json
{
  "message": "Successfully unsubscribed from push notifications"
}
```

**Behavior**:

- ✅ Verifies subscription exists and belongs to authenticated user
- ✅ Performs **soft delete** (sets `isActive: false`)
- ✅ Updates `gsi5pk` to `PUSH_SUB_INACTIVE` (moves to inactive partition)
- ✅ Returns 404 if subscription not found
- ✅ Returns 403 if user doesn't own the subscription

---

### ✅ **3. Check Notification Status for Device**

**Endpoint**: `POST /api/v1/notifications/status`  
**Auth**: Required (Cognito)  
**Lambda**: `checkNotificationStatusLambda`  
**File**: `backend/services/api/notifications/check-status.ts`

**Purpose**: Check if notifications are enabled for a specific device/endpoint

**Request Body**:

```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/..."
}
```

**Response (Enabled)**:

```json
{
  "enabled": true,
  "subscription": {
    "subscriptionId": "sub_uuid",
    "deviceType": "desktop" | "mobile" | "tablet",
    "platform": "Mozilla/5.0...",
    "browser": "Chrome",
    "createdAt": "2025-11-24T12:00:00.000Z",
    "lastUsedAt": "2025-11-24T15:00:00.000Z"
  },
  "message": "Notifications are enabled for this device"
}
```

**Response (Disabled)**:

```json
{
  "enabled": false,
  "message": "No subscription found for this device"
}
```

**Response (Subscription Exists but Inactive)**:

```json
{
  "enabled": false,
  "subscription": {
    "subscriptionId": "sub_uuid",
    "deviceType": "desktop",
    "platform": "Mozilla/5.0...",
    "browser": "Chrome",
    "createdAt": "2025-11-24T12:00:00.000Z",
    "lastUsedAt": "2025-11-24T15:00:00.000Z"
  },
  "message": "Notifications are disabled for this device"
}
```

**Behavior**:

- ✅ Checks if a subscription exists for the given endpoint
- ✅ Returns subscription details if found (whether active or inactive)
- ✅ Does NOT expose sensitive keys (p256dh, auth)
- ✅ Useful for checking status before attempting to subscribe/unsubscribe

---

### ✅ **4. List All Subscriptions**

**Endpoint**: `GET /api/v1/notifications/subscriptions`  
**Auth**: Required (Cognito)  
**Lambda**: `listSubscriptionsLambda`  
**File**: `backend/services/api/notifications/list-subscriptions.ts`

**Purpose**: Get all push subscriptions (active and inactive) for the authenticated user

**Response**:

```json
{
  "subscriptions": [
    {
      "subscriptionId": "sub_uuid",
      "deviceType": "desktop" | "mobile" | "tablet",
      "platform": "Mozilla/5.0...",
      "browser": "Chrome",
      "isActive": true,
      "createdAt": "2025-11-24T12:00:00.000Z",
      "lastUsedAt": "2025-11-24T15:00:00.000Z"
    }
  ],
  "total": 3,
  "active": 2
}
```

**Behavior**:

- ✅ Returns **all** subscriptions (both active and inactive)
- ✅ Sorted by `lastUsedAt` (most recent first)
- ✅ Does **NOT** expose sensitive keys (`p256dh`, `auth`, `endpoint`)
- ✅ Includes summary counts (total and active)

---

### ✅ **5. Send Push Notification (Admin Only)**

**Endpoint**: `POST /api/v1/admin/notifications/send`  
**Auth**: Required (Cognito + ADMIN group)  
**Lambda**: `sendNotificationLambda`  
**File**: `backend/services/api/admin/notifications/send-notification.ts`

**Purpose**: Send push notifications to users (admin functionality)

**Note**: This is an admin-only endpoint for sending notifications, not for managing subscriptions.

---

## 🗄️ **Database Schema**

### **Subscription Record Structure**

**Table**: Main DynamoDB table (`localstays-staging`)

**Keys**:

- `pk`: `USER#<userId>` (Cognito sub)
- `sk`: `PUSH_SUB#<subscriptionId>`

**Attributes**:

```typescript
{
  pk: string; // USER#<userId>
  sk: string; // PUSH_SUB#<subscriptionId>
  entityType: "PUSH_SUBSCRIPTION";
  subscriptionId: string; // sub_uuid
  userId: string; // Cognito sub
  endpoint: string; // Push service endpoint
  keys: {
    p256dh: string; // Public key
    auth: string; // Auth secret
  }
  deviceType: "desktop" | "mobile" | "tablet";
  platform: string; // User-Agent string
  browser: string; // Chrome, Safari, Firefox, etc.
  isActive: boolean; // true = active, false = unsubscribed
  isDeleted: boolean; // Always false (for future use)
  failureCount: number; // Tracks failed push attempts
  createdAt: string; // ISO timestamp
  lastUsedAt: string; // ISO timestamp (updated on re-subscribe)

  // GSI5 attributes for querying active subscriptions
  gsi5pk: string; // 'PUSH_SUB_ACTIVE' or 'PUSH_SUB_INACTIVE'
  gsi5sk: string; // createdAt timestamp
}
```

---

## 🔍 **What's Missing / Gaps**

### ❌ **1. No "Get Single Subscription Status" Endpoint**

**Issue**: There's no way to check the status of a specific subscription without fetching all subscriptions.

**Suggested Endpoint**:

```
GET /api/v1/notifications/subscribe/{subscriptionId}
```

**Use Case**: Frontend wants to check if a specific device is still subscribed without loading all subscriptions.

---

### ❌ **2. No "Disable All Notifications" Endpoint**

**Issue**: Users must unsubscribe each device individually. No bulk disable.

**Suggested Endpoint**:

```
DELETE /api/v1/notifications/subscriptions
```

**Use Case**: User wants to disable all push notifications across all devices at once.

---

### ❌ **3. No "Re-enable Subscription" Endpoint**

**Issue**: Once unsubscribed, the subscription is marked inactive. To re-enable, user must call subscribe again with the same endpoint, which updates the existing record. However, there's no explicit "re-enable" endpoint.

**Current Workaround**: Call `POST /api/v1/notifications/subscribe` again with the same subscription data - it will reactivate the existing subscription.

**Status**: ✅ **Actually works fine** - the subscribe endpoint handles this case.

---

### ⚠️ **4. No Notification Preferences/Settings**

**Issue**: No way to configure notification types or preferences (e.g., "only booking updates", "no marketing").

**Suggested Endpoint**:

```
GET /api/v1/notifications/preferences
PUT /api/v1/notifications/preferences
```

**Use Case**: User wants to control which types of notifications they receive.

---

### ⚠️ **5. No Subscription Validation/Health Check**

**Issue**: No way to test if a subscription is still valid (push service might have invalidated it).

**Suggested Endpoint**:

```
POST /api/v1/notifications/subscribe/{subscriptionId}/test
```

**Use Case**: Send a test notification to verify the subscription still works.

---

### ⚠️ **6. Limited Query Capabilities**

**Issue**: The list endpoint returns ALL subscriptions. No filtering by:

- Active only
- Device type
- Date range

**Suggested Enhancement**: Add query parameters to list endpoint:

```
GET /api/v1/notifications/subscriptions?active=true&deviceType=mobile
```

---

## 📊 **Summary**

### **What We Have** ✅

1. ✅ Subscribe to push notifications
2. ✅ Unsubscribe from push notifications (by subscriptionId)
3. ✅ List all subscriptions for a user
4. ✅ Admin endpoint to send notifications
5. ✅ Automatic device/browser detection
6. ✅ Soft delete (subscriptions are deactivated, not deleted)
7. ✅ Duplicate prevention (same endpoint = update existing)

### **What We're Missing** ❌

1. ❌ Get single subscription status
2. ❌ Bulk disable all notifications
3. ❌ Notification preferences/settings
4. ❌ Subscription validation/test endpoint
5. ❌ Filtered list queries (active only, by device type, etc.)

---

## 🎯 **Recommendations**

### **High Priority**

1. **Add filtered list endpoint** - Allow querying active subscriptions only
2. **Add bulk disable** - Let users disable all notifications at once

### **Medium Priority**

3. **Add notification preferences** - Let users control notification types
4. **Add test notification** - Let users verify their subscription works

### **Low Priority**

5. **Add single subscription status** - Optimize for checking one subscription
6. **Add subscription health monitoring** - Track and clean up invalid subscriptions

---

## 📍 **Infrastructure Location**

**CDK Stack**: `HostApiStack` (`infra/lib/host-api-stack.ts`)

**Lambda Functions**:

- `subscribeNotificationLambda` (lines 403-413)
- `unsubscribeNotificationLambda` (lines 416-426)
- `listSubscriptionsLambda` (lines 429-439)

**API Routes** (lines 887-920):

- `POST /api/v1/notifications/subscribe`
- `DELETE /api/v1/notifications/subscribe/{subscriptionId}`
- `GET /api/v1/notifications/subscriptions`

**Permissions**:

- All notification lambdas have `grantReadWriteData` on main DynamoDB table
- All notification lambdas have `grantReadData` on main table (line 444)

---

## 🔐 **Security**

- ✅ All endpoints require Cognito authentication
- ✅ Ownership verification on unsubscribe (can't delete other users' subscriptions)
- ✅ Sensitive keys (p256dh, auth) are NOT exposed in list endpoint
- ✅ Subscriptions are scoped to user (PK includes userId)

---

## 🧪 **Testing**

**Staging Endpoint**: `https://k27ar3e32j.execute-api.eu-north-1.amazonaws.com/staging/`

**Example Requests**:

```bash
# Subscribe
POST https://k27ar3e32j.execute-api.eu-north-1.amazonaws.com/staging/api/v1/notifications/subscribe
Authorization: Bearer <cognito-token>
Content-Type: application/json

{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/...",
    "keys": {
      "p256dh": "...",
      "auth": "..."
    }
  }
}

# List subscriptions
GET https://k27ar3e32j.execute-api.eu-north-1.amazonaws.com/staging/api/v1/notifications/subscriptions
Authorization: Bearer <cognito-token>

# Unsubscribe
DELETE https://k27ar3e32j.execute-api.eu-north-1.amazonaws.com/staging/api/v1/notifications/subscribe/{subscriptionId}
Authorization: Bearer <cognito-token>
```
