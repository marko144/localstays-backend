#!/bin/bash
# Outputs frontend Cognito configuration for a given environment

ENV=$1

if [ -z "$ENV" ]; then
  echo "Usage: $0 <environment>"
  echo "Example: $0 dev1"
  exit 1
fi

REGION="eu-north-1"

echo "Fetching Cognito configuration for environment: ${ENV} (Region: ${REGION})"
echo ""

USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name localstays-${ENV}-cognito \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text \
  --region "${REGION}" 2>/dev/null)

USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name localstays-${ENV}-cognito \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" \
  --output text \
  --region "${REGION}" 2>/dev/null)

if [ -z "$USER_POOL_ID" ] || [ -z "$USER_POOL_CLIENT_ID" ]; then
  echo "❌ Error: Could not retrieve Cognito User Pool ID or Client ID for localstays-${ENV}-cognito."
  echo "Please ensure the stack is deployed and the outputs exist."
  exit 1
fi

echo "--- Frontend Configuration ---"
echo "COGNITO_USER_POOL_ID=${USER_POOL_ID}"
echo "COGNITO_CLIENT_ID=${USER_POOL_CLIENT_ID}"
echo "COGNITO_REGION=${REGION}"
echo "----------------------------"

# Optional: Output as JSON
echo ""
echo "--- JSON Format ---"
cat <<EOF
{
  "userPoolId": "${USER_POOL_ID}",
  "clientId": "${USER_POOL_CLIENT_ID}",
  "region": "${REGION}"
}
EOF
echo "-------------------"
