#!/bin/bash
# upload-wasm.sh
# Upload WASM files to R2 bucket
#
# This script uploads the compiled WASM files to the appropriate R2 bucket
# for the target environment.
#
# Usage:
#   ./scripts/upload-wasm.sh [options]
#
# Options:
#   --env, -e <env>       Environment: staging, production (default: staging)
#   --bucket, -b <name>   Override bucket name
#   --file, -f <path>     Specific WASM file to upload
#   --profile <name>      WASM profile: minimal, standard, full
#   --dry-run             Print commands without executing
#   --verbose             Enable verbose output
#   --help, -h            Show this help message
#
# Examples:
#   ./scripts/upload-wasm.sh --env staging
#   ./scripts/upload-wasm.sh --env production --profile full
#   ./scripts/upload-wasm.sh --file ./dist/clickhouse.wasm --bucket chdb-wasm

set -e

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default options
ENVIRONMENT="staging"
BUCKET_NAME=""
WASM_FILE=""
PROFILE=""
DRY_RUN=false
VERBOSE=false

# Bucket names by environment
STAGING_BUCKET="chdb-wasm-staging"
PRODUCTION_BUCKET="chdb-wasm"

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
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_section() {
    echo ""
    echo -e "${CYAN}${BOLD}=== $1 ===${NC}"
    echo ""
}

# ============================================================================
# Helper Functions
# ============================================================================

show_help() {
    head -28 "$0" | tail -24
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

get_file_size() {
    local file="$1"
    if [ -f "$file" ]; then
        if stat --version &>/dev/null 2>&1; then
            stat -c%s "$file" 2>/dev/null || echo 0
        else
            stat -f%z "$file" 2>/dev/null || echo 0
        fi
    else
        echo 0
    fi
}

format_size() {
    local size="$1"
    if [ "$size" -lt 1024 ]; then
        echo "${size}B"
    elif [ "$size" -lt 1048576 ]; then
        echo "$(( size / 1024 ))KB"
    else
        echo "$(( size / 1048576 ))MB"
    fi
}

# ============================================================================
# Parse Arguments
# ============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --env|-e)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --bucket|-b)
            BUCKET_NAME="$2"
            shift 2
            ;;
        --file|-f)
            WASM_FILE="$2"
            shift 2
            ;;
        --profile)
            PROFILE="$2"
            shift 2
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
            exit 1
            ;;
    esac
done

# ============================================================================
# Setup
# ============================================================================

echo ""
echo -e "${BOLD}================================================================${NC}"
echo -e "${BOLD}  Upload WASM to R2${NC}"
echo -e "${BOLD}================================================================${NC}"

# Determine bucket name
if [ -z "$BUCKET_NAME" ]; then
    if [ "$ENVIRONMENT" = "production" ]; then
        BUCKET_NAME="$PRODUCTION_BUCKET"
    else
        BUCKET_NAME="$STAGING_BUCKET"
    fi
fi

log_info "Environment: $ENVIRONMENT"
log_info "Bucket: $BUCKET_NAME"

# Check for wrangler
if ! command -v wrangler &> /dev/null; then
    log_error "wrangler not found. Install with: npm install -g wrangler"
    exit 1
fi

# ============================================================================
# Find WASM Files
# ============================================================================

log_section "Finding WASM Files"

WASM_FILES=()

if [ -n "$WASM_FILE" ]; then
    # Specific file provided
    if [ -f "$WASM_FILE" ]; then
        WASM_FILES+=("$WASM_FILE")
    else
        log_error "File not found: $WASM_FILE"
        exit 1
    fi
else
    # Find WASM files in dist or build directories
    if [ -n "$PROFILE" ]; then
        # Look for profile-specific builds
        for dir in "${PROJECT_ROOT}/dist/${PROFILE}" "${PROJECT_ROOT}/build-wasm" "${PROJECT_ROOT}/build-${PROFILE}"; do
            if [ -d "$dir" ]; then
                while IFS= read -r -d '' file; do
                    WASM_FILES+=("$file")
                done < <(find "$dir" -name "*.wasm" -type f -print0 2>/dev/null)
            fi
        done
    else
        # Look in common locations
        for dir in "${PROJECT_ROOT}/dist" "${PROJECT_ROOT}/build-wasm" "${PROJECT_ROOT}/wasm"; do
            if [ -d "$dir" ]; then
                while IFS= read -r -d '' file; do
                    WASM_FILES+=("$file")
                done < <(find "$dir" -name "*.wasm" -type f -print0 2>/dev/null)
            fi
        done
    fi

    # Also check for clickhouse.wasm in project root
    if [ -f "${PROJECT_ROOT}/clickhouse.wasm" ]; then
        WASM_FILES+=("${PROJECT_ROOT}/clickhouse.wasm")
    fi
fi

if [ ${#WASM_FILES[@]} -eq 0 ]; then
    log_warn "No WASM files found"
    echo ""
    echo "Please build WASM first:"
    echo "  ./scripts/build-wasm.sh"
    echo ""
    echo "Or specify a file:"
    echo "  ./scripts/upload-wasm.sh --file path/to/file.wasm"
    exit 1
fi

log_info "Found ${#WASM_FILES[@]} WASM file(s):"
for file in "${WASM_FILES[@]}"; do
    local size
    size=$(get_file_size "$file")
    echo "  - $(basename "$file") ($(format_size $size))"
done

# ============================================================================
# Upload Files
# ============================================================================

log_section "Uploading to R2"

uploaded=0
failed=0

for file in "${WASM_FILES[@]}"; do
    local filename
    filename=$(basename "$file")
    local size
    size=$(get_file_size "$file")

    log_info "Uploading $filename ($(format_size $size))..."

    # Determine the object name
    # For the main WASM file, use 'clickhouse.wasm'
    local object_name="$filename"
    if [[ "$filename" == chdb-*.wasm ]] || [[ "$filename" == clickhouse*.wasm ]]; then
        object_name="clickhouse.wasm"
    fi

    # Upload using wrangler r2 object put
    if run_cmd wrangler r2 object put "${BUCKET_NAME}/${object_name}" --file "$file" --content-type "application/wasm"; then
        log_success "Uploaded $filename as $object_name"
        ((uploaded++))
    else
        log_error "Failed to upload $filename"
        ((failed++))
    fi
done

# ============================================================================
# Verify Upload
# ============================================================================

if [ "$DRY_RUN" = false ] && [ $uploaded -gt 0 ]; then
    log_section "Verifying Upload"

    log_info "Listing objects in bucket..."
    if wrangler r2 object list "$BUCKET_NAME" 2>/dev/null | head -20; then
        log_success "Upload verification complete"
    else
        log_warn "Could not verify upload (listing may require additional permissions)"
    fi
fi

# ============================================================================
# Summary
# ============================================================================

log_section "Upload Summary"

echo -e "${BOLD}Environment:${NC} $ENVIRONMENT"
echo -e "${BOLD}Bucket:${NC}      $BUCKET_NAME"
echo -e "${BOLD}Uploaded:${NC}    $uploaded file(s)"
if [ $failed -gt 0 ]; then
    echo -e "${BOLD}${RED}Failed:${NC}      $failed file(s)"
fi
echo ""

if [ $failed -eq 0 ]; then
    echo -e "${BOLD}================================================================${NC}"
    echo -e "${GREEN}${BOLD}  UPLOAD COMPLETE${NC}"
    echo -e "${BOLD}================================================================${NC}"
else
    echo -e "${BOLD}================================================================${NC}"
    echo -e "${RED}${BOLD}  UPLOAD FAILED ($failed errors)${NC}"
    echo -e "${BOLD}================================================================${NC}"
    exit 1
fi

echo ""
log_info "To deploy the worker, run:"
echo "  ./scripts/deploy.sh all --env $ENVIRONMENT"
echo ""
