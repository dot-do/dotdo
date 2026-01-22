#!/bin/bash
# build-ultra-minimal.sh
# Build script for the ULTRA-MINIMAL WASM configuration
#
# This script builds the smallest possible chdb WASM binary by using
# the wasm-ultra-minimal.cmake preset which disables ALL optional features.
#
# RESEARCH INSIGHTS (why ultra-minimal exists):
#   - ClickHouse code section is 5.13x larger than DuckDB (117MB vs 22MB)
#   - ClickHouse has 142,075 functions vs DuckDB's 60,116
#   - Average function size is 868 bytes vs 399 bytes
#
# TARGET: <40MB uncompressed, <10MB gzipped
#
# WHAT'S ENABLED:
#   - Memory and Log table engines ONLY
#   - Native and JSONEachRow formats ONLY
#   - Basic aggregates: count, sum, min, max, avg
#   - Essential conversion functions: toInt*, toString, etc.
#
# WHAT'S DISABLED:
#   - ALL cloud storage (S3, GCS, Azure, HDFS)
#   - ALL external databases (MySQL, PostgreSQL, MongoDB, etc.)
#   - ALL heavy formats (Parquet, Arrow, ORC, Avro, Protobuf)
#   - ALL specialized libraries (ICU, NLP, Geo, Vector search)
#   - MergeTree and persistent storage engines
#   - JIT compilation (LLVM)
#   - Distributed queries and clustering
#
# Usage:
#   ./scripts/build-ultra-minimal.sh [options]
#
# Options:
#   --clean       Clean build directory before building
#   --configure   Only run cmake configure step (skip build)
#   --verbose     Enable verbose output
#   --wasm-opt    Run wasm-opt post-processing
#   --help        Show this help message
#
# Requirements:
#   - Emscripten SDK installed and EMSDK environment variable set
#   - CMake 3.20+
#   - wasm-opt (optional, for post-processing)

set -e

# Script directory and paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CMAKE_CONFIG="${PROJECT_ROOT}/cmake/wasm-ultra-minimal.cmake"
BUILD_DIR="${PROJECT_ROOT}/build-ultra-minimal"
CHDB_SOURCE="${PROJECT_ROOT}/../../vendor/chdb"
OUTPUT_DIR="${PROJECT_ROOT}/dist/ultra-minimal"

# Options
CLEAN_BUILD=false
CONFIGURE_ONLY=false
VERBOSE=false
RUN_WASM_OPT=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# ============================================================================
# Helper Functions
# ============================================================================

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

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

log_size() {
    echo -e "${MAGENTA}[SIZE]${NC} $1"
}

show_help() {
    echo "build-ultra-minimal.sh - Build ultra-minimal WASM binary"
    echo ""
    echo "Usage: ./scripts/build-ultra-minimal.sh [options]"
    echo ""
    echo "Options:"
    echo "  --clean       Clean build directory before building"
    echo "  --configure   Only run cmake configure step (skip build)"
    echo "  --verbose     Enable verbose output"
    echo "  --wasm-opt    Run wasm-opt post-processing for smallest size"
    echo "  --help        Show this help message"
    echo ""
    echo "Target: <40MB uncompressed, <10MB gzipped"
    echo ""
    echo "This is the most aggressive size optimization profile."
    echo "Only use it when binary size is the primary concern."
    exit 0
}

format_bytes() {
    local bytes=$1
    if [ $bytes -ge 1073741824 ]; then
        echo "$(echo "scale=2; $bytes / 1073741824" | bc) GB"
    elif [ $bytes -ge 1048576 ]; then
        echo "$(echo "scale=2; $bytes / 1048576" | bc) MB"
    elif [ $bytes -ge 1024 ]; then
        echo "$(echo "scale=2; $bytes / 1024" | bc) KB"
    else
        echo "$bytes bytes"
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
        --configure)
            CONFIGURE_ONLY=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --wasm-opt)
            RUN_WASM_OPT=true
            shift
            ;;
        --help|-h)
            show_help
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Run with --help for usage information"
            exit 1
            ;;
    esac
done

# ============================================================================
# Header
# ============================================================================

echo ""
echo "============================================================"
echo "  ULTRA-MINIMAL WASM Build"
echo "============================================================"
echo ""
echo "  Target: <40MB uncompressed, <10MB gzipped"
echo ""
echo "  This configuration disables EVERYTHING possible for"
echo "  the smallest binary size at the cost of features."
echo ""
echo "============================================================"
echo ""

# ============================================================================
# Step 1: Check for Emscripten SDK
# ============================================================================

log_step "Checking for Emscripten SDK..."

if [ -z "${EMSDK}" ]; then
    log_error "EMSDK environment variable is not set!"
    echo ""
    echo "The Emscripten SDK is required to build WASM targets."
    echo ""
    echo "To install Emscripten:"
    echo "  git clone https://github.com/emscripten-core/emsdk.git"
    echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    exit 1
fi

TOOLCHAIN_FILE="${EMSDK}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake"
if [ ! -f "${TOOLCHAIN_FILE}" ]; then
    log_error "Emscripten toolchain file not found at: ${TOOLCHAIN_FILE}"
    exit 1
fi

log_success "Emscripten SDK found at: ${EMSDK}"

if command -v emcc &> /dev/null; then
    EMCC_VERSION=$(emcc --version 2>/dev/null | head -1)
    log_info "Emscripten version: ${EMCC_VERSION}"
fi

# Check for wasm-opt if requested
if [ "$RUN_WASM_OPT" = true ]; then
    if ! command -v wasm-opt &> /dev/null; then
        log_warn "wasm-opt not found - will skip post-processing"
        log_info "Install with: npm install -g binaryen OR brew install binaryen"
        RUN_WASM_OPT=false
    else
        WASM_OPT_VERSION=$(wasm-opt --version 2>/dev/null | head -1)
        log_info "wasm-opt version: ${WASM_OPT_VERSION}"
    fi
fi

# ============================================================================
# Step 2: Verify source files
# ============================================================================

log_step "Verifying source files..."

if [ ! -f "${CMAKE_CONFIG}" ]; then
    log_error "CMake configuration not found: ${CMAKE_CONFIG}"
    exit 1
fi
log_success "Found cmake config: ${CMAKE_CONFIG}"

if [ ! -d "${CHDB_SOURCE}" ] || [ ! -f "${CHDB_SOURCE}/CMakeLists.txt" ]; then
    log_error "chdb source not found at: ${CHDB_SOURCE}"
    echo "Run: git submodule update --init --recursive"
    exit 1
fi
log_success "Found chdb source: ${CHDB_SOURCE}"

# ============================================================================
# Step 3: Prepare build directory
# ============================================================================

log_step "Preparing build directory..."

if [ "$CLEAN_BUILD" = true ] && [ -d "${BUILD_DIR}" ]; then
    log_info "Cleaning existing build directory..."
    rm -rf "${BUILD_DIR}"
fi

mkdir -p "${BUILD_DIR}"
mkdir -p "${OUTPUT_DIR}"

log_success "Build directory: ${BUILD_DIR}"
log_success "Output directory: ${OUTPUT_DIR}"

# ============================================================================
# Step 4: Run cmake configure
# ============================================================================

echo ""
log_step "Running cmake configure with ultra-minimal preset..."
echo ""

cd "${BUILD_DIR}"

CMAKE_LOG="${BUILD_DIR}/cmake_configure.log"

log_info "CMake command:"
echo "  cmake -C ${CMAKE_CONFIG} \\"
echo "        -DCMAKE_TOOLCHAIN_FILE=${TOOLCHAIN_FILE} \\"
echo "        -DCMAKE_BUILD_TYPE=MinSizeRel \\"
echo "        ${CHDB_SOURCE}"
echo ""

set +e

CMAKE_CMD="cmake -C ${CMAKE_CONFIG} -DCMAKE_TOOLCHAIN_FILE=${TOOLCHAIN_FILE} -DCMAKE_BUILD_TYPE=MinSizeRel ${CHDB_SOURCE}"

if [ "$VERBOSE" = true ]; then
    ${CMAKE_CMD} 2>&1 | tee "${CMAKE_LOG}"
    CMAKE_EXIT_CODE=${PIPESTATUS[0]}
else
    ${CMAKE_CMD} > "${CMAKE_LOG}" 2>&1
    CMAKE_EXIT_CODE=$?
fi

set -e

if [ ${CMAKE_EXIT_CODE} -ne 0 ]; then
    log_error "CMake configure failed! (exit code: ${CMAKE_EXIT_CODE})"
    echo ""
    echo "Last 50 lines of output:"
    echo "----------------------------------------"
    tail -50 "${CMAKE_LOG}"
    echo "----------------------------------------"
    echo "Full log: ${CMAKE_LOG}"
    exit 1
fi

log_success "CMake configure completed"

if [ "$CONFIGURE_ONLY" = true ]; then
    echo ""
    log_success "Configure-only mode: stopping here"
    echo "To build: cd ${BUILD_DIR} && cmake --build . --parallel"
    exit 0
fi

# ============================================================================
# Step 5: Build
# ============================================================================

echo ""
log_step "Building ultra-minimal WASM binary..."
echo ""

# Determine parallel jobs
if command -v nproc &> /dev/null; then
    PARALLEL_JOBS=$(nproc)
elif command -v sysctl &> /dev/null; then
    PARALLEL_JOBS=$(sysctl -n hw.ncpu 2>/dev/null || echo 4)
else
    PARALLEL_JOBS=4
fi

log_info "Using ${PARALLEL_JOBS} parallel jobs"

BUILD_LOG="${BUILD_DIR}/cmake_build.log"
BUILD_START_TIME=$(date +%s)

set +e

if [ "$VERBOSE" = true ]; then
    cmake --build . --parallel "${PARALLEL_JOBS}" 2>&1 | tee "${BUILD_LOG}"
    BUILD_EXIT_CODE=${PIPESTATUS[0]}
else
    cmake --build . --parallel "${PARALLEL_JOBS}" > "${BUILD_LOG}" 2>&1
    BUILD_EXIT_CODE=$?
fi

BUILD_END_TIME=$(date +%s)
BUILD_DURATION=$((BUILD_END_TIME - BUILD_START_TIME))

set -e

if [ ${BUILD_EXIT_CODE} -ne 0 ]; then
    log_error "Build failed! (exit code: ${BUILD_EXIT_CODE})"
    echo ""
    echo "Last 100 lines of build output:"
    echo "----------------------------------------"
    tail -100 "${BUILD_LOG}"
    echo "----------------------------------------"
    echo "Full log: ${BUILD_LOG}"
    exit 1
fi

log_success "Build completed in ${BUILD_DURATION} seconds"

# ============================================================================
# Step 6: Post-processing with wasm-opt (optional)
# ============================================================================

if [ "$RUN_WASM_OPT" = true ]; then
    echo ""
    log_step "Running wasm-opt post-processing..."

    WASM_FILES=$(find "${BUILD_DIR}" -name "*.wasm" 2>/dev/null || true)

    for wasm_file in ${WASM_FILES}; do
        if [ -f "${wasm_file}" ]; then
            ORIGINAL_SIZE=$(wc -c < "${wasm_file}")

            log_info "Processing: ${wasm_file##*/}"
            log_info "Original size: $(format_bytes ${ORIGINAL_SIZE})"

            OPTIMIZED_FILE="${wasm_file%.wasm}.optimized.wasm"

            wasm-opt -Oz \
                --strip-debug \
                --strip-dwarf \
                --strip-producers \
                --remove-unused-module-elements \
                --remove-unused-nonfunction-module-elements \
                --remove-unused-brs \
                --remove-unused-names \
                --vacuum \
                "${wasm_file}" -o "${OPTIMIZED_FILE}"

            if [ -f "${OPTIMIZED_FILE}" ]; then
                OPTIMIZED_SIZE=$(wc -c < "${OPTIMIZED_FILE}")
                SAVINGS=$((ORIGINAL_SIZE - OPTIMIZED_SIZE))
                PERCENT=$((SAVINGS * 100 / ORIGINAL_SIZE))

                # Replace original with optimized
                mv "${OPTIMIZED_FILE}" "${wasm_file}"

                log_success "Optimized size: $(format_bytes ${OPTIMIZED_SIZE}) (saved ${PERCENT}%)"
            fi
        fi
    done
fi

# ============================================================================
# Step 7: Collect artifacts
# ============================================================================

echo ""
log_step "Collecting build artifacts..."

WASM_FILES=$(find "${BUILD_DIR}" -name "*.wasm" 2>/dev/null || true)
JS_FILES=$(find "${BUILD_DIR}" -name "*.js" -type f 2>/dev/null | grep -v "node_modules" | grep -v "CMake" || true)

# Copy to output directory
for artifact in ${WASM_FILES} ${JS_FILES}; do
    if [ -f "${artifact}" ]; then
        cp "${artifact}" "${OUTPUT_DIR}/"
        log_info "Copied: ${artifact##*/}"
    fi
done

# ============================================================================
# Step 8: Size Report
# ============================================================================

echo ""
echo "============================================================"
echo "  SIZE REPORT - Ultra-Minimal Build"
echo "============================================================"
echo ""

TOTAL_SIZE=0
TOTAL_GZIP=0

for wasm_file in ${WASM_FILES}; do
    if [ -f "${wasm_file}" ]; then
        FILE_SIZE=$(wc -c < "${wasm_file}")
        GZIP_SIZE=$(gzip -c "${wasm_file}" 2>/dev/null | wc -c)
        BROTLI_SIZE=""

        if command -v brotli &> /dev/null; then
            BROTLI_SIZE=$(brotli -c "${wasm_file}" 2>/dev/null | wc -c)
        fi

        TOTAL_SIZE=$((TOTAL_SIZE + FILE_SIZE))
        TOTAL_GZIP=$((TOTAL_GZIP + GZIP_SIZE))

        echo "  ${wasm_file##*/}"
        echo "    Uncompressed: $(format_bytes ${FILE_SIZE})"
        echo "    Gzipped:      $(format_bytes ${GZIP_SIZE})"
        if [ -n "${BROTLI_SIZE}" ]; then
            echo "    Brotli:       $(format_bytes ${BROTLI_SIZE})"
        fi
        echo ""
    fi
done

# Check against target
TARGET_UNCOMPRESSED=$((40 * 1048576))  # 40MB
TARGET_GZIPPED=$((10 * 1048576))       # 10MB

echo "============================================================"
echo "  TOTALS"
echo "============================================================"
echo ""
echo "  Uncompressed: $(format_bytes ${TOTAL_SIZE})"
echo "  Gzipped:      $(format_bytes ${TOTAL_GZIP})"
echo ""

if [ ${TOTAL_SIZE} -le ${TARGET_UNCOMPRESSED} ]; then
    log_success "TARGET MET: Under 40MB uncompressed"
else
    log_warn "TARGET MISSED: Over 40MB uncompressed"
fi

if [ ${TOTAL_GZIP} -le ${TARGET_GZIPPED} ]; then
    log_success "TARGET MET: Under 10MB gzipped"
else
    log_warn "TARGET MISSED: Over 10MB gzipped"
fi

# ============================================================================
# Summary
# ============================================================================

echo ""
echo "============================================================"
echo "  BUILD COMPLETE"
echo "============================================================"
echo ""
echo "  Build directory:  ${BUILD_DIR}"
echo "  Output directory: ${OUTPUT_DIR}"
echo "  Configure log:    ${CMAKE_LOG}"
echo "  Build log:        ${BUILD_LOG}"
echo "  Build time:       ${BUILD_DURATION} seconds"
echo ""
echo "  ENABLED FEATURES:"
echo "    - Memory table engine"
echo "    - JSONEachRow, CSV, TSV formats"
echo "    - count, sum, min, max, avg aggregates"
echo "    - Basic type conversions"
echo ""
echo "  DISABLED FEATURES:"
echo "    - Cloud storage (S3, GCS, Azure)"
echo "    - External databases (MySQL, PostgreSQL)"
echo "    - Heavy formats (Parquet, Arrow, ORC)"
echo "    - Specialized libraries (ICU, NLP, Geo)"
echo "    - MergeTree storage engine"
echo "    - JIT compilation"
echo "    - Distributed queries"
echo ""
echo "  Next steps:"
echo "    - Test: Import WASM module in browser"
echo "    - Deploy: Copy ${OUTPUT_DIR}/ to CDN"
echo "    - Analyze: ./scripts/analyze-size.sh ${BUILD_DIR}"
echo ""
