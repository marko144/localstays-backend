# RBAC Database Design for Localstays

## ✅ Confirmation: PreTokenGeneration Trigger is Possible

**YES**, Cognito's **PreTokenGeneration** Lambda trigger can inject custom claims into JWT tokens (both ID and Access tokens). This is the perfect solution for your RBAC system.

### How it works:
1. User authenticates with Cognito
2. **Before** issuing the JWT, Cognito invokes your PreTokenGen Lambda
3. Lambda fetches user data from DynamoDB (role, permissions, hostId)
4. Lambda adds custom claims to `event.response.claimsOverrideDetails`
5. Cognito issues JWT with your custom claims embedded

### Limitations:
- **ID Token**: Max 2KB for custom claims (plenty for permissions list)
- **Access Token**: Can add custom claims but consider size
- Claims are READ-ONLY to the frontend (tamper-proof)
- **Refresh**: Custom claims are regenerated on each token refresh

---

## Database Design: Single Table (Recommended)

**Use the existing `localstays-dev` DynamoDB table** with a single-table design.

### Why Single Table?
✅ **Performance**: One table = one read for user data  
✅ **Cost**: Lower cost than multiple tables  
✅ **Scalability**: DynamoDB single-table is proven at scale  
✅ **Atomic Operations**: Update user + role in one transaction  
✅ **Simpler Lambda**: One query to get all user context  

---

## Access Patterns

### Critical for PreTokenGen (must be fast):
1. **Get user by Cognito sub** → fetch role, permissions, hostId
2. **Get role permissions** → fetch permission list for a role

### Other patterns (for app logic):
3. Get all users for a host
4. Get all listings for a host
5. Get listing by ID
6. Query listings by status (for admin)
7. Get host by ID
8. Query hosts by status

---

## Entity Designs

### 1. User Record (Updated from current)

**Current structure:**
```typescript
{
  pk: "USER#<sub>",
  sk: "PROFILE",
  email: string,
  termsAccepted: boolean,
  termsAcceptedAt: string,
  marketingOptIn: boolean,
  marketingOptInAt: string,
  createdAt: string,
  updatedAt: string
}
```

**RBAC additions:**
```typescript
{
  pk: "USER#<sub>",
  sk: "PROFILE",
  email: string,
  
  // RBAC fields (NEW)
  role: "HOST" | "ADMIN",        // Derives from Cognito Group, cached here
  hostId: string | null,         // Set for HOST users, null for ADMIN
  permissions: string[],         // Cached from role, can be overridden
  status: "ACTIVE" | "SUSPENDED" | "BANNED",
  
  // Consent tracking (existing)
  termsAccepted: boolean,
  termsAcceptedAt: string,
  marketingOptIn: boolean,
  marketingOptInAt: string,
  
  // Metadata
  createdAt: string,
  updatedAt: string,
  lastLoginAt: string
}
```

**GSI for lookups:**
- **GSI1**: `pk=hostId, sk=USER#<sub>` (query all users for a host)

---

### 2. Role Definition (Static/Config)

Store role → permissions mapping for easy updates:

```typescript
{
  pk: "ROLE#HOST",
  sk: "CONFIG",
  roleName: "HOST",
  displayName: "Property Host",
  description: "Manages their own properties and KYC",
  permissions: [
    "HOST_LISTING_CREATE",
    "HOST_LISTING_EDIT_DRAFT",
    "HOST_LISTING_SUBMIT_REVIEW",
    "HOST_LISTING_SET_OFFLINE",
    "HOST_LISTING_SET_ONLINE",
    "HOST_LISTING_VIEW_OWN",
    "HOST_LISTING_DELETE",
    "HOST_KYC_SUBMIT"
  ],
  isActive: true,
  updatedAt: string
}
```

```typescript
{
  pk: "ROLE#ADMIN",
  sk: "CONFIG",
  roleName: "ADMIN",
  displayName: "Platform Administrator",
  description: "Platform-wide oversight and moderation",
  permissions: [
    "ADMIN_HOST_VIEW_ALL",
    "ADMIN_HOST_SUSPEND",
    "ADMIN_HOST_REINSTATE",
    "ADMIN_KYC_VIEW_ALL",
    "ADMIN_KYC_APPROVE",
    "ADMIN_KYC_REJECT",
    "ADMIN_LISTING_VIEW_ALL",
    "ADMIN_LISTING_APPROVE",
    "ADMIN_LISTING_REJECT",
    "ADMIN_LISTING_SUSPEND"
  ],
  isActive: true,
  updatedAt: string
}
```

**Why store roles in DB?**
- ✅ Easy to update permissions without code deployment
- ✅ Can add new roles without Lambda changes
- ✅ Admin UI can manage roles
- ✅ Audit trail for role changes

---

### 3. Host Record

```typescript
{
  pk: "HOST#<hostId>",
  sk: "META",
  hostId: string,              // Same as pk suffix
  hostType: "INDIVIDUAL" | "BUSINESS",
  businessName: string | null,
  status: "ACTIVE" | "SUSPENDED" | "BANNED",
  
  // KYC
  kyc: {
    status: "NOT_STARTED" | "PENDING" | "APPROVED" | "REJECTED",
    submittedAt: string | null,
    approvedAt: string | null,
    rejectedAt: string | null,
    rejectReason: string | null,
    approvedBy: string | null,  // Admin user ID
    rejectedBy: string | null,
    documentUrls: string[],     // S3 keys
    notes: string | null
  },
  
  // Contact
  email: string,
  phone: string,
  address: {
    street: string,
    city: string,
    state: string,
    country: string,
    postalCode: string
  },
  
  // Stats (denormalized for performance)
  stats: {
    totalListings: number,
    activeListings: number,
    totalBookings: number,
    averageRating: number
  },
  
  // Metadata
  createdBy: string,           // User sub who created this host
  createdAt: string,
  updatedAt: string,
  suspendedAt: string | null,
  suspendedBy: string | null,
  suspendedReason: string | null
}
```

**GSI for queries:**
- **GSI1**: `pk=status, sk=HOST#<hostId>` (query hosts by status)
- **GSI2**: `pk=kyc.status, sk=HOST#<hostId>` (query hosts by KYC status)

---

### 4. Listing Record

```typescript
{
  pk: "LISTING#<listingId>",
  sk: "META",
  listingId: string,
  hostId: string,              // Owner host
  
  // Status & Lifecycle
  status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "ONLINE" | "OFFLINE" | "REJECTED" | "SUSPENDED",
  isDeleted: boolean,
  deletedAt: string | null,
  deletedBy: string | null,    // User who deleted
  
  // Moderation
  moderation: {
    submittedAt: string | null,
    reviewedAt: string | null,
    approvedAt: string | null,
    approvedBy: string | null,   // Admin user ID
    rejectedAt: string | null,
    rejectedBy: string | null,
    rejectReason: string | null,
    suspendedAt: string | null,
    suspendedBy: string | null,
    suspendedReason: string | null,
    notes: string | null
  },
  
  // Property Details
  title: string,
  description: string,
  propertyType: string,
  bedrooms: number,
  bathrooms: number,
  maxGuests: number,
  
  // Location
  address: {
    street: string,
    city: string,
    state: string,
    country: string,
    postalCode: string,
    coordinates: {
      lat: number,
      lng: number
    }
  },
  
  // Pricing
  pricing: {
    basePrice: number,
    currency: "USD" | "EUR",
    cleaningFee: number,
    weeklyDiscount: number,
    monthlyDiscount: number
  },
  
  // Media
  images: string[],            // S3 keys
  coverImage: string,
  
  // Amenities
  amenities: string[],
  
  // Rules
  houseRules: string[],
  checkInTime: string,
  checkOutTime: string,
  cancellationPolicy: string,
  
  // Stats (denormalized)
  stats: {
    totalBookings: number,
    averageRating: number,
    reviewCount: number,
    views: number
  },
  
  // Metadata
  createdAt: string,
  updatedAt: string,
  publishedAt: string | null,  // First time went ONLINE
  lastOnlineAt: string | null
}
```

**GSI for queries:**
- **GSI1**: `pk=hostId, sk=LISTING#<listingId>` (get all listings for a host)
- **GSI2**: `pk=status, sk=LISTING#<listingId>` (query listings by status - for admin)
- **GSI3**: `pk=ONLINE#<city>, sk=LISTING#<listingId>` (search available listings by location)

---

## PreTokenGeneration Lambda Flow

### Lambda Function: `cognito-pre-token-generation.ts`

```typescript
import { PreTokenGenerationTriggerHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME!;
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export const handler: PreTokenGenerationTriggerHandler = async (event) => {
  const { sub } = event.request.userAttributes;
  
  try {
    // 1. Get user record from DynamoDB
    const userResult = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `USER#${sub}`, sk: 'PROFILE' }
    }));
    
    const user = userResult.Item;
    
    if (!user) {
      console.error('User not found in DynamoDB', { sub });
      // Return event unchanged - Cognito will use defaults
      return event;
    }
    
    // 2. Determine role from Cognito Groups (ADMIN wins if both exist)
    const groups = event.request.groupConfiguration?.groupsToOverride || [];
    const role = groups.includes('ADMIN') ? 'ADMIN' : groups.includes('HOST') ? 'HOST' : null;
    
    if (!role) {
      console.warn('User has no role assigned', { sub, groups });
      return event;
    }
    
    // 3. Get permissions for the role
    const roleResult = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `ROLE#${role}`, sk: 'CONFIG' }
    }));
    
    const roleConfig = roleResult.Item;
    const permissions = user.permissions || roleConfig?.permissions || [];
    
    // 4. Build custom claims
    const customClaims: Record<string, any> = {
      role,
      permissions,
      status: user.status || 'ACTIVE'
    };
    
    // Add hostId for HOST users
    if (role === 'HOST' && user.hostId) {
      customClaims.hostId = user.hostId;
    }
    
    // 5. Inject claims into token
    event.response = {
      claimsOverrideDetails: {
        claimsToAddOrOverride: customClaims,
      }
    };
    
    console.log('Claims injected', { sub, role, hostId: customClaims.hostId, permissionCount: permissions.length });
    
    return event;
    
  } catch (error) {
    console.error('PreTokenGeneration failed', { error, sub });
    // Return event unchanged to allow authentication to proceed
    return event;
  }
};
```

---

## Syncing Role from Cognito Groups

Since roles are defined in **Cognito Groups**, we need to sync them to DynamoDB when:
1. User is added to a group (PostAuthentication or manually)
2. User is removed from a group

### Option 1: Sync on PostAuthentication (Recommended)
Update user record with role from Cognito groups after each login.

### Option 2: Sync on Group Assignment
Create admin API that updates both Cognito Group AND DynamoDB.

### Option 3: Read from Cognito Groups Only
PreTokenGen reads groups from `event.request.groupConfiguration` (no DB needed for role).

**Recommended**: **Option 1 + 3 Hybrid**
- PreTokenGen reads role from Cognito Groups (source of truth)
- Cache role in DynamoDB for analytics/queries
- Update DynamoDB role on PostAuthentication

---

## Initial Data Seeding

### Seed Roles (run once)

```typescript
// seed-roles.ts
const roles = [
  {
    pk: 'ROLE#HOST',
    sk: 'CONFIG',
    roleName: 'HOST',
    displayName: 'Property Host',
    permissions: [
      'HOST_LISTING_CREATE',
      'HOST_LISTING_EDIT_DRAFT',
      'HOST_LISTING_SUBMIT_REVIEW',
      'HOST_LISTING_SET_OFFLINE',
      'HOST_LISTING_SET_ONLINE',
      'HOST_LISTING_VIEW_OWN',
      'HOST_LISTING_DELETE',
      'HOST_KYC_SUBMIT'
    ],
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    pk: 'ROLE#ADMIN',
    sk: 'CONFIG',
    roleName: 'ADMIN',
    displayName: 'Platform Administrator',
    permissions: [
      'ADMIN_HOST_VIEW_ALL',
      'ADMIN_HOST_SUSPEND',
      'ADMIN_HOST_REINSTATE',
      'ADMIN_KYC_VIEW_ALL',
      'ADMIN_KYC_APPROVE',
      'ADMIN_KYC_REJECT',
      'ADMIN_LISTING_VIEW_ALL',
      'ADMIN_LISTING_APPROVE',
      'ADMIN_LISTING_REJECT',
      'ADMIN_LISTING_SUSPEND'
    ],
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];
```

---

## Migration Plan for Existing Users

Since you already have users in DynamoDB with the current schema:

```typescript
// migration-add-rbac-fields.ts
async function migrateUser(sub: string, email: string) {
  // Check if user is in HOST or ADMIN group
  const groups = await getCognitoUserGroups(sub);
  const role = groups.includes('ADMIN') ? 'ADMIN' : 'HOST';
  
  // For HOST users, create a Host record if doesn't exist
  let hostId = null;
  if (role === 'HOST') {
    hostId = await getOrCreateHostForUser(sub, email);
  }
  
  // Get permissions from role config
  const roleConfig = await getRoleConfig(role);
  
  // Update user record
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { pk: `USER#${sub}`, sk: 'PROFILE' },
    UpdateExpression: 'SET #role = :role, #hostId = :hostId, #permissions = :permissions, #status = :status, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#role': 'role',
      '#hostId': 'hostId',
      '#permissions': 'permissions',
      '#status': 'status',
      '#updatedAt': 'updatedAt'
    },
    ExpressionAttributeValues: {
      ':role': role,
      ':hostId': hostId,
      ':permissions': roleConfig.permissions,
      ':status': 'ACTIVE',
      ':updatedAt': new Date().toISOString()
    }
  }));
}
```

---

## Token Size Considerations

### Permissions List Size
- HOST: 8 permissions × ~25 chars = ~200 bytes
- ADMIN: 10 permissions × ~25 chars = ~250 bytes

**Total custom claims**: ~500 bytes (well under 2KB limit) ✅

### If you need to optimize:
- Store permission IDs (integers) instead of strings
- Use bitmask for permissions (most compact)
- Store only role in token, fetch permissions on backend

---

## Security Considerations

### 1. Permission Validation
**Backend MUST validate permissions**, never trust claims alone:
```typescript
function hasPermission(claims: TokenClaims, required: string): boolean {
  // Trust Cognito-verified JWT signature
  // But validate permission against DB if critical operation
  if (claims.permissions.includes(required)) {
    // Optionally: fetch fresh permissions from DB for write operations
    return true;
  }
  return false;
}
```

### 2. Host ID Validation
For HOST operations, **ALWAYS** validate:
```typescript
if (claims.role === 'HOST') {
  if (claims.hostId !== resource.hostId) {
    throw new ForbiddenError('Cannot access resources from different host');
  }
}
```

### 3. Token Refresh
- Custom claims are regenerated on token refresh
- If permissions change, user must refresh token (or re-login)
- Consider adding `permissionsVersion` to detect stale tokens

---

## Recommendations

### ✅ DO:
1. Use PreTokenGeneration Lambda to inject claims
2. Use single DynamoDB table for all entities
3. Store role configs in DynamoDB for easy updates
4. Cache role in user record for queries
5. Validate permissions on backend (never trust frontend)
6. Use Cognito Groups as source of truth for role
7. Add `status` field to users for suspension

### ❌ DON'T:
1. Store permissions only in Cognito (can't update without deployment)
2. Use separate tables for each entity (reduces performance)
3. Trust token claims without validation
4. Allow role changes without updating Cognito Group
5. Forget to handle token size limits

---

## Next Steps

1. **Create PreTokenGeneration Lambda**
2. **Update User entity schema** (add role, hostId, permissions, status)
3. **Create Role config entities** in DynamoDB
4. **Seed initial roles** (HOST and ADMIN)
5. **Attach PreTokenGen trigger** to Cognito User Pool
6. **Migrate existing users** (add RBAC fields)
7. **Test token generation** with different roles
8. **Build authorization middleware** for API Gateway/Lambda
9. **Update frontend** to read role/permissions from token

---

## Example Token Payload

After PreTokenGen runs, your JWT will look like:

```json
{
  "sub": "808c590c-6051-7021-b24f-36955c5a47eb",
  "email": "host@example.com",
  "email_verified": true,
  "cognito:username": "808c590c-6051-7021-b24f-36955c5a47eb",
  "cognito:groups": ["HOST"],
  
  "role": "HOST",
  "hostId": "host_abc123",
  "status": "ACTIVE",
  "permissions": [
    "HOST_LISTING_CREATE",
    "HOST_LISTING_EDIT_DRAFT",
    "HOST_LISTING_SUBMIT_REVIEW",
    "HOST_LISTING_SET_OFFLINE",
    "HOST_LISTING_SET_ONLINE",
    "HOST_LISTING_VIEW_OWN",
    "HOST_LISTING_DELETE",
    "HOST_KYC_SUBMIT"
  ],
  
  "iat": 1729713600,
  "exp": 1729717200,
  "iss": "https://cognito-idp.eu-north-1.amazonaws.com/eu-north-1_BtUJVZhtP",
  "aud": "40bibjthjg37ivvc88d1e92pr"
}
```

Perfect for frontend routing and backend authorization! 🚀

