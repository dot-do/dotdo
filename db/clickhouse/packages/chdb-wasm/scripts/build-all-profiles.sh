#!/bin/bash
# build-all-profiles.sh
# Build all chdb-wasm profiles in sequence
#
# This script builds all three main chdb-wasm profiles (core, minimal, standard)
# and reports the sizes of each build.
#
# Usage:
#   ./scripts/build-all-profiles.sh [OPTIONS]
#
# Options:
#   --clean         Clean build directories before building
#   --verbose       Enable verbose build output
#   --dry-run       Print commands without executing
#   --jobs N        Number of parallel build jobs (default: auto)
#   --no-opt        Skip wasm-opt post-processing
#   --help, -h      Show this help message
#
# Output directories:
#   build-core/dist/      Core profile (~1MB)
#   build-minimal/dist/   Minimal profile (~5-10MB)
#   build-standard/dist/  Standard profile (~15-25MB)
#
# Examples:
#   ./scripts/build-all-profiles.sh              # Build all profiles
#   ./scripts/build-all-profiles.sh --clean      # Clean build all profiles
#   ./scripts/build-all-profiles.sh --verbose    # Verbose output

set -e

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PUBLIC_WASM_DIR="${PROJECT_ROOT}/public/wasm"

# Profiles to build (space-separated for bash 3 compatibility)
PROFILES="core minimal standard"

# Default options
CLEAN_BUILD=false
VERBOSE=false
DRY_RUN=false
SKIP_WASM_OPT=false
JOBS=""

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

log_header() {
    echo ""
    echo -e "${MAGENTA}${BOLD}================================================================${NC}"
    echo -e "${MAGENTA}${BOLD}  $1${NC}"
    echo -e "${MAGENTA}${BOLD}================================================================${NC}"
    echo ""
}

# ============================================================================
# Helper Functions
# ============================================================================

show_help() {
    head -28 "$0" | tail -23
    exit 0
}

get_profile_desc() {
    case "$1" in
        core)     echo "Parser/Lexer only" ;;
        minimal)  echo "Memory engine + basic functions" ;;
        standard) echo "MergeTree + Parquet + Date/Time" ;;
        *)        echo "Unknown profile" ;;
    esac
}

get_profile_target() {
    case "$1" in
        core)     echo "~1MB" ;;
        minimal)  echo "~5-10MB" ;;
        standard) echo "~15-25MB" ;;
        *)        echo "N/A" ;;
    esac
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
        local kb=$((size / 1024))
        local kb_dec=$(( (size % 1024) * 10 / 1024 ))
        echo "${kb}.${kb_dec}KB"
    else
        local mb=$((size / 1048576))
        local mb_dec=$(( (size % 1048576) * 100 / 1048576 ))
        printf "%d.%02dMB" "$mb" "$mb_dec"
    fi
}

# ============================================================================
# Parse Arguments
# ============================================================================

while [ $# -gt 0 ]; do
    case $1 in
        --clean)
            CLEAN_BUILD=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --jobs)
            JOBS="$2"
            shift 2
            ;;
        --no-opt)
            SKIP_WASM_OPT=true
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

# ============================================================================
# Emscripten SDK Setup
# ============================================================================

find_emsdk() {
    if [ -n "${EMSDK}" ] && [ -d "${EMSDK}" ]; then
        echo "${EMSDK}"
        return 0
    fi

    local path
    for path in "${HOME}/emsdk" "/opt/emsdk" "/usr/local/emsdk" "${HOME}/.emsdk" "/emsdk"; do
        if [ -f "${path}/emsdk_env.sh" ]; then
            echo "${path}"
            return 0
        fi
    done

    return 1
}

setup_emsdk() {
    local emsdk_path

    log_info "Searching for Emscripten SDK..."

    if ! emsdk_path=$(find_emsdk); then
        log_error "Emscripten SDK not found!"
        echo ""
        echo "Please install Emscripten SDK:"
        echo "  git clone https://github.com/emscripten-core/emsdk.git"
        echo "  cd emsdk"
        echo "  ./emsdk install latest"
        echo "  ./emsdk activate latest"
        echo "  source ./emsdk_env.sh"
        exit 1
    fi

    log_info "Found Emscripten SDK at: ${emsdk_path}"

    # Source the environment
    log_info "Sourcing emsdk_env.sh..."
    # shellcheck source=/dev/null
    source "${emsdk_path}/emsdk_env.sh" 2>/dev/null || {
        log_error "Failed to source emsdk_env.sh"
        exit 1
    }

    if ! command -v emcc &> /dev/null; then
        log_error "emcc not found after sourcing emsdk_env.sh"
        exit 1
    fi

    local emcc_version
    emcc_version=$(emcc --version | head -n1)
    log_success "Emscripten ready: ${emcc_version}"

    export EMSDK="${emsdk_path}"
    export EMSCRIPTEN="${EMSDK}/upstream/emscripten"
}

# ============================================================================
# Main Script
# ============================================================================

log_header "chdb-wasm Multi-Profile Builder"

echo -e "  ${BOLD}Profiles to build:${NC}"
for profile in $PROFILES; do
    desc=$(get_profile_desc "$profile")
    target=$(get_profile_target "$profile")
    echo -e "    - ${CYAN}${profile}${NC}: ${desc} (${target})"
done
echo ""

# Setup Emscripten
log_section "Emscripten SDK Setup"
setup_emsdk

# Track build results (using files for bash 3 compatibility)
RESULTS_DIR=$(mktemp -d)
trap "rm -rf ${RESULTS_DIR}" EXIT

# Build each profile
for profile in $PROFILES; do
    log_header "Building Profile: ${profile}"

    BUILD_DIR="${PROJECT_ROOT}/build-${profile}"
    DIST_DIR="${BUILD_DIR}/dist"

    # Build arguments
    BUILD_ARGS="${profile}"

    if [ "$CLEAN_BUILD" = true ]; then
        BUILD_ARGS="${BUILD_ARGS} --clean"
    fi

    if [ "$VERBOSE" = true ]; then
        BUILD_ARGS="${BUILD_ARGS} --verbose"
    fi

    if [ "$DRY_RUN" = true ]; then
        BUILD_ARGS="${BUILD_ARGS} --dry-run"
    fi

    if [ "$SKIP_WASM_OPT" = true ]; then
        BUILD_ARGS="${BUILD_ARGS} --no-opt"
    fi

    if [ -n "$JOBS" ]; then
        BUILD_ARGS="${BUILD_ARGS} --jobs ${JOBS}"
    fi

    # Record start time
    START_TIME=$(date +%s)

    # Run the build
    # shellcheck disable=SC2086
    if "${SCRIPT_DIR}/build-profile.sh" ${BUILD_ARGS}; then
        echo "SUCCESS" > "${RESULTS_DIR}/${profile}_status"
    else
        echo "FAILED" > "${RESULTS_DIR}/${profile}_status"
        log_error "Build failed for profile: ${profile}"
        continue
    fi

    # Record build time
    END_TIME=$(date +%s)
    echo $((END_TIME - START_TIME)) > "${RESULTS_DIR}/${profile}_time"

    # Find WASM files and record sizes
    if [ "$DRY_RUN" = false ]; then
        # Look for wasm files in the dist directory first
        WASM_FILE=""
        if [ -d "${DIST_DIR}" ]; then
            WASM_FILE=$(find "${DIST_DIR}" -name "*.wasm" -type f 2>/dev/null | head -1)
        fi

        # Try looking in the build directory if not found
        if [ -z "$WASM_FILE" ] || [ ! -f "$WASM_FILE" ]; then
            WASM_FILE=$(find "${BUILD_DIR}" -name "*.wasm" -type f 2>/dev/null | head -1)
        fi

        if [ -n "$WASM_FILE" ] && [ -f "$WASM_FILE" ]; then
            SIZE=$(get_file_size "$WASM_FILE")
            echo "$SIZE" > "${RESULTS_DIR}/${profile}_size"
            echo "$WASM_FILE" > "${RESULTS_DIR}/${profile}_path"

            # Compress with gzip and get size
            GZIP_SIZE=$(gzip -c "$WASM_FILE" 2>/dev/null | wc -c | tr -d ' ')
            echo "$GZIP_SIZE" > "${RESULTS_DIR}/${profile}_gzip_size"
        fi
    fi
done

# ============================================================================
# Copy to public/wasm for deployment
# ============================================================================

if [ "$DRY_RUN" = false ]; then
    log_section "Copying builds to public/wasm/"

    mkdir -p "${PUBLIC_WASM_DIR}"

    for profile in $PROFILES; do
        STATUS=$(cat "${RESULTS_DIR}/${profile}_status" 2>/dev/null || echo "UNKNOWN")

        if [ "$STATUS" = "SUCCESS" ]; then
            DIST_DIR="${PROJECT_ROOT}/build-${profile}/dist"
            TARGET_DIR="${PUBLIC_WASM_DIR}/${profile}"

            if [ -d "${DIST_DIR}" ]; then
                mkdir -p "${TARGET_DIR}"

                # Copy all relevant files
                for ext in wasm js d.ts json; do
                    for file in "${DIST_DIR}"/*.${ext}; do
                        if [ -f "$file" ]; then
                            cp "$file" "${TARGET_DIR}/"
                            log_info "Copied $(basename "$file") to public/wasm/${profile}/"
                        fi
                    done
                done

                # Also create gzipped versions
                for wasm_file in "${TARGET_DIR}"/*.wasm; do
                    if [ -f "$wasm_file" ]; then
                        gzip -kf "$wasm_file"
                        log_info "Created $(basename "$wasm_file").gz"
                    fi
                done

                log_success "Deployed ${profile} profile to public/wasm/${profile}/"
            else
                log_warn "No dist directory found for ${profile}"
            fi
        fi
    done
fi

# ============================================================================
# Size Report
# ============================================================================

log_header "Build Size Report"

echo ""
printf "%-12s | %-10s | %-12s | %-12s | %-10s | %-8s\n" \
    "Profile" "Status" "Raw Size" "Gzipped" "Target" "Time"
printf "%-12s-+-%-10s-+-%-12s-+-%-12s-+-%-10s-+-%-8s\n" \
    "------------" "----------" "------------" "------------" "----------" "--------"

for profile in $PROFILES; do
    STATUS=$(cat "${RESULTS_DIR}/${profile}_status" 2>/dev/null || echo "SKIPPED")
    TARGET=$(get_profile_target "$profile")

    if [ "$STATUS" = "SUCCESS" ]; then
        RAW_SIZE=$(cat "${RESULTS_DIR}/${profile}_size" 2>/dev/null || echo "0")
        GZIP_SIZE=$(cat "${RESULTS_DIR}/${profile}_gzip_size" 2>/dev/null || echo "0")
        TIME=$(cat "${RESULTS_DIR}/${profile}_time" 2>/dev/null || echo "0")

        if [ "$RAW_SIZE" -gt 0 ] 2>/dev/null; then
            RAW_FMT=$(format_size "$RAW_SIZE")
            GZIP_FMT=$(format_size "$GZIP_SIZE")
        else
            RAW_FMT="N/A"
            GZIP_FMT="N/A"
        fi

        TIME_FMT="${TIME}s"

        printf "%-12s | ${GREEN}%-10s${NC} | %-12s | %-12s | %-10s | %-8s\n" \
            "$profile" "$STATUS" "$RAW_FMT" "$GZIP_FMT" "$TARGET" "$TIME_FMT"
    else
        printf "%-12s | ${RED}%-10s${NC} | %-12s | %-12s | %-10s | %-8s\n" \
            "$profile" "$STATUS" "-" "-" "$TARGET" "-"
    fi
done

echo ""

# Detailed size breakdown
if [ "$DRY_RUN" = false ]; then
    log_section "Detailed Size Information"

    for profile in $PROFILES; do
        STATUS=$(cat "${RESULTS_DIR}/${profile}_status" 2>/dev/null || echo "UNKNOWN")

        if [ "$STATUS" = "SUCCESS" ]; then
            echo -e "${BOLD}${profile}${NC}:"

            RAW_SIZE=$(cat "${RESULTS_DIR}/${profile}_size" 2>/dev/null || echo "0")
            GZIP_SIZE=$(cat "${RESULTS_DIR}/${profile}_gzip_size" 2>/dev/null || echo "0")
            WASM_PATH=$(cat "${RESULTS_DIR}/${profile}_path" 2>/dev/null || echo "")

            if [ "$RAW_SIZE" -gt 0 ] 2>/dev/null; then
                RAW_FMT=$(format_size "$RAW_SIZE")
                GZIP_FMT=$(format_size "$GZIP_SIZE")

                if [ "$GZIP_SIZE" -gt 0 ] 2>/dev/null; then
                    RATIO=$((GZIP_SIZE * 100 / RAW_SIZE))
                    echo "  Raw:        $RAW_FMT ($RAW_SIZE bytes)"
                    echo "  Gzipped:    $GZIP_FMT ($GZIP_SIZE bytes) - ${RATIO}% of raw"
                fi

                # Show file location
                if [ -n "$WASM_PATH" ]; then
                    echo "  Location:   ${WASM_PATH}"
                fi
            else
                echo "  Size info not available"
            fi
            echo ""
        fi
    done
fi

# ============================================================================
# Summary
# ============================================================================

log_header "Build Summary"

TOTAL_SUCCESS=0
TOTAL_FAILED=0

for profile in $PROFILES; do
    STATUS=$(cat "${RESULTS_DIR}/${profile}_status" 2>/dev/null || echo "UNKNOWN")
    if [ "$STATUS" = "SUCCESS" ]; then
        TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
    else
        TOTAL_FAILED=$((TOTAL_FAILED + 1))
    fi
done

echo -e "  ${GREEN}Successful:${NC}  ${TOTAL_SUCCESS}"
echo -e "  ${RED}Failed:${NC}      ${TOTAL_FAILED}"
echo ""

if [ "$TOTAL_SUCCESS" -gt 0 ]; then
    echo -e "  ${BOLD}Output locations:${NC}"
    for profile in $PROFILES; do
        STATUS=$(cat "${RESULTS_DIR}/${profile}_status" 2>/dev/null || echo "UNKNOWN")
        if [ "$STATUS" = "SUCCESS" ]; then
            echo "    build-${profile}/dist/"
        fi
    done
    echo ""
    echo -e "  ${BOLD}Deployment location:${NC}"
    echo "    public/wasm/"
fi

echo ""

if [ "$TOTAL_FAILED" -gt 0 ]; then
    log_warn "Some builds failed. Check the output above for details."
    exit 1
else
    log_success "All profiles built successfully!"
fi
