#!/bin/bash

###############################################################################
# Seed Admin User Script
# 
# Creates the first admin user in Cognito and DynamoDB for the dev1 environment
# 
# Usage: ./scripts/seed-admin-user.sh
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENV="dev1"
REGION="eu-north-1"
COGNITO_STACK="localstays-${ENV}-cognito"
DATA_STACK="localstays-${ENV}-data"

echo -e "${BLUE}🚀 Seeding Admin User for ${ENV} environment${NC}\n"

# Step 1: Get stack outputs
echo -e "${YELLOW}📊 Fetching stack outputs...${NC}"

# Get User Pool ID from Cognito Stack
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name "${COGNITO_STACK}" \
  --region ${REGION} \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text)

if [ -z "$USER_POOL_ID" ]; then
  echo -e "${RED}❌ Failed to get User Pool ID from stack: ${COGNITO_STACK}${NC}"
  exit 1
fi
echo -e "${GREEN}✅ User Pool ID: ${USER_POOL_ID}${NC}"
echo -e "${GREEN}✅ Cognito Stack: ${COGNITO_STACK}${NC}"

# Get Table Name from Data Stack
TABLE_NAME=$(aws cloudformation describe-stacks \
  --stack-name "${DATA_STACK}" \
  --region ${REGION} \
  --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" \
  --output text)

if [ -z "$TABLE_NAME" ]; then
  echo -e "${RED}❌ Failed to get Table Name from stack: ${DATA_STACK}${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Table Name: ${TABLE_NAME}${NC}"
echo -e "${GREEN}✅ Data Stack: ${DATA_STACK}${NC}\n"

# Step 2: Run the seed script with ts-node
echo -e "${YELLOW}🌱 Running seed script...${NC}\n"

cd "$(dirname "$0")/.."

AWS_REGION=${REGION} \
USER_POOL_ID=${USER_POOL_ID} \
TABLE_NAME=${TABLE_NAME} \
npx ts-node backend/services/seed/seed-admin-user.ts

if [ $? -eq 0 ]; then
  echo -e "\n${GREEN}✅ ✅ ✅ Admin user seeding complete! ✅ ✅ ✅${NC}\n"
  echo -e "${BLUE}🔑 Login credentials:${NC}"
  echo -e "   Email: marko+admin@velocci.me"
  echo -e "   Password: Password1*"
  echo -e "   Environment: ${ENV}"
  echo -e "   User Pool ID: ${USER_POOL_ID}"
  echo -e ""
else
  echo -e "\n${RED}❌ Admin user seeding failed${NC}"
  exit 1
fi

