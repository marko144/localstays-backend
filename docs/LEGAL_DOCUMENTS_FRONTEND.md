# Legal Documents (ToS & Privacy) - Frontend Implementation

## Language Support

All legal documents contain **both English (en) and Serbian (sr)** versions in a single record. When a new version is uploaded, both languages are uploaded together.

---

## Fixed URLs (No Auth Required)

For footer links, use these fixed CloudFront URLs:

```typescript
const CLOUDFRONT_DOMAIN = process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN;

const LEGAL_URLS = {
  tos: {
    en: `https://${CLOUDFRONT_DOMAIN}/legal/tos/en/latest.html`,
    sr: `https://${CLOUDFRONT_DOMAIN}/legal/tos/sr/latest.html`,
  },
  privacy: {
    en: `https://${CLOUDFRONT_DOMAIN}/legal/privacy/en/latest.html`,
    sr: `https://${CLOUDFRONT_DOMAIN}/legal/privacy/sr/latest.html`,
  },
};

// Usage based on user's language preference
const userLang = i18n.language === "sr" ? "sr" : "en";
const tosUrl = LEGAL_URLS.tos[userLang];
const privacyUrl = LEGAL_URLS.privacy[userLang];
```

These always point to the current version. No API call needed.

---

## Signup Flow

Pass these custom attributes during Cognito signup:

```typescript
Auth.signUp({
  username: email,
  password,
  attributes: {
    email,
    "custom:termsAccepted": "true",
    "custom:marketingOptIn": marketingOptIn ? "true" : "false",
    "custom:userAgent": navigator.userAgent,
    "custom:acceptLanguage": navigator.language,
  },
});
```

Backend automatically records ToS/Privacy acceptance at signup with latest versions.

---

## Post-Login: Check Acceptance Status

After login, call this to check if user needs to accept new versions:

### `GET /api/v1/hosts/{hostId}/legal/status`

**Response:**

```json
{
  "tos": {
    "currentVersion": "1.0",
    "urls": {
      "en": {
        "versioned": "https://cloudfront.../legal/tos/en/v1.0.html",
        "latest": "https://cloudfront.../legal/tos/en/latest.html"
      },
      "sr": {
        "versioned": "https://cloudfront.../legal/tos/sr/v1.0.html",
        "latest": "https://cloudfront.../legal/tos/sr/latest.html"
      }
    },
    "hostAcceptedVersion": "0.1",
    "hostAcceptedAt": "2024-06-15T10:30:00Z",
    "needsAcceptance": true
  },
  "privacy": {
    "currentVersion": "1.0",
    "urls": {
      "en": {
        "versioned": "https://cloudfront.../legal/privacy/en/v1.0.html",
        "latest": "https://cloudfront.../legal/privacy/en/latest.html"
      },
      "sr": {
        "versioned": "https://cloudfront.../legal/privacy/sr/v1.0.html",
        "latest": "https://cloudfront.../legal/privacy/sr/latest.html"
      }
    },
    "hostAcceptedVersion": "1.0",
    "hostAcceptedAt": "2024-12-01T14:00:00Z",
    "needsAcceptance": false
  }
}
```

**Frontend Logic:**

```typescript
const { tos, privacy } = await getLegalStatus(hostId);
const userLang = i18n.language === "sr" ? "sr" : "en";

if (tos.needsAcceptance || privacy.needsAcceptance) {
  showLegalAcceptanceModal({
    tos: { ...tos, url: tos.urls[userLang].versioned },
    privacy: { ...privacy, url: privacy.urls[userLang].versioned },
  });
}
```

---

## Accept Legal Documents

When user clicks "Accept" in modal:

### `POST /api/v1/hosts/{hostId}/legal/accept`

**Request:**

```json
{
  "acceptTos": true,
  "tosVersion": "1.0",
  "acceptPrivacy": true,
  "privacyVersion": "1.0"
}
```

Version fields are optional - if omitted, accepts latest version.

**Response:**

```json
{
  "success": true,
  "accepted": {
    "tos": {
      "version": "1.0",
      "acceptedAt": "2025-12-07T10:30:00Z"
    },
    "privacy": {
      "version": "1.0",
      "acceptedAt": "2025-12-07T10:30:00Z"
    }
  }
}
```

---

## Admin: Upload Documents

Both English and Serbian content must be uploaded together.

### `POST /api/v1/admin/legal/documents`

**Request:**

```json
{
  "documentType": "tos",
  "version": "1.0",
  "contentEn": "<base64 encoded HTML for English>",
  "contentSr": "<base64 encoded HTML for Serbian>"
}
```

| Field          | Type               | Description                    |
| -------------- | ------------------ | ------------------------------ |
| `documentType` | `tos` \| `privacy` | Document type                  |
| `version`      | `string`           | Semantic version (e.g., "1.0") |
| `contentEn`    | `string`           | Base64 encoded HTML (English)  |
| `contentSr`    | `string`           | Base64 encoded HTML (Serbian)  |

**Response:**

```json
{
  "documentType": "tos",
  "version": "1.0",
  "content": {
    "en": {
      "s3Key": "legal/tos/en/v1.0.html",
      "cloudFrontUrl": "https://cloudfront.../legal/tos/en/v1.0.html",
      "sha256Hash": "abc123..."
    },
    "sr": {
      "s3Key": "legal/tos/sr/v1.0.html",
      "cloudFrontUrl": "https://cloudfront.../legal/tos/sr/v1.0.html",
      "sha256Hash": "def456..."
    }
  },
  "latestUrls": {
    "en": "https://cloudfront.../legal/tos/en/latest.html",
    "sr": "https://cloudfront.../legal/tos/sr/latest.html"
  },
  "uploadedAt": "2025-12-09T10:00:00Z",
  "isLatest": true
}
```

### `GET /api/v1/admin/legal/documents`

Lists all documents with both language versions.

### `GET /api/v1/admin/legal/documents/{type}`

Lists all versions of a document type.

### `GET /api/v1/admin/legal/documents/{type}/{version}`

Gets a specific document version with both languages.

---

## Example Modal Component

```tsx
function LegalAcceptanceModal({ tos, privacy, onAccept }) {
  const [loading, setLoading] = useState(false);
  const { t, i18n } = useTranslation();
  const userLang = i18n.language === "sr" ? "sr" : "en";

  const handleAccept = async () => {
    setLoading(true);
    await acceptLegalDocuments(hostId, {
      acceptTos: tos.needsAcceptance,
      tosVersion: tos.currentVersion,
      acceptPrivacy: privacy.needsAcceptance,
      privacyVersion: privacy.currentVersion,
    });
    onAccept();
  };

  return (
    <Modal blocking>
      <h2>{t("legal.updatedTerms")}</h2>

      {tos.needsAcceptance && (
        <p>
          {t("legal.pleaseReview")}{" "}
          <a href={tos.urls[userLang].versioned} target="_blank">
            {t("legal.termsOfService")}
          </a>
        </p>
      )}

      {privacy.needsAcceptance && (
        <p>
          {t("legal.pleaseReview")}{" "}
          <a href={privacy.urls[userLang].versioned} target="_blank">
            {t("legal.privacyPolicy")}
          </a>
        </p>
      )}

      <Button onClick={handleAccept} loading={loading}>
        {t("legal.iAccept")}
      </Button>
    </Modal>
  );
}
```

---

## S3/CloudFront URL Structure

```
legal/
├── tos/
│   ├── en/
│   │   ├── v1.0.html
│   │   ├── v1.1.html
│   │   └── latest.html  (copy of current version)
│   └── sr/
│       ├── v1.0.html
│       ├── v1.1.html
│       └── latest.html
└── privacy/
    ├── en/
    │   ├── v1.0.html
    │   └── latest.html
    └── sr/
        ├── v1.0.html
        └── latest.html
```

---

## DynamoDB Schema

Single record per version containing both languages:

```
PK: DOCUMENT#tos        SK: VERSION#1.0
{
  documentType: "tos",
  version: "1.0",
  content: {
    en: { s3Key: "legal/tos/en/v1.0.html", sha256Hash: "..." },
    sr: { s3Key: "legal/tos/sr/v1.0.html", sha256Hash: "..." }
  },
  isLatest: true,
  gsi1pk: "LATEST#tos",
  gsi1sk: "DOCUMENT"
}
```

---

## Error Codes

| Code                      | Meaning                                 |
| ------------------------- | --------------------------------------- |
| `HOST_NOT_FOUND`          | Invalid hostId                          |
| `INVALID_DOCUMENT_TYPE`   | Must be "tos" or "privacy"              |
| `INVALID_TOS_VERSION`     | Specified ToS version doesn't exist     |
| `INVALID_PRIVACY_VERSION` | Specified Privacy version doesn't exist |
| `MISSING_CONTENT_EN`      | English content required                |
| `MISSING_CONTENT_SR`      | Serbian content required                |
| `NO_TOS_AVAILABLE`        | No ToS document uploaded yet            |
| `NO_PRIVACY_AVAILABLE`    | No Privacy document uploaded yet        |
| `NO_ACCEPTANCE`           | Must accept at least one document       |
| `VERSION_EXISTS`          | Version already exists                  |

---

## Summary

1. **Footer links**: Use fixed `latest.html` URLs with language path (`/en/` or `/sr/`)
2. **Signup**: Pass `userAgent` and `acceptLanguage` as custom attributes
3. **Post-login**: Call `GET /legal/status`, check `needsAcceptance` flags
4. **Modal**: Show if either flag is true, use `urls[userLang].versioned` for link
5. **Accept**: Call `POST /legal/accept` with versions from status response
6. **Admin upload**: Include both `contentEn` and `contentSr` in request
