#!/bin/bash

# =============================================================================
# Setup Stripe SSM Parameters
# =============================================================================
# This script stores Stripe API keys in AWS SSM Parameter Store.
# Run once per environment after getting your keys from Stripe Dashboard.
#
# Usage:
#   ./scripts/setup-stripe-ssm.sh staging sk_test_xxx
#   ./scripts/setup-stripe-ssm.sh prod sk_live_xxx
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - Appropriate IAM permissions for SSM
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check arguments
if [ "$#" -ne 2 ]; then
    echo -e "${RED}Error: Missing arguments${NC}"
    echo "Usage: $0 <environment> <stripe-secret-key>"
    echo "  environment: dev1, staging, or prod"
    echo "  stripe-secret-key: Your Stripe secret key (sk_test_... or sk_live_...)"
    exit 1
fi

ENVIRONMENT=$1
STRIPE_SECRET_KEY=$2
REGION="eu-central-1"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev1|staging|prod)$ ]]; then
    echo -e "${RED}Error: Invalid environment '${ENVIRONMENT}'${NC}"
    echo "Must be one of: dev1, staging, prod"
    exit 1
fi

# Validate key format
if [[ "$ENVIRONMENT" == "prod" && ! "$STRIPE_SECRET_KEY" =~ ^sk_live_ ]]; then
    echo -e "${RED}Error: Production environment requires a live key (sk_live_...)${NC}"
    exit 1
fi

if [[ "$ENVIRONMENT" != "prod" && ! "$STRIPE_SECRET_KEY" =~ ^sk_test_ ]]; then
    echo -e "${YELLOW}Warning: Non-production environment should use test key (sk_test_...)${NC}"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

PARAMETER_NAME="/localstays/${ENVIRONMENT}/stripe/secret-key"

echo -e "${YELLOW}Storing Stripe secret key...${NC}"
echo "  Environment: ${ENVIRONMENT}"
echo "  Parameter:   ${PARAMETER_NAME}"
echo "  Region:      ${REGION}"
echo "  Key prefix:  ${STRIPE_SECRET_KEY:0:12}..."

# Store the parameter
aws ssm put-parameter \
    --name "${PARAMETER_NAME}" \
    --value "${STRIPE_SECRET_KEY}" \
    --type "SecureString" \
    --region "${REGION}" \
    --overwrite \
    --description "Stripe API secret key for ${ENVIRONMENT} environment"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Successfully stored Stripe secret key${NC}"
    echo ""
    echo "The Lambda function will automatically read this key when needed."
    echo ""
    echo -e "${YELLOW}⚠️  Security reminder:${NC}"
    echo "  - Never commit secret keys to git"
    echo "  - Rotate keys if they were ever exposed"
    echo "  - Use sk_test_ keys for non-production environments"
else
    echo -e "${RED}❌ Failed to store parameter${NC}"
    exit 1
fi

