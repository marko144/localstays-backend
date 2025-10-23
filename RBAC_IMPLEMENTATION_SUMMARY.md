# RBAC Implementation Summary

## ✅ Answers to Your Questions

### 1. **Can we pass claims back inside the token?**
**YES!** Cognito's **PreTokenGeneration** Lambda trigger is perfect for this:
- Inject custom claims (`role`, `hostId`, `permissions`) into JWT
- Max 2KB for custom claims (plenty of space)
- Claims are tamper-proof (signed by Cognito)
- Automatically refreshed on token renewal

### 2. **How best to structure RBAC in DynamoDB?**
**SINGLE TABLE DESIGN** (use existing `localstays-dev` table):

| Entity | PK | SK | Why? |
|--------|----|----|------|
| User | `USER#<sub>` | `PROFILE` | Store role, hostId, permissions, status |
| Role Config | `ROLE#<roleName>` | `CONFIG` | Define permissions per role (editable) |
| Host | `HOST#<hostId>` | `META` | Host status, KYC, business info |
| Listing | `LISTING#<listingId>` | `META` | Property data, status, moderation |

**Why single table?**
- ✅ Fast lookups (one query for user context in PreTokenGen)
- ✅ Lower cost than multiple tables
- ✅ Proven at scale for DynamoDB
- ✅ Atomic transactions across entities

---

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User Login (Cognito)                                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Cognito checks groups (HOST or ADMIN)                    │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PreTokenGeneration Lambda Triggered                      │
│    - Fetch user from DynamoDB (USER#<sub>)                  │
│    - Fetch role config (ROLE#<role>)                        │
│    - Build custom claims:                                   │
│      • role: "HOST" or "ADMIN"                              │
│      • hostId: "host_123" (if HOST)                         │
│      • permissions: ["HOST_LISTING_CREATE", ...]            │
│      • status: "ACTIVE"                                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Cognito issues JWT with custom claims embedded           │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Frontend receives token                                  │
│    - Routes to /host or /admin based on role                │
│    - Shows/hides UI based on permissions                    │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. API Requests (with JWT in Authorization header)          │
│    - API Gateway validates JWT signature                    │
│    - Lambda reads claims from token                         │
│    - Validates permissions + hostId (if HOST)               │
│    - Executes operation if authorized                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Checklist

### Phase 1: Database Schema
- [ ] Add RBAC fields to User entity (role, hostId, permissions, status)
- [ ] Create Role config entities (ROLE#HOST, ROLE#ADMIN)
- [ ] Create Host entity schema
- [ ] Create Listing entity schema
- [ ] Add GSIs for queries (hostId, status lookups)

### Phase 2: Lambda Functions
- [ ] Create PreTokenGeneration Lambda
- [ ] Add IAM permissions (DynamoDB read)
- [ ] Attach trigger to Cognito User Pool
- [ ] Test token generation with HOST user
- [ ] Test token generation with ADMIN user

### Phase 3: Seed Data
- [ ] Seed ROLE#HOST config with permissions
- [ ] Seed ROLE#ADMIN config with permissions
- [ ] Migrate existing users (add RBAC fields)
- [ ] Create initial Host records for existing HOST users

### Phase 4: Authorization Middleware
- [ ] Create Lambda authorizer function
- [ ] Implement permission validation helper
- [ ] Implement hostId validation for HOST operations
- [ ] Add to API Gateway

### Phase 5: Frontend Integration
- [ ] Decode JWT and read custom claims
- [ ] Route based on role (/host vs /admin)
- [ ] Show/hide UI based on permissions
- [ ] Handle permission errors gracefully

### Phase 6: Testing
- [ ] Test HOST user flow (create listing, submit for review)
- [ ] Test ADMIN user flow (approve listing, suspend host)
- [ ] Test permission validation
- [ ] Test hostId tenant isolation
- [ ] Test token refresh (permissions stay current)

---

## Key Benefits of This Design

### 🚀 Performance
- **One DynamoDB query** in PreTokenGen = fast token generation
- Permissions cached in JWT = no DB lookup on every request
- Single table = efficient queries with GSIs

### 💰 Cost
- Minimal Lambda invocations (only on login/refresh)
- Single DynamoDB table = lower cost
- No additional auth service needed

### 🔒 Security
- Permissions signed in JWT (tamper-proof)
- Backend validates on every request
- Host tenant isolation enforced
- Easy to suspend users (update status, refresh token)

### 🛠️ Maintainability
- Update permissions without code deploy (edit DynamoDB)
- Add new roles easily
- Clear separation of concerns
- Well-documented permission list

### 📈 Scalability
- DynamoDB single-table scales to millions of users
- JWT claims = stateless authorization
- No session management needed
- Horizontal scaling with Lambda

---

## Example Queries

### PreTokenGen: Get user + role
```typescript
// 1. Get user
const user = await ddb.get({
  pk: 'USER#808c590c-6051-7021-b24f-36955c5a47eb',
  sk: 'PROFILE'
});

// 2. Get role config
const roleConfig = await ddb.get({
  pk: 'ROLE#HOST',
  sk: 'CONFIG'
});

// Result: user.permissions or roleConfig.permissions
```

### API: Validate HOST operation
```typescript
const claims = decodeJWT(token);

// Check role
if (claims.role !== 'HOST') {
  throw new ForbiddenError('HOST role required');
}

// Check permission
if (!claims.permissions.includes('HOST_LISTING_CREATE')) {
  throw new ForbiddenError('Missing permission');
}

// Check tenant isolation
const listing = await getListing(listingId);
if (listing.hostId !== claims.hostId) {
  throw new ForbiddenError('Cannot access other host\'s listings');
}

// ✅ Authorized!
```

---

## Files to Create

1. **`backend/services/auth/cognito-pre-token-generation.ts`**
   - PreTokenGen Lambda handler
   - Fetches user + role from DynamoDB
   - Injects custom claims

2. **`backend/services/auth/authorization-middleware.ts`**
   - Helper functions for permission checks
   - Host ID validation
   - Role validation

3. **`backend/services/rbac/seed-roles.ts`**
   - Script to seed role configs
   - Run once after deployment

4. **`backend/services/rbac/migrate-users.ts`**
   - Migration script for existing users
   - Adds RBAC fields

5. **`infra/lib/rbac-stack.ts`** (optional)
   - CDK for PreTokenGen Lambda
   - IAM permissions
   - Cognito trigger attachment

---

## Permission Validation Examples

### Frontend (TypeScript)
```typescript
// Decode JWT
const token = await Auth.currentSession();
const claims = token.getIdToken().decodePayload();

// Check role
if (claims.role === 'HOST') {
  // Show host dashboard
  router.push('/host/dashboard');
} else if (claims.role === 'ADMIN') {
  // Show admin dashboard
  router.push('/admin/dashboard');
}

// Check permission
if (claims.permissions.includes('HOST_LISTING_CREATE')) {
  // Show "Create Listing" button
  <Button onClick={createListing}>Create Listing</Button>
}
```

### Backend (Lambda)
```typescript
export async function createListing(event: APIGatewayEvent) {
  const claims = getClaims(event); // From JWT
  
  // 1. Check role
  if (claims.role !== 'HOST') {
    return forbidden('HOST role required');
  }
  
  // 2. Check permission
  if (!hasPermission(claims, 'HOST_LISTING_CREATE')) {
    return forbidden('Missing HOST_LISTING_CREATE permission');
  }
  
  // 3. Validate hostId
  if (!claims.hostId) {
    return forbidden('No host associated with user');
  }
  
  // 4. Check host status
  const host = await getHost(claims.hostId);
  if (host.status === 'SUSPENDED') {
    return forbidden('Host is suspended');
  }
  
  // ✅ Create listing
  const listing = await db.createListing({
    hostId: claims.hostId,
    status: 'DRAFT',
    // ... other fields
  });
  
  return success(listing);
}
```

---

## Migration Strategy

### For Existing Users in Production

1. **Add nullable RBAC fields first**:
   ```typescript
   role?: string
   hostId?: string
   permissions?: string[]
   status?: string
   ```

2. **Deploy PreTokenGen Lambda** (handles missing fields gracefully)

3. **Run migration script** in batches:
   ```typescript
   for (const user of users) {
     await migrateUser(user.sub);
   }
   ```

4. **Verify** all users have RBAC fields

5. **Make fields required** in schema

---

## Conclusion

This RBAC design gives you:
- ✅ **Fast authorization** (permissions in JWT)
- ✅ **Flexible permissions** (editable in DynamoDB)
- ✅ **Secure tenant isolation** (hostId validation)
- ✅ **Scalable architecture** (single table, stateless)
- ✅ **Easy to maintain** (clear permission list)

Ready to implement? Start with Phase 1 (database schema updates) and Phase 2 (PreTokenGen Lambda). 🚀

