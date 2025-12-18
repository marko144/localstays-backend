#!/bin/bash

# Script to set the commission-rate config in SSM Parameter Store
# Usage: ./scripts/setup-commission-rate-ssm.sh <environment> <rate>
# Example: ./scripts/setup-commission-rate-ssm.sh staging 0.065   # 6.5% commission
#          ./scripts/setup-commission-rate-ssm.sh prod 0.065      # 6.5% commission
#
# The rate is a decimal (0.065 = 6.5% commission)

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: $0 <environment> <rate>"
    echo "Example: $0 staging 0.15   # 15% commission"
    echo "         $0 prod 0.10      # 10% commission"
    exit 1
fi

ENVIRONMENT=$1
VALUE=$2

# Validate value is a number between 0 and 1
if ! echo "$VALUE" | grep -qE '^0(\.[0-9]+)?$|^1(\.0+)?$'; then
    echo "Error: Rate must be a decimal between 0 and 1 (e.g., 0.15 for 15%)"
    exit 1
fi

PARAMETER_NAME="/localstays/${ENVIRONMENT}/config/commission-rate"

echo "Setting commission-rate for ${ENVIRONMENT} to ${VALUE} ($(echo "$VALUE * 100" | bc)%)..."

aws ssm put-parameter \
    --name "${PARAMETER_NAME}" \
    --value "${VALUE}" \
    --type "String" \
    --overwrite \
    --description "Commission rate for free/commission-based ads (decimal, e.g., 0.15 = 15%)"

echo "✅ Successfully set ${PARAMETER_NAME} = ${VALUE}"
echo ""
echo "This rate will be applied to bookings made through commission-based listings."
echo "To check current value: aws ssm get-parameter --name ${PARAMETER_NAME}"

