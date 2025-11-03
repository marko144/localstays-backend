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

### Automated Deployment (Recommended)

Use the deployment script which handles Docker manifest list issues:

```bash
./deploy.sh dev1 eu-north-1 YOUR_ACCOUNT_ID
```

The script will build, push, and prepare the image for Lambda deployment.

### Manual Deployment

**IMPORTANT:** Docker Desktop creates manifest lists by default, which AWS Lambda does not support. The deployment script handles this automatically, but if deploying manually, follow these steps:

```bash
# 1. Authenticate Docker to ECR
aws ecr get-login-password --region eu-north-1 | \
  docker login --username AWS --password-stdin \
  YOUR_ACCOUNT_ID.dkr.ecr.eu-north-1.amazonaws.com

# 2. Build for ARM64 (Lambda uses Graviton2)
docker build --platform linux/arm64 -t dev1-localstays-image-processor .

# 3. Tag and push
docker tag dev1-localstays-image-processor:latest \
  YOUR_ACCOUNT_ID.dkr.ecr.eu-north-1.amazonaws.com/dev1-localstays-image-processor:latest
docker push YOUR_ACCOUNT_ID.dkr.ecr.eu-north-1.amazonaws.com/dev1-localstays-image-processor:latest

# 4. Extract ARM64 manifest digest and re-push as single-platform
ARM64_DIGEST=$(docker inspect dev1-localstays-image-processor:latest --format '{{.Id}}' | cut -d':' -f2)
docker pull --platform=linux/arm64 \
  YOUR_ACCOUNT_ID.dkr.ecr.eu-north-1.amazonaws.com/dev1-localstays-image-processor@sha256:${ARM64_DIGEST}
docker tag YOUR_ACCOUNT_ID.dkr.ecr.eu-north-1.amazonaws.com/dev1-localstays-image-processor@sha256:${ARM64_DIGEST} \
  YOUR_ACCOUNT_ID.dkr.ecr.eu-north-1.amazonaws.com/dev1-localstays-image-processor:latest
docker push YOUR_ACCOUNT_ID.dkr.ecr.eu-north-1.amazonaws.com/dev1-localstays-image-processor:latest

# 5. Update Lambda function
aws lambda update-function-code \
  --function-name dev1-image-processor \
  --image-uri YOUR_ACCOUNT_ID.dkr.ecr.eu-north-1.amazonaws.com/dev1-localstays-image-processor:latest \
  --region eu-north-1
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
