#!/bin/bash
# Test script for GET /api/v1/hosts/{hostId}/profile endpoint

# Configuration
API_URL="${API_URL:-https://your-api-id.execute-api.eu-north-1.amazonaws.com/dev1}"
ID_TOKEN="${ID_TOKEN:-your-jwt-token-here}"
HOST_ID="${HOST_ID:-your-host-id-here}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Testing GET Profile Endpoint${NC}"
echo "API URL: $API_URL"
echo "Host ID: $HOST_ID"
echo ""

# Make the request
echo -e "${YELLOW}Sending request...${NC}"
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X GET \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  "$API_URL/api/v1/hosts/$HOST_ID/profile")

# Parse response
HTTP_BODY=$(echo "$RESPONSE" | sed -e 's/HTTP_STATUS\:.*//g')
HTTP_STATUS=$(echo "$RESPONSE" | tr -d '\n' | sed -e 's/.*HTTP_STATUS://')

echo ""
echo -e "${YELLOW}Response Status:${NC} $HTTP_STATUS"
echo -e "${YELLOW}Response Body:${NC}"
echo "$HTTP_BODY" | jq '.' 2>/dev/null || echo "$HTTP_BODY"

# Check status
if [ "$HTTP_STATUS" -eq 200 ]; then
  echo ""
  echo -e "${GREEN}✓ Success!${NC}"
  
  # Parse and display key fields
  echo ""
  echo -e "${YELLOW}Profile Summary:${NC}"
  echo "$HTTP_BODY" | jq -r '
    "Host ID: \(.hostId)",
    "Host Type: \(.hostType)",
    "Status: \(.status)",
    "Email: \(.email)",
    "Phone: \(.phone)",
    "KYC Status: \(.kyc.status)",
    "Documents: \(.documents | length)",
    ""
  ' 2>/dev/null
  
  # Show documents
  echo -e "${YELLOW}Documents:${NC}"
  echo "$HTTP_BODY" | jq -r '.documents[] | 
    "  - \(.documentType): \(.fileName) (\(.status))"
  ' 2>/dev/null
  
elif [ "$HTTP_STATUS" -eq 404 ]; then
  echo ""
  echo -e "${RED}✗ Profile not found${NC}"
elif [ "$HTTP_STATUS" -eq 403 ]; then
  echo ""
  echo -e "${RED}✗ Forbidden - You don't have access to this host${NC}"
elif [ "$HTTP_STATUS" -eq 401 ]; then
  echo ""
  echo -e "${RED}✗ Unauthorized - Check your JWT token${NC}"
else
  echo ""
  echo -e "${RED}✗ Request failed with status $HTTP_STATUS${NC}"
fi

echo ""

