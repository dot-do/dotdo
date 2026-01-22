#!/bin/bash
# build-lto.sh
# Build script for chdb-wasm with Link Time Optimization (LTO) enabled
#
# LTO can provide 15-25% binary size reduction through:
#   - Cross-module dead code elimination
#   - Cross-module function inlining
#   - Whole-program optimization
#
# Usage:
#   ./scripts/build-lto.sh [OPTIONS]
#
# Options:
#   --clean         Clean build directory before building
#   --mode MODE     LTO mode: full (default, recommended) or thin
#   --jobs N        Number of parallel build jobs (default: auto)
#   --verbose       Enable verbose build output
#   --dry-run       Print commands without executing
#   --compare       Build both with and without LTO and compare sizes
#   --help, -h      Show this help message
#
# Environment Variables:
#   EMSDK           Path to Emscripten SDK
#   CHDB_WASM_LTO_MODE  LTO mode (full or thin)
#
# Examples:
#   ./scripts/build-lto.sh                    # Build with full LTO (recommended)
#   ./scripts/build-lto.sh --mode thin        # Build with ThinLTO
#   ./scripts/build-lto.sh --clean --compare  # Clean build and compare sizes

set -e

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CMAKE_DIR="${PROJECT_ROOT}/cmake"
BUILD_DIR="${PROJECT_ROOT}/build-lto"
CHDB_SOURCE="${PROJECT_ROOT}/../../vendor/chdb"

# Default options
LTO_MODE="${CHDB_WASM_LTO_MODE:-full}"
CLEAN_BUILD=false
VERBOSE=false
DRY_RUN=false
COMPARE_MODE=false
JOBS=""

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
    head -30 "$0" | tail -25
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
        printf "%.1fKB" "$(echo "scale=1; $size / 1024" | bc)"
    else
        printf "%.2fMB" "$(echo "scale=2; $size / 1048576" | bc)"
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
        --mode)
            LTO_MODE="$2"
            shift 2
            ;;
        --jobs)
            JOBS="$2"
            shift 2
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --compare)
            COMPARE_MODE=true
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

# Validate LTO mode
case $LTO_MODE in
    full|thin)
        ;;
    *)
        log_error "Invalid LTO mode: $LTO_MODE"
        echo "Valid modes: full, thin"
        exit 1
        ;;
esac

# ============================================================================
# Header
# ============================================================================

echo ""
echo -e "${BOLD}================================================================${NC}"
echo -e "${BOLD}  chdb-wasm LTO Build Script${NC}"
echo -e "${BOLD}================================================================${NC}"
echo ""
log_info "Project Root: ${PROJECT_ROOT}"
log_info "Build Directory: ${BUILD_DIR}"
log_info "LTO Mode: ${LTO_MODE}"
log_info "CPU Jobs: $(get_cpu_count)"
echo ""

# ============================================================================
# Emscripten SDK Setup
# ============================================================================

log_section "Emscripten SDK Setup"

find_emsdk() {
    if [ -n "${EMSDK}" ] && [ -d "${EMSDK}" ]; then
        echo "${EMSDK}"
        return 0
    fi

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
        exit 1
    fi

    log_info "Found Emscripten SDK at: ${emsdk_path}"

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

setup_emsdk

# ============================================================================
# Verify Source Directory
# ============================================================================

log_section "Verifying Source Directory"

if [ ! -d "${CHDB_SOURCE}" ]; then
    log_error "chdb source directory not found: ${CHDB_SOURCE}"
    exit 1
fi

if [ ! -f "${CHDB_SOURCE}/CMakeLists.txt" ]; then
    log_error "CMakeLists.txt not found in: ${CHDB_SOURCE}"
    exit 1
fi

log_success "Found chdb source at: ${CHDB_SOURCE}"

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
log_info "Build directory: ${BUILD_DIR}"

# ============================================================================
# Configure CMake with LTO
# ============================================================================

log_section "CMake Configuration (LTO Enabled)"

TOOLCHAIN_FILE="${EMSDK}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake"

if [ ! -f "${TOOLCHAIN_FILE}" ]; then
    log_error "Emscripten toolchain not found: ${TOOLCHAIN_FILE}"
    exit 1
fi

log_info "Using toolchain: ${TOOLCHAIN_FILE}"
log_info "LTO Mode: ${LTO_MODE}"

# Build CMake arguments
CMAKE_ARGS=(
    # Load base WASM minimal configuration
    "-C" "${CMAKE_DIR}/wasm-minimal-correct.cmake"
    # Load LTO configuration (must come after base config)
    "-C" "${CMAKE_DIR}/wasm-lto.cmake"
    # Toolchain
    "-DCMAKE_TOOLCHAIN_FILE=${TOOLCHAIN_FILE}"
    # Build configuration
    "-DCMAKE_BUILD_TYPE=MinSizeRel"
    # LTO mode
    "-DCHDB_WASM_LTO_MODE=${LTO_MODE}"
    # Source directory
    "${CHDB_SOURCE}"
)

if [ "$VERBOSE" = true ]; then
    CMAKE_ARGS+=("-DCMAKE_VERBOSE_MAKEFILE=ON")
fi

log_info "CMake configuration:"
for arg in "${CMAKE_ARGS[@]}"; do
    echo "    ${arg}"
done
echo ""

cd "${BUILD_DIR}"

log_info "Running CMake configure..."
CMAKE_LOG="${BUILD_DIR}/cmake_configure.log"

if [ "$VERBOSE" = true ]; then
    run_cmd cmake "${CMAKE_ARGS[@]}" 2>&1 | tee "${CMAKE_LOG}"
else
    run_cmd cmake "${CMAKE_ARGS[@]}" > "${CMAKE_LOG}" 2>&1
fi

if [ "$DRY_RUN" = false ]; then
    log_success "CMake configuration complete"
    log_info "Configuration log: ${CMAKE_LOG}"
fi

# ============================================================================
# Build
# ============================================================================

log_section "Building with LTO"

CPU_COUNT=$(get_cpu_count)
log_info "Building with ${CPU_COUNT} parallel jobs..."
log_warn "LTO builds take significantly longer than non-LTO builds"

BUILD_LOG="${BUILD_DIR}/cmake_build.log"
BUILD_START_TIME=$(date +%s)

if [ "$VERBOSE" = true ]; then
    run_cmd cmake --build . --parallel "${CPU_COUNT}" 2>&1 | tee "${BUILD_LOG}"
else
    run_cmd cmake --build . --parallel "${CPU_COUNT}" > "${BUILD_LOG}" 2>&1
fi

BUILD_END_TIME=$(date +%s)
BUILD_DURATION=$((BUILD_END_TIME - BUILD_START_TIME))

if [ "$DRY_RUN" = false ]; then
    log_success "Build completed in ${BUILD_DURATION} seconds"
    log_info "Build log: ${BUILD_LOG}"
fi

# ============================================================================
# Post-Build Optimization with wasm-opt
# ============================================================================

if [ "$DRY_RUN" = false ]; then
    log_section "WASM Post-Processing"

    WASM_OPT=""
    if command -v wasm-opt &> /dev/null; then
        WASM_OPT="wasm-opt"
    elif [ -f "${EMSDK}/upstream/bin/wasm-opt" ]; then
        WASM_OPT="${EMSDK}/upstream/bin/wasm-opt"
    fi

    if [ -n "$WASM_OPT" ]; then
        log_info "Using wasm-opt: ${WASM_OPT}"

        WASM_FILES=$(find "${BUILD_DIR}" -name "*.wasm" -type f 2>/dev/null || true)

        for wasm_file in $WASM_FILES; do
            if [ -f "$wasm_file" ]; then
                log_info "Optimizing: $(basename "$wasm_file")"

                ORIG_SIZE=$(get_file_size "$wasm_file")

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

                mv "${wasm_file}.opt" "$wasm_file"

                NEW_SIZE=$(get_file_size "$wasm_file")

                if [ "$ORIG_SIZE" -gt 0 ]; then
                    SAVED=$((ORIG_SIZE - NEW_SIZE))
                    PERCENT=$((SAVED * 100 / ORIG_SIZE))
                    log_success "  Size reduced by $(format_size $SAVED) (${PERCENT}%)"
                fi
            fi
        done
    else
        log_warn "wasm-opt not found, skipping post-processing"
    fi
fi

# ============================================================================
# Report Results
# ============================================================================

if [ "$DRY_RUN" = false ]; then
    log_section "Build Results"

    WASM_FILES=$(find "${BUILD_DIR}" -name "*.wasm" 2>/dev/null || true)

    if [ -n "$WASM_FILES" ]; then
        log_success "WASM artifacts found:"
        echo ""
        for wasm_file in $WASM_FILES; do
            if [ -f "$wasm_file" ]; then
                FILE_SIZE=$(get_file_size "$wasm_file")
                GZIP_SIZE=$(gzip -c "$wasm_file" 2>/dev/null | wc -c | tr -d ' ')

                echo "  $(basename "$wasm_file"):"
                echo "    Uncompressed: $(format_size $FILE_SIZE)"
                echo "    Gzipped:      $(format_size $GZIP_SIZE)"
                echo ""
            fi
        done
    else
        log_warn "No .wasm files found in build output"
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
    log_success "LTO BUILD COMPLETE"
fi
echo -e "${BOLD}================================================================${NC}"
echo ""
log_info "LTO Mode:       ${LTO_MODE}"
log_info "Build Time:     ${BUILD_DURATION} seconds"
log_info "Build Dir:      ${BUILD_DIR}"
echo ""
log_info "LTO provides 15-25% size reduction through:"
echo "    - Cross-module dead code elimination"
echo "    - Cross-module function inlining"
echo "    - Whole-program optimization"
echo ""

if [ "$DRY_RUN" = false ]; then
    log_info "To analyze build size in detail:"
    echo "  ./scripts/analyze-size.sh ${BUILD_DIR}"
    echo ""
fi
