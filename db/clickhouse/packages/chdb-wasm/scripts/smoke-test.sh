#!/bin/bash
# smoke-test.sh
# Run smoke tests against a deployed chDB WASM worker
#
# Usage:
#   ./scripts/smoke-test.sh <url>
#   ./scripts/smoke-test.sh --config chdb-fetch --env staging
#
# Examples:
#   ./scripts/smoke-test.sh https://chdb-wasm.dotdo.workers.dev
#   ./scripts/smoke-test.sh --config chdb-lake --env production
#   ./scripts/smoke-test.sh --config all --env staging

set -e

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default options
URL=""
CONFIG=""
ENVIRONMENT="staging"
VERBOSE=false
JSON_OUTPUT=false

# Worker URL patterns
declare -A STAGING_URLS
STAGING_URLS["chdb-wasm"]="https://chdb-wasm-staging.dotdo.workers.dev"
STAGING_URLS["chdb-fetch"]="https://chdb-fetch-staging.dotdo.workers.dev"
STAGING_URLS["chdb-lake"]="https://chdb-lake-staging.dotdo.workers.dev"

declare -A PRODUCTION_URLS
PRODUCTION_URLS["chdb-wasm"]="https://chdb-wasm.dotdo.workers.dev"
PRODUCTION_URLS["chdb-fetch"]="https://chdb-fetch.dotdo.workers.dev"
PRODUCTION_URLS["chdb-lake"]="https://chdb-lake.dotdo.workers.dev"

# Test results
TESTS_PASSED=0
TESTS_FAILED=0
TEST_RESULTS=()

# ============================================================================
# Color Output
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info() {
    if [ "$JSON_OUTPUT" = false ]; then
        echo -e "${BLUE}[INFO]${NC} $1"
    fi
}

log_success() {
    if [ "$JSON_OUTPUT" = false ]; then
        echo -e "${GREEN}[PASS]${NC} $1"
    fi
}

log_error() {
    if [ "$JSON_OUTPUT" = false ]; then
        echo -e "${RED}[FAIL]${NC} $1"
    fi
}

log_warn() {
    if [ "$JSON_OUTPUT" = false ]; then
        echo -e "${YELLOW}[WARN]${NC} $1"
    fi
}

log_section() {
    if [ "$JSON_OUTPUT" = false ]; then
        echo ""
        echo -e "${CYAN}${BOLD}=== $1 ===${NC}"
        echo ""
    fi
}

# ============================================================================
# Helper Functions
# ============================================================================

show_help() {
    cat << 'EOF'
Usage: ./scripts/smoke-test.sh [url|options]

Arguments:
  url                    Direct URL to test

Options:
  --config, -c <name>    Configuration: chdb-wasm, chdb-fetch, chdb-lake, all
  --env, -e <env>        Environment: staging, production (default: staging)
  --verbose, -v          Verbose output
  --json                 Output results as JSON
  --help, -h             Show this help message

Examples:
  ./scripts/smoke-test.sh https://chdb-wasm.dotdo.workers.dev
  ./scripts/smoke-test.sh --config chdb-fetch --env staging
  ./scripts/smoke-test.sh --config all --env production
EOF
    exit 0
}

get_url() {
    local config="$1"
    local env="$2"

    if [ "$env" = "production" ]; then
        echo "${PRODUCTION_URLS[$config]}"
    else
        echo "${STAGING_URLS[$config]}"
    fi
}

measure_latency() {
    local start end
    start=$(date +%s%N)
    "$@" > /dev/null 2>&1
    local exit_code=$?
    end=$(date +%s%N)
    echo $(( (end - start) / 1000000 ))
    return $exit_code
}

record_result() {
    local name="$1"
    local passed="$2"
    local latency="$3"
    local details="$4"

    if [ "$passed" = true ]; then
        ((TESTS_PASSED++))
        log_success "$name (${latency}ms) - $details"
    else
        ((TESTS_FAILED++))
        log_error "$name (${latency}ms) - $details"
    fi

    TEST_RESULTS+=("{\"name\":\"$name\",\"passed\":$passed,\"latency\":$latency,\"details\":\"$details\"}")
}

# ============================================================================
# Test Functions
# ============================================================================

test_ping() {
    local url="$1"
    local start end latency response status

    log_info "Testing /ping endpoint..."

    start=$(date +%s%N)
    response=$(curl -s -w "\n%{http_code}" "${url}/ping" 2>/dev/null)
    end=$(date +%s%N)
    latency=$(( (end - start) / 1000000 ))

    status=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$status" = "200" ]; then
        record_result "Ping Endpoint" true "$latency" "OK"
        return 0
    else
        record_result "Ping Endpoint" false "$latency" "HTTP $status"
        return 1
    fi
}

test_simple_query() {
    local url="$1"
    local start end latency response status

    log_info "Testing simple arithmetic query..."

    local query="SELECT%201%2B1%20AS%20result"
    start=$(date +%s%N)
    response=$(curl -s -w "\n%{http_code}" "${url}/?query=${query}&default_format=JSON" 2>/dev/null)
    end=$(date +%s%N)
    latency=$(( (end - start) / 1000000 ))

    status=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$status" = "200" ]; then
        # Verify result
        if echo "$body" | jq -e '.data[0].result == 2' &>/dev/null; then
            record_result "Simple Query" true "$latency" "1+1=2"
            return 0
        else
            record_result "Simple Query" false "$latency" "Wrong result"
            return 1
        fi
    else
        record_result "Simple Query" false "$latency" "HTTP $status"
        return 1
    fi
}

test_string_functions() {
    local url="$1"
    local start end latency response status

    log_info "Testing string functions..."

    local query="SELECT%20upper('hello')%20AS%20upper_str"
    start=$(date +%s%N)
    response=$(curl -s -w "\n%{http_code}" "${url}/?query=${query}&default_format=JSON" 2>/dev/null)
    end=$(date +%s%N)
    latency=$(( (end - start) / 1000000 ))

    status=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$status" = "200" ]; then
        if echo "$body" | jq -e '.data[0].upper_str == "HELLO"' &>/dev/null; then
            record_result "String Functions" true "$latency" "upper('hello')=HELLO"
            return 0
        else
            record_result "String Functions" false "$latency" "Wrong result"
            return 1
        fi
    else
        record_result "String Functions" false "$latency" "HTTP $status"
        return 1
    fi
}

test_system_functions() {
    local url="$1"
    local start end latency response status

    log_info "Testing system functions..."

    local query="SELECT%20version()%20AS%20v"
    start=$(date +%s%N)
    response=$(curl -s -w "\n%{http_code}" "${url}/?query=${query}&default_format=JSON" 2>/dev/null)
    end=$(date +%s%N)
    latency=$(( (end - start) / 1000000 ))

    status=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$status" = "200" ]; then
        local version
        version=$(echo "$body" | jq -r '.data[0].v // empty')
        if [ -n "$version" ]; then
            record_result "System Functions" true "$latency" "version()=$version"
            return 0
        else
            record_result "System Functions" false "$latency" "No version returned"
            return 1
        fi
    else
        record_result "System Functions" false "$latency" "HTTP $status"
        return 1
    fi
}

test_json_format() {
    local url="$1"
    local start end latency response status

    log_info "Testing JSON response format..."

    local query="SELECT%2042%20AS%20num%2C%20'test'%20AS%20str"
    start=$(date +%s%N)
    response=$(curl -s -w "\n%{http_code}" "${url}/?query=${query}&default_format=JSON" 2>/dev/null)
    end=$(date +%s%N)
    latency=$(( (end - start) / 1000000 ))

    status=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$status" = "200" ]; then
        # Verify JSON structure
        if echo "$body" | jq -e '.meta and .data and .rows' &>/dev/null; then
            local meta_count
            meta_count=$(echo "$body" | jq '.meta | length')
            record_result "JSON Format" true "$latency" "Valid structure with $meta_count columns"
            return 0
        else
            record_result "JSON Format" false "$latency" "Invalid JSON structure"
            return 1
        fi
    else
        record_result "JSON Format" false "$latency" "HTTP $status"
        return 1
    fi
}

test_cors_headers() {
    local url="$1"
    local start end latency response cors_origin

    log_info "Testing CORS headers..."

    start=$(date +%s%N)
    response=$(curl -s -I -X OPTIONS "${url}/ping" 2>/dev/null)
    end=$(date +%s%N)
    latency=$(( (end - start) / 1000000 ))

    cors_origin=$(echo "$response" | grep -i "access-control-allow-origin" | head -1)

    if [ -n "$cors_origin" ]; then
        record_result "CORS Headers" true "$latency" "Headers present"
        return 0
    else
        record_result "CORS Headers" false "$latency" "Missing CORS headers"
        return 1
    fi
}

test_error_handling() {
    local url="$1"
    local start end latency response status

    log_info "Testing error handling..."

    local query="INVALID%20SQL%20SYNTAX"
    start=$(date +%s%N)
    response=$(curl -s -w "\n%{http_code}" "${url}/?query=${query}&default_format=JSON" 2>/dev/null)
    end=$(date +%s%N)
    latency=$(( (end - start) / 1000000 ))

    status=$(echo "$response" | tail -n1)

    # Should return an error status (not 200)
    if [ "$status" != "200" ]; then
        record_result "Error Handling" true "$latency" "Returns HTTP $status for invalid SQL"
        return 0
    else
        record_result "Error Handling" false "$latency" "Should return error for invalid SQL"
        return 1
    fi
}

test_post_method() {
    local url="$1"
    local start end latency response status

    log_info "Testing POST method..."

    start=$(date +%s%N)
    response=$(curl -s -w "\n%{http_code}" -X POST -d "SELECT 123 AS num" "${url}/?default_format=JSON" 2>/dev/null)
    end=$(date +%s%N)
    latency=$(( (end - start) / 1000000 ))

    status=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$status" = "200" ]; then
        if echo "$body" | jq -e '.data[0].num == 123' &>/dev/null; then
            record_result "POST Method" true "$latency" "POST body query works"
            return 0
        else
            record_result "POST Method" false "$latency" "Wrong result from POST"
            return 1
        fi
    else
        record_result "POST Method" false "$latency" "HTTP $status"
        return 1
    fi
}

test_status_endpoint() {
    local url="$1"
    local start end latency response status

    log_info "Testing /status endpoint..."

    start=$(date +%s%N)
    response=$(curl -s -w "\n%{http_code}" "${url}/status" 2>/dev/null)
    end=$(date +%s%N)
    latency=$(( (end - start) / 1000000 ))

    status=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$status" = "200" ]; then
        local service
        service=$(echo "$body" | jq -r '.service // empty')
        if [ -n "$service" ]; then
            record_result "Status Endpoint" true "$latency" "service=$service"
            return 0
        else
            record_result "Status Endpoint" false "$latency" "Missing service field"
            return 1
        fi
    else
        record_result "Status Endpoint" false "$latency" "HTTP $status"
        return 1
    fi
}

# ============================================================================
# Main Test Runner
# ============================================================================

run_tests() {
    local url="$1"
    local config_name="$2"

    log_section "Running Smoke Tests for $config_name"
    log_info "URL: $url"
    echo ""

    # Reset counters
    TESTS_PASSED=0
    TESTS_FAILED=0
    TEST_RESULTS=()

    # Run all tests
    test_ping "$url"
    test_simple_query "$url"
    test_string_functions "$url"
    test_system_functions "$url"
    test_json_format "$url"
    test_cors_headers "$url"
    test_error_handling "$url"
    test_post_method "$url"
    test_status_endpoint "$url"

    # Print summary
    echo ""
    log_info "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"

    return $TESTS_FAILED
}

output_json() {
    local url="$1"
    local config="$2"
    local env="$3"

    local results_json
    results_json=$(IFS=,; echo "[${TEST_RESULTS[*]}]")

    cat << EOF
{
  "url": "$url",
  "config": "$config",
  "environment": "$env",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "summary": {
    "total": $((TESTS_PASSED + TESTS_FAILED)),
    "passed": $TESTS_PASSED,
    "failed": $TESTS_FAILED
  },
  "results": $results_json
}
EOF
}

# ============================================================================
# Parse Arguments
# ============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --config|-c)
            CONFIG="$2"
            shift 2
            ;;
        --env|-e)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        --help|-h)
            show_help
            ;;
        http*)
            URL="$1"
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# ============================================================================
# Main
# ============================================================================

if [ "$JSON_OUTPUT" = false ]; then
    echo ""
    echo -e "${BOLD}================================================================${NC}"
    echo -e "${BOLD}  chDB WASM Smoke Tests${NC}"
    echo -e "${BOLD}================================================================${NC}"
fi

# Check for required tools
if ! command -v jq &> /dev/null; then
    log_error "jq is required but not installed. Install with: brew install jq"
    exit 1
fi

total_failed=0

if [ -n "$URL" ]; then
    # Direct URL mode
    run_tests "$URL" "Direct URL"
    total_failed=$?
elif [ -n "$CONFIG" ]; then
    if [ "$CONFIG" = "all" ]; then
        # Test all configurations
        for cfg in "chdb-wasm" "chdb-fetch" "chdb-lake"; do
            url=$(get_url "$cfg" "$ENVIRONMENT")
            if [ -n "$url" ]; then
                run_tests "$url" "$cfg"
                total_failed=$((total_failed + $?))
            fi
        done
    else
        # Single configuration
        url=$(get_url "$CONFIG" "$ENVIRONMENT")
        if [ -z "$url" ]; then
            log_error "Unknown configuration: $CONFIG"
            exit 1
        fi
        run_tests "$url" "$CONFIG"
        total_failed=$?

        if [ "$JSON_OUTPUT" = true ]; then
            output_json "$url" "$CONFIG" "$ENVIRONMENT"
        fi
    fi
else
    log_error "No URL or configuration specified"
    echo "Use --help for usage information"
    exit 1
fi

# Final summary
if [ "$JSON_OUTPUT" = false ]; then
    echo ""
    echo -e "${BOLD}================================================================${NC}"
    if [ $total_failed -eq 0 ]; then
        echo -e "${GREEN}${BOLD}  ALL TESTS PASSED${NC}"
    else
        echo -e "${RED}${BOLD}  $total_failed TEST(S) FAILED${NC}"
    fi
    echo -e "${BOLD}================================================================${NC}"
    echo ""
fi

exit $total_failed
