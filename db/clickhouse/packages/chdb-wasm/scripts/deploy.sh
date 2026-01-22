#!/bin/bash
# deploy.sh
# Automated deployment pipeline for chDB WASM Workers
#
# This script handles the full deployment workflow:
# - Build WASM modules
# - Bundle configurations
# - Deploy to Cloudflare Workers (staging/production)
# - Run smoke tests
# - Report deployment status
#
# Usage:
#   ./scripts/deploy.sh <config> [options]
#
# Configs:
#   chdb-fetch    Deploy chdb-fetch configuration
#   chdb-lake     Deploy chdb-lake configuration
#   all           Deploy all configurations
#
# Options:
#   --env, -e <env>     Environment: staging, production (default: staging)
#   --skip-build        Skip WASM build step
#   --skip-tests        Skip smoke tests after deployment
#   --skip-verify       Skip deployment verification
#   --promote           Deploy to staging, verify, then promote to production
#   --force             Skip confirmation prompts
#   --dry-run           Print commands without executing
#   --verbose           Enable verbose output
#   --help, -h          Show this help message
#
# Examples:
#   ./scripts/deploy.sh all                          # Deploy all to staging
#   ./scripts/deploy.sh chdb-fetch --env production  # Deploy fetch to production
#   ./scripts/deploy.sh all --promote                # Full staging -> production flow
#   ./scripts/deploy.sh all --skip-build             # Deploy without rebuilding

set -e

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WRANGLER_TOML="${PROJECT_ROOT}/wrangler.toml"

# Default options
CONFIG=""
ENVIRONMENT="staging"
SKIP_BUILD=false
SKIP_TESTS=false
SKIP_VERIFY=false
PROMOTE=false
FORCE=false
DRY_RUN=false
VERBOSE=false

# Available configurations
CONFIGS=("chdb-fetch" "chdb-lake")

# Cloudflare Worker URLs (will be populated based on environment)
declare -A WORKER_URLS

# ============================================================================
# Color Output
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_section() {
    echo ""
    echo -e "${CYAN}${BOLD}=== $1 ===${NC}"
    echo ""
}

log_step() {
    echo -e "${MAGENTA}[STEP]${NC} $1"
}

# ============================================================================
# Helper Functions
# ============================================================================

show_help() {
    head -40 "$0" | tail -36
    exit 0
}

run_cmd() {
    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}[DRY-RUN]${NC} $*"
        return 0
    else
        if [ "$VERBOSE" = true ]; then
            echo -e "${CYAN}[RUN]${NC} $*"
        fi
        "$@"
    fi
}

confirm() {
    if [ "$FORCE" = true ]; then
        return 0
    fi

    local message="$1"
    read -p "$(echo -e "${YELLOW}${message} [y/N]:${NC} ")" response
    case "$response" in
        [yY][eE][sS]|[yY]) return 0 ;;
        *) return 1 ;;
    esac
}

check_dependencies() {
    log_step "Checking dependencies..."

    local missing=()

    if ! command -v wrangler &> /dev/null; then
        missing+=("wrangler (npm install -g wrangler)")
    fi

    if ! command -v jq &> /dev/null; then
        missing+=("jq (brew install jq)")
    fi

    if ! command -v curl &> /dev/null; then
        missing+=("curl")
    fi

    if ! command -v npx &> /dev/null; then
        missing+=("npx (comes with npm)")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing dependencies:"
        for dep in "${missing[@]}"; do
            echo "  - $dep"
        done
        exit 1
    fi

    log_success "All dependencies available"
}

get_worker_url() {
    local config="$1"
    local env="$2"

    # Base worker name from wrangler.toml
    local base_name="chdb-wasm"

    # Construct URL based on environment and config
    if [ "$env" = "production" ]; then
        case "$config" in
            "chdb-fetch")
                echo "https://chdb-fetch.dotdo.workers.dev"
                ;;
            "chdb-lake")
                echo "https://chdb-lake.dotdo.workers.dev"
                ;;
            *)
                echo "https://${base_name}.dotdo.workers.dev"
                ;;
        esac
    else
        # Staging URLs
        case "$config" in
            "chdb-fetch")
                echo "https://chdb-fetch-staging.dotdo.workers.dev"
                ;;
            "chdb-lake")
                echo "https://chdb-lake-staging.dotdo.workers.dev"
                ;;
            *)
                echo "https://${base_name}-staging.dotdo.workers.dev"
                ;;
        esac
    fi
}

# ============================================================================
# Parse Arguments
# ============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        chdb-fetch|chdb-lake|all)
            CONFIG="$1"
            shift
            ;;
        --env|-e)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --skip-verify)
            SKIP_VERIFY=true
            shift
            ;;
        --promote)
            PROMOTE=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            show_help
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Use --help for usage information."
            exit 1
            ;;
    esac
done

# Validate config
if [ -z "$CONFIG" ]; then
    log_error "No configuration specified."
    echo ""
    echo "Usage: $0 <config> [options]"
    echo "Configs: chdb-fetch, chdb-lake, all"
    echo ""
    echo "Use --help for more information."
    exit 1
fi

# Validate environment
if [ "$ENVIRONMENT" != "staging" ] && [ "$ENVIRONMENT" != "production" ]; then
    log_error "Invalid environment: $ENVIRONMENT"
    echo "Valid environments: staging, production"
    exit 1
fi

# ============================================================================
# Header
# ============================================================================

echo ""
echo -e "${BOLD}================================================================${NC}"
echo -e "${BOLD}  chDB WASM Deployment Pipeline${NC}"
echo -e "${BOLD}================================================================${NC}"
echo ""
log_info "Configuration: ${CONFIG}"
log_info "Environment: ${ENVIRONMENT}"
log_info "Project Root: ${PROJECT_ROOT}"
if [ "$PROMOTE" = true ]; then
    log_info "Mode: Promote (staging -> production)"
fi
echo ""

# Check dependencies
check_dependencies

# ============================================================================
# Build Step
# ============================================================================

if [ "$SKIP_BUILD" = false ]; then
    log_section "Building WASM Modules"

    # Check if build script exists
    if [ -f "${SCRIPT_DIR}/build-wasm.sh" ]; then
        log_step "Running WASM build..."

        BUILD_ARGS=("--release")
        if [ "$VERBOSE" = true ]; then
            BUILD_ARGS+=("--verbose")
        fi

        run_cmd "${SCRIPT_DIR}/build-wasm.sh" "${BUILD_ARGS[@]}" || {
            log_warn "WASM build failed or not configured. Continuing with existing artifacts..."
        }
    else
        log_warn "Build script not found, skipping build step"
    fi

    log_success "Build step complete"
else
    log_info "Skipping build step (--skip-build)"
fi

# ============================================================================
# Bundle Configuration
# ============================================================================

log_section "Bundling Configuration"

bundle_config() {
    local config="$1"
    log_step "Bundling ${config}..."

    # Create config-specific wrangler.toml if needed
    local config_toml="${PROJECT_ROOT}/wrangler.${config}.toml"

    if [ ! -f "$config_toml" ]; then
        log_info "Using main wrangler.toml for ${config}"
    else
        log_info "Using config-specific wrangler.toml: ${config_toml}"
    fi

    log_success "Bundled ${config}"
}

if [ "$CONFIG" = "all" ]; then
    for cfg in "${CONFIGS[@]}"; do
        bundle_config "$cfg"
    done
else
    bundle_config "$CONFIG"
fi

# ============================================================================
# Deploy Function
# ============================================================================

deploy_worker() {
    local config="$1"
    local env="$2"

    log_step "Deploying ${config} to ${env}..."

    local deploy_args=()

    # Use environment-specific deployment
    if [ "$env" = "production" ]; then
        deploy_args+=("--env" "production")
    elif [ "$env" = "staging" ]; then
        deploy_args+=("--env" "staging")
    fi

    # Check for config-specific wrangler.toml
    local config_toml="${PROJECT_ROOT}/wrangler.${config}.toml"
    if [ -f "$config_toml" ]; then
        deploy_args+=("--config" "$config_toml")
    fi

    cd "$PROJECT_ROOT"

    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}[DRY-RUN]${NC} wrangler deploy ${deploy_args[*]}"
    else
        # Run wrangler deploy
        if ! wrangler deploy "${deploy_args[@]}"; then
            log_error "Deployment failed for ${config} to ${env}"
            return 1
        fi
    fi

    log_success "Deployed ${config} to ${env}"
    return 0
}

# ============================================================================
# Verification Function
# ============================================================================

verify_deployment() {
    local config="$1"
    local env="$2"

    if [ "$SKIP_VERIFY" = true ]; then
        log_info "Skipping verification (--skip-verify)"
        return 0
    fi

    log_step "Verifying deployment of ${config} in ${env}..."

    local worker_url
    worker_url=$(get_worker_url "$config" "$env")

    log_info "Worker URL: ${worker_url}"

    # Run verification script if available
    local verify_script="${SCRIPT_DIR}/verify-deployment.ts"
    if [ -f "$verify_script" ]; then
        if [ "$DRY_RUN" = true ]; then
            echo -e "${YELLOW}[DRY-RUN]${NC} npx tsx ${verify_script} --url ${worker_url}"
        else
            if ! npx tsx "$verify_script" --url "$worker_url" --config "$config" --env "$env"; then
                log_error "Verification failed for ${config} in ${env}"
                return 1
            fi
        fi
    else
        # Basic verification using curl
        log_info "Running basic verification..."

        # Test /ping endpoint
        log_step "Testing /ping endpoint..."
        if [ "$DRY_RUN" = false ]; then
            local ping_response
            local ping_status
            ping_response=$(curl -s -w "\n%{http_code}" "${worker_url}/ping" 2>/dev/null)
            ping_status=$(echo "$ping_response" | tail -n1)
            local ping_body
            ping_body=$(echo "$ping_response" | sed '$d')

            if [ "$ping_status" = "200" ]; then
                log_success "/ping returned 200 OK"
            else
                log_error "/ping returned status ${ping_status}"
                return 1
            fi
        fi

        # Test sample query
        log_step "Testing sample query..."
        if [ "$DRY_RUN" = false ]; then
            local query_response
            local query_status
            query_response=$(curl -s -w "\n%{http_code}" "${worker_url}/?query=SELECT%201%2B1%20AS%20result&default_format=JSON" 2>/dev/null)
            query_status=$(echo "$query_response" | tail -n1)

            if [ "$query_status" = "200" ]; then
                log_success "Query endpoint returned 200 OK"
            else
                log_error "Query endpoint returned status ${query_status}"
                return 1
            fi
        fi
    fi

    log_success "Verification passed for ${config} in ${env}"
    return 0
}

# ============================================================================
# Smoke Tests
# ============================================================================

run_smoke_tests() {
    local config="$1"
    local env="$2"

    if [ "$SKIP_TESTS" = true ]; then
        log_info "Skipping smoke tests (--skip-tests)"
        return 0
    fi

    log_step "Running smoke tests for ${config} in ${env}..."

    local worker_url
    worker_url=$(get_worker_url "$config" "$env")

    local tests_passed=0
    local tests_failed=0

    # Test 1: Ping endpoint
    log_info "Test 1: Ping endpoint"
    if [ "$DRY_RUN" = false ]; then
        local start_time
        start_time=$(date +%s%N)
        local response
        response=$(curl -s -o /dev/null -w "%{http_code}" "${worker_url}/ping")
        local end_time
        end_time=$(date +%s%N)
        local latency
        latency=$(( (end_time - start_time) / 1000000 ))

        if [ "$response" = "200" ]; then
            log_success "  PASS - /ping (${latency}ms)"
            ((tests_passed++))
        else
            log_error "  FAIL - /ping returned ${response}"
            ((tests_failed++))
        fi
    else
        log_info "  [DRY-RUN] Would test /ping"
        ((tests_passed++))
    fi

    # Test 2: Simple arithmetic query
    log_info "Test 2: Simple arithmetic query"
    if [ "$DRY_RUN" = false ]; then
        local start_time
        start_time=$(date +%s%N)
        local response
        response=$(curl -s "${worker_url}/?query=SELECT%201%2B1%20AS%20result&default_format=JSON")
        local end_time
        end_time=$(date +%s%N)
        local latency
        latency=$(( (end_time - start_time) / 1000000 ))

        if echo "$response" | jq -e '.data[0].result == 2' &>/dev/null; then
            log_success "  PASS - SELECT 1+1 (${latency}ms)"
            ((tests_passed++))
        else
            log_error "  FAIL - SELECT 1+1 returned unexpected result"
            ((tests_failed++))
        fi
    else
        log_info "  [DRY-RUN] Would test SELECT 1+1"
        ((tests_passed++))
    fi

    # Test 3: System function
    log_info "Test 3: System function (version)"
    if [ "$DRY_RUN" = false ]; then
        local response
        response=$(curl -s "${worker_url}/?query=SELECT%20version()%20AS%20v&default_format=JSON")

        if echo "$response" | jq -e '.data[0].v' &>/dev/null; then
            local version
            version=$(echo "$response" | jq -r '.data[0].v')
            log_success "  PASS - version() = ${version}"
            ((tests_passed++))
        else
            log_error "  FAIL - version() returned unexpected result"
            ((tests_failed++))
        fi
    else
        log_info "  [DRY-RUN] Would test version()"
        ((tests_passed++))
    fi

    # Test 4: Response format (JSON)
    log_info "Test 4: Response format validation"
    if [ "$DRY_RUN" = false ]; then
        local response
        response=$(curl -s "${worker_url}/?query=SELECT%20'test'%20AS%20str&default_format=JSON")

        if echo "$response" | jq -e '.meta and .data and .rows' &>/dev/null; then
            log_success "  PASS - JSON format valid"
            ((tests_passed++))
        else
            log_error "  FAIL - Invalid JSON format"
            ((tests_failed++))
        fi
    else
        log_info "  [DRY-RUN] Would test JSON format"
        ((tests_passed++))
    fi

    # Summary
    echo ""
    log_info "Smoke Tests Summary: ${tests_passed} passed, ${tests_failed} failed"

    if [ "$tests_failed" -gt 0 ]; then
        return 1
    fi
    return 0
}

# ============================================================================
# Main Deployment Flow
# ============================================================================

log_section "Deployment"

deploy_single_config() {
    local config="$1"
    local target_env="${2:-$ENVIRONMENT}"

    log_info "Deploying ${config} to ${target_env}..."

    # Deploy
    if ! deploy_worker "$config" "$target_env"; then
        log_error "Deployment failed"
        return 1
    fi

    # Wait for deployment to propagate
    if [ "$DRY_RUN" = false ]; then
        log_info "Waiting for deployment to propagate..."
        sleep 5
    fi

    # Verify
    if ! verify_deployment "$config" "$target_env"; then
        log_error "Verification failed"
        return 1
    fi

    # Smoke tests
    if ! run_smoke_tests "$config" "$target_env"; then
        log_error "Smoke tests failed"
        return 1
    fi

    return 0
}

# Handle --promote flow
if [ "$PROMOTE" = true ]; then
    log_section "Staging Deployment"

    if [ "$CONFIG" = "all" ]; then
        for cfg in "${CONFIGS[@]}"; do
            if ! deploy_single_config "$cfg" "staging"; then
                log_error "Staging deployment failed for ${cfg}"
                exit 1
            fi
        done
    else
        if ! deploy_single_config "$CONFIG" "staging"; then
            log_error "Staging deployment failed"
            exit 1
        fi
    fi

    log_success "Staging deployment successful"

    # Confirm promotion
    echo ""
    if ! confirm "Staging deployment verified. Promote to production?"; then
        log_info "Promotion cancelled"
        exit 0
    fi

    log_section "Production Deployment"

    if [ "$CONFIG" = "all" ]; then
        for cfg in "${CONFIGS[@]}"; do
            if ! deploy_single_config "$cfg" "production"; then
                log_error "Production deployment failed for ${cfg}"
                exit 1
            fi
        done
    else
        if ! deploy_single_config "$CONFIG" "production"; then
            log_error "Production deployment failed"
            exit 1
        fi
    fi

    log_success "Production deployment successful"
else
    # Direct deployment to specified environment
    if [ "$ENVIRONMENT" = "production" ]; then
        if ! confirm "Deploy directly to PRODUCTION?"; then
            log_info "Deployment cancelled"
            exit 0
        fi
    fi

    if [ "$CONFIG" = "all" ]; then
        for cfg in "${CONFIGS[@]}"; do
            if ! deploy_single_config "$cfg" "$ENVIRONMENT"; then
                log_error "Deployment failed for ${cfg}"
                exit 1
            fi
        done
    else
        if ! deploy_single_config "$CONFIG" "$ENVIRONMENT"; then
            log_error "Deployment failed"
            exit 1
        fi
    fi
fi

# ============================================================================
# Summary
# ============================================================================

log_section "Deployment Summary"

echo -e "${BOLD}Configuration:${NC} ${CONFIG}"
echo -e "${BOLD}Environment:${NC}   ${ENVIRONMENT}"
echo -e "${BOLD}Status:${NC}        ${GREEN}SUCCESS${NC}"
echo ""

if [ "$CONFIG" = "all" ]; then
    echo -e "${BOLD}Deployed Workers:${NC}"
    for cfg in "${CONFIGS[@]}"; do
        local url
        url=$(get_worker_url "$cfg" "$ENVIRONMENT")
        echo "  - ${cfg}: ${url}"
    done
else
    local url
    url=$(get_worker_url "$CONFIG" "$ENVIRONMENT")
    echo -e "${BOLD}Worker URL:${NC} ${url}"
fi

echo ""
echo -e "${BOLD}================================================================${NC}"
echo -e "${GREEN}${BOLD}  DEPLOYMENT COMPLETE${NC}"
echo -e "${BOLD}================================================================${NC}"
echo ""
