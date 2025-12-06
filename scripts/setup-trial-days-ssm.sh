#!/bin/bash

# Script to set the trial-days config in SSM Parameter Store
# Usage: ./scripts/setup-trial-days-ssm.sh <environment> <days>
# Example: ./scripts/setup-trial-days-ssm.sh staging 14
#          ./scripts/setup-trial-days-ssm.sh prod 7
#          ./scripts/setup-trial-days-ssm.sh staging 0  # Disable trials

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: $0 <environment> <days>"
    echo ""
    echo "Examples:"
    echo "  $0 staging 14    # 14-day trial for staging"
    echo "  $0 prod 7        # 7-day trial for prod"
    echo "  $0 staging 0     # Disable trials in staging"
    exit 1
fi

ENVIRONMENT=$1
DAYS=$2

# Validate days is a number
if ! [[ "$DAYS" =~ ^[0-9]+$ ]]; then
    echo "Error: Days must be a non-negative integer"
    exit 1
fi

PARAMETER_NAME="/localstays/${ENVIRONMENT}/config/trial-days"

echo "Setting trial-days for ${ENVIRONMENT} to ${DAYS}..."

aws ssm put-parameter \
    --name "${PARAMETER_NAME}" \
    --value "${DAYS}" \
    --type "String" \
    --overwrite \
    --description "Number of trial days for new subscriptions (0 = no trial)"

echo "✅ Successfully set ${PARAMETER_NAME} = ${DAYS}"
echo ""
if [ "$DAYS" -eq 0 ]; then
    echo "⚠️  Trials are DISABLED - new subscriptions will start with immediate payment"
else
    echo "📅 New subscriptions will have a ${DAYS}-day free trial"
fi
echo ""
echo "Note: The Lambda caches this value. New subscriptions will use the updated value."
echo "To check current value: aws ssm get-parameter --name ${PARAMETER_NAME}"

