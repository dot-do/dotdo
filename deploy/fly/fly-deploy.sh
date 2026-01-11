#!/bin/bash
# fly.io deployment script for dotdo stateless Durable Objects
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="${FLY_APP_NAME:-dotdo}"
PRIMARY_REGION="${FLY_PRIMARY_REGION:-iad}"
SECONDARY_REGIONS="${FLY_SECONDARY_REGIONS:-lhr,nrt,syd}"
MACHINES_PER_REGION="${FLY_MACHINES_PER_REGION:-2}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  dotdo fly.io Deployment${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if fly CLI is installed
if ! command -v fly &> /dev/null; then
    echo -e "${RED}Error: fly CLI is not installed${NC}"
    echo "Install with: curl -L https://fly.io/install.sh | sh"
    exit 1
fi

# Check if logged in
if ! fly auth whoami &> /dev/null; then
    echo -e "${RED}Error: Not logged in to fly.io${NC}"
    echo "Run: fly auth login"
    exit 1
fi

echo -e "${GREEN}Logged in as:${NC} $(fly auth whoami)"
echo ""

# Function to check if a secret exists
check_secret() {
    fly secrets list -a "$APP_NAME" 2>/dev/null | grep -q "^$1" || return 1
}

# Check for required secrets
echo -e "${YELLOW}Checking required secrets...${NC}"
MISSING_SECRETS=0

if ! check_secret "TURSO_URL"; then
    echo -e "${RED}  Missing: TURSO_URL${NC}"
    MISSING_SECRETS=1
fi

if ! check_secret "TURSO_TOKEN"; then
    echo -e "${RED}  Missing: TURSO_TOKEN${NC}"
    MISSING_SECRETS=1
fi

if [ $MISSING_SECRETS -eq 1 ]; then
    echo ""
    echo -e "${YELLOW}Please set required secrets:${NC}"
    echo "  fly secrets set TURSO_URL=libsql://your-db.turso.io -a $APP_NAME"
    echo "  fly secrets set TURSO_TOKEN=your-token -a $APP_NAME"
    echo ""
    echo -e "${YELLOW}Optional secrets:${NC}"
    echo "  fly secrets set R2_ACCESS_KEY=... R2_SECRET_KEY=... R2_ENDPOINT=... -a $APP_NAME"
    echo "  fly secrets set OPENAI_API_KEY=... -a $APP_NAME"
    echo "  fly secrets set ANTHROPIC_API_KEY=... -a $APP_NAME"
    exit 1
fi

echo -e "${GREEN}  All required secrets are set${NC}"
echo ""

# Check if app exists, create if not
if ! fly apps list | grep -q "^$APP_NAME"; then
    echo -e "${YELLOW}Creating app: $APP_NAME${NC}"
    fly apps create "$APP_NAME" --org personal
fi

# Deploy
echo -e "${YELLOW}Deploying to $APP_NAME...${NC}"
echo ""

fly deploy \
    --app "$APP_NAME" \
    --strategy rolling \
    --wait-timeout 300

echo ""
echo -e "${GREEN}Deployment complete!${NC}"
echo ""

# Scale to multiple regions
echo -e "${YELLOW}Scaling to multiple regions...${NC}"

# Scale primary region
echo "  Scaling $PRIMARY_REGION to $MACHINES_PER_REGION machines..."
fly scale count "$MACHINES_PER_REGION" --region "$PRIMARY_REGION" -a "$APP_NAME" --yes || true

# Scale secondary regions
IFS=',' read -ra REGIONS <<< "$SECONDARY_REGIONS"
for region in "${REGIONS[@]}"; do
    echo "  Scaling $region to $MACHINES_PER_REGION machines..."
    fly scale count "$MACHINES_PER_REGION" --region "$region" -a "$APP_NAME" --yes || true
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Summary${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  App:      ${BLUE}$APP_NAME${NC}"
echo -e "  URL:      ${BLUE}https://$APP_NAME.fly.dev${NC}"
echo -e "  Health:   ${BLUE}https://$APP_NAME.fly.dev/api/health${NC}"
echo -e "  Regions:  ${BLUE}$PRIMARY_REGION, $SECONDARY_REGIONS${NC}"
echo ""

# Show status
echo -e "${YELLOW}Current status:${NC}"
fly status -a "$APP_NAME"
