# Verification File Processor Lambda

Processes GuardDuty malware scan results for all verification files (documents and videos with `veri_` prefix).

## Purpose

This Lambda handles files that only need malware scanning and moving to their final destination:

- Profile documents (ID cards, passports, etc.)
- Listing documents (proof of right to list, etc.)
- Property video verification files (admin-requested)
- Initial listing videos (optional, uploaded during listing creation)
- LIVE_ID_CHECK video files

## Flow

```
S3 Upload (veri_* prefix)
  → GuardDuty Scan
  → EventBridge
  → SQS (verification-processing-queue)
  → This Lambda
  → Clean: Move to final destination (remove veri_ prefix)
  → Infected: Quarantine + Log to DynamoDB
```

## File Handling

### Clean Files (NO_THREATS_FOUND)

1. Copy file to final destination (remove `veri_` prefix)
2. Delete staging file
3. Update DynamoDB record with final S3 key and file size

### Infected Files (THREATS_FOUND)

1. Copy file to quarantine folder (keep `veri_` prefix)
2. Delete staging file
3. Write malware detection record to DynamoDB
4. Update original record status to "INFECTED"

## Supported File Patterns

| File Type        | S3 Key Pattern                                                                     | DynamoDB Key                                                |
| ---------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Profile Document | `{hostId}/verification/veri_{documentId}_{fileName}`                               | `HOST#{hostId}`, `DOCUMENT#{documentId}`                    |
| Listing Document | `{hostId}/listings/{listingId}/verification/veri_{documentType}.{ext}`             | `HOST#{hostId}`, `LISTING_DOC#{listingId}#{documentType}`   |
| Property Video   | `{hostId}/listings/{listingId}/verification/veri_property-video-{requestId}.{ext}` | `LISTING#{listingId}`, `REQUEST#{requestId}`                |
| Initial Video    | `veri_initial-video_{listingId}.{ext}` → `{hostId}/listings/{listingId}/initial_video/property-video.{ext}` | `HOST#{hostId}`, `LISTING_INITIAL_VIDEO#{listingId}` |
| LIVE_ID_CHECK    | `{hostId}/requests/{requestId}/veri_live-id-check.{ext}`                           | `HOST#{hostId}`, `REQUEST#{requestId}`                      |

## Environment Variables

- `TABLE_NAME` - DynamoDB table name
- `BUCKET_NAME` - S3 bucket name

## Dependencies

- `@aws-sdk/client-s3` - S3 operations
- `@aws-sdk/client-dynamodb` - DynamoDB client
- `@aws-sdk/lib-dynamodb` - DynamoDB document client

## Error Handling

- Invalid prefixes: Skipped (no retry)
- Unknown scan status: Skipped (no retry)
- Processing errors: Added to batch failures (SQS will retry)
- Parse errors: Added to batch failures (SQS will retry)

## Deployment

This Lambda is deployed as part of the CDK stack (`infra/lib/api-lambda-stack.ts`):

- Runtime: Node.js 20.x
- Architecture: ARM64
- Memory: 512 MB
- Timeout: 60 seconds
- Trigger: SQS (verification-processing-queue)
- Batch size: 1 message
- Partial batch failure: Enabled
