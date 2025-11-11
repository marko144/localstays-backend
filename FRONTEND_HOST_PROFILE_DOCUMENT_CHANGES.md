# Frontend Changes: Host Profile Document Requirements

## 🚨 Breaking Changes - Document Requirements Updated

**Date:** November 11, 2025  
**Environment:** Staging (deployed)  
**Affects:** Host profile submission flow for both Individual and Business hosts

---

## Summary of Changes

We've updated the document requirements for host profile submissions:

### Individual Hosts

- **Proof of Address** is now **OPTIONAL** (was previously mandatory)
- Government ID remains mandatory

### Business Hosts

- **Proof of Address** has been **COMPLETELY REMOVED** (no longer accepted)
- Only Government ID and Business Registration are required (plus VAT Certificate if VAT registered)

---

## Updated Document Requirements

### For INDIVIDUAL Hosts

**Mandatory:**

- ✅ Government-issued ID (one of):
  - Passport
  - ID Card
  - Driver's License

**Optional:**

- ⚪ Proof of Address (utility bill, bank statement, etc.)

**Minimum documents:** 1 (just the ID)  
**Maximum documents:** 2 (ID + optional proof of address)

---

### For BUSINESS Hosts

**Mandatory:**

- ✅ Government-issued ID of authorized person (one of):
  - Passport
  - ID Card
  - Driver's License
- ✅ Business Registration

**Conditionally Mandatory:**

- ✅ VAT Certificate (only if `vatRegistered: true`)

**Removed:**

- ❌ ~~Proof of Address~~ - No longer required or accepted

**Minimum documents:** 2 (ID + Business Registration)  
**Maximum documents:** 3 (ID + Business Registration + VAT Certificate if VAT registered)

---

## Frontend Implementation Changes Required

### 1. Update Form Validation

#### Individual Host Form

```typescript
// OLD validation (REMOVE THIS)
const requiredDocs = {
  governmentId: true,
  proofOfAddress: true, // ❌ Remove this requirement
};

// NEW validation (USE THIS)
const requiredDocs = {
  governmentId: true,
  proofOfAddress: false, // ✅ Now optional
};
```

#### Business Host Form

```typescript
// OLD validation (REMOVE THIS)
const requiredDocs = {
  governmentId: true,
  businessRegistration: true,
  proofOfAddress: true, // ❌ Remove this completely
  vatCertificate: vatRegistered,
};

// NEW validation (USE THIS)
const requiredDocs = {
  governmentId: true,
  businessRegistration: true,
  // proofOfAddress removed entirely
  vatCertificate: vatRegistered,
};
```

### 2. Update UI Labels and Help Text

#### Individual Host - Proof of Address

```typescript
// Update the label to indicate it's optional
<FormField
  label="Proof of Address (Optional)"
  helperText="Optional: Upload a utility bill, bank statement, or official document showing your address"
  optional={true}
/>
```

#### Business Host - Remove Proof of Address Field

```typescript
// REMOVE the entire proof of address field from business host form
// Do not show this field at all for business hosts
```

### 3. Update Document Type Enum (if used in frontend)

```typescript
export enum DocumentType {
  PASSPORT = "PASSPORT",
  ID_CARD = "ID_CARD",
  DRIVERS_LICENSE = "DRIVERS_LICENSE",
  PROOF_OF_ADDRESS = "PROOF_OF_ADDRESS", // Still valid for Individual hosts
  BUSINESS_REGISTRATION = "BUSINESS_REGISTRATION",
  VAT_CERTIFICATE = "VAT_CERTIFICATE",
}

// Update allowed documents per host type
export const ALLOWED_DOCUMENTS = {
  INDIVIDUAL: [
    DocumentType.PASSPORT,
    DocumentType.ID_CARD,
    DocumentType.DRIVERS_LICENSE,
    DocumentType.PROOF_OF_ADDRESS, // ✅ Still allowed, but optional
  ],
  BUSINESS: [
    DocumentType.PASSPORT,
    DocumentType.ID_CARD,
    DocumentType.DRIVERS_LICENSE,
    DocumentType.BUSINESS_REGISTRATION,
    DocumentType.VAT_CERTIFICATE,
    // ❌ PROOF_OF_ADDRESS removed from business hosts
  ],
};
```

### 4. Update Form Submission Logic

#### Individual Host Submission

```typescript
// Allow submission even if proof of address is not provided
const documents = [];

// Government ID (mandatory)
if (governmentIdFile) {
  documents.push({
    documentType: selectedIdType, // PASSPORT | ID_CARD | DRIVERS_LICENSE
    fileName: governmentIdFile.name,
    fileSize: governmentIdFile.size,
    mimeType: governmentIdFile.type,
  });
} else {
  // Show error - government ID is required
  return;
}

// Proof of Address (optional)
if (proofOfAddressFile) {
  documents.push({
    documentType: "PROOF_OF_ADDRESS",
    fileName: proofOfAddressFile.name,
    fileSize: proofOfAddressFile.size,
    mimeType: proofOfAddressFile.type,
  });
}
// ✅ No error if proof of address is missing

// Submit with 1 or 2 documents
await submitHostProfile({ profile, documents });
```

#### Business Host Submission

```typescript
// Do not include proof of address at all
const documents = [];

// Government ID (mandatory)
if (governmentIdFile) {
  documents.push({
    documentType: selectedIdType,
    fileName: governmentIdFile.name,
    fileSize: governmentIdFile.size,
    mimeType: governmentIdFile.type,
  });
} else {
  return; // Error
}

// Business Registration (mandatory)
if (businessRegistrationFile) {
  documents.push({
    documentType: "BUSINESS_REGISTRATION",
    fileName: businessRegistrationFile.name,
    fileSize: businessRegistrationFile.size,
    mimeType: businessRegistrationFile.type,
  });
} else {
  return; // Error
}

// VAT Certificate (conditional)
if (vatRegistered && vatCertificateFile) {
  documents.push({
    documentType: "VAT_CERTIFICATE",
    fileName: vatCertificateFile.name,
    fileSize: vatCertificateFile.size,
    mimeType: vatCertificateFile.type,
  });
} else if (vatRegistered && !vatCertificateFile) {
  return; // Error - VAT cert required when VAT registered
}

// ❌ Do NOT include proof of address for business hosts
// Submit with 2 or 3 documents (never include proof of address)
await submitHostProfile({ profile, documents });
```

### 5. Update Error Messages

```typescript
// Individual Host
const ERROR_MESSAGES = {
  INDIVIDUAL: {
    MISSING_ID: "Government-issued ID is required",
    // Remove: MISSING_PROOF_OF_ADDRESS error
  },
  BUSINESS: {
    MISSING_ID: "Government-issued ID of authorized person is required",
    MISSING_BUSINESS_REG: "Business Registration document is required",
    MISSING_VAT_CERT: "VAT Certificate is required when VAT registered",
    // Remove: MISSING_PROOF_OF_ADDRESS error
  },
};
```

### 6. Update Help Text / Instructions

#### Individual Host Instructions

```
Required Documents:
✓ Government-issued ID (Passport, ID Card, or Driver's License)

Optional Documents:
• Proof of Address (utility bill, bank statement, or official document)
```

#### Business Host Instructions

```
Required Documents:
✓ Government-issued ID of authorized person
✓ Business Registration document
✓ VAT Certificate (only if your business is VAT registered)
```

---

## API Request/Response Changes

### No changes to API endpoint or request structure

The API endpoints remain the same:

- `POST /api/v1/hosts/{hostId}/profile/submit-intent`
- `POST /api/v1/hosts/{hostId}/profile/confirm-submission`

The request body structure is unchanged - you just send fewer documents:

```typescript
// Example: Individual host with only ID (no proof of address)
{
  "profile": { /* profile data */ },
  "documents": [
    {
      "documentType": "PASSPORT",
      "fileName": "passport.jpg",
      "fileSize": 1234567,
      "mimeType": "image/jpeg"
    }
    // No proof of address - this is now valid!
  ]
}

// Example: Business host (no proof of address allowed)
{
  "profile": { /* profile data */ },
  "documents": [
    {
      "documentType": "ID_CARD",
      "fileName": "id.jpg",
      "fileSize": 1234567,
      "mimeType": "image/jpeg"
    },
    {
      "documentType": "BUSINESS_REGISTRATION",
      "fileName": "business_reg.pdf",
      "fileSize": 2345678,
      "mimeType": "application/pdf"
    }
    // No proof of address included
  ]
}
```

### Backend Validation

The backend will now:

- ✅ **Accept** Individual host submissions with only 1 document (just ID)
- ✅ **Accept** Individual host submissions with 2 documents (ID + proof of address)
- ✅ **Accept** Business host submissions with 2 documents (ID + Business Registration)
- ✅ **Accept** Business host submissions with 3 documents (ID + Business Registration + VAT Certificate)
- ❌ **Reject** Business host submissions that include PROOF_OF_ADDRESS

---

## Testing Checklist

### Individual Host Flow

- [ ] Can submit with only Government ID (no proof of address)
- [ ] Can submit with Government ID + Proof of Address
- [ ] Form shows proof of address as optional
- [ ] No validation errors when proof of address is omitted
- [ ] Backend accepts submission with 1 document
- [ ] Backend accepts submission with 2 documents

### Business Host Flow

- [ ] Cannot see proof of address field in the form
- [ ] Can submit with Government ID + Business Registration only
- [ ] Can submit with Government ID + Business Registration + VAT Certificate (when VAT registered)
- [ ] Form validation requires VAT Certificate when `vatRegistered: true`
- [ ] Backend accepts submission with 2 documents (non-VAT registered)
- [ ] Backend accepts submission with 3 documents (VAT registered)
- [ ] Backend rejects if PROOF_OF_ADDRESS is included (should not happen if UI is correct)

---

## Rollout Plan

1. **Staging Environment:** ✅ Already deployed
2. **Frontend Changes:** Update forms and validation
3. **Testing:** Complete checklist above
4. **Production Deployment:** Deploy backend changes, then frontend changes

---

## Questions or Issues?

Contact backend team if:

- You receive unexpected validation errors
- The backend rejects valid document combinations
- You need clarification on document types

---

## Technical Notes

- Document type validation is in `backend/services/types/document.types.ts`
- Validation logic is in `backend/services/api/lib/document-validation.ts`
- Host profile submission is in `backend/services/api/hosts/submit-intent.ts`
