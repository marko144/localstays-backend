# Admin Translation Requests - Simplified Multi-Language System

## Overview

The LocalStays translation system allows hosts to submit listing content in **one language**, and admins to provide translations in additional required languages. This creates a **Translation Request** that admins can view and action.

**Key Principle**: Hosts provide text in ONE language only. Admins add translations for other required languages.

---

## How Translation Requests Are Triggered

### 1. Initial Listing Creation

When a host submits a new listing, they provide each translatable field in **one language**:

**Example Request (Host writes in Serbian):**
```json
{
  "description": {
    "text": "Prelepi stan u centru Beograda...",
    "language": "sr"
  },
  "checkIn": {
    "type": "SELF_CHECKIN",
    "description": {
      "text": "Koristite sef sa šifrom 1234...",
      "language": "sr"
    },
    "checkInFrom": "14:00",
    "checkOutBy": "11:00"
  }
}
```

**Result**: A translation request is automatically created tracking which fields need translation:

```json
{
  "fieldsToTranslate": {
    "description": "sr",
    "checkInDescription": "sr"
  }
}
```

The `fieldsToTranslate` maps each field to the **original language** the host wrote in.

### 2. Editing a Listing

Same logic applies when editing:
```json
{
  "updates": {
    "description": {
      "text": "Updated description in English...",
      "language": "en"
    }
  }
}
```

**Result**: The translation request is updated with `description: "en"`, indicating the host now writes in English and needs Serbian translation.

---

## Data Structures

### TranslatableTextField (Stored on Listing)

The new format uses a `versions` map for extensibility:

```json
{
  "versions": {
    "sr": {
      "text": "Prelepi stan u centru Beograda...",
      "providedBy": "HOST",
      "updatedAt": "2026-01-26T14:55:30.069Z"
    },
    "en": {
      "text": "Beautiful apartment in the heart of Belgrade...",
      "providedBy": "ADMIN",
      "updatedAt": "2026-01-26T15:30:00.000Z",
      "updatedBy": "admin@lokalstays.com"
    }
  },
  "originalLanguage": "sr"
}
```

**Benefits of this structure:**
- **Extensible**: Add new languages (German, French, etc.) without schema changes
- **Auditable**: Track who provided each translation
- **Clear ownership**: `originalLanguage` indicates what the host wrote

### Translation Request (DynamoDB Record)

```json
{
  "pk": "TRANSLATION_REQUEST#PENDING",
  "sk": "LISTING#listing_fa916e62-fb51-4e12-9a6e-4bc40eba4dfe",
  "listingId": "listing_fa916e62-fb51-4e12-9a6e-4bc40eba4dfe",
  "hostId": "host_2f58aff4-a9f1-43d8-bdf9-c3f4e6728e5e",
  "listingName": "Beautiful Apartment in Belgrade",
  "fieldsToTranslate": {
    "description": "sr",
    "checkInDescription": "sr",
    "parkingDescription": "sr"
  },
  "status": "PENDING",
  "requestedAt": "2026-01-26T14:55:30.069Z",
  "gsi3pk": "LISTING#listing_fa916e62-fb51-4e12-9a6e-4bc40eba4dfe",
  "gsi3sk": "TRANSLATION_REQUEST"
}
```

**Fields Explained:**

| Field | Description |
|-------|-------------|
| `fieldsToTranslate` | Maps field name → original language the host wrote in |
| `status` | `PENDING` (admins delete when complete) |
| `requestedAt` | When the listing was submitted/updated |

---

## Language Configuration

The system uses a centralized language configuration to determine which languages are required:

```json
{
  "pk": "CONFIG#SYSTEM",
  "sk": "LANGUAGES",
  "languages": [
    { "code": "en", "name": "English", "nativeName": "English", "isActive": true },
    { "code": "sr", "name": "Serbian", "nativeName": "Srpski", "isActive": true }
  ],
  "requiredForListings": ["en", "sr"]
}
```

**Admin screens should use this configuration** to dynamically show which languages need translations.

---

## Admin API Endpoints

### 1. List Pending Translation Requests

**Endpoint**: `GET /api/v1/admin/translation-requests`

**Permission Required**: `ADMIN_LISTING_VIEW_ALL`

**Response**:
```json
{
  "success": true,
  "data": {
    "requests": [
      {
        "listingId": "listing_fa916e62-fb51-4e12-9a6e-4bc40eba4dfe",
        "hostId": "host_2f58aff4-a9f1-43d8-bdf9-c3f4e6728e5e",
        "listingName": "Beautiful Apartment in Belgrade",
        "fieldsToTranslate": {
          "description": "sr",
          "checkInDescription": "sr"
        },
        "requestedAt": "2026-01-26T14:55:30.069Z"
      }
    ],
    "pagination": {
      "count": 1,
      "hasMore": false,
      "nextToken": null
    }
  }
}
```

---

### 2. Set Translations

**Endpoint**: `PUT /api/v1/admin/listings/{listingId}/translations`

**Permission Required**: `ADMIN_LISTING_VIEW_ALL`

**Request Body**:

Admin provides translations for target language(s). **The language must differ from originalLanguage**.

```json
{
  "description": {
    "language": "en",
    "text": "Beautiful apartment in the heart of Belgrade with stunning city views..."
  },
  "checkInDescription": {
    "language": "en",
    "text": "Use the lockbox with code 1234 at the front door..."
  }
}
```

**Validation**: If the host wrote in Serbian (`originalLanguage: "sr"`), admin can ONLY add English (`language: "en"`). Attempting to set Serbian will return an error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Cannot set description translation in 'sr' - this is the host's original language"
  }
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "listingId": "listing_fa916e62-fb51-4e12-9a6e-4bc40eba4dfe",
    "translationsUpdated": ["description.en", "checkInDescription.en"],
    "updatedAt": "2026-01-26T15:30:00.000Z"
  }
}
```

---

### 3. Complete Translation Request

**Endpoint**: `PATCH /api/v1/admin/translation-requests/{listingId}/complete`

**Permission Required**: `ADMIN_LISTING_VIEW_ALL`

**Description**: Marks a translation request as complete. Validates that all required languages exist for all fields before allowing completion.

**Response (Success)**:
```json
{
  "success": true,
  "data": {
    "listingId": "listing_fa916e62-fb51-4e12-9a6e-4bc40eba4dfe",
    "completedAt": "2026-01-26T16:00:00.000Z",
    "completedBy": "admin@lokalstays.com"
  }
}
```

**Response (Incomplete Translations)**:
```json
{
  "success": false,
  "error": {
    "code": "INCOMPLETE_TRANSLATIONS",
    "message": "Not all required translations are present",
    "details": ["description.en", "checkInDescription.en"]
  }
}
```

---

### 4. Get Language Configuration

**Endpoint**: `GET /api/v1/admin/config/languages`

**Permission Required**: `ADMIN_LISTING_VIEW_ALL`

**Response**:
```json
{
  "success": true,
  "data": {
    "languages": [
      { "code": "en", "name": "English", "nativeName": "English", "isActive": true },
      { "code": "sr", "name": "Serbian", "nativeName": "Srpski", "isActive": true }
    ],
    "requiredForListings": ["en", "sr"],
    "updatedAt": "2026-01-26T10:00:00.000Z"
  }
}
```

---

### 5. Update Language Configuration

**Endpoint**: `PUT /api/v1/admin/config/languages`

**Permission Required**: `ADMIN_LISTING_VIEW_ALL` (super admin)

**Request Body**:
```json
{
  "languages": [
    { "code": "en", "name": "English", "nativeName": "English", "isActive": true },
    { "code": "sr", "name": "Serbian", "nativeName": "Srpski", "isActive": true },
    { "code": "de", "name": "German", "nativeName": "Deutsch", "isActive": true }
  ],
  "requiredForListings": ["en", "sr"]
}
```

---

## Admin Workflow

### Recommended Admin UI Flow

1. **Translation Requests List Page**
   - Call `GET /api/v1/admin/translation-requests`
   - Display table: Listing Name, Original Language, Fields, Date Requested
   - Each row links to the listing detail page

2. **Listing Detail Page**
   - Call `GET /api/v1/admin/config/languages` to get required languages
   - For each translatable field (`description`, `checkIn.description`, `parking.description`):
     - Show the host's text with original language badge
     - For each **other** required language, show input field for admin translation
   - Submit button calls `PUT /api/v1/admin/listings/{listingId}/translations`

3. **Completing Translation**
   - After adding all required translations, click "Mark Complete"
   - This calls `PATCH /api/v1/admin/translation-requests/{listingId}/complete`
   - If incomplete, error shows which translations are missing

### Example UI Mockup

```
┌─────────────────────────────────────────────────────────────────┐
│ Listing: Beautiful Apartment in Belgrade                        │
│ Status: IN_REVIEW                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Description                              Original: Serbian 🇷🇸   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ [HOST] Serbian:                                             │ │
│ │ "Prelepi stan u centru Beograda sa predivnim pogledom..."  │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ [ADMIN] English (enter translation):        ⚠️ Required    │ │
│ │ [                                                         ] │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ Check-in Instructions                    Original: Serbian 🇷🇸   │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ [HOST] Serbian:                                             │ │
│ │ "Koristite sef sa šifrom 1234 na ulaznim vratima..."       │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ [ADMIN] English (enter translation):        ⚠️ Required    │ │
│ │ [                                                         ] │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│               [ Save Translations ]    [ Mark Complete ]        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Provider Tracking

Each language version tracks who provided it:

| Provider | Meaning |
|----------|---------|
| `HOST` | Text was provided by the property host |
| `ADMIN` | Text was translated by a LocalStays admin |

The `updatedBy` field (admin's email/sub) is only present for ADMIN-provided translations.

---

## Future Extensibility

The new system is designed for multi-language expansion:

1. **Add New Language**: 
   - Update `CONFIG#SYSTEM LANGUAGES` via admin API
   - Add to `requiredForListings` if listings must have that language

2. **No Schema Changes**: 
   - New languages are just new keys in the `versions` map
   - Existing listings continue to work

3. **Gradual Rollout**:
   - Can add languages as optional first (`isActive: true` but not in `requiredForListings`)
   - Later make them required when enough translations exist

---

## Migration

Existing listings with the old `BilingualTextField` format (`en`/`sr` objects directly) need migration to the new `TranslatableTextField` format (`versions` map).

**Migration Script**: `backend/services/migrations/migrate-to-translatable-text-fields.ts`

```bash
# Dry run (preview changes)
TABLE_NAME=localstays-staging AWS_REGION=eu-north-1 npx ts-node backend/services/migrations/migrate-to-translatable-text-fields.ts

# Apply changes
DRY_RUN=false TABLE_NAME=localstays-staging AWS_REGION=eu-north-1 npx ts-node backend/services/migrations/migrate-to-translatable-text-fields.ts
```

---

## Host Frontend Changes

### Translatable Fields

The following fields are now translatable:
- `description` (required)
- `checkIn.description` (optional)
- `parking.description` (optional)

### OLD Input Format (deprecated)

```json
{
  "description": {
    "en": "English text...",
    "sr": "Serbian text...",
    "requestTranslation": true
  }
}
```

### NEW Input Format

```json
{
  "description": {
    "text": "The text in ONE language...",
    "language": "sr"
  }
}
```

### Host Create Listing Form

1. **Language Selector**: Add a language dropdown (EN/SR) near each text field
2. **Single Text Input**: Host writes in their chosen language
3. **No Translation Toggle Needed**: Translation is always implied (admin will add other languages)

**Example Form Structure:**
```
Description
┌─────────────────────────────────────────────┐
│ Language: [Serbian ▼]                       │
│ ┌─────────────────────────────────────────┐ │
│ │ Prelepi stan u centru Beograda...      │ │
│ │                                         │ │
│ │                                         │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### Submit Intent Request Example

**POST** `/api/v1/hosts/{hostId}/listings/submit-intent`

```json
{
  "listingName": "Beautiful Apartment in Belgrade",
  "propertyType": "APARTMENT",
  "description": {
    "text": "Prelepi stan u centru Beograda sa predivnim pogledom na grad...",
    "language": "sr"
  },
  "address": { ... },
  "capacity": { ... },
  "checkIn": {
    "type": "SELF_CHECKIN",
    "description": {
      "text": "Koristite sef sa šifrom na ulaznim vratima",
      "language": "sr"
    },
    "checkInFrom": "14:00",
    "checkOutBy": "11:00"
  },
  "parking": {
    "type": "FREE",
    "description": {
      "text": "Besplatan parking ispred zgrade",
      "language": "sr"
    }
  },
  ...
}
```

### Update Listing Request Example

**PUT** `/api/v1/hosts/{hostId}/listings/{listingId}/update`

```json
{
  "updates": {
    "description": {
      "text": "Updated description in English...",
      "language": "en"
    }
  }
}
```

### Get Listing Response (New Format)

When fetching a listing, the response now contains `versions` map:

```json
{
  "listing": {
    "listingId": "...",
    "description": {
      "versions": {
        "sr": {
          "text": "Prelepi stan...",
          "providedBy": "HOST",
          "updatedAt": "2026-01-26T14:55:30.069Z"
        },
        "en": {
          "text": "Beautiful apartment...",
          "providedBy": "ADMIN",
          "updatedAt": "2026-01-26T15:30:00.000Z",
          "updatedBy": "admin@lokalstays.com"
        }
      },
      "originalLanguage": "sr"
    },
    "checkIn": {
      "type": { "key": "SELF_CHECKIN", ... },
      "description": {
        "versions": {
          "sr": { "text": "...", "providedBy": "HOST", ... }
        },
        "originalLanguage": "sr"
      },
      ...
    },
    ...
  }
}
```

### Displaying Host's Text for Editing

When host edits their listing:
1. Find the `originalLanguage` from the field
2. Pre-populate the text input with `versions[originalLanguage].text`
3. Pre-select the language dropdown to `originalLanguage`
4. On submit, send `{ text, language }` format

```typescript
// Example helper
function getHostText(field: TranslatableTextField): { text: string; language: string } {
  const lang = field.originalLanguage;
  return {
    text: field.versions[lang]?.text || '',
    language: lang
  };
}
```

### Validation Errors

| Error | Cause |
|-------|-------|
| `description.language must be a valid 2-letter language code` | Invalid language code |
| `description.text is required` | Empty text |
| `description.text must be at least 50 characters` | Too short (description only) |
| `description.text must not exceed 2000 characters` | Too long |

---

## Guest/Public Frontend Changes

### Public Listing Response

Public listings return bilingual short descriptions:

```json
{
  "listingId": "...",
  "name": "Beautiful Apartment in Belgrade",
  "shortDescription": {
    "en": "Beautiful apartment in the heart of Belgrade...",
    "sr": "Prelepi stan u centru Beograda..."
  },
  ...
}
```

### Displaying to Guests

Use the user's locale preference to select which language to display:

```typescript
function getLocalizedText(shortDesc: { en: string; sr: string }, locale: string): string {
  if (locale.startsWith('sr')) {
    return shortDesc.sr || shortDesc.en; // Fallback to English
  }
  return shortDesc.en || shortDesc.sr; // Fallback to Serbian
}
```

**Important**: Always have a fallback since translations may be incomplete during the admin review period.

---

## Summary

1. **Hosts provide text in ONE language** via `{ text, language }` input
2. **Translation requests track** which fields need translation and their original language
3. **Admins add translations** for required languages (cannot overwrite host's language)
4. **Language config determines** which languages are required
5. **Admins explicitly mark complete** when all translations are done
6. **System is extensible** - add new languages without code changes

---

## Quick Reference: API Changes

### Host APIs - Changed Request Format

| Endpoint | Field Change |
|----------|--------------|
| `POST /hosts/{hostId}/listings/submit-intent` | `description`, `checkIn.description`, `parking.description` → `{ text, language }` |
| `PUT /hosts/{hostId}/listings/{listingId}/update` | Same fields → `{ text, language }` |

### Host APIs - Changed Response Format

| Endpoint | Field Change |
|----------|--------------|
| `GET /hosts/{hostId}/listings/{listingId}` | Translatable fields now return `{ versions: {...}, originalLanguage }` |

### Admin APIs - New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/translation-requests/{listingId}/complete` | PATCH | Mark translation complete |
| `/admin/config/languages` | GET | Get language configuration |
| `/admin/config/languages` | PUT | Update language configuration |

### Admin APIs - Changed Field Names

| Before | After |
|--------|-------|
| `fieldsRequested` | `fieldsToTranslate` |
| `source: "HOST" \| "LOKALSTAYS"` | `providedBy: "HOST" \| "ADMIN"` |
