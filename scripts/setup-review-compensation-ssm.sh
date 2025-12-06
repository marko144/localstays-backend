#!/bin/bash

# Script to set the review-compensation-enabled config in SSM Parameter Store
# Usage: ./scripts/setup-review-compensation-ssm.sh <environment> <true|false>
# Example: ./scripts/setup-review-compensation-ssm.sh staging false
#          ./scripts/setup-review-compensation-ssm.sh prod true

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: $0 <environment> <true|false>"
    echo "Example: $0 staging false"
    echo "         $0 prod true"
    exit 1
fi

ENVIRONMENT=$1
VALUE=$2

# Validate value
if [ "$VALUE" != "true" ] && [ "$VALUE" != "false" ]; then
    echo "Error: Value must be 'true' or 'false'"
    exit 1
fi

PARAMETER_NAME="/localstays/${ENVIRONMENT}/config/review-compensation-enabled"

echo "Setting review-compensation-enabled for ${ENVIRONMENT} to ${VALUE}..."

aws ssm put-parameter \
    --name "${PARAMETER_NAME}" \
    --value "${VALUE}" \
    --type "String" \
    --overwrite \
    --description "Controls whether review compensation days are calculated and applied to ad slots"

echo "✅ Successfully set ${PARAMETER_NAME} = ${VALUE}"
echo ""
echo "Note: The Lambda caches this value for 5 minutes."
echo "To check current value: aws ssm get-parameter --name ${PARAMETER_NAME}"

