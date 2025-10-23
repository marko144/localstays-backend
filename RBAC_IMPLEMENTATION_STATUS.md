# RBAC Implementation Status

## 🎯 Overview

This document tracks the implementation status of Role-Based Access Control (RBAC) for the Localstays Host Portal.

**Last Updated:** October 23, 2025

---

## ✅ Completed Components

### 1. Database Schema & Infrastructure ✅

**File:** `infra/lib/data-stack.ts`

- ✅ Added 4 Global Secondary Indexes (GSIs) to support RBAC queries:
  - **GSI1**: Lookup entities by owner (e.g., Host by ownerUserSub)
  - **GSI2**: Query entities by status (e.g., Hosts by status)
  - **GSI3**: Lookup by email (e.g., Host by email)
  - **GSI4**: Query by country (e.g., Hosts by country)

**Status:** Ready for deployment

---

### 2. Role Configuration Seed Scripts ✅

**Files:**

- `backend/services/seed/seed-roles.ts` - Role definitions (HOST, ADMIN)
- `backend/services/seed/seed-enums.ts` - Enum definitions (statuses, types)
- `backend/services/seed/seed-all.ts` - Master seed script
- `backend/package.json` - Added `"seed"` npm script

**Role Definitions:**

- **HOST Role**: 8 permissions for property management
  - `HOST_LISTING_CREATE`, `HOST_LISTING_EDIT_DRAFT`, `HOST_LISTING_SUBMIT_REVIEW`, etc.
- **ADMIN Role**: 10 permissions for platform administration
  - `ADMIN_HOST_VIEW_ALL`, `ADMIN_KYC_APPROVE`, `ADMIN_LISTING_APPROVE`, etc.

**Enum Definitions:**

- **HOST_STATUS**: `INCOMPLETE`, `VERIFICATION`, `VERIFIED`, `INFO_REQUIRED`, `SUSPENDED`
- **USER_STATUS**: `ACTIVE`, `SUSPENDED`, `BANNED`
- **HOST_TYPE**: `INDIVIDUAL`, `BUSINESS`

**Usage:**

```bash
cd backend
npm run seed
```

**Status:** Ready to run after deployment

---

### 3. PostConfirmation Lambda (User Initialization) ✅

**File:** `backend/services/auth/cognito-post-confirmation.ts`

**Functionality:**

- ✅ Assigns new users to `HOST` Cognito Group
- ✅ Fetches HOST role permissions from DynamoDB
- ✅ Creates minimal Host record with `status: INCOMPLETE`
- ✅ Updates User record with RBAC fields (`role`, `hostId`, `permissions`, `status`)

**Flow:**

1. User confirms email
2. Trigger fires
3. Assign to HOST group in Cognito
4. Get permissions from `ROLE#HOST` config
5. Create Host record: `HOST#<userSub>` with generated `hostId`
6. Update User record: `USER#<userSub>` with RBAC data

**Status:** Code complete, needs deployment

---

### 4. PreTokenGeneration Lambda (JWT Claims) ✅

**File:** `backend/services/auth/cognito-pre-token-generation.ts`

**Functionality:**

- ✅ Fetches User record from DynamoDB
- ✅ Determines role from Cognito Groups (ADMIN wins if user has both)
- ✅ Retrieves permissions (user-specific OR role defaults)
- ✅ Injects custom claims into JWT:
  - `role`: "HOST" or "ADMIN"
  - `hostId`: For HOST users
  - `permissions`: Array of permission strings
  - `status`: User account status

**Custom Claims Structure:**

```json
{
  "role": "HOST",
  "hostId": "host_123e4567-e89b-12d3-a456-426614174000",
  "permissions": ["HOST_LISTING_CREATE", "HOST_LISTING_EDIT_DRAFT", ...],
  "status": "ACTIVE"
}
```

**Status:** Code complete, needs deployment

---

### 5. Infrastructure Configuration ✅

**File:** `infra/lib/auth-trigger-stack.ts`

**Changes:**

- ✅ Added PreTokenGeneration Lambda definition
- ✅ Configured environment variables (`TABLE_NAME`)
- ✅ Added IAM policies:
  - PostConfirmation: `GetItem`, `PutItem`, `UpdateItem` on DynamoDB
  - PreTokenGeneration: `GetItem` on DynamoDB
- ✅ Added Cognito invoke permissions for both Lambdas
- ✅ Added CloudWatch Logs configuration
- ✅ Added CDK outputs for Lambda ARNs

**Status:** Ready for deployment

---

## 📋 Deployment Checklist

### Phase 1: Deploy Infrastructure

- [ ] **Deploy CDK stacks**

  ```bash
  npm run build
  npx cdk deploy --all
  ```

- [ ] **Attach PreTokenGeneration trigger to Cognito** (Manual)

  ```bash
  aws cognito-idp update-user-pool \
    --user-pool-id eu-north-1_ZKkIbkbWG \
    --lambda-config PreTokenGeneration=<ARN_FROM_CDK_OUTPUT> \
    --region eu-north-1
  ```

  Note: CDK doesn't support PreTokenGeneration trigger declaratively yet.

### Phase 2: Seed Data

- [ ] **Run seed scripts**

  ```bash
  cd backend
  npm run seed
  ```

  This will populate:

  - Role configurations (HOST, ADMIN) in DynamoDB
  - Enum definitions (statuses, types) in DynamoDB

### Phase 3: Verify

- [ ] **Test new user signup**

  1. Sign up a new user via frontend
  2. Confirm email
  3. Check DynamoDB for:
     - User record with RBAC fields
     - Host record with `INCOMPLETE` status
  4. Log in and check JWT token contains custom claims

- [ ] **Test existing users** (if any)
  - Existing users need migration (see Phase 4)

### Phase 4: Migrate Existing Users (If Applicable)

- [ ] **Create migration script** (TODO)
  - Fetch all users from Cognito
  - For each user:
    - Assign to HOST group
    - Create Host record
    - Update User record with RBAC fields

---

## 🔄 Data Flow Diagrams

### New User Signup Flow

```
User Signs Up
    ↓
PreSignUp (validates email, captures consent)
    ↓
User Confirms Email
    ↓
PostConfirmation Lambda
    ├─ Assign to HOST Cognito Group
    ├─ Get HOST permissions from DynamoDB
    ├─ Create Host record (status=INCOMPLETE)
    └─ Update User record with RBAC fields
    ↓
User Logs In
    ↓
PreTokenGeneration Lambda
    ├─ Get User record from DynamoDB
    ├─ Determine role from Cognito Groups
    ├─ Get permissions (user custom OR role default)
    └─ Inject claims into JWT
    ↓
Frontend receives JWT with custom claims
```

### JWT Token Generation Flow (Every Login)

```
User Logs In / Refreshes Token
    ↓
PreTokenGeneration Lambda Triggered
    ↓
1. Fetch User Record (USER#<sub>)
    ↓
2. Determine Role from Cognito Groups
   - ADMIN if in "ADMIN" group
   - HOST if in "HOST" group
    ↓
3. Get Permissions
   - Use user.permissions if exists
   - Else fetch ROLE#<role> config
    ↓
4. Build Custom Claims
   - role
   - hostId (if HOST)
   - permissions
   - status
    ↓
5. Inject Claims into JWT
    ↓
Cognito Issues JWT with Custom Claims
```

---

## 📊 Database Entities

### User Entity

```typescript
{
  pk: "USER#<cognito-sub>",
  sk: "PROFILE",
  email: "host@example.com",
  role: "HOST",                    // NEW: From Cognito Group
  hostId: "host_<uuid>",           // NEW: Links to Host entity
  permissions: [...],              // NEW: Custom or role defaults
  status: "ACTIVE",                // NEW: Account status
  firstName: "John",
  lastName: "Doe",
  phoneNumber: "+46701234567",
  consentGiven: true,
  consentTimestamp: "2025-01-15T10:00:00Z",
  createdAt: "2025-01-15T10:00:00Z",
  updatedAt: "2025-01-15T10:00:00Z"
}
```

### Host Entity (Created at Signup)

```typescript
{
  pk: "HOST#<cognito-sub>",
  sk: "PROFILE",
  hostId: "host_<uuid>",           // NEW: Unique identifier
  ownerUserSub: "<cognito-sub>",   // Links to User
  email: "host@example.com",
  status: "INCOMPLETE",            // NEW: Initially blank
  // Profile fields filled out later by user:
  firstName: null,
  lastName: null,
  businessName: null,
  type: null,
  taxId: null,
  address: null,
  // GSI keys for queries:
  gsi1pk: "OWNER#<cognito-sub>",   // Query by owner
  gsi1sk: "HOST",
  gsi2pk: "STATUS#INCOMPLETE",     // Query by status
  gsi2sk: "HOST#<cognito-sub>",
  createdAt: "2025-01-15T10:00:00Z",
  updatedAt: "2025-01-15T10:00:00Z"
}
```

### Role Entity (Seeded)

```typescript
{
  pk: "ROLE#HOST",
  sk: "CONFIG",
  roleName: "HOST",
  displayName: "Property Host",
  permissions: [
    "HOST_LISTING_CREATE",
    "HOST_LISTING_EDIT_DRAFT",
    "HOST_LISTING_SUBMIT_REVIEW",
    // ... 8 total permissions
  ],
  isActive: true,
  createdAt: "2025-01-15T10:00:00Z",
  updatedAt: "2025-01-15T10:00:00Z"
}
```

### Enum Entity (Seeded)

```typescript
{
  pk: "ENUM#HOST_STATUS",
  sk: "VALUE#INCOMPLETE",
  enumType: "HOST_STATUS",
  enumValue: "INCOMPLETE",
  displayLabel: "Profile Incomplete",
  description: "Host profile created but not yet filled out",
  sortOrder: 1,
  metadata: {
    allowedTransitions: ["VERIFICATION", "SUSPENDED"],
    requiresAction: true,
    color: "orange",
    icon: "warning"
  },
  isActive: true,
  createdAt: "2025-01-15T10:00:00Z",
  updatedAt: "2025-01-15T10:00:00Z"
}
```

---

## 🚧 Pending Tasks

### High Priority

- [ ] Deploy infrastructure changes
- [ ] Seed roles and enums
- [ ] Update DEPLOYMENT_GUIDE.md with PreTokenGeneration attachment steps
- [ ] Test end-to-end signup flow

### Medium Priority

- [ ] Create migration script for existing users
- [ ] Add admin UI for role/permission management
- [ ] Add API endpoints to read enum configurations

### Low Priority / Future

- [ ] Add permission caching in frontend
- [ ] Add audit logging for permission changes
- [ ] Add role hierarchy support (future enhancement)

---

## 📝 Notes

### Design Decisions

1. **Role Source of Truth: Cognito Groups**

   - Groups are managed in Cognito
   - DynamoDB User record stores role for convenience
   - PreTokenGeneration reads from Cognito Groups (authoritative)

2. **Two-Phase Host Creation**

   - Phase 1 (PostConfirmation): Create minimal Host record with `status: INCOMPLETE`
   - Phase 2 (User Action): User fills out profile, status → `VERIFICATION`
   - Ensures `hostId` is available in JWT immediately

3. **Permission Storage**

   - Role defaults in `ROLE#<name>` configs
   - User-specific overrides in `USER#<sub>` records
   - PreTokenGeneration uses user overrides OR role defaults

4. **Enum Management**
   - Stored in DynamoDB for maintainability
   - Includes metadata (colors, icons, transitions)
   - Can be queried dynamically by frontend/backend

### Lambda Timeouts

- PreTokenGeneration: 5 seconds (must be fast, blocks token issuance)
- PostConfirmation: 10 seconds (runs async, doesn't block user)

### Error Handling

- Both Lambdas return event unchanged on error
- Allows authentication to proceed
- Frontend should handle missing claims gracefully

---

## 🔗 Related Documentation

- [RBAC_DATABASE_DESIGN.md](./RBAC_DATABASE_DESIGN.md) - Detailed schema design
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - Deployment instructions
- [README.md](./README.md) - Project overview

---

## ✨ Summary

**We are at the deployment stage!** All code is complete and ready to deploy:

1. ✅ Database schema with GSIs
2. ✅ Seed scripts for roles and enums
3. ✅ PostConfirmation Lambda (user initialization)
4. ✅ PreTokenGeneration Lambda (JWT claims)
5. ✅ Infrastructure configuration

**Next Steps:**

1. Deploy CDK stacks
2. Manually attach PreTokenGeneration trigger to Cognito
3. Run seed scripts
4. Test with a new user signup

**Estimated Time to Production:** 30-45 minutes
