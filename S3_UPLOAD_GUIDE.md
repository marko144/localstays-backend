# S3 Pre-signed URL Upload Guide

## 🚨 Critical Requirements for Frontend

When uploading files to S3 using pre-signed URLs, you **MUST** follow these exact rules:

### 1. Use PUT Request (Not POST)

```typescript
// ✅ CORRECT
fetch(uploadUrl, {
  method: "PUT",
  body: file,
  headers: {
    "Content-Type": file.type, // MUST match the MIME type from the API response
  },
});

// ❌ WRONG - Don't use POST
fetch(uploadUrl, {
  method: "POST", // This will fail!
  body: formData,
});
```

### 2. Set Content-Type Header EXACTLY

The `Content-Type` header **MUST** match the MIME type that was used to generate the pre-signed URL.

```typescript
// ✅ CORRECT
const response = await fetch(uploadUrl, {
  method: "PUT",
  body: file,
  headers: {
    "Content-Type": "image/jpeg", // Must match what you sent to the API
  },
});

// ❌ WRONG - Missing Content-Type
const response = await fetch(uploadUrl, {
  method: "PUT",
  body: file,
  // Missing headers!
});

// ❌ WRONG - Wrong Content-Type
const response = await fetch(uploadUrl, {
  method: "PUT",
  body: file,
  headers: {
    "Content-Type": "application/octet-stream", // Doesn't match!
  },
});
```

### 3. Don't Add Extra Headers

Pre-signed URLs are very strict. Only include headers that were specified when generating the URL.

```typescript
// ✅ CORRECT
const response = await fetch(uploadUrl, {
  method: "PUT",
  body: file,
  headers: {
    "Content-Type": file.type,
  },
});

// ❌ WRONG - Extra headers will cause 403
const response = await fetch(uploadUrl, {
  method: "PUT",
  body: file,
  headers: {
    "Content-Type": file.type,
    Authorization: `Bearer ${token}`, // Don't add this!
    "X-Custom-Header": "value", // Don't add this!
  },
});
```

### 4. Send Raw File (Not FormData)

```typescript
// ✅ CORRECT - Send raw file
const response = await fetch(uploadUrl, {
  method: "PUT",
  body: file, // Raw File object
  headers: {
    "Content-Type": file.type,
  },
});

// ❌ WRONG - Don't use FormData
const formData = new FormData();
formData.append("file", file);
const response = await fetch(uploadUrl, {
  method: "PUT",
  body: formData, // This will fail!
});
```

---

## 📋 Complete Frontend Implementation

### Step 1: Submit Intent and Get Upload URLs

```typescript
interface DocumentIntent {
  documentType:
    | "PASSPORT"
    | "ID_CARD"
    | "DRIVERS_LICENSE"
    | "PROOF_OF_ADDRESS"
    | "BUSINESS_REGISTRATION"
    | "VAT_CERTIFICATE";
  fileName: string;
  fileSize: number;
  mimeType: string;
}

interface SubmitIntentResponse {
  success: boolean;
  hostId: string;
  submissionToken: string;
  expiresAt: string;
  uploadUrls: Array<{
    documentId: string;
    documentType: string;
    uploadUrl: string;
    expiresAt: string;
  }>;
}

async function submitProfileIntent(
  hostId: string,
  profile: ProfileData,
  files: File[]
): Promise<SubmitIntentResponse> {
  // Prepare document intents
  const documents: DocumentIntent[] = files.map((file) => ({
    documentType: getDocumentTypeForFile(file), // Your logic to determine type
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
  }));

  const response = await fetch(
    `${API_URL}/api/v1/hosts/${hostId}/profile/submit-intent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        profile,
        documents,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to submit intent");
  }

  return response.json();
}
```

### Step 2: Upload Files to S3 Using Pre-signed URLs

```typescript
async function uploadFileToS3(
  file: File,
  uploadUrl: string,
  mimeType: string
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": mimeType, // CRITICAL: Must match what was sent to API
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`S3 upload failed: ${response.status} - ${errorText}`);
  }
}

async function uploadAllDocuments(
  files: File[],
  uploadUrls: SubmitIntentResponse["uploadUrls"]
): Promise<void> {
  // Upload all files in parallel
  const uploadPromises = uploadUrls.map((urlInfo, index) => {
    const file = files[index];
    return uploadFileToS3(file, urlInfo.uploadUrl, file.type);
  });

  await Promise.all(uploadPromises);
}
```

### Step 3: Confirm Submission

```typescript
async function confirmSubmission(
  hostId: string,
  submissionToken: string
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/v1/hosts/${hostId}/profile/confirm-submission`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        submissionToken,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to confirm submission");
  }
}
```

### Complete Flow

```typescript
async function submitHostProfile(
  hostId: string,
  profile: ProfileData,
  files: File[]
): Promise<void> {
  try {
    // Step 1: Submit intent and get upload URLs
    console.log("Step 1: Submitting intent...");
    const intentResponse = await submitProfileIntent(hostId, profile, files);

    console.log("Step 2: Uploading documents to S3...");
    // Step 2: Upload files to S3
    await uploadAllDocuments(files, intentResponse.uploadUrls);

    console.log("Step 3: Confirming submission...");
    // Step 3: Confirm submission
    await confirmSubmission(hostId, intentResponse.submissionToken);

    console.log("✅ Profile submitted successfully!");
  } catch (error) {
    console.error("❌ Profile submission failed:", error);
    throw error;
  }
}
```

---

## 🐛 Troubleshooting 403 Errors

### Check 1: Verify Content-Type Matches

```typescript
// When creating document intents
const documents = files.map((file) => ({
  documentType: getDocumentType(file),
  fileName: file.name,
  fileSize: file.size,
  mimeType: file.type, // ← This value
}));

// When uploading to S3
await fetch(uploadUrl, {
  method: "PUT",
  body: file,
  headers: {
    "Content-Type": file.type, // ← Must match the mimeType above!
  },
});
```

### Check 2: Verify URL Not Expired

Pre-signed URLs expire after 10 minutes (600 seconds). If you get a 403 error:

```typescript
// Check if URL is expired
const urlInfo = intentResponse.uploadUrls[0];
const expiresAt = new Date(urlInfo.expiresAt);
const now = new Date();

if (now > expiresAt) {
  console.error("Upload URL has expired! You need to request a new one.");
  // Re-submit intent to get fresh URLs
}
```

### Check 3: Don't Modify the URL

```typescript
// ✅ CORRECT - Use URL exactly as provided
const uploadUrl = urlInfo.uploadUrl;
await fetch(uploadUrl, { ... });

// ❌ WRONG - Don't modify the URL
const modifiedUrl = uploadUrl + '&custom=param';
await fetch(modifiedUrl, { ... }); // This will fail!
```

### Check 4: Verify File Object

```typescript
// ✅ CORRECT - File from input
const file = fileInput.files[0];
console.log("File type:", file.type); // e.g., "image/jpeg"
console.log("File size:", file.size);

// ❌ WRONG - Empty or invalid file
if (!file || file.size === 0) {
  throw new Error("Invalid file");
}
```

---

## 📝 Example with Error Handling

```typescript
async function uploadWithRetry(
  file: File,
  uploadUrl: string,
  mimeType: string,
  maxRetries: number = 3
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Upload attempt ${attempt}/${maxRetries} for ${file.name}`);

      const response = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": mimeType,
        },
      });

      if (response.ok) {
        console.log(`✅ Successfully uploaded ${file.name}`);
        return;
      }

      // Log detailed error
      const errorText = await response.text();
      console.error(`❌ Upload failed (${response.status}):`, errorText);

      // Don't retry on 403 (likely a configuration issue)
      if (response.status === 403) {
        throw new Error(
          `Access denied (403). This usually means:\n` +
            `1. Content-Type header doesn't match (expected: ${mimeType})\n` +
            `2. URL has expired\n` +
            `3. Extra headers were added\n` +
            `Error details: ${errorText}`
        );
      }

      // Retry on other errors
      if (attempt === maxRetries) {
        throw new Error(
          `Upload failed after ${maxRetries} attempts: ${errorText}`
        );
      }

      // Wait before retry (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      console.warn(`Attempt ${attempt} failed, retrying...`, error);
    }
  }
}
```

---

## 🔍 Debug Checklist

If you're getting 403 errors, verify:

- [ ] Using `PUT` method (not POST)
- [ ] `Content-Type` header is set
- [ ] `Content-Type` matches the `mimeType` sent to the API
- [ ] Sending raw `File` object (not FormData)
- [ ] Not adding extra headers (like Authorization)
- [ ] URL hasn't expired (< 10 minutes old)
- [ ] Not modifying the pre-signed URL
- [ ] File is valid and not empty
- [ ] CORS is configured on S3 bucket (already done in backend)

---

## 🎯 Quick Test

Test a single file upload:

```typescript
// 1. Get the upload URL from the API
const intentResponse = await submitProfileIntent(hostId, profile, [file]);
const { uploadUrl } = intentResponse.uploadUrls[0];

// 2. Upload the file
const response = await fetch(uploadUrl, {
  method: "PUT",
  body: file,
  headers: {
    "Content-Type": file.type,
  },
});

// 3. Check the response
console.log("Status:", response.status);
console.log("OK:", response.ok);

if (!response.ok) {
  const errorText = await response.text();
  console.error("Error:", errorText);
}
```

---

## 📚 Additional Resources

- [AWS S3 Pre-signed URLs Documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [MDN Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
- [File API](https://developer.mozilla.org/en-US/docs/Web/API/File)





