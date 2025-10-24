#!/bin/bash
# Copies SendGrid API key from source environment to target environment in SSM Parameter Store

echo "🔑 Copying SendGrid API Key"

SOURCE_ENV=$1
TARGET_ENV=$2

if [ -z "$SOURCE_ENV" ] || [ -z "$TARGET_ENV" ]; then
  echo "Usage: $0 <source_env> <target_env>"
  echo "Example: $0 dev dev1"
  exit 1
fi

SOURCE_PARAM_NAME="/localstays/${SOURCE_ENV}/sendgrid"
TARGET_PARAM_NAME="/localstays/${TARGET_ENV}/sendgrid"
REGION="eu-north-1"

echo "   Source: ${SOURCE_PARAM_NAME}"
echo "   Target: ${TARGET_PARAM_NAME}"
echo ""

# Check if source exists
if ! aws ssm get-parameter --name "${SOURCE_PARAM_NAME}" --region "${REGION}" > /dev/null 2>&1; then
  echo "❌ Error: Source parameter ${SOURCE_PARAM_NAME} does not exist"
  exit 1
fi

echo "📖 Reading from source..."

# Get the value from the source parameter
API_KEY=$(aws ssm get-parameter \
  --name "${SOURCE_PARAM_NAME}" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text \
  --region "${REGION}")

if [ -z "$API_KEY" ]; then
  echo "❌ Error: Could not retrieve API key from ${SOURCE_PARAM_NAME}"
  exit 1
fi

echo "✍️  Writing to target..."

# Put the value into the target parameter
aws ssm put-parameter \
  --name "${TARGET_PARAM_NAME}" \
  --value "${API_KEY}" \
  --type SecureString \
  --overwrite \
  --region "${REGION}"

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Successfully copied SendGrid API key from ${SOURCE_ENV} to ${TARGET_ENV}"
  echo ""
  echo "Verify with:"
  echo "  aws ssm get-parameter --name ${TARGET_PARAM_NAME} --with-decryption --region ${REGION}"
else
  echo "❌ Error: Failed to copy SendGrid API key to ${TARGET_PARAM_NAME}"
  exit 1
fi
