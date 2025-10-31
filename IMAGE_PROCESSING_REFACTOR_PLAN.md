# Image & File Processing Architecture Refactor

## Current State Analysis

### File Upload Patterns

#### 1. **Listing Images** (Currently Working ✅)

- **Current Path**: `{hostId}/listings/{listingId}/staging/{imageId}.jpg`
- **Destination**: `{hostId}/listings/{listingId}/images/{imageId}-full.webp` + thumbnail
- **Pipeline**: GuardDuty scan → Lambda resize/WebP conversion → DynamoDB update
- **Status**: Working but needs prefix

#### 2. **Profile Documents** (NOT Scanned ❌)

- **Current Path**: `{hostId}/verification/{documentId}_{fileName}`
- **Types**: ID_CARD, PASSPORT, UTILITY_BILL, etc.
- **Status**: Uploads directly to final location without scanning

#### 3. **Listing Documents** (NOT Scanned ❌)

- **Current Path**: `{hostId}/listings/{listingId}/verification/{documentType}.{ext}`
- **Types**: PROOF_OF_RIGHT_TO_LIST, EXISTING_PROFILE_PROOF
- **Status**: Uploads directly to final location without scanning

#### 4. **Property Video Verification** (NOT Scanned ❌)

- **Current Path**: `{hostId}/listings/{listingId}/verification/property-video-{requestId}.{ext}`
- **Types**: MP4, MOV, WEBM
- **Status**: Uploads directly to final location without scanning

#### 5. **Live ID Check Documents** (NOT Scanned ❌)

- **Current Path**: `{hostId}/requests/{requestId}_{fileName}`
- **Types**: Profile photos, ID documents
- **Status**: Uploads directly to final location without scanning

---

## Proposed Solution: Two-Prefix, Two-Pipeline Architecture

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         S3 Upload                                │
└───────────────────┬─────────────────────────────────────────────┘
                    │
                    ├─────────────────┬──────────────────────────┐
                    │                 │                          │
              ┌─────▼──────┐    ┌────▼─────┐           ┌────────▼────────┐
              │ lstimg_*   │    │ veri_*   │           │ Other files     │
              │ (Listing   │    │ (All     │           │ (Skip scanning) │
              │  Images)   │    │ Verif    │           └─────────────────┘
              └─────┬──────┘    │ Files)   │
                    │           └────┬─────┘
                    │                │
            ┌───────▼────────┐  ┌────▼───────────┐
            │  GuardDuty     │  │  GuardDuty     │
            │  Scan          │  │  Scan          │
            └───────┬────────┘  └────┬───────────┘
                    │                │
            ┌───────▼────────┐  ┌────▼───────────┐
            │  EventBridge   │  │  EventBridge   │
            │  (Scan Result) │  │  (Scan Result) │
            └───────┬────────┘  └────┬───────────┘
                    │                │
            ┌───────▼────────┐  ┌────▼───────────┐
            │   SQS Queue    │  │   SQS Queue    │
            │   (Images)     │  │   (Docs/Video) │
            └───────┬────────┘  └────┬───────────┘
                    │                │
        ┌───────────▼────────┐  ┌────▼──────────────┐
        │ Image Processor    │  │ Verification File │
        │ Lambda             │  │ Processor Lambda  │
        │                    │  │                   │
        │ • Download image   │  │ • Move to final   │
        │ • Resize (1920px)  │  │   destination OR  │
        │ • Convert WebP     │  │ • Quarantine      │
        │ • Create thumbnail │  │ • Update DynamoDB │
        │ • Upload to        │  └───────────────────┘
        │   /images/         │
        │ • Update DynamoDB  │
        └────────────────────┘
                    │
        ┌───────────▼────────┐
        │ Clean images in    │
        │ /images/ folder    │
        └────────────────────┘
```

---

## Implementation Plan

### Phase 1: Update GuardDuty Configuration

**Goal**: Configure GuardDuty to scan both prefixes

```bash
aws guardduty update-malware-protection-plan \
  --malware-protection-plan-id <ID> \
  --protected-resource '{"S3Bucket":{"ObjectPrefixes":["lstimg_","veri_"]}}'
```

---

### Phase 2: Update Listing Image Uploads (lstimg\_ prefix)

#### Files to modify:

**1. `backend/services/api/listings/submit-intent.ts`**

- Change line 179:

  ```typescript
  // OLD:
  const s3Key = `${s3Prefix}staging/${img.imageId}.${getFileExtension(
    img.contentType
  )}`;

  // NEW:
  const s3Key = `${s3Prefix}staging/lstimg_${img.imageId}.${getFileExtension(
    img.contentType
  )}`;
  ```

**2. `backend/services/image-processor/index.js`**

- Update line 50 to handle the new prefix:

  ```javascript
  // OLD:
  const pathParts = objectKey.split('/');
  if (pathParts.length < 5 || pathParts[1] !== 'listings' || pathParts[3] !== 'staging') {
    console.error('Invalid S3 key format:', objectKey);
    continue;
  }
  const fileName = pathParts[4];
  const imageId = fileName.split('.')[0];

  // NEW:
  const pathParts = objectKey.split('/');
  if (pathParts.length < 5 || pathParts[1] !== 'listings' || pathParts[3] !== 'staging') {
    console.error('Invalid S3 key format:', objectKey);
    continue;
  }
  const fileName = pathParts[4];

  // Remove lstimg_ prefix from filename
  if (!fileName.startsWith('lstimg_')) {
    console.error('Invalid image prefix:', objectKey);
    continue;
  }

  const fileNameWithoutPrefix = fileName.substring(7); // Remove "lstimg_"
  const imageId = fileNameWithoutPrefix.split('.')[0];
  ```

---

### Phase 3: Create Verification File Processor Lambda

#### New Lambda Function: `verification-file-processor`

**Purpose**: Handle all verification files (documents, videos) that just need scanning and moving

**Location**: `backend/services/verification-processor/`

**Files to create**:

1. **`backend/services/verification-processor/index.js`**

```javascript
const {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  UpdateCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");

const s3Client = new S3Client({});
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.TABLE_NAME;
const BUCKET_NAME = process.env.BUCKET_NAME;

exports.handler = async (event) => {
  console.log(
    "Processing batch of",
    event.Records.length,
    "verification file scans"
  );

  const batchItemFailures = [];

  for (const record of event.Records) {
    try {
      const guardDutyEvent = JSON.parse(record.body);
      const { scanStatus, s3ObjectDetails, scanResultDetails } =
        guardDutyEvent.detail;
      const { bucketName, objectKey } = s3ObjectDetails;
      const { scanResultStatus, threats } = scanResultDetails;

      console.log(
        `Processing ${objectKey}: scanResultStatus=${scanResultStatus}`
      );

      // Verify this is a verification file (veri_ prefix)
      const fileName = objectKey.split("/").pop();
      if (!fileName.startsWith("veri_")) {
        console.error("Invalid verification file prefix:", objectKey);
        continue; // Skip
      }

      if (scanResultStatus === "THREATS_FOUND") {
        await handleInfectedFile(bucketName, objectKey, threats);
      } else if (scanResultStatus === "NO_THREATS_FOUND") {
        await handleCleanFile(bucketName, objectKey);
      } else {
        console.warn(`Unknown scanResultStatus: ${scanResultStatus}`);
      }
    } catch (error) {
      console.error("Error processing verification file:", error);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

async function handleInfectedFile(bucket, key, threats) {
  console.log(`🦠 INFECTED: ${key} - Quarantining...`);

  const malwareNames = threats ? threats.map((t) => t.name) : [];

  // Parse the key to extract metadata
  const metadata = parseVerificationKey(key);
  if (!metadata) {
    console.error("Could not parse verification key:", key);
    return;
  }

  // Move to quarantine
  const quarantineKey = key.replace("veri_", "quarantine/veri_");

  await s3Client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${key}`,
      Key: quarantineKey,
      TaggingDirective: "REPLACE",
      Tagging: "Status=Quarantined&Reason=Malware",
    })
  );

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  // Write malware detection record
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: metadata.entityPk,
        sk: `MALWARE#${Date.now()}#${metadata.fileId}`,
        fileId: metadata.fileId,
        s3Key: quarantineKey,
        originalS3Key: key,
        detectedAt: new Date().toISOString(),
        malwareNames,
        fileType: metadata.fileType,
      },
    })
  );

  // Update the document/request record status to INFECTED
  await updateFileStatus(metadata, "INFECTED", quarantineKey);

  console.log(`✅ Quarantined ${key} to ${quarantineKey}`);
}

async function handleCleanFile(bucket, key) {
  console.log(`✅ CLEAN: ${key} - Moving to final destination...`);

  const metadata = parseVerificationKey(key);
  if (!metadata) {
    console.error("Could not parse verification key:", key);
    return;
  }

  // Remove veri_ prefix for final destination
  const finalKey = key.replace("veri_", "");

  // Copy to final destination
  await s3Client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${key}`,
      Key: finalKey,
    })
  );

  // Delete staging file
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  // Get file metadata
  const headResult = await s3Client.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: finalKey,
    })
  );

  // Update the document/request record with final S3 key
  await updateFileStatus(metadata, "CLEAN", finalKey, headResult.ContentLength);

  console.log(`✅ Moved ${key} to ${finalKey}`);
}

function parseVerificationKey(key) {
  // Expected formats:
  // Profile docs: {hostId}/verification/veri_{documentId}_{fileName}
  // Listing docs: {hostId}/listings/{listingId}/verification/veri_{documentType}.{ext}
  // Videos: {hostId}/listings/{listingId}/verification/veri_property-video-{requestId}.{ext}
  // LIVE_ID_CHECK: {hostId}/requests/veri_{requestId}_{fileName}

  const parts = key.split("/");
  const fileName = parts[parts.length - 1];
  const fileNameWithoutPrefix = fileName.substring(5); // Remove "veri_"

  const hostId = parts[0];

  if (parts[1] === "verification") {
    // Profile document: {hostId}/verification/veri_{documentId}_{fileName}
    const documentId = fileNameWithoutPrefix.split("_")[0];
    return {
      type: "PROFILE_DOCUMENT",
      hostId,
      documentId,
      fileId: documentId,
      entityPk: `HOST#${hostId}`,
      entitySk: `DOCUMENT#${documentId}`,
      fileType: "document",
    };
  }

  if (parts[1] === "listings" && parts[3] === "verification") {
    const listingId = parts[2];

    if (fileNameWithoutPrefix.startsWith("property-video-")) {
      // Property video: {hostId}/listings/{listingId}/verification/veri_property-video-{requestId}.{ext}
      const requestId = fileNameWithoutPrefix.match(
        /property-video-(.+?)\./
      )[1];
      return {
        type: "PROPERTY_VIDEO",
        hostId,
        listingId,
        requestId,
        fileId: requestId,
        entityPk: `LISTING#${listingId}`,
        entitySk: `REQUEST#${requestId}`,
        fileType: "video",
      };
    } else {
      // Listing document: {hostId}/listings/{listingId}/verification/veri_{documentType}.{ext}
      const documentType = fileNameWithoutPrefix.split(".")[0];
      return {
        type: "LISTING_DOCUMENT",
        hostId,
        listingId,
        documentType,
        fileId: `${listingId}_${documentType}`,
        entityPk: `HOST#${hostId}`,
        entitySk: `LISTING_DOC#${listingId}#${documentType}`,
        fileType: "document",
      };
    }
  }

  if (parts[1] === "requests") {
    // LIVE_ID_CHECK: {hostId}/requests/veri_{requestId}_{fileName}
    const requestId = fileNameWithoutPrefix.split("_")[0];
    return {
      type: "LIVE_ID_CHECK",
      hostId,
      requestId,
      fileId: requestId,
      entityPk: `HOST#${hostId}`,
      entitySk: `REQUEST#${requestId}`,
      fileType: "document",
    };
  }

  return null;
}

async function updateFileStatus(metadata, status, s3Key, fileSize = null) {
  const updateExpression = fileSize
    ? "SET #status = :status, s3Key = :s3Key, fileSize = :fileSize, scannedAt = :now, updatedAt = :now"
    : "SET #status = :status, s3Key = :s3Key, scannedAt = :now, updatedAt = :now";

  const expressionAttributeValues = fileSize
    ? {
        ":status": status,
        ":s3Key": s3Key,
        ":fileSize": fileSize,
        ":now": new Date().toISOString(),
      }
    : {
        ":status": status,
        ":s3Key": s3Key,
        ":now": new Date().toISOString(),
      };

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: metadata.entityPk,
        sk: metadata.entitySk,
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );
}
```

2. **`backend/services/verification-processor/package.json`**

```json
{
  "name": "verification-file-processor",
  "version": "1.0.0",
  "description": "Lambda function for processing verification file scans",
  "main": "index.js",
  "dependencies": {
    "@aws-sdk/client-s3": "^3.709.0",
    "@aws-sdk/client-dynamodb": "^3.709.0",
    "@aws-sdk/lib-dynamodb": "^3.709.0"
  }
}
```

---

### Phase 4: Update All File Upload Endpoints with veri\_ Prefix

#### Files to modify:

**1. Profile Documents** - `backend/services/api/hosts/submit-intent.ts` (line 216)

```typescript
// OLD:
const s3Key = `${hostId}/verification/${doc.documentId}_${doc.fileName}`;

// NEW:
const s3Key = `${hostId}/verification/veri_${doc.documentId}_${doc.fileName}`;
```

**2. Profile Documents** - `backend/services/api/hosts/update-rejected-profile.ts` (line 214, 315)

```typescript
// OLD (line 214):
const s3Key = `${hostId}/verification/${doc.documentId}_${doc.fileName}`;

// NEW:
const s3Key = `${hostId}/verification/veri_${doc.documentId}_${doc.fileName}`;

// Also update line 315 (in createDocumentRecords)
```

**3. Listing Documents** - `backend/services/api/listings/submit-intent.ts` (line 226)

```typescript
// OLD:
const s3Key = `${s3Prefix}verification/${doc.documentType}.${getFileExtension(
  doc.contentType
)}`;

// NEW:
const s3Key = `${s3Prefix}verification/veri_${
  doc.documentType
}.${getFileExtension(doc.contentType)}`;
```

**4. Property Videos** - `backend/services/api/hosts/submit-video-intent.ts` (line 130)

```typescript
// OLD:
const s3Key = `${hostId}/listings/${listingId}/verification/property-video-${requestId}.${fileExtension}`;

// NEW:
const s3Key = `${hostId}/listings/${listingId}/verification/veri_property-video-${requestId}.${fileExtension}`;
```

**5. Property Videos** - `backend/services/api/hosts/confirm-video.ts` (line 104)

```typescript
// OLD:
const testKey = `${hostId}/listings/${listingId}/verification/property-video-${requestId}.${ext}`;

// NEW:
const testKey = `${hostId}/listings/${listingId}/verification/veri_property-video-${requestId}.${ext}`;
```

**6. LIVE_ID_CHECK Documents** - `backend/services/api/requests/submit-intent.ts` (line 114)

```typescript
// OLD:
const s3Key = `${hostId}/requests/${requestId}/live-id-check.${fileExtension}`;

// NEW:
const s3Key = `${hostId}/requests/${requestId}/veri_live-id-check.${fileExtension}`;
```

**7. LIVE_ID_CHECK Documents (confirm)** - `backend/services/api/requests/confirm-submission.ts` (line 111)

```typescript
// OLD:
const testKey = `${hostId}/requests/${requestId}/live-id-check.${ext}`;

// NEW:
const testKey = `${hostId}/requests/${requestId}/veri_live-id-check.${ext}`;
```

---

### Phase 5: Update Infrastructure (CDK)

**File**: `infra/lib/api-lambda-stack.ts`

#### Changes needed:

1. **Create second SQS queue for verification files**:

```typescript
// After existing imageProcessingQueue (around line 195)

// Dead Letter Queue for failed verification file processing
const verificationProcessingDLQ = new sqs.Queue(
  this,
  "VerificationProcessingDLQ",
  {
    queueName: `${stage}-verification-processing-dlq`,
    retentionPeriod: cdk.Duration.days(14),
    removalPolicy:
      stage === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
  }
);

// Verification file processing queue
const verificationProcessingQueue = new sqs.Queue(
  this,
  "VerificationProcessingQueue",
  {
    queueName: `${stage}-verification-processing-queue`,
    visibilityTimeout: cdk.Duration.seconds(90),
    retentionPeriod: cdk.Duration.days(4),
    receiveMessageWaitTime: cdk.Duration.seconds(20),
    deadLetterQueue: {
      queue: verificationProcessingDLQ,
      maxReceiveCount: 3,
    },
    removalPolicy:
      stage === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
  }
);
```

2. **Create second EventBridge rule**:

```typescript
// After existing guardDutyRule (around line 263)

const guardDutyRuleVerification = new events.Rule(
  this,
  "GuardDutyScanCompleteVerification",
  {
    ruleName: `${stage}-guardduty-scan-complete-verification`,
    description:
      "Capture GuardDuty malware scan completion events for verification files",
    eventPattern: {
      source: ["aws.guardduty"],
      detailType: ["GuardDuty Malware Protection Object Scan Result"],
      detail: {
        scanStatus: ["COMPLETED"],
        s3ObjectDetails: {
          bucketName: [bucket.bucketName],
          objectKey: [{ prefix: "veri_" }], // Filter for verification files
        },
      },
    },
  }
);

guardDutyRuleVerification.addTarget(
  new targets.SqsQueue(verificationProcessingQueue)
);
```

3. **Create verification processor Lambda**:

```typescript
// After imageProcessorLambda (around line 330)

this.verificationProcessorLambda = new nodejs.NodejsFunction(
  this,
  "VerificationProcessorLambda",
  {
    functionName: `${stage}-verification-processor`,
    runtime: lambda.Runtime.NODEJS_20_X,
    architecture: lambda.Architecture.ARM_64,
    entry: "backend/services/verification-processor/index.js",
    handler: "handler",
    timeout: cdk.Duration.seconds(60),
    memorySize: 512,
    environment: {
      TABLE_NAME: table.tableName,
      BUCKET_NAME: bucket.bucketName,
    },
    bundling: {
      minify: true,
      sourceMap: false,
    },
  }
);

new logs.LogGroup(this, "VerificationProcessorLogGroup", {
  logGroupName: `/aws/lambda/${stage}-verification-processor`,
  retention:
    stage === "prod"
      ? logs.RetentionDays.ONE_MONTH
      : logs.RetentionDays.ONE_WEEK,
  removalPolicy:
    stage === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
});

bucket.grantReadWrite(this.verificationProcessorLambda);
table.grantReadWriteData(this.verificationProcessorLambda);

this.verificationProcessorLambda.addEventSource(
  new SqsEventSource(verificationProcessingQueue, {
    batchSize: 1,
    maxBatchingWindow: cdk.Duration.seconds(0),
    reportBatchItemFailures: true,
  })
);
```

4. **Update existing EventBridge rule to filter for lstimg\_ prefix**:

```typescript
// Modify existing guardDutyRule (line 248-263)
const guardDutyRule = new events.Rule(this, "GuardDutyScanComplete", {
  ruleName: `${stage}-guardduty-scan-complete`,
  description:
    "Capture GuardDuty malware scan completion events for listing images",
  eventPattern: {
    source: ["aws.guardduty"],
    detailType: ["GuardDuty Malware Protection Object Scan Result"],
    detail: {
      scanStatus: ["COMPLETED"],
      s3ObjectDetails: {
        bucketName: [bucket.bucketName],
        objectKey: [{ prefix: "lstimg_" }], // ✅ Filter for listing images only
      },
    },
  },
});
```

---

## Migration Strategy

### Order of Implementation:

1. **Deploy new infrastructure** (Phase 5)

   - Creates verification processor Lambda
   - Creates verification SQS queue
   - Creates EventBridge rules with prefix filters
   - Updates GuardDuty to scan both prefixes

2. **Update existing image processor** (Phase 2)

   - Handle lstimg\_ prefix in Lambda
   - Deploy updated Lambda

3. **Deploy verification file processor** (Phase 3)

   - New Lambda for handling documents/videos

4. **Update all upload endpoints** (Phase 4)

   - Add veri\_ prefix to all verification file uploads
   - Update confirm endpoints to look for prefixed files

5. **Test end-to-end**
   - Upload listing image (lstimg\_)
   - Upload verification document (veri\_)
   - Upload video (veri\_)
   - Verify both pipelines work correctly

---

## Key Benefits

1. **Two independent pipelines**: Images and verification files processed separately
2. **Prefix-based routing**: GuardDuty/EventBridge can filter by prefix
3. **No orchestration needed**: EventBridge routes to correct SQS queue based on prefix
4. **Preserved destinations**: Files move to their current expected locations (just without prefix)
5. **Malware protection**: All uploaded files are scanned
6. **Scalable**: Each pipeline scales independently
7. **Cost-effective**: Simpler than complex orchestration

---

## Testing Checklist

- [ ] Upload listing image with lstimg\_ prefix → Image processor
- [ ] Upload profile document with veri\_ prefix → Verification processor
- [ ] Upload listing document with veri\_ prefix → Verification processor
- [ ] Upload property video with veri\_ prefix → Verification processor
- [ ] Test infected file (EICAR test file) → Quarantine
- [ ] Verify DynamoDB updates correct
- [ ] Verify S3 final destinations correct
- [ ] Test GuardDuty prefix filtering works
- [ ] Test EventBridge routing to correct queues
- [ ] Verify no infinite scan loops

---

## Rollback Plan

If issues arise:

1. Remove veri\_ prefixes from upload endpoints (revert to current behavior)
2. Remove lstimg\_ prefixes from upload endpoints
3. Disable new EventBridge rules
4. GuardDuty continues scanning but events don't route to Lambdas
5. Original behavior restored (files upload directly without scanning)
