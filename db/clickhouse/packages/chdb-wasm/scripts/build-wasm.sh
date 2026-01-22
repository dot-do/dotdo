#!/bin/bash
# build-wasm.sh
# Complete build script for chdb-wasm with comprehensive WASM configuration
#
# This script:
# - Sources the Emscripten SDK environment
# - Configures CMake with the WASM build preset
# - Builds the chdb library for WebAssembly
#
# Usage:
#   ./scripts/build-wasm.sh [OPTIONS]
#
# Options:
#   --clean         Clean build directory before building
#   --release       Build in Release mode (default)
#   --debug         Build in Debug mode
#   --verbose       Enable verbose build output
#   --dry-run       Print commands without executing
#   --jobs N        Number of parallel build jobs (default: auto)
#   --profile NAME  Build profile: minimal, standard, full (default: minimal)
#   --no-opt        Skip wasm-opt post-processing
#   --check-emsdk   Only check Emscripten SDK installation
#   --help, -h      Show this help message
#
# Environment Variables:
#   EMSDK           Path to Emscripten SDK
#   BUILD_TYPE      CMake build type (Release, Debug)
#   CHDB_WASM_PROFILE  Build profile (minimal, standard, full)
#   JOBS            Number of parallel build jobs
#
# Examples:
#   ./scripts/build-wasm.sh                      # Build with defaults
#   ./scripts/build-wasm.sh --profile minimal    # Build minimal profile
#   ./scripts/build-wasm.sh --clean --release    # Clean release build
#   ./scripts/build-wasm.sh --debug --verbose    # Debug build with verbose output

set -e

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CMAKE_DIR="${PROJECT_ROOT}/cmake"
BUILD_DIR="${PROJECT_ROOT}/build-wasm"
DIST_DIR="${PROJECT_ROOT}/dist"

# Default options
BUILD_TYPE="${BUILD_TYPE:-Release}"
PROFILE="${CHDB_WASM_PROFILE:-minimal}"
CLEAN_BUILD=false
VERBOSE=false
DRY_RUN=false
SKIP_WASM_OPT=false
CHECK_EMSDK_ONLY=false
JOBS="${JOBS:-}"

# ============================================================================
# Color Output
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
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

# ============================================================================
# Helper Functions
# ============================================================================

show_help() {
    head -38 "$0" | tail -33
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

get_cpu_count() {
    if [ -n "$JOBS" ]; then
        echo "$JOBS"
    elif command -v nproc &> /dev/null; then
        nproc
    elif command -v sysctl &> /dev/null; then
        sysctl -n hw.ncpu 2>/dev/null || echo 4
    else
        echo 4
    fi
}

get_file_size() {
    local file="$1"
    if [ -f "$file" ]; then
        if stat --version &>/dev/null 2>&1; then
            # GNU stat
            stat -c%s "$file" 2>/dev/null || echo 0
        else
            # BSD stat (macOS)
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
        --clean)
            CLEAN_BUILD=true
            shift
            ;;
        --release)
            BUILD_TYPE="Release"
            shift
            ;;
        --debug)
            BUILD_TYPE="Debug"
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
        --profile)
            PROFILE="$2"
            shift 2
            ;;
        --no-opt)
            SKIP_WASM_OPT=true
            shift
            ;;
        --check-emsdk)
            CHECK_EMSDK_ONLY=true
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

# Validate profile
case $PROFILE in
    minimal|standard|full)
        ;;
    *)
        log_error "Invalid profile: $PROFILE"
        echo "Valid profiles: minimal, standard, full"
        exit 1
        ;;
esac

# ============================================================================
# Header
# ============================================================================

echo ""
echo -e "${BOLD}================================================================${NC}"
echo -e "${BOLD}  chdb-wasm Build Script${NC}"
echo -e "${BOLD}================================================================${NC}"
echo ""
log_info "Project Root: ${PROJECT_ROOT}"
log_info "Build Directory: ${BUILD_DIR}"
log_info "Build Type: ${BUILD_TYPE}"
log_info "Profile: ${PROFILE}"
log_info "CPU Jobs: $(get_cpu_count)"
echo ""

# ============================================================================
# Emscripten SDK Setup
# ============================================================================

log_section "Emscripten SDK Setup"

find_emsdk() {
    # Check environment variable first
    if [ -n "${EMSDK}" ] && [ -d "${EMSDK}" ]; then
        echo "${EMSDK}"
        return 0
    fi

    # Common installation locations
    local EMSDK_PATHS=(
        "${HOME}/emsdk"
        "/opt/emsdk"
        "/usr/local/emsdk"
        "${HOME}/.emsdk"
        "/emsdk"
    )

    for path in "${EMSDK_PATHS[@]}"; do
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
        echo ""
        echo "Or set the EMSDK environment variable to your installation path."
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

    # Verify emcc is available
    if ! command -v emcc &> /dev/null; then
        log_error "emcc not found after sourcing emsdk_env.sh"
        exit 1
    fi

    # Get and display version
    local emcc_version
    emcc_version=$(emcc --version | head -n1)
    log_success "Emscripten ready: ${emcc_version}"

    # Export for child processes
    export EMSDK="${emsdk_path}"
    export EMSCRIPTEN="${EMSDK}/upstream/emscripten"
}

setup_emsdk

# Check-only mode
if [ "$CHECK_EMSDK_ONLY" = true ]; then
    echo ""
    log_success "Emscripten SDK is properly configured!"
    echo ""
    emcc --version
    em++ --version
    exit 0
fi

# ============================================================================
# Clean Build Directory
# ============================================================================

if [ "$CLEAN_BUILD" = true ]; then
    log_section "Cleaning Build Directory"

    if [ -d "${BUILD_DIR}" ]; then
        log_info "Removing ${BUILD_DIR}..."
        run_cmd rm -rf "${BUILD_DIR}"
    fi

    log_success "Clean complete"
fi

# ============================================================================
# Create Build Directory
# ============================================================================

log_section "Preparing Build Directory"

run_cmd mkdir -p "${BUILD_DIR}"
log_info "Build directory ready: ${BUILD_DIR}"

# ============================================================================
# Configure CMake
# ============================================================================

log_section "CMake Configuration"

# Toolchain file path
TOOLCHAIN_FILE="${EMSDK}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake"

if [ ! -f "${TOOLCHAIN_FILE}" ]; then
    log_error "Emscripten CMake toolchain not found at: ${TOOLCHAIN_FILE}"
    exit 1
fi

log_info "Using toolchain: ${TOOLCHAIN_FILE}"

# Build CMake arguments
CMAKE_ARGS=(
    # Use WASM build preset
    "-C" "${CMAKE_DIR}/wasm-build.cmake"

    # Toolchain
    "-DCMAKE_TOOLCHAIN_FILE=${TOOLCHAIN_FILE}"

    # Build configuration
    "-DCMAKE_BUILD_TYPE=${BUILD_TYPE}"

    # Profile selection
    "-DCHDB_WASM_PROFILE=${PROFILE}"

    # Source and build directories
    "-S" "${PROJECT_ROOT}"
    "-B" "${BUILD_DIR}"
)

# Add verbose flag if requested
if [ "$VERBOSE" = true ]; then
    CMAKE_ARGS+=("-DCMAKE_VERBOSE_MAKEFILE=ON")
fi

# Display configuration
log_info "CMake configuration:"
for arg in "${CMAKE_ARGS[@]}"; do
    echo "    ${arg}"
done
echo ""

# Run CMake configure
log_info "Running CMake configure..."
run_cmd cmake "${CMAKE_ARGS[@]}"

if [ "$DRY_RUN" = false ]; then
    log_success "CMake configuration complete"
fi

# ============================================================================
# Build
# ============================================================================

log_section "Building chdb-wasm"

CPU_COUNT=$(get_cpu_count)
log_info "Building with ${CPU_COUNT} parallel jobs..."

BUILD_ARGS=(
    "--build" "${BUILD_DIR}"
    "--parallel" "${CPU_COUNT}"
)

if [ "$VERBOSE" = true ]; then
    BUILD_ARGS+=("--verbose")
fi

run_cmd cmake "${BUILD_ARGS[@]}"

if [ "$DRY_RUN" = false ]; then
    log_success "Build complete"
fi

# ============================================================================
# Post-Build Optimization (wasm-opt)
# ============================================================================

if [ "$SKIP_WASM_OPT" = false ] && [ "$DRY_RUN" = false ]; then
    log_section "WASM Optimization"

    # Find wasm-opt
    WASM_OPT=""
    if command -v wasm-opt &> /dev/null; then
        WASM_OPT="wasm-opt"
    elif [ -f "${EMSDK}/upstream/bin/wasm-opt" ]; then
        WASM_OPT="${EMSDK}/upstream/bin/wasm-opt"
    fi

    if [ -n "$WASM_OPT" ]; then
        log_info "Using wasm-opt: ${WASM_OPT}"

        # Find WASM files
        WASM_FILES=$(find "${BUILD_DIR}" -name "*.wasm" -type f 2>/dev/null || true)

        for wasm_file in $WASM_FILES; do
            if [ -f "$wasm_file" ]; then
                log_info "Optimizing: $(basename "$wasm_file")"

                # Get original size
                ORIG_SIZE=$(get_file_size "$wasm_file")

                # Run wasm-opt with size optimizations
                "$WASM_OPT" \
                    -Oz \
                    --enable-simd \
                    --enable-bulk-memory \
                    --enable-sign-ext \
                    --enable-nontrapping-float-to-int \
                    --converge \
                    --strip-debug \
                    --strip-dwarf \
                    --strip-producers \
                    --vacuum \
                    --duplicate-function-elimination \
                    --duplicate-import-elimination \
                    --remove-unused-module-elements \
                    --remove-unused-names \
                    --merge-similar-functions \
                    "$wasm_file" \
                    -o "${wasm_file}.opt" 2>/dev/null || {
                        log_warn "wasm-opt optimization failed for $(basename "$wasm_file")"
                        continue
                    }

                # Replace original with optimized
                mv "${wasm_file}.opt" "$wasm_file"

                # Get new size
                NEW_SIZE=$(get_file_size "$wasm_file")

                if [ "$ORIG_SIZE" -gt 0 ]; then
                    SAVED=$((ORIG_SIZE - NEW_SIZE))
                    PERCENT=$((SAVED * 100 / ORIG_SIZE))
                    log_success "  Size reduced by $(format_size $SAVED) (${PERCENT}%)"
                fi
            fi
        done
    else
        log_warn "wasm-opt not found, skipping additional optimization"
        log_info "Install wasm-opt for smaller binaries: https://github.com/WebAssembly/binaryen"
    fi
fi

# ============================================================================
# Copy to Distribution Directory
# ============================================================================

if [ "$DRY_RUN" = false ]; then
    log_section "Distribution Files"

    DIST_PROFILE_DIR="${DIST_DIR}/${PROFILE}"
    run_cmd mkdir -p "${DIST_PROFILE_DIR}"

    # Find and copy output files
    JS_FILES=$(find "${BUILD_DIR}" -maxdepth 2 -name "*.js" -type f 2>/dev/null || true)
    WASM_FILES=$(find "${BUILD_DIR}" -maxdepth 2 -name "*.wasm" -type f 2>/dev/null || true)

    for file in $JS_FILES $WASM_FILES; do
        if [ -f "$file" ]; then
            cp "$file" "${DIST_PROFILE_DIR}/"
            log_info "Copied: $(basename "$file")"
        fi
    done

    # Create package.json for the profile
    cat > "${DIST_PROFILE_DIR}/package.json" << EOF
{
  "name": "@chdb/wasm-${PROFILE}",
  "version": "1.0.0",
  "description": "chdb WebAssembly build (${PROFILE} profile)",
  "main": "chdb-${PROFILE}.js",
  "types": "chdb-${PROFILE}.d.ts",
  "exports": {
    ".": {
      "import": "./chdb-${PROFILE}.js",
      "types": "./chdb-${PROFILE}.d.ts"
    }
  },
  "files": [
    "chdb-${PROFILE}.js",
    "chdb-${PROFILE}.wasm",
    "chdb-${PROFILE}.d.ts"
  ],
  "keywords": ["clickhouse", "wasm", "sql", "database"],
  "license": "Apache-2.0"
}
EOF

    log_info "Created package.json"
fi

# ============================================================================
# Report Results
# ============================================================================

if [ "$DRY_RUN" = false ]; then
    log_section "Build Results"

    log_info "Output directory: ${DIST_PROFILE_DIR}"
    echo ""

    if [ -d "${DIST_PROFILE_DIR}" ]; then
        for file in "${DIST_PROFILE_DIR}"/*.wasm "${DIST_PROFILE_DIR}"/*.js; do
            if [ -f "$file" ]; then
                SIZE=$(get_file_size "$file")
                GZIP_SIZE=$(gzip -c "$file" 2>/dev/null | wc -c)
                echo "  $(basename "$file"):"
                echo "    Raw:     $(format_size $SIZE)"
                echo "    Gzipped: $(format_size $GZIP_SIZE)"
            fi
        done
    fi
fi

# ============================================================================
# Summary
# ============================================================================

echo ""
echo -e "${BOLD}================================================================${NC}"
if [ "$DRY_RUN" = true ]; then
    log_warn "DRY RUN COMPLETE (no commands were executed)"
else
    log_success "BUILD COMPLETE"
fi
echo -e "${BOLD}================================================================${NC}"
echo ""
log_info "Profile:     ${PROFILE}"
log_info "Build Type:  ${BUILD_TYPE}"
log_info "Output:      ${DIST_PROFILE_DIR}"
echo ""

if [ "$DRY_RUN" = false ]; then
    log_info "To analyze build size in detail:"
    echo "  ./scripts/analyze-size.sh ${BUILD_DIR}"
    echo ""
    log_info "To test the WASM build:"
    echo "  node --experimental-wasm-modules test/test-wasm.mjs"
    echo ""
fi
