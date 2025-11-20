# Frontend API Configuration Guide

## 🚨 Breaking Change: Multiple API Gateways

As of **November 19, 2025**, the Localstays backend has been restructured from **1 monolithic API Gateway** into **3 separate API Gateways** to overcome CloudFormation's 500 resource limit and improve organization.

This document explains how to update the frontend to work with the new infrastructure.

---

## 📊 What Changed?

### Before (Single API):

```
ALL ENDPOINTS → https://xxxxx.execute-api.eu-north-1.amazonaws.com/staging/
```

### After (Three APIs):

```
Host endpoints    → https://xxxxx.execute-api.eu-north-1.amazonaws.com/staging/ (Host API)
Admin endpoints   → https://yyyyy.execute-api.eu-north-1.amazonaws.com/staging/ (Admin API)
Public endpoints  → https://zzzzz.execute-api.eu-north-1.amazonaws.com/staging/ (Public API)
```

---

## 🗺️ API Endpoint Mapping

| Endpoint Pattern                      | API Gateway    | Environment Variable  |
| ------------------------------------- | -------------- | --------------------- |
| `/api/v1/hosts/{hostId}/profile/**`   | **Host API**   | `VITE_HOST_API_URL`   |
| `/api/v1/hosts/{hostId}/subscription` | **Host API**   | `VITE_HOST_API_URL`   |
| `/api/v1/hosts/{hostId}/listings/**`  | **Host API**   | `VITE_HOST_API_URL`   |
| `/api/v1/hosts/{hostId}/requests/**`  | **Host API**   | `VITE_HOST_API_URL`   |
| `/api/v1/listings/metadata`           | **Host API**   | `VITE_HOST_API_URL`   |
| `/api/v1/notifications/**`            | **Host API**   | `VITE_HOST_API_URL`   |
| `/api/v1/admin/**`                    | **Admin API**  | `VITE_ADMIN_API_URL`  |
| `/api/v1/geocode/**`                  | **Public API** | `VITE_PUBLIC_API_URL` |

---

## ⚙️ Environment Variables

### Host App (.env.staging)

```env
VITE_HOST_API_URL=https://xxxxx.execute-api.eu-north-1.amazonaws.com/staging
VITE_PUBLIC_API_URL=https://zzzzz.execute-api.eu-north-1.amazonaws.com/staging

# Get these from CDK deployment outputs:
# - LocalstaysStagingHostApiStack.HostApiEndpoint
# - LocalstaysStagingPublicApiStack.PublicApiEndpoint
```

### Admin Dashboard (.env.staging)

```env
VITE_ADMIN_API_URL=https://yyyyy.execute-api.eu-north-1.amazonaws.com/staging

# Get this from CDK deployment output:
# - LocalstaysStagingAdminApiStack.AdminApiEndpoint
```

### Production (.env.production)

```env
# Host App
VITE_HOST_API_URL=https://xxxxx.execute-api.eu-north-1.amazonaws.com/prod
VITE_PUBLIC_API_URL=https://zzzzz.execute-api.eu-north-1.amazonaws.com/prod

# Admin Dashboard
VITE_ADMIN_API_URL=https://yyyyy.execute-api.eu-north-1.amazonaws.com/prod
```

---

## 🔧 Code Migration

### Option 1: Quick Fix (Minimal Changes)

If you currently have a single `API_URL`, you can map it based on the endpoint:

```typescript
// src/lib/api/config.ts
const HOST_API_URL = import.meta.env.VITE_HOST_API_URL;
const ADMIN_API_URL = import.meta.env.VITE_ADMIN_API_URL;
const PUBLIC_API_URL = import.meta.env.VITE_PUBLIC_API_URL;

export function getApiUrl(endpoint: string): string {
  if (endpoint.startsWith("/api/v1/admin/")) {
    return ADMIN_API_URL;
  }
  if (endpoint.startsWith("/api/v1/geocode/")) {
    return PUBLIC_API_URL;
  }
  // Default to host API for all other endpoints
  return HOST_API_URL;
}

// Usage:
const url = getApiUrl(endpoint) + endpoint;
await fetch(url, options);
```

### Option 2: Recommended (API Client Abstraction)

Create separate API clients for better type safety and organization:

```typescript
// src/lib/api/host-api.ts
const HOST_API_URL = import.meta.env.VITE_HOST_API_URL;

export const hostApi = {
  // Profile
  submitProfileIntent: (hostId: string, data: any) =>
    fetch(`${HOST_API_URL}/api/v1/hosts/${hostId}/profile/submit-intent`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  confirmProfileSubmission: (hostId: string, data: any) =>
    fetch(`${HOST_API_URL}/api/v1/hosts/${hostId}/profile/confirm-submission`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getProfile: (hostId: string) =>
    fetch(`${HOST_API_URL}/api/v1/hosts/${hostId}/profile`),

  updateRejectedProfile: (hostId: string, data: any) =>
    fetch(`${HOST_API_URL}/api/v1/hosts/${hostId}/profile/update-rejected`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Subscription
  getSubscription: (hostId: string) =>
    fetch(`${HOST_API_URL}/api/v1/hosts/${hostId}/subscription`),

  // Listings
  getListingMetadata: () => fetch(`${HOST_API_URL}/api/v1/listings/metadata`),

  submitListingIntent: (hostId: string, data: any) =>
    fetch(`${HOST_API_URL}/api/v1/hosts/${hostId}/listings/submit-intent`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getListings: (hostId: string) =>
    fetch(`${HOST_API_URL}/api/v1/hosts/${hostId}/listings`),

  getListing: (hostId: string, listingId: string) =>
    fetch(`${HOST_API_URL}/api/v1/hosts/${hostId}/listings/${listingId}`),

  deleteListing: (hostId: string, listingId: string) =>
    fetch(`${HOST_API_URL}/api/v1/hosts/${hostId}/listings/${listingId}`, {
      method: "DELETE",
    }),

  confirmListingSubmission: (hostId: string, listingId: string, data: any) =>
    fetch(
      `${HOST_API_URL}/api/v1/hosts/${hostId}/listings/${listingId}/confirm-submission`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),

  updateListing: (hostId: string, listingId: string, data: any) =>
    fetch(
      `${HOST_API_URL}/api/v1/hosts/${hostId}/listings/${listingId}/update`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    ),

  resubmitListing: (hostId: string, listingId: string) =>
    fetch(
      `${HOST_API_URL}/api/v1/hosts/${hostId}/listings/${listingId}/resubmit`,
      {
        method: "POST",
      }
    ),

  // Pricing
  getPricing: (hostId: string, listingId: string) =>
    fetch(
      `${HOST_API_URL}/api/v1/hosts/${hostId}/listings/${listingId}/pricing`
    ),

  setPricing: (hostId: string, listingId: string, data: any) =>
    fetch(
      `${HOST_API_URL}/api/v1/hosts/${hostId}/listings/${listingId}/pricing`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    ),

  // Image Updates
  submitImageUpdate: (hostId: string, listingId: string, data: any) =>
    fetch(
      `${HOST_API_URL}/api/v1/hosts/${hostId}/listings/${listingId}/image-update`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),

  confirmImageUpdate: (hostId: string, listingId: string, data: any) =>
    fetch(
      `${HOST_API_URL}/api/v1/hosts/${hostId}/listings/${listingId}/image-update/confirm`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),

  // Requests
  getRequests: (hostId: string) =>
    fetch(`${HOST_API_URL}/api/v1/hosts/${hostId}/requests`),

  getRequest: (hostId: string, requestId: string) =>
    fetch(`${HOST_API_URL}/api/v1/hosts/${hostId}/requests/${requestId}`),

  submitRequestIntent: (hostId: string, requestId: string, data: any) =>
    fetch(
      `${HOST_API_URL}/api/v1/hosts/${hostId}/requests/${requestId}/submit-intent`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),

  confirmRequestSubmission: (hostId: string, requestId: string, data: any) =>
    fetch(
      `${HOST_API_URL}/api/v1/hosts/${hostId}/requests/${requestId}/confirm-submission`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),

  // Listing Requests (video, verification code)
  getListingRequests: (hostId: string, listingId: string) =>
    fetch(
      `${HOST_API_URL}/api/v1/hosts/${hostId}/listings/${listingId}/requests`
    ),

  submitVideoIntent: (
    hostId: string,
    listingId: string,
    requestId: string,
    data: any
  ) =>
    fetch(
      `${HOST_API_URL}/api/v1/hosts/${hostId}/listings/${listingId}/requests/${requestId}/submit-video-intent`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),

  confirmVideo: (
    hostId: string,
    listingId: string,
    requestId: string,
    data: any
  ) =>
    fetch(
      `${HOST_API_URL}/api/v1/hosts/${hostId}/listings/${listingId}/requests/${requestId}/confirm-video`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),

  submitCode: (
    hostId: string,
    listingId: string,
    requestId: string,
    data: any
  ) =>
    fetch(
      `${HOST_API_URL}/api/v1/hosts/${hostId}/listings/${listingId}/requests/${requestId}/submit-code`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),

  // Notifications
  subscribeNotification: (data: any) =>
    fetch(`${HOST_API_URL}/api/v1/notifications/subscribe`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  unsubscribeNotification: (subscriptionId: string) =>
    fetch(`${HOST_API_URL}/api/v1/notifications/subscribe/${subscriptionId}`, {
      method: "DELETE",
    }),

  listSubscriptions: () =>
    fetch(`${HOST_API_URL}/api/v1/notifications/subscriptions`),
};
```

```typescript
// src/lib/api/admin-api.ts
const ADMIN_API_URL = import.meta.env.VITE_ADMIN_API_URL;

export const adminApi = {
  // Hosts
  getHosts: (params?: URLSearchParams) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/hosts?${params}`),

  searchHosts: (query: string) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/hosts/search?q=${query}`),

  getPendingReviewHosts: () =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/hosts/pending-review`),

  getHost: (hostId: string) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/hosts/${hostId}`),

  getHostDocuments: (hostId: string) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/hosts/${hostId}/documents`),

  getHostListings: (hostId: string) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/hosts/${hostId}/listings`),

  getHostRequests: (hostId: string) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/hosts/${hostId}/requests`),

  approveHost: (hostId: string, data?: any) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/hosts/${hostId}/approve`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  rejectHost: (hostId: string, data: any) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/hosts/${hostId}/reject`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  suspendHost: (hostId: string, data: any) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/hosts/${hostId}/suspend`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  reinstateHost: (hostId: string, data?: any) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/hosts/${hostId}/reinstate`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Listings
  getListings: (params?: URLSearchParams) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/listings?${params}`),

  getPendingReviewListings: () =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/listings/pending-review`),

  getListing: (listingId: string) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/listings/${listingId}`),

  setListingReviewing: (listingId: string) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/listings/${listingId}/reviewing`, {
      method: "PUT",
    }),

  approveListing: (listingId: string, data?: any) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/listings/${listingId}/approve`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  rejectListing: (listingId: string, data: any) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/listings/${listingId}/reject`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  suspendListing: (listingId: string, data: any) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/listings/${listingId}/suspend`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Listing Requests (admin creates requests)
  getListingRequests: (listingId: string) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/listings/${listingId}/requests`),

  createPropertyVideoRequest: (listingId: string, data: any) =>
    fetch(
      `${ADMIN_API_URL}/api/v1/admin/listings/${listingId}/requests/property-video`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),

  createAddressVerificationRequest: (listingId: string, data: any) =>
    fetch(
      `${ADMIN_API_URL}/api/v1/admin/listings/${listingId}/requests/address-verification`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),

  // Requests
  getRequests: (params?: URLSearchParams) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/requests?${params}`),

  getPendingReviewRequests: () =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/requests/pending-review`),

  getRequest: (requestId: string) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/requests/${requestId}`),

  approveRequest: (requestId: string, data?: any) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/requests/${requestId}/approve`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  rejectRequest: (requestId: string, data: any) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/requests/${requestId}/reject`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Notifications
  sendNotification: (data: any) =>
    fetch(`${ADMIN_API_URL}/api/v1/admin/notifications/send`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
```

```typescript
// src/lib/api/public-api.ts
const PUBLIC_API_URL = import.meta.env.VITE_PUBLIC_API_URL;

export const publicApi = {
  // Geocoding Rate Limiting
  checkAndIncrementRateLimit: () =>
    fetch(`${PUBLIC_API_URL}/api/v1/geocode/rate-limit`, {
      method: "POST",
    }),
};
```

---

## ✅ Migration Checklist

### Backend Deployment

- [ ] Deploy new infrastructure to staging
- [ ] Capture all 3 API URLs from CDK outputs
- [ ] Verify all 3 API Gateways are accessible

### Frontend Configuration

- [ ] Update `.env.staging` with 3 API URLs (Host, Admin, Public)
- [ ] Update `.env.production` with 3 API URLs (when deploying to prod)
- [ ] Remove old `VITE_API_URL` references

### Code Updates

- [ ] Choose migration strategy (Option 1: Quick Fix or Option 2: API Clients)
- [ ] Update all API calls to use correct URL
- [ ] Test host endpoints (profile, listings, requests)
- [ ] Test admin endpoints (host management, listing review)
- [ ] Test public endpoints (geocoding rate limit)

### CI/CD

- [ ] Update build pipelines with new environment variables
- [ ] Update deployment scripts if they reference API URLs
- [ ] Test full CI/CD flow

### Documentation

- [ ] Update internal frontend docs with new API structure
- [ ] Document which endpoints use which API
- [ ] Share this guide with frontend team

---

## 🔍 Testing

After migration, test these key flows:

### Host App

```bash
# Profile management
GET  {HOST_API}/api/v1/hosts/{hostId}/profile
POST {HOST_API}/api/v1/hosts/{hostId}/profile/submit-intent
POST {HOST_API}/api/v1/hosts/{hostId}/profile/confirm-submission

# Listings
GET  {HOST_API}/api/v1/listings/metadata
GET  {HOST_API}/api/v1/hosts/{hostId}/listings
POST {HOST_API}/api/v1/hosts/{hostId}/listings/submit-intent

# Geocoding rate limit
POST {PUBLIC_API}/api/v1/geocode/rate-limit
```

### Admin Dashboard

```bash
# Host management
GET {ADMIN_API}/api/v1/admin/hosts
GET {ADMIN_API}/api/v1/admin/hosts/pending-review
PUT {ADMIN_API}/api/v1/admin/hosts/{hostId}/approve

# Listing review
GET {ADMIN_API}/api/v1/admin/listings/pending-review
PUT {ADMIN_API}/api/v1/admin/listings/{listingId}/reviewing
PUT {ADMIN_API}/api/v1/admin/listings/{listingId}/approve
```

---

## 💡 Benefits of This Restructure

1. **Better Organization**: Clear separation between host, admin, and public concerns
2. **Independent Scaling**: Each API can be scaled independently based on traffic
3. **Security Isolation**: Admin endpoints completely isolated from public/host APIs
4. **Resource Limits**: Each API stays well under CloudFormation's 500 resource limit
5. **Monitoring**: Separate CloudWatch logs per API for easier debugging
6. **Cost Transparency**: Clear cost breakdown per API type (no additional cost - still pay per request)

---

## 📞 Support

If you encounter issues during migration:

1. Check that all 3 API URLs are correctly set in `.env` files
2. Verify CDK deployment outputs match your configuration
3. Test each API independently using curl/Postman
4. Check browser console for CORS errors (should be configured correctly)
5. Review CloudWatch logs for specific API Gateway (`/aws/apigateway/localstays-{stage}-{host|admin|public}-api`)

---

**Document Version:** 1.0  
**Date:** 2025-11-19  
**Related:** [STAGING_DEPLOYMENT_MASTER_PLAN.md](./STAGING_DEPLOYMENT_MASTER_PLAN.md)

