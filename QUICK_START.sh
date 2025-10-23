#!/bin/bash

# Localstays Backend - Quick Start Deployment Script
# Run this after setting your SendGrid API key

set -e  # Exit on error

echo "🚀 Localstays Backend Deployment"
echo "================================="
echo ""

# Configuration
REGION="eu-north-1"
USER_POOL_ID="eu-north-1_NhDbGTVZd"
SENDGRID_PARAM="/localstays/dev/sendgrid"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if SendGrid API key is set
echo "📋 Checking prerequisites..."
if aws ssm get-parameter --name "$SENDGRID_PARAM" --region "$REGION" &>/dev/null; then
    echo -e "${GREEN}✅ SendGrid API key found in SSM${NC}"
else
    echo -e "${YELLOW}⚠️  SendGrid API key not found!${NC}"
    echo ""
    echo "Please set it first:"
    echo "  aws ssm put-parameter \\"
    echo "    --name \"$SENDGRID_PARAM\" \\"
    echo "    --type SecureString \\"
    echo "    --value \"SG.your-sendgrid-api-key\" \\"
    echo "    --region $REGION"
    echo ""
    read -p "Press Enter after setting the API key, or Ctrl+C to exit..."
fi

# Check if CDK is bootstrapped
echo ""
echo "📦 Checking CDK bootstrap..."
if aws cloudformation describe-stacks --stack-name CDKToolkit --region "$REGION" &>/dev/null; then
    echo -e "${GREEN}✅ CDK already bootstrapped${NC}"
else
    echo -e "${YELLOW}⚠️  CDK not bootstrapped. Bootstrapping now...${NC}"
    npx cdk bootstrap --region "$REGION"
fi

# Build the project
echo ""
echo "🔨 Building project..."
npm run build

# Deploy all stacks
echo ""
echo "🚀 Deploying CDK stacks..."
npx cdk deploy --all -c userPoolId="$USER_POOL_ID" --require-approval never

# Get Lambda ARN
echo ""
echo "🔍 Getting Lambda ARN..."
LAMBDA_ARN=$(aws lambda get-function \
  --function-name localstays-dev-custom-email-sender \
  --region "$REGION" \
  --query 'Configuration.FunctionArn' \
  --output text)

echo -e "${GREEN}✅ Lambda ARN: $LAMBDA_ARN${NC}"

# Attach Custom Email Sender trigger
echo ""
echo "🔗 Attaching Custom Email Sender trigger to Cognito..."
aws cognito-idp update-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --lambda-config "CustomEmailSender={LambdaVersion=V1_0,LambdaArn=$LAMBDA_ARN}" \
  --region "$REGION"

echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo "📊 Stack Outputs:"
echo "  - DynamoDB Table: localstays-dev"
echo "  - Lambda Function: localstays-dev-custom-email-sender"
echo "  - SSM Parameter: $SENDGRID_PARAM"
echo "  - Region: $REGION"
echo ""
echo "🧪 Test the setup:"
echo "  1. Sign up a new user via Cognito"
echo "  2. Check email for verification link"
echo "  3. View Lambda logs:"
echo "     aws logs tail /aws/lambda/localstays-dev-custom-email-sender --follow --region $REGION"
echo ""
echo "📚 For more information, see:"
echo "  - README.md (comprehensive docs)"
echo "  - DEPLOYMENT.md (deployment guide)"
echo "  - PROJECT_SUMMARY.md (what was created)"
echo ""
echo -e "${GREEN}🎉 Ready to go!${NC}"

















