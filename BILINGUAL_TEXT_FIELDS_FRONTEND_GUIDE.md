# Translatable Text Fields - Frontend Implementation Guide

## Overview

This document describes the **simplified multi-language text field system** for listing content. The system is designed to be future-proof and can easily support additional languages beyond English and Serbian.

## Key Concept

**Host provides text in ONE language** → **Backend automatically creates translation request** → **Admin provides translations** → **Admin marks complete**

## Affected Fields

| Field | Description | Required |
|-------|-------------|----------|
| `description` | Main listing description | Yes (min 50 chars) |
| `checkIn.description` | Check-in instructions | No |
| `parking.description` | Parking details | No |

---

## Data Structures

### Host Input Format (Simple)

When creating or updating a listing, hosts send:

```typescript
interface TranslatableTextFieldInput {
  text: string;      // The content
  language: string;  // Language code: 'en' or 'sr'
}
```

### Stored Format (Multi-Language Map)

The backend stores text in a language-keyed map:

```typescript
interface TranslatableTextField {
  versions: {
    [languageCode: string]: {
      text: string;
      providedBy: 'HOST' | 'ADMIN';
      updatedAt: string;
      updatedBy?: string;  // Admin sub if providedBy is ADMIN
    };
  };
  originalLanguage: string;  // Which language the host wrote in
}
```

### Example Stored Data

```json
{
  "description": {
    "versions": {
      "en": {
        "text": "Beautiful apartment in Belgrade with stunning views...",
        "providedBy": "HOST",
        "updatedAt": "2026-01-26T10:30:00Z"
      },
      "sr": {
        "text": "Prelepi stan u Beogradu sa predivnim pogledom...",
        "providedBy": "ADMIN",
        "updatedAt": "2026-01-26T14:00:00Z",
        "updatedBy": "admin-sub-123"
      }
    },
    "originalLanguage": "en"
  }
}
```

---

## Host Frontend Changes

### 1. Create Listing (POST /api/v1/hosts/{hostId}/listings/submit-intent)

**Request Body - Translatable Fields:**

```typescript
// BEFORE (old format - do NOT use)
{
  description: "Beautiful apartment...",
  checkIn: {
    description: "Use the lockbox..."
  }
}

// AFTER (new format)
{
  description: {
    text: "Beautiful apartment in Belgrade...",
    language: "en"  // Host indicates which language they wrote in
  },
  checkIn: {
    type: "SELF_CHECKIN",
    checkInFrom: "14:00",
    checkOutBy: "11:00",
    description: {           // Optional
      text: "Use the lockbox with code 1234",
      language: "en"
    }
  },
  parking: {
    type: "FREE",
    description: {           // Optional
      text: "Free parking in front of building",
      language: "en"
    }
  }
}
```

### 2. Update Listing (PUT /api/v1/hosts/{hostId}/listings/{listingId}/update)

Same format as create - only send fields you want to update:

```typescript
{
  "updates": {
    "description": {
      "text": "Updated description text...",
      "language": "en"
    }
  }
}
```

### 3. Get Listing Response (GET /api/v1/hosts/{hostId}/listings/{listingId})

Returns the full `versions` map:

```json
{
  "success": true,
  "data": {
    "listing": {
      "listingId": "listing_abc123",
      "description": {
        "versions": {
          "en": {
            "text": "Beautiful apartment...",
            "providedBy": "HOST",
            "updatedAt": "2026-01-26T10:30:00Z"
          },
          "sr": {
            "text": "Prelepi stan...",
            "providedBy": "ADMIN",
            "updatedAt": "2026-01-26T14:00:00Z",
            "updatedBy": "admin-sub-123"
          }
        },
        "originalLanguage": "en"
      },
      "checkIn": {
        "type": { "key": "SELF_CHECKIN", "en": "Self Check-in", "sr": "Samostalni ulazak" },
        "checkInFrom": "14:00",
        "checkOutBy": "11:00",
        "description": {
          "versions": {
            "en": {
              "text": "Use the lockbox...",
              "providedBy": "HOST",
              "updatedAt": "2026-01-26T10:30:00Z"
            }
          },
          "originalLanguage": "en"
        }
      }
    }
  }
}
```

---

## ⚠️ Critical Behavior: Host Updates Clear Translations

**When a host updates any translatable field, ALL existing translations are CLEARED.**

This is intentional to prevent stale/misleading translations.

### Example Scenario:

1. Host writes description in English
2. Admin translates to Serbian
3. **Host updates the English description**
4. **Result:** Serbian translation is deleted, new translation request is created

### Why?

- The admin's Serbian translation was based on the OLD English text
- If we kept the old Serbian, guests might see outdated/incorrect information
- A new translation request signals the admin to translate the new text

### UI Implications:

Show a warning when host edits a field that has existing translations:

```
⚠️ Updating this text will require new translations from our team.
Any existing translations will be replaced once we provide new ones.
```

---

## Guest/Public Frontend Changes

### Search Listings (GET /api/v1/guest/search/listings)

The `shortDescription` field is returned as a language map:

```json
{
  "listings": [
    {
      "listingId": "listing_abc123",
      "name": "Beautiful Apartment",
      "shortDescription": {
        "en": "Beautiful apartment in the heart of Belgrade...",
        "sr": "Prelepi stan u srcu Beograda..."
      }
    }
  ]
}
```

### Displaying Text

Pick the appropriate language based on user preference:

```typescript
function getLocalizedText(
  shortDescription: { en?: string; sr?: string },
  userLanguage: 'en' | 'sr'
): string {
  // Try user's preferred language first
  if (shortDescription[userLanguage]) {
    return shortDescription[userLanguage];
  }
  // Fall back to any available language
  return shortDescription.en || shortDescription.sr || '';
}
```

### Get Listing Details (GET /api/v1/guest/listings/{listingId})

Full translatable fields are returned with the `versions` structure:

```typescript
function getLocalizedDescription(
  field: TranslatableTextField,
  userLanguage: 'en' | 'sr'
): string {
  const version = field.versions[userLanguage];
  if (version?.text) {
    return version.text;
  }
  // Fall back to original language
  const original = field.versions[field.originalLanguage];
  return original?.text || '';
}
```

---

## Admin Frontend Changes

### 1. List Translation Requests

**GET /api/v1/admin/translation-requests**

```json
{
  "success": true,
  "data": {
    "translationRequests": [
      {
        "listingId": "listing_abc123",
        "hostId": "host_xyz",
        "listingName": "Beautiful Apartment",
        "fieldsToTranslate": {
          "description": "en",        // Host wrote in English, need Serbian
          "checkInDescription": "en",
          "parkingDescription": "en"
        },
        "status": "PENDING",
        "requestedAt": "2026-01-26T10:30:00Z"
      }
    ]
  }
}
```

### 2. Set Translations

**PUT /api/v1/admin/listings/{listingId}/translations**

Admin provides translations for the OTHER language (not the original):

```typescript
// Host wrote in English (originalLanguage: "en")
// Admin provides Serbian translation:
{
  "description": {
    "language": "sr",
    "text": "Prelepi stan u Beogradu..."
  },
  "checkInDescription": {
    "language": "sr", 
    "text": "Koristite kutiju za ključeve..."
  },
  "parkingDescription": {
    "language": "sr",
    "text": "Besplatan parking ispred zgrade"
  }
}
```

**Validation:** Admin cannot set a translation for the `originalLanguage` - that's the host's text.

### 3. Complete Translation Request

**PATCH /api/v1/admin/translation-requests/{listingId}/complete**

After providing all translations, admin explicitly marks the request complete:

```typescript
// Request
PATCH /api/v1/admin/translation-requests/listing_abc123/complete

// Response (success)
{
  "success": true,
  "data": {
    "message": "Translation request completed",
    "listingId": "listing_abc123"
  }
}

// Response (error - missing translations)
{
  "success": false,
  "error": {
    "message": "Cannot complete: missing required translations",
    "code": "MISSING_TRANSLATIONS",
    "missingTranslations": {
      "sr": ["description", "checkInDescription"]
    }
  }
}
```

### 4. Get Listing (Admin View)

**GET /api/v1/admin/listings/{listingId}**

Includes pending translation request info:

```json
{
  "success": true,
  "data": {
    "listing": { /* ... */ },
    "pendingTranslationRequest": {
      "fieldsToTranslate": {
        "description": "en",
        "checkInDescription": "en"
      },
      "requestedAt": "2026-01-26T10:30:00Z"
    }
  }
}
```

---

## Language Configuration (Admin)

Admins can manage supported languages dynamically.

### Get Languages

**GET /api/v1/admin/config/languages**

```json
{
  "success": true,
  "data": {
    "languages": [
      {
        "code": "en",
        "name": "English",
        "nativeName": "English",
        "isActive": true
      },
      {
        "code": "sr",
        "name": "Serbian",
        "nativeName": "Српски",
        "isActive": true
      }
    ],
    "requiredForListings": ["en", "sr"]
  }
}
```

### Update Languages

**PUT /api/v1/admin/config/languages**

```typescript
{
  "languages": [
    { "code": "en", "name": "English", "nativeName": "English", "isActive": true },
    { "code": "sr", "name": "Serbian", "nativeName": "Српски", "isActive": true },
    { "code": "de", "name": "German", "nativeName": "Deutsch", "isActive": false }
  ],
  "requiredForListings": ["en", "sr"]
}
```

---

## Translation Status Indicators

### For Host UI

Show translation status on listing cards/details:

| Status | Indicator | Meaning |
|--------|-----------|---------|
| All translations complete | ✅ | All required languages have text |
| Pending translation | 🔄 | Waiting for admin to translate |
| Partial translations | ⚠️ | Some languages missing |

### Check Translation Status

```typescript
function getTranslationStatus(
  field: TranslatableTextField,
  requiredLanguages: string[]
): 'complete' | 'pending' | 'partial' {
  const availableLanguages = Object.keys(field.versions)
    .filter(lang => field.versions[lang]?.text);
  
  const missingCount = requiredLanguages
    .filter(lang => !availableLanguages.includes(lang))
    .length;
  
  if (missingCount === 0) return 'complete';
  if (missingCount === requiredLanguages.length - 1) return 'pending';
  return 'partial';
}
```

---

## Migration Notes

Existing listings have been migrated to the new format:

- Old `BilingualTextField` (`{ en: {...}, sr: {...} }`) → New `TranslatableTextField` (`{ versions: { en: {...}, sr: {...} }, originalLanguage: "en" }`)
- Existing translations are preserved
- `originalLanguage` defaults to `"en"` for migrated data

---

## Quick Reference

### Host API Endpoints

| Endpoint | Method | Translatable Field Format |
|----------|--------|---------------------------|
| `/api/v1/hosts/{hostId}/listings/submit-intent` | POST | `{ text: string, language: string }` |
| `/api/v1/hosts/{hostId}/listings/{listingId}/update` | PUT | `{ text: string, language: string }` |
| `/api/v1/hosts/{hostId}/listings/{listingId}` | GET | Returns `TranslatableTextField` |

### Admin API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/admin/translation-requests` | GET | List pending requests |
| `/api/v1/admin/listings/{listingId}/translations` | PUT | Set translations |
| `/api/v1/admin/translation-requests/{listingId}/complete` | PATCH | Mark complete |
| `/api/v1/admin/config/languages` | GET | Get language config |
| `/api/v1/admin/config/languages` | PUT | Update language config |

### Guest API Endpoints

| Endpoint | Method | Translatable Field Format |
|----------|--------|---------------------------|
| `/api/v1/guest/search/listings` | GET | `shortDescription: { en?: string, sr?: string }` |
| `/api/v1/guest/listings/{listingId}` | GET | Returns `TranslatableTextField` |
