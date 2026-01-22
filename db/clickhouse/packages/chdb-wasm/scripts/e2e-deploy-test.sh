#!/usr/bin/env bash
#
# E2E Deploy Test Script
#
# This script builds WASM modules, deploys to a staging worker,
# runs E2E tests, and reports results.
#
# Usage:
#   ./scripts/e2e-deploy-test.sh [options]
#
# Options:
#   --local        Run tests against local wrangler dev (default)
#   --staging      Deploy to staging and run tests
#   --production   Deploy to production (requires --force)
#   --force        Allow production deployment
#   --skip-build   Skip WASM build step
#   --skip-deploy  Skip deployment step (use existing deployment)
#   --verbose      Enable verbose output
#   --help         Show this help message
#

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default configuration
MODE="local"
SKIP_BUILD=false
SKIP_DEPLOY=false
VERBOSE=false
FORCE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --local)
      MODE="local"
      shift
      ;;
    --staging)
      MODE="staging"
      shift
      ;;
    --production)
      MODE="production"
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-deploy)
      SKIP_DEPLOY=true
      shift
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --help)
      echo "E2E Deploy Test Script"
      echo ""
      echo "Usage: ./scripts/e2e-deploy-test.sh [options]"
      echo ""
      echo "Options:"
      echo "  --local        Run tests against local wrangler dev (default)"
      echo "  --staging      Deploy to staging and run tests"
      echo "  --production   Deploy to production (requires --force)"
      echo "  --force        Allow production deployment"
      echo "  --skip-build   Skip WASM build step"
      echo "  --skip-deploy  Skip deployment step"
      echo "  --verbose      Enable verbose output"
      echo "  --help         Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Functions
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Header
echo ""
echo "========================================"
echo "  E2E Deploy Test"
echo "  Mode: ${MODE}"
echo "========================================"
echo ""

# Validate production deployment
if [[ "$MODE" == "production" && "$FORCE" != "true" ]]; then
  log_error "Production deployment requires --force flag"
  exit 1
fi

cd "$PROJECT_DIR"

# Step 1: Build WASM (if not skipped)
if [[ "$SKIP_BUILD" != "true" ]]; then
  log_info "Step 1: Building WASM modules..."

  # Check if build script exists
  if [[ -f "./wasm/build.sh" ]]; then
    if [[ "$VERBOSE" == "true" ]]; then
      ./wasm/build.sh
    else
      ./wasm/build.sh > /dev/null 2>&1 || log_warning "WASM build skipped (script may not be configured)"
    fi
    log_success "WASM build complete"
  else
    log_warning "WASM build script not found, skipping..."
  fi

  # Ensure public directory exists for static assets
  mkdir -p public/wasm
  mkdir -p public/extensions

  # Copy WASM files to public directory if they exist
  if [[ -d "wasm/dist" ]]; then
    cp -r wasm/dist/*.wasm public/wasm/ 2>/dev/null || true
    log_info "Copied WASM files to public/wasm/"
  fi

  if [[ -d "wasm/core/dist" ]]; then
    cp -r wasm/core/dist/*.wasm public/wasm/ 2>/dev/null || true
    log_info "Copied core WASM files to public/wasm/"
  fi
else
  log_info "Step 1: Skipping WASM build (--skip-build)"
fi

# Step 2: Deploy (if not local and not skipped)
WORKER_URL=""

if [[ "$MODE" != "local" && "$SKIP_DEPLOY" != "true" ]]; then
  log_info "Step 2: Deploying to ${MODE}..."

  case "$MODE" in
    staging)
      # Deploy to staging
      if [[ "$VERBOSE" == "true" ]]; then
        wrangler deploy --env staging
      else
        wrangler deploy --env staging > /dev/null 2>&1
      fi

      # Get the worker URL from wrangler
      WORKER_URL=$(wrangler whoami 2>/dev/null | grep -oP 'https://[^\s]+' | head -1 || echo "")

      # If we can't get URL automatically, construct it
      if [[ -z "$WORKER_URL" ]]; then
        WORKER_URL="https://chdb-wasm-staging.${CF_ACCOUNT_SUBDOMAIN:-workers.dev}"
      fi

      log_success "Deployed to staging: ${WORKER_URL}"
      ;;

    production)
      # Deploy to production
      if [[ "$VERBOSE" == "true" ]]; then
        wrangler deploy --env production
      else
        wrangler deploy --env production > /dev/null 2>&1
      fi

      WORKER_URL="https://chdb-wasm.${CF_ACCOUNT_SUBDOMAIN:-workers.dev}"
      log_success "Deployed to production: ${WORKER_URL}"
      ;;
  esac
elif [[ "$MODE" != "local" ]]; then
  log_info "Step 2: Skipping deployment (--skip-deploy)"

  # Use environment variable if set
  if [[ -n "$WORKER_URL" ]]; then
    log_info "Using WORKER_URL from environment: ${WORKER_URL}"
  else
    log_warning "No WORKER_URL set, tests may fail"
  fi
else
  log_info "Step 2: Using local wrangler dev"
fi

# Step 3: Run E2E tests
log_info "Step 3: Running E2E tests..."

TEST_EXIT_CODE=0

if [[ "$MODE" == "local" ]]; then
  # Run local E2E tests
  if [[ "$VERBOSE" == "true" ]]; then
    pnpm vitest run tests/e2e/dynamic-wasm.test.ts --config vitest.e2e.config.ts || TEST_EXIT_CODE=$?
  else
    pnpm vitest run tests/e2e/dynamic-wasm.test.ts --config vitest.e2e.config.ts --reporter=dot || TEST_EXIT_CODE=$?
  fi
else
  # Run deployed E2E tests
  export WORKER_URL
  export USE_LOCAL=false

  if [[ "$VERBOSE" == "true" ]]; then
    pnpm vitest run tests/e2e/dynamic-wasm.test.ts --config vitest.e2e.config.ts || TEST_EXIT_CODE=$?
  else
    pnpm vitest run tests/e2e/dynamic-wasm.test.ts --config vitest.e2e.config.ts --reporter=dot || TEST_EXIT_CODE=$?
  fi
fi

# Step 4: Report results
echo ""
echo "========================================"
echo "  Test Results"
echo "========================================"
echo ""

if [[ $TEST_EXIT_CODE -eq 0 ]]; then
  log_success "All E2E tests passed!"

  echo ""
  echo "Test Summary:"
  echo "  - Mode: ${MODE}"
  if [[ -n "$WORKER_URL" ]]; then
    echo "  - Worker URL: ${WORKER_URL}"
  fi
  echo "  - Status: PASSED"
  echo ""
else
  log_error "Some E2E tests failed"

  echo ""
  echo "Test Summary:"
  echo "  - Mode: ${MODE}"
  if [[ -n "$WORKER_URL" ]]; then
    echo "  - Worker URL: ${WORKER_URL}"
  fi
  echo "  - Status: FAILED"
  echo "  - Exit Code: ${TEST_EXIT_CODE}"
  echo ""

  # Suggest debugging steps
  echo "Debugging suggestions:"
  echo "  1. Run with --verbose for detailed output"
  echo "  2. Check worker logs: wrangler tail"
  echo "  3. Test manually: curl ${WORKER_URL}/ping"
  echo ""
fi

exit $TEST_EXIT_CODE
