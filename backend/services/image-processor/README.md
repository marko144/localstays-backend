# Image Processor Lambda

Lambda function for processing listing images with GuardDuty malware scanning.

## Overview

This Lambda function runs in a Docker container and processes images that have been scanned by AWS GuardDuty Malware Protection:

- **Infected images**: Moved to quarantine folder, logged in DynamoDB
- **Clean images**: Converted to WebP format, thumbnail generated, uploaded to S3

## Architecture

```
S3 Upload → GuardDuty Scan → EventBridge → SQS → Lambda (this) → S3 + DynamoDB
```

## Dependencies

- **Sharp**: High-performance image processing library (uses libvips)
- **libheif**: HEIC/HEIF format support (for iOS photos)
- **AWS SDK**: S3 and DynamoDB clients

## Image Formats Supported

- JPEG/JPG
- PNG
- GIF
- WebP
- **HEIC** (iOS photos)

## Output

### Clean Images

- Full-size WebP (85% quality): `{hostId}/listings/{listingId}/images/{imageId}-full.webp`
- Thumbnail WebP (400px, 85% quality): `{hostId}/listings/{listingId}/images/{imageId}-thumb.webp`

### Infected Images

- Quarantined: `{hostId}/listings/{listingId}/quarantine/{imageId}.{ext}`
- Malware record: `LISTING#{listingId} / MALWARE#{timestamp}#{imageId}`

## Building the Docker Image

```bash
cd backend/services/image-processor
docker build -t localstays-image-processor .
```

## Testing Locally

```bash
# Run container locally
docker run -p 9000:8080 \
  -e TABLE_NAME=your-table \
  -e BUCKET_NAME=your-bucket \
  -e AWS_REGION=eu-north-1 \
  -e AWS_ACCESS_KEY_ID=xxx \
  -e AWS_SECRET_ACCESS_KEY=xxx \
  localstays-image-processor

# Test with sample event
curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -d @test-event.json
```

## Deployment

The Docker image is built and pushed to ECR, then deployed as a Lambda function via CDK:

```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region eu-north-1 | \
  docker login --username AWS --password-stdin \
  YOUR_ACCOUNT_ID.dkr.ecr.eu-north-1.amazonaws.com

# Build for ARM64 (Lambda uses Graviton2)
docker build --platform linux/arm64 -t dev1-localstays-image-processor .

# Tag image
docker tag dev1-localstays-image-processor:latest \
  YOUR_ACCOUNT_ID.dkr.ecr.eu-north-1.amazonaws.com/dev1-localstays-image-processor:latest

# Push to ECR
docker push YOUR_ACCOUNT_ID.dkr.ecr.eu-north-1.amazonaws.com/dev1-localstays-image-processor:latest

# Deploy via CDK
cd ../../../
npx cdk deploy LocalstaysDev1ApiStack -c env=dev1
```

## Configuration

### Lambda Settings

- **Memory**: 2048 MB
- **Timeout**: 90 seconds
- **Reserved Concurrency**: 20 (controls scaling)
- **Architecture**: ARM64 (Graviton2)

### Environment Variables

- `TABLE_NAME`: DynamoDB table name
- `BUCKET_NAME`: S3 bucket name
- `AWS_REGION`: AWS region (auto-populated)

## Monitoring

CloudWatch Logs: `/aws/lambda/dev1-image-processor`

Key metrics:

- Duration: Should be < 30s for most images
- Memory usage: Typically 500-1000 MB
- Errors: Should be 0 (check DLQ for failures)

## Error Handling

- **Transient errors**: Message returned to SQS for retry (max 3 attempts)
- **Permanent failures**: Message sent to Dead Letter Queue
- **Invalid S3 keys**: Skipped (not retried)
- **Unknown threat status**: Skipped (not retried)
