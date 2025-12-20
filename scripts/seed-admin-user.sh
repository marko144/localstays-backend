#!/bin/bash

###############################################################################
# Seed Admin User Script
# 
# Creates the first admin user in Cognito and DynamoDB
# 
# Usage: 
#   ./scripts/seed-admin-user.sh              # Defaults to dev1
#   ./scripts/seed-admin-user.sh staging      # For staging
#   ./scripts/seed-admin-user.sh prod         # For production (generates strong password)
#
# Environment variables (optional):
#   ADMIN_EMAIL - Override admin email (default: marko+admin@velocci.me)
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
ENV="${1:-dev1}"
REGION="eu-north-1"
COGNITO_STACK="localstays-${ENV}-cognito"
DATA_STACK="localstays-${ENV}-data"

# Validate environment
if [[ ! "$ENV" =~ ^(dev1|staging|prod)$ ]]; then
    echo -e "${RED}Error: Invalid environment '${ENV}'${NC}"
    echo "Usage: $0 <environment>"
    echo "  environment: dev1, staging, or prod"
    exit 1
fi

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         LocalStays Admin User Seeding - ${ENV}                    ${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$ENV" == "prod" ]; then
    echo -e "${YELLOW}⚠️  PRODUCTION MODE: A strong random password will be generated${NC}"
    echo -e "${YELLOW}   Make sure to save the password securely - it cannot be retrieved later!${NC}"
    echo ""
fi

# Step 1: Get stack outputs
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Fetching stack outputs...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Get User Pool ID from Cognito Stack
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name "${COGNITO_STACK}" \
  --region ${REGION} \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text)

if [ -z "$USER_POOL_ID" ] || [ "$USER_POOL_ID" == "None" ]; then
  echo -e "${RED}❌ Failed to get User Pool ID from stack: ${COGNITO_STACK}${NC}"
  echo -e "${RED}   Make sure the Cognito stack is deployed first.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ User Pool ID: ${USER_POOL_ID}${NC}"

# Get Table Name from Data Stack
TABLE_NAME=$(aws cloudformation describe-stacks \
  --stack-name "${DATA_STACK}" \
  --region ${REGION} \
  --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" \
  --output text)

if [ -z "$TABLE_NAME" ] || [ "$TABLE_NAME" == "None" ]; then
  echo -e "${RED}❌ Failed to get Table Name from stack: ${DATA_STACK}${NC}"
  echo -e "${RED}   Make sure the Data stack is deployed first.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Table Name: ${TABLE_NAME}${NC}"
echo ""

# Step 2: Run the seed script with ts-node
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Running seed script...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

cd "$(dirname "$0")/.."

AWS_REGION=${REGION} \
USER_POOL_ID=${USER_POOL_ID} \
TABLE_NAME=${TABLE_NAME} \
STAGE=${ENV} \
npx ts-node backend/services/seed/seed-admin-user.ts

if [ $? -eq 0 ]; then
  echo ""
  echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║         ✅ Admin User Seeding Complete!                         ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  if [ "$ENV" == "prod" ]; then
    echo -e "${YELLOW}⚠️  IMPORTANT: Save the password above securely!${NC}"
    echo -e "${YELLOW}   It was randomly generated and cannot be retrieved.${NC}"
  fi
else
  echo -e "\n${RED}❌ Admin user seeding failed${NC}"
  exit 1
fi
