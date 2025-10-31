#!/bin/bash

##############################################################################
# Image Processor Lambda - Build & Deploy Script
##############################################################################
#
# This script builds the Docker image for ARM64 (Graviton2) and pushes it to ECR.
#
# Prerequisites:
# 1. AWS CLI configured with appropriate credentials
# 2. Docker installed and running
# 3. ECR repository created (via CDK deployment)
#
# Usage:
#   ./deploy.sh <stage> <aws-region> <aws-account-id>
#
# Example:
#   ./deploy.sh dev1 eu-north-1 123456789012
#
##############################################################################

set -e  # Exit on error

# Check arguments
if [ $# -ne 3 ]; then
  echo "Usage: $0 <stage> <aws-region> <aws-account-id>"
  echo "Example: $0 dev1 eu-north-1 123456789012"
  exit 1
fi

STAGE=$1
REGION=$2
ACCOUNT_ID=$3
REPO_NAME="${STAGE}-localstays-image-processor"
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE_URI="${ECR_URI}/${REPO_NAME}:latest"

echo "============================================"
echo "Image Processor Lambda Deployment"
echo "============================================"
echo "Stage:       ${STAGE}"
echo "Region:      ${REGION}"
echo "Account ID:  ${ACCOUNT_ID}"
echo "Repository:  ${REPO_NAME}"
echo "Image URI:   ${IMAGE_URI}"
echo "============================================"
echo ""

# Step 1: Authenticate Docker to ECR
echo "📦 Step 1/4: Authenticating Docker to ECR..."
aws ecr get-login-password --region ${REGION} | \
  docker login --username AWS --password-stdin ${ECR_URI}
echo "✅ Authentication successful"
echo ""

# Step 2: Build Docker image for ARM64
echo "🔨 Step 2/4: Building Docker image for ARM64..."
echo "This may take 10-15 minutes for first build (compiling libheif + libvips)..."
docker build --platform linux/arm64 -t ${REPO_NAME}:latest .
echo "✅ Build successful"
echo ""

# Step 3: Tag image for ECR
echo "🏷️  Step 3/4: Tagging image..."
docker tag ${REPO_NAME}:latest ${IMAGE_URI}
echo "✅ Tagged: ${IMAGE_URI}"
echo ""

# Step 4: Push to ECR
echo "⬆️  Step 4/4: Pushing to ECR..."
docker push ${IMAGE_URI}
echo "✅ Push successful"
echo ""

echo "============================================"
echo "✅ Deployment Complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo "1. Deploy CDK stack:"
echo "   cd ../../../"
echo "   npx cdk deploy LocalstaysDev1ApiStack -c env=dev1"
echo ""
echo "2. Verify Lambda function:"
echo "   aws lambda get-function --function-name ${STAGE}-image-processor --region ${REGION}"
echo ""
echo "3. Monitor logs:"
echo "   aws logs tail /aws/lambda/${STAGE}-image-processor --follow --region ${REGION}"
echo ""

