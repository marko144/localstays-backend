# Frontend Upload Instructions

## Profile Submission with Document Uploads

## 🎯 Quick Summary

1. **Send MIME type when requesting URLs** - Backend needs it to generate correct pre-signed URLs
2. **Upload to S3 with exact Content-Type** - Must match the MIME type you sent
3. **Handle partial failures** - Some uploads may succeed while others fail
4. **Retry only failed uploads** - Don't re-upload successful files
5. **Call confirm-submission only when ALL uploads succeed**

---

## 📝 Step-by-Step Implementation

### Step 1: Submit Intent with MIME Types

**Critical:** You MUST send the `mimeType` for each document.

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
  mimeType: string; // ← REQUIRED! e.g., "application/pdf", "image/jpeg", "image/png"
}

async function submitProfileIntent(
  hostId: string,
  profile: ProfileData,
  files: File[]
): Promise<SubmitIntentResponse> {
  // Prepare document intents with MIME types
  const documents: DocumentIntent[] = files.map((file) => ({
    documentType: determineDocumentType(file), // Your logic
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type, // ← Get from File object
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
        documents, // ← Contains mimeType for each file
      }),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to submit intent");
  }

  return response.json();
}
```

**Allowed MIME types:**

- `application/pdf`
- `image/jpeg`
- `image/jpg`
- `image/png`

---

### Step 2: Upload to S3 with Matching Content-Type

**Critical:** The `Content-Type` header MUST exactly match the `mimeType` you sent in Step 1.

```typescript
interface UploadResult {
  documentId: string;
  success: boolean;
  error?: Error;
}

async function uploadFileToS3(
  file: File,
  uploadUrl: string,
  mimeType: string // ← Must match what you sent to API
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": mimeType, // ← MUST MATCH!
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`S3 upload failed (${response.status}): ${errorText}`);
  }
}

async function uploadAllDocuments(
  files: File[],
  uploadUrls: DocumentUploadUrl[]
): Promise<UploadResult[]> {
  // Upload all files and track results
  const results = await Promise.allSettled(
    uploadUrls.map(async (urlInfo, index) => {
      const file = files[index];

      // Use the SAME mimeType that was sent to the API
      // (Should match file.type, but use what API expects)
      await uploadFileToS3(file, urlInfo.uploadUrl, file.type);

      return {
        documentId: urlInfo.documentId,
        success: true,
      };
    })
  );

  // Convert Promise results to UploadResult[]
  return results.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    } else {
      return {
        documentId: uploadUrls[index].documentId,
        success: false,
        error: result.reason,
      };
    }
  });
}
```

---

### Step 3: Handle Partial Failures

**The tricky part:** Some uploads may succeed while others fail.

```typescript
interface SubmissionState {
  submissionToken: string;
  uploadUrls: DocumentUploadUrl[];
  expiresAt: string;
  files: File[];
  uploadResults: Map<string, { success: boolean; error?: Error }>;
}

async function handleProfileSubmission(
  hostId: string,
  profile: ProfileData,
  files: File[]
): Promise<void> {
  // Step 1: Get upload URLs
  const intentResponse = await submitProfileIntent(hostId, profile, files);

  const state: SubmissionState = {
    submissionToken: intentResponse.submissionToken,
    uploadUrls: intentResponse.uploadUrls,
    expiresAt: intentResponse.expiresAt,
    files,
    uploadResults: new Map(),
  };

  // Step 2: Upload all files
  const results = await uploadAllDocuments(files, intentResponse.uploadUrls);

  // Track results
  results.forEach((result) => {
    state.uploadResults.set(result.documentId, {
      success: result.success,
      error: result.error,
    });
  });

  // Step 3: Check if all succeeded
  const allSucceeded = results.every((r) => r.success);
  const someFailed = results.some((r) => !r.success);

  if (allSucceeded) {
    // All uploads succeeded - confirm submission
    await confirmSubmission(hostId, intentResponse.submissionToken, results);
    console.log("✅ Profile submitted successfully!");
  } else if (someFailed) {
    // Some failed - handle partial failure
    await handlePartialFailure(hostId, state);
  }
}
```

---

### Step 4: Retry Failed Uploads Only

**Don't re-upload files that already succeeded!**

```typescript
async function handlePartialFailure(
  hostId: string,
  state: SubmissionState
): Promise<void> {
  // Find which uploads failed
  const failedUploads = state.uploadUrls.filter((urlInfo) => {
    const result = state.uploadResults.get(urlInfo.documentId);
    return !result?.success;
  });

  console.log(`❌ ${failedUploads.length} uploads failed`);

  // Show error to user
  const shouldRetry = await askUserToRetry(
    `${failedUploads.length} document(s) failed to upload. Would you like to retry?`
  );

  if (!shouldRetry) {
    return; // User cancelled
  }

  // Check if token expired
  if (isTokenExpired(state.expiresAt)) {
    console.log("⏰ Token expired - need to restart submission");
    throw new Error("Upload token expired. Please submit again.");
  }

  // Retry ONLY the failed uploads
  const retryResults = await Promise.allSettled(
    failedUploads.map(async (urlInfo) => {
      const fileIndex = state.uploadUrls.findIndex(
        (u) => u.documentId === urlInfo.documentId
      );
      const file = state.files[fileIndex];

      await uploadFileToS3(file, urlInfo.uploadUrl, file.type);

      return {
        documentId: urlInfo.documentId,
        success: true,
      };
    })
  );

  // Update results
  retryResults.forEach((result, index) => {
    const docId = failedUploads[index].documentId;
    if (result.status === "fulfilled") {
      state.uploadResults.set(docId, { success: true });
    } else {
      state.uploadResults.set(docId, { success: false, error: result.reason });
    }
  });

  // Check if all succeeded now
  const allSucceeded = Array.from(state.uploadResults.values()).every(
    (r) => r.success
  );

  if (allSucceeded) {
    // All uploads succeeded - confirm submission
    const allResults = state.uploadUrls.map((urlInfo) => ({
      documentId: urlInfo.documentId,
      success: true,
    }));
    await confirmSubmission(hostId, state.submissionToken, allResults);
    console.log("✅ Profile submitted successfully after retry!");
  } else {
    // Still have failures - offer another retry
    await handlePartialFailure(hostId, state);
  }
}

function isTokenExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

function askUserToRetry(message: string): Promise<boolean> {
  // Show dialog/toast to user
  return new Promise((resolve) => {
    const retry = window.confirm(message);
    resolve(retry);
  });
}
```

---

### Step 5: Confirm Submission (Only When All Succeed)

**Only call this when ALL uploads have succeeded.**

```typescript
async function confirmSubmission(
  hostId: string,
  submissionToken: string,
  uploadResults: UploadResult[]
): Promise<void> {
  // Only include successfully uploaded documents
  const uploadedDocuments = uploadResults
    .filter((r) => r.success)
    .map((r) => ({
      documentId: r.documentId,
      documentType: getDocumentType(r.documentId), // You need to track this
    }));

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
        uploadedDocuments,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();

    // Backend will verify files exist in S3
    if (error.data?.missingFiles) {
      throw new Error(
        `Some files are missing in S3: ${error.data.missingFiles
          .map((f) => f.documentId)
          .join(", ")}`
      );
    }

    throw new Error(error.message || "Confirmation failed");
  }

  return response.json();
}
```

---

## 🎨 Complete Example with UI State

```typescript
interface UploadState {
  status:
    | "idle"
    | "validating"
    | "uploading"
    | "confirming"
    | "success"
    | "error";
  submissionToken: string | null;
  uploadProgress: Map<string, number>; // documentId -> progress %
  uploadResults: Map<string, { success: boolean; error?: Error }>;
  expiresAt: string | null;
}

function useProfileSubmission() {
  const [state, setState] = useState<UploadState>({
    status: "idle",
    submissionToken: null,
    uploadProgress: new Map(),
    uploadResults: new Map(),
    expiresAt: null,
  });

  const submit = async (profile: ProfileData, files: File[]) => {
    try {
      // Step 1: Submit intent
      setState((prev) => ({ ...prev, status: "validating" }));
      const intent = await submitProfileIntent(hostId, profile, files);

      setState((prev) => ({
        ...prev,
        submissionToken: intent.submissionToken,
        expiresAt: intent.expiresAt,
      }));

      // Step 2: Upload files with progress tracking
      setState((prev) => ({ ...prev, status: "uploading" }));

      const results = await uploadAllDocumentsWithProgress(
        files,
        intent.uploadUrls,
        (docId, progress) => {
          setState((prev) => ({
            ...prev,
            uploadProgress: new Map(prev.uploadProgress).set(docId, progress),
          }));
        }
      );

      // Update results
      const uploadResults = new Map(
        results.map((r) => [
          r.documentId,
          { success: r.success, error: r.error },
        ])
      );
      setState((prev) => ({ ...prev, uploadResults }));

      // Check for failures
      const allSucceeded = results.every((r) => r.success);

      if (!allSucceeded) {
        setState((prev) => ({ ...prev, status: "error" }));
        // Handle partial failure (see Step 4 above)
        return;
      }

      // Step 3: Confirm submission
      setState((prev) => ({ ...prev, status: "confirming" }));
      await confirmSubmission(hostId, intent.submissionToken, results);

      setState((prev) => ({ ...prev, status: "success" }));
    } catch (error) {
      setState((prev) => ({ ...prev, status: "error" }));
      throw error;
    }
  };

  const retryFailed = async (files: File[]) => {
    // Retry only failed uploads (see Step 4 above)
  };

  return { state, submit, retryFailed };
}

// Usage in component
function ProfileSubmissionForm() {
  const { state, submit, retryFailed } = useProfileSubmission();

  return (
    <div>
      {state.status === "uploading" && (
        <div>
          <p>Uploading documents...</p>
          {Array.from(state.uploadProgress.entries()).map(
            ([docId, progress]) => (
              <ProgressBar key={docId} value={progress} />
            )
          )}
        </div>
      )}

      {state.status === "error" && (
        <div>
          <p>Some uploads failed:</p>
          <ul>
            {Array.from(state.uploadResults.entries())
              .filter(([_, result]) => !result.success)
              .map(([docId, result]) => (
                <li key={docId}>
                  Document {docId}: {result.error?.message}
                </li>
              ))}
          </ul>
          <button onClick={() => retryFailed(files)}>
            Retry Failed Uploads
          </button>
        </div>
      )}

      {state.status === "success" && <p>✅ Profile submitted successfully!</p>}
    </div>
  );
}
```

---

## 🔍 Common Mistakes to Avoid

### ❌ Wrong: Not sending mimeType

```typescript
const documents = files.map((file) => ({
  documentType: getType(file),
  fileName: file.name,
  fileSize: file.size,
  // Missing mimeType!
}));
```

### ✅ Correct: Always send mimeType

```typescript
const documents = files.map((file) => ({
  documentType: getType(file),
  fileName: file.name,
  fileSize: file.size,
  mimeType: file.type, // ← Required!
}));
```

---

### ❌ Wrong: Content-Type doesn't match

```typescript
// Sent "image/jpeg" to API
await fetch(uploadUrl, {
  method: "PUT",
  body: file,
  headers: {
    "Content-Type": "application/octet-stream", // ← Wrong!
  },
});
```

### ✅ Correct: Content-Type matches exactly

```typescript
// Sent "image/jpeg" to API
await fetch(uploadUrl, {
  method: "PUT",
  body: file,
  headers: {
    "Content-Type": "image/jpeg", // ← Matches!
  },
});
```

---

### ❌ Wrong: Re-uploading successful files

```typescript
// Some uploads failed, so retry ALL of them
await uploadAllDocuments(files, uploadUrls); // ← Wasteful!
```

### ✅ Correct: Retry only failed uploads

```typescript
// Only retry the ones that failed
const failedUploads = uploadUrls.filter((urlInfo) => {
  return !uploadResults.get(urlInfo.documentId)?.success;
});
await retryUploads(failedUploads); // ← Efficient!
```

---

### ❌ Wrong: Calling confirm before all succeed

```typescript
// Some uploads failed but calling confirm anyway
if (results.some((r) => r.success)) {
  await confirmSubmission(hostId, token, results); // ← Will fail!
}
```

### ✅ Correct: Only confirm when ALL succeed

```typescript
// Only confirm when ALL uploads succeeded
if (results.every((r) => r.success)) {
  await confirmSubmission(hostId, token, results); // ← Correct!
}
```

---

## 🎯 Key Takeaways

1. **Always send `mimeType`** when requesting upload URLs
2. **Match `Content-Type`** exactly when uploading to S3
3. **Track upload results** per document
4. **Retry only failed uploads** - don't re-upload successful ones
5. **Check token expiry** before retrying (15 minute limit)
6. **Only call confirm-submission** when ALL uploads succeed
7. **Handle partial failures gracefully** with clear UI feedback
8. **Use `Promise.allSettled`** to handle multiple uploads independently

---

## 📞 Need Help?

If you see **403 Forbidden** errors:

- Check that `Content-Type` header matches the `mimeType` you sent
- Verify you're not adding extra headers (like `Authorization`)
- Ensure URL hasn't expired (10 minute limit)
- Check browser console for CORS errors

If **some uploads succeed but others fail**:

- Use the retry logic above to retry only failed ones
- Check file sizes (max 10MB per file)
- Verify MIME types are allowed (pdf, jpeg, jpg, png only)





