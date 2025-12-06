#!/bin/bash
# Setup SSM parameter for subscriptions-enabled toggle
# Usage: ./setup-subscriptions-enabled-ssm.sh <stage> <true|false>
# Example: ./setup-subscriptions-enabled-ssm.sh staging false

set -e

STAGE=${1:-staging}
ENABLED=${2:-true}

# Validate enabled value
if [[ "$ENABLED" != "true" && "$ENABLED" != "false" ]]; then
  echo "Error: Second argument must be 'true' or 'false'"
  echo "Usage: $0 <stage> <true|false>"
  exit 1
fi

PARAM_NAME="/localstays/${STAGE}/config/subscriptions-enabled"
REGION="eu-north-1"

echo "Setting subscriptions-enabled parameter..."
echo "  Stage: $STAGE"
echo "  Parameter: $PARAM_NAME"
echo "  Value: $ENABLED"

aws ssm put-parameter \
  --name "$PARAM_NAME" \
  --value "$ENABLED" \
  --type "String" \
  --overwrite \
  --region "$REGION"

echo ""
echo "✅ Parameter set successfully!"
echo ""
echo "Verify with:"
echo "  aws ssm get-parameter --name \"$PARAM_NAME\" --region $REGION"



