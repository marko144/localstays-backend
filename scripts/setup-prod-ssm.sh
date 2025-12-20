#!/bin/bash

###############################################################################
# Production SSM Parameter Setup Script
# 
# This script sets ALL SSM parameters required for production deployment.
# Run this BEFORE deploying CDK stacks to ensure all parameters exist.
#
# Usage: ./scripts/setup-prod-ssm.sh
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - Access to staging environment (for copying keys)
#
# NOTE: This script copies Stripe TEST keys from staging temporarily.
#       Update to LIVE keys when ready for real payments.
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration - SAME REGION AS STAGING
ENV="prod"
REGION="eu-north-1"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         LocalStays Production SSM Parameter Setup              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}⚠️  NOTE: This script uses STAGING Stripe keys temporarily.${NC}"
echo -e "${YELLOW}   Update to LIVE keys when ready for real payments.${NC}"
echo ""

###############################################################################
# STEP 1: Set VAPID Keys (Required for Push Notifications)
###############################################################################

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}STEP 1: Setting VAPID Keys for Push Notifications${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Production VAPID keys (pre-generated, different from staging)
VAPID_PUBLIC_KEY="BC5jmHhsmx6qSMLXCaZIenKrcGIfSplIPv_4rpdIZimmkXy4AK0AZdCtidbFb1HuytBD6QNxZnlCr9YqD-6qsEk"
VAPID_PRIVATE_KEY="lHBAZLQ0oLCWdiUEUpmZzHXJyEfPnyYAl5j9onnAsJk"
VAPID_SUBJECT="mailto:support@localstays.me"

echo -e "  Setting VAPID public key..."
aws ssm put-parameter \
  --name "/localstays/${ENV}/vapid/publicKey" \
  --value "${VAPID_PUBLIC_KEY}" \
  --type "String" \
  --overwrite \
  --region "${REGION}" \
  --description "VAPID public key for web push notifications" > /dev/null
echo -e "  ${GREEN}✓ /localstays/${ENV}/vapid/publicKey${NC}"

echo -e "  Setting VAPID private key..."
aws ssm put-parameter \
  --name "/localstays/${ENV}/vapid/privateKey" \
  --value "${VAPID_PRIVATE_KEY}" \
  --type "SecureString" \
  --overwrite \
  --region "${REGION}" \
  --description "VAPID private key for web push notifications" > /dev/null
echo -e "  ${GREEN}✓ /localstays/${ENV}/vapid/privateKey (SecureString)${NC}"

echo -e "  Setting VAPID subject..."
aws ssm put-parameter \
  --name "/localstays/${ENV}/vapid/subject" \
  --value "${VAPID_SUBJECT}" \
  --type "String" \
  --overwrite \
  --region "${REGION}" \
  --description "VAPID subject (contact email) for web push" > /dev/null
echo -e "  ${GREEN}✓ /localstays/${ENV}/vapid/subject${NC}"

###############################################################################
# STEP 2: Copy SendGrid API Key from Staging
###############################################################################

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}STEP 2: Copying SendGrid API Key from Staging${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "  Reading SendGrid key from staging..."
SENDGRID_KEY=$(aws ssm get-parameter \
  --name "/localstays/staging/sendgrid" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text \
  --region "${REGION}")

if [ -z "$SENDGRID_KEY" ]; then
  echo -e "${RED}Error: Could not retrieve SendGrid key from staging${NC}"
  exit 1
fi

echo -e "  Setting SendGrid key for production..."
aws ssm put-parameter \
  --name "/localstays/${ENV}/sendgrid" \
  --value "${SENDGRID_KEY}" \
  --type "SecureString" \
  --overwrite \
  --region "${REGION}" \
  --description "SendGrid API key for transactional emails" > /dev/null
echo -e "  ${GREEN}✓ /localstays/${ENV}/sendgrid (SecureString)${NC}"

###############################################################################
# STEP 3: Copy Stripe Secret Key from Staging (TEMPORARY)
###############################################################################

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}STEP 3: Copying Stripe Secret Key from Staging (TEMPORARY)${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${YELLOW}⚠️  Using staging TEST key - update to LIVE key for real payments${NC}"

echo -e "  Reading Stripe key from staging..."
STRIPE_KEY=$(aws ssm get-parameter \
  --name "/localstays/staging/stripe/secret-key" \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text \
  --region "${REGION}")

if [ -z "$STRIPE_KEY" ]; then
  echo -e "${RED}Error: Could not retrieve Stripe key from staging${NC}"
  exit 1
fi

echo -e "  Setting Stripe key for production (TEST key - temporary)..."
aws ssm put-parameter \
  --name "/localstays/${ENV}/stripe/secret-key" \
  --value "${STRIPE_KEY}" \
  --type "SecureString" \
  --overwrite \
  --region "${REGION}" \
  --description "Stripe API secret key - TEMPORARY: Using TEST key, update to LIVE for real payments" > /dev/null
echo -e "  ${GREEN}✓ /localstays/${ENV}/stripe/secret-key (SecureString - TEST KEY)${NC}"

###############################################################################
# STEP 4: Set Business Configuration Parameters
###############################################################################

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}STEP 4: Setting Business Configuration Parameters${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Trial days = 60
echo -e "  Setting trial-days = 60..."
aws ssm put-parameter \
  --name "/localstays/${ENV}/config/trial-days" \
  --value "60" \
  --type "String" \
  --overwrite \
  --region "${REGION}" \
  --description "Number of trial days for new subscriptions" > /dev/null
echo -e "  ${GREEN}✓ /localstays/${ENV}/config/trial-days = 60${NC}"

# Commission rate = 6.6% (0.066)
echo -e "  Setting commission-rate = 0.066 (6.6%)..."
aws ssm put-parameter \
  --name "/localstays/${ENV}/config/commission-rate" \
  --value "0.066" \
  --type "String" \
  --overwrite \
  --region "${REGION}" \
  --description "Commission rate for free/commission-based listings (6.6%)" > /dev/null
echo -e "  ${GREEN}✓ /localstays/${ENV}/config/commission-rate = 0.066${NC}"

# Auto-publish on approval = false
echo -e "  Setting auto-publish-on-approval = false..."
aws ssm put-parameter \
  --name "/localstays/${ENV}/config/auto-publish-on-approval" \
  --value "false" \
  --type "String" \
  --overwrite \
  --region "${REGION}" \
  --description "Don't auto-publish listings on admin approval" > /dev/null
echo -e "  ${GREEN}✓ /localstays/${ENV}/config/auto-publish-on-approval = false${NC}"

# Review compensation enabled = true
echo -e "  Setting review-compensation-enabled = true..."
aws ssm put-parameter \
  --name "/localstays/${ENV}/config/review-compensation-enabled" \
  --value "true" \
  --type "String" \
  --overwrite \
  --region "${REGION}" \
  --description "Enable review compensation days for ad slots" > /dev/null
echo -e "  ${GREEN}✓ /localstays/${ENV}/config/review-compensation-enabled = true${NC}"

# Subscriptions enabled = false (not purchasable yet)
echo -e "  Setting subscriptions-enabled = false..."
aws ssm put-parameter \
  --name "/localstays/${ENV}/config/subscriptions-enabled" \
  --value "false" \
  --type "String" \
  --overwrite \
  --region "${REGION}" \
  --description "Subscriptions not available for purchase yet" > /dev/null
echo -e "  ${GREEN}✓ /localstays/${ENV}/config/subscriptions-enabled = false${NC}"

###############################################################################
# Summary
###############################################################################

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ ALL SSM PARAMETERS SET SUCCESSFULLY${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}Parameters set in ${REGION}:${NC}"
echo -e "  • /localstays/prod/vapid/publicKey"
echo -e "  • /localstays/prod/vapid/privateKey (SecureString)"
echo -e "  • /localstays/prod/vapid/subject"
echo -e "  • /localstays/prod/sendgrid (SecureString)"
echo -e "  • /localstays/prod/stripe/secret-key (SecureString - ${YELLOW}TEST KEY${NC})"
echo -e "  • /localstays/prod/config/trial-days = 60"
echo -e "  • /localstays/prod/config/commission-rate = 0.066"
echo -e "  • /localstays/prod/config/auto-publish-on-approval = false"
echo -e "  • /localstays/prod/config/review-compensation-enabled = true"
echo -e "  • /localstays/prod/config/subscriptions-enabled = false"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT REMINDERS:${NC}"
echo ""
echo -e "  1. ${YELLOW}VAPID Public Key for Frontend:${NC}"
echo -e "     ${CYAN}${VAPID_PUBLIC_KEY}${NC}"
echo ""
echo -e "  2. ${YELLOW}Stripe is using TEST key - update when ready for real payments:${NC}"
echo -e "     ${CYAN}./scripts/setup-stripe-ssm.sh prod sk_live_xxxxx${NC}"
echo ""
echo -e "  3. ${YELLOW}Stripe EventBridge uses staging event source - update in infra/bin/infra.ts${NC}"
echo ""
echo -e "${GREEN}You can now proceed with CDK deployment!${NC}"
echo ""
