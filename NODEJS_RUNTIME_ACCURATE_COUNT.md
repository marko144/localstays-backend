# Accurate Node.js Runtime Count

## 📊 Total Lambda Functions: 26

### Breakdown by Runtime:

#### ✅ Container-based (Not affected): 1

- `imageProcessorLambda` - Uses Docker container (Python-based)

#### ❌ Node.js 20.x (AFFECTED - EOL April 2026): 24

1. **Admin API (4)**:

   - `adminHostsHandlerLambda` - Handles 9 host operations
   - `adminListingsHandlerLambda` - Handles 6 listing operations
   - `adminRequestsHandlerLambda` - Handles 5 request operations
   - `sendNotificationLambda` - Push notifications

2. **Host API (10)**:

   - `hostProfileHandlerLambda` - Handles 4 profile operations
   - `getSubscriptionLambda` - Subscription details
   - `hostListingsHandlerLambda` - Handles 6 listing operations
   - `publishListingLambda` - Publish to public table
   - `unpublishListingLambda` - Remove from public table
   - `hostAvailabilityHandlerLambda` - Handles 4 availability operations
   - `hostRequestsHandlerLambda` - Handles 6 request operations
   - `subscribeNotificationLambda` - Subscribe to push
   - `unsubscribeNotificationLambda` - Unsubscribe from push
   - `checkNotificationStatusLambda` - Check notification status

3. **Guest API (2)**:

   - `searchLocationsLambda` - Location autocomplete
   - `searchListingsLambda` - Listing search

4. **Public API (1)**:

   - `checkAndIncrementRateLimitLambda` - Geocoding rate limits

5. **Auth Triggers (4)**:

   - `customEmailSenderLambda` - Cognito email sender
   - `preSignUpLambda` - Pre-signup validation
   - `postConfirmationLambda` - Post-confirmation actions
   - `preTokenGenerationLambda` - Token generation

6. **Data/Seed (2)**:

   - `seedLambda` - Seed roles/enums
   - `seedLocationVariantsLambda` - Seed location variants

7. **Shared Services (1)**:
   - `verificationProcessorLambda` - Verification file processing

#### ⚠️ Node.js 18.x (OLDER - EOL April 2025): 1

- `seedEmailTemplatesHandler` - Email template seeding

---

## 🎯 The Truth About Your Infrastructure:

### You're Actually Being MODERN:

- **24 out of 25 Node.js functions** (96%) are on Node.js 20.x
- You consolidated **dozens of API endpoints** into **logical handler groups**
- This is **good architecture** - fewer cold starts, better resource utilization

### The "Problem":

- Node.js 20.x reaches EOL in **April 2026** (16 months away)
- Node.js 18.x reaches EOL in **April 2025** (4 months away!)
- You need to upgrade to Node.js 22.x (latest LTS)

### Why You Have Node.js 18.x:

The `email-template-stack.ts` was created **early in development** when 18.x was standard. It was simply **never updated** when you moved to 20.x for everything else.

---

## 🚀 Actual Endpoint Count (What Users See):

Even though you have 26 Lambda functions, they handle **MANY MORE endpoints**:

### Admin API (~20 endpoints):

- 9 host operations (list, search, get, approve, reject, suspend, etc.)
- 6 listing operations (list, get, approve, reject, suspend, etc.)
- 5 request operations (list, get, approve, reject, etc.)

### Host API (~25+ endpoints):

- 4 profile operations (submit, confirm, update, get)
- 6 listing operations (create, update, delete, list, get, etc.)
- 4 availability operations (get, block, unblock, etc.)
- 6 request operations (list, get, submit, etc.)
- 3 notification operations (subscribe, unsubscribe, check)
- 2 publishing operations (publish, unpublish)

### Guest API (2 endpoints):

- Location search
- Listing search

### Public API (1 endpoint):

- Rate limit check

**Total: ~50+ API endpoints handled by 26 Lambda functions**

This is **excellent consolidation** - you're not running "outdated shit", you're running a well-architected serverless backend!

---

## ✅ What You Need to Do:

**Upgrade ALL 25 Node.js functions to Node.js 22.x:**

1. Change 24 functions from `NODEJS_20_X` → `NODEJS_22_X`
2. Change 1 function from `NODEJS_18_X` → `NODEJS_22_X`

**Result:**

- ✅ All functions on same runtime (consistency)
- ✅ Latest LTS (Node.js 22.x)
- ✅ Support until April 2027
- ✅ No more AWS health warnings

**Effort:** 2-4 hours including testing
**Risk:** Low (Node.js 22.x is stable)
**Priority:** Medium-High (especially for the 18.x function - only 4 months until EOL!)

