#!/bin/bash
# build-minimal.sh
# Test script for the minimal WASM configuration using wasm-minimal-correct.cmake
#
# This script validates the wasm-minimal-correct.cmake preset by running a test build.
# It uses the cmake preset file (-C flag) instead of passing flags inline.
#
# Usage:
#   ./scripts/build-minimal.sh [options]
#
# Options:
#   --clean       Clean build directory before building
#   --configure   Only run cmake configure step (skip build)
#   --verbose     Enable verbose output
#   --help        Show this help message
#
# Requirements:
#   - Emscripten SDK installed and EMSDK environment variable set
#   - CMake 3.20+

set -e

# Script directory and paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CMAKE_CONFIG="${PROJECT_ROOT}/cmake/wasm-minimal-correct.cmake"
BUILD_DIR="${PROJECT_ROOT}/build-minimal-test"
CHDB_SOURCE="${PROJECT_ROOT}/../../vendor/chdb"

# Options
CLEAN_BUILD=false
CONFIGURE_ONLY=false
VERBOSE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
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

show_help() {
    echo "build-minimal.sh - Test minimal WASM configuration"
    echo ""
    echo "Usage: ./scripts/build-minimal.sh [options]"
    echo ""
    echo "Options:"
    echo "  --clean       Clean build directory before building"
    echo "  --configure   Only run cmake configure step (skip build)"
    echo "  --verbose     Enable verbose output"
    echo "  --help        Show this help message"
    echo ""
    echo "This script tests the wasm-minimal-correct.cmake preset file."
    exit 0
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
echo "=============================================="
echo "  Minimal WASM Configuration Test"
echo "=============================================="
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
    echo "  1. Clone the repository:"
    echo "     git clone https://github.com/emscripten-core/emsdk.git"
    echo ""
    echo "  2. Install and activate the latest version:"
    echo "     cd emsdk"
    echo "     ./emsdk install latest"
    echo "     ./emsdk activate latest"
    echo ""
    echo "  3. Set up the environment (run this before building):"
    echo "     source ./emsdk_env.sh"
    echo ""
    echo "  4. Verify EMSDK is set:"
    echo "     echo \$EMSDK"
    echo ""
    exit 1
fi

# Verify the toolchain file exists
TOOLCHAIN_FILE="${EMSDK}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake"
if [ ! -f "${TOOLCHAIN_FILE}" ]; then
    log_error "Emscripten toolchain file not found!"
    echo ""
    echo "Expected location: ${TOOLCHAIN_FILE}"
    echo ""
    echo "Please ensure Emscripten is properly installed and activated."
    echo "Run: source \$EMSDK/emsdk_env.sh"
    exit 1
fi

log_success "Emscripten SDK found at: ${EMSDK}"

# Display version information
if command -v emcc &> /dev/null; then
    EMCC_VERSION=$(emcc --version 2>/dev/null | head -1)
    log_info "Emscripten version: ${EMCC_VERSION}"
fi

# ============================================================================
# Step 2: Verify cmake preset file exists
# ============================================================================

log_step "Verifying cmake configuration file..."

if [ ! -f "${CMAKE_CONFIG}" ]; then
    log_error "CMake configuration file not found!"
    echo ""
    echo "Expected: ${CMAKE_CONFIG}"
    echo ""
    echo "Please ensure wasm-minimal-correct.cmake exists in the cmake directory."
    exit 1
fi

log_success "Found: ${CMAKE_CONFIG}"

# ============================================================================
# Step 3: Verify chdb source directory
# ============================================================================

log_step "Verifying chdb source directory..."

if [ ! -d "${CHDB_SOURCE}" ]; then
    log_error "chdb source directory not found!"
    echo ""
    echo "Expected: ${CHDB_SOURCE}"
    echo ""
    echo "Please ensure the vendor/chdb submodule is initialized:"
    echo "  git submodule update --init --recursive"
    exit 1
fi

if [ ! -f "${CHDB_SOURCE}/CMakeLists.txt" ]; then
    log_error "chdb CMakeLists.txt not found!"
    echo ""
    echo "Expected: ${CHDB_SOURCE}/CMakeLists.txt"
    echo ""
    echo "The vendor/chdb submodule may be empty. Try:"
    echo "  git submodule update --init --recursive"
    exit 1
fi

log_success "Found chdb source at: ${CHDB_SOURCE}"

# ============================================================================
# Step 4: Create build directory
# ============================================================================

log_step "Preparing build directory..."

if [ "$CLEAN_BUILD" = true ] && [ -d "${BUILD_DIR}" ]; then
    log_info "Cleaning existing build directory..."
    rm -rf "${BUILD_DIR}"
fi

mkdir -p "${BUILD_DIR}"
log_success "Build directory: ${BUILD_DIR}"

# ============================================================================
# Step 5: Run cmake configure
# ============================================================================

echo ""
log_step "Running cmake configure..."
echo ""
log_info "Command:"
echo "  cmake -C ${CMAKE_CONFIG} \\"
echo "        -DCMAKE_TOOLCHAIN_FILE=${TOOLCHAIN_FILE} \\"
echo "        ${CHDB_SOURCE}"
echo ""

cd "${BUILD_DIR}"

# Capture cmake output and errors
CMAKE_LOG="${BUILD_DIR}/cmake_configure.log"

set +e  # Don't exit on error - we want to capture it

if [ "$VERBOSE" = true ]; then
    cmake -C "${CMAKE_CONFIG}" \
          -DCMAKE_TOOLCHAIN_FILE="${TOOLCHAIN_FILE}" \
          "${CHDB_SOURCE}" 2>&1 | tee "${CMAKE_LOG}"
    CMAKE_EXIT_CODE=${PIPESTATUS[0]}
else
    cmake -C "${CMAKE_CONFIG}" \
          -DCMAKE_TOOLCHAIN_FILE="${TOOLCHAIN_FILE}" \
          "${CHDB_SOURCE}" > "${CMAKE_LOG}" 2>&1
    CMAKE_EXIT_CODE=$?
fi

set -e

if [ ${CMAKE_EXIT_CODE} -ne 0 ]; then
    log_error "CMake configure failed! (exit code: ${CMAKE_EXIT_CODE})"
    echo ""
    echo "Error output:"
    echo "----------------------------------------"
    tail -50 "${CMAKE_LOG}"
    echo "----------------------------------------"
    echo ""
    echo "Full log available at: ${CMAKE_LOG}"
    exit 1
fi

log_success "CMake configure completed successfully"
log_info "Configuration log: ${CMAKE_LOG}"

if [ "$CONFIGURE_ONLY" = true ]; then
    echo ""
    log_success "Configure-only mode: stopping before build step"
    echo ""
    echo "To proceed with the build manually, run:"
    echo "  cd ${BUILD_DIR}"
    echo "  cmake --build . --parallel \$(nproc)"
    exit 0
fi

# ============================================================================
# Step 6: Run build
# ============================================================================

echo ""
log_step "Running build..."
echo ""

# Determine number of parallel jobs
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

set +e  # Don't exit on error - we want to capture it

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
    echo ""
    echo "Full log available at: ${BUILD_LOG}"
    echo ""
    echo "Common issues:"
    echo "  - Missing dependencies: Check that all submodules are initialized"
    echo "  - Memory issues: Try reducing parallel jobs with: cmake --build . -j 2"
    echo "  - WASM-incompatible code: Some features may need WASM-specific patches"
    exit 1
fi

log_success "Build completed in ${BUILD_DURATION} seconds"
log_info "Build log: ${BUILD_LOG}"

# ============================================================================
# Step 7: Report results
# ============================================================================

echo ""
echo "=============================================="
echo "  Build Results"
echo "=============================================="
echo ""

# Find and report WASM artifacts
WASM_FILES=$(find "${BUILD_DIR}" -name "*.wasm" 2>/dev/null || true)
JS_FILES=$(find "${BUILD_DIR}" -name "*.js" -type f 2>/dev/null | grep -v "node_modules" || true)

if [ -n "${WASM_FILES}" ]; then
    log_success "WASM artifacts found:"
    echo ""
    for wasm_file in ${WASM_FILES}; do
        if [ -f "${wasm_file}" ]; then
            FILE_SIZE=$(ls -lh "${wasm_file}" | awk '{print $5}')
            FILE_SIZE_BYTES=$(wc -c < "${wasm_file}")
            GZIP_SIZE=$(gzip -c "${wasm_file}" 2>/dev/null | wc -c)
            GZIP_SIZE_MB=$(echo "scale=2; ${GZIP_SIZE} / 1048576" | bc 2>/dev/null || echo "N/A")

            echo "  ${wasm_file##*/}"
            echo "    Size:    ${FILE_SIZE} (${FILE_SIZE_BYTES} bytes)"
            echo "    Gzipped: ${GZIP_SIZE_MB} MB (${GZIP_SIZE} bytes)"
            echo ""
        fi
    done
else
    log_warn "No .wasm files found in build output"
    echo ""
    echo "This may be expected if the build produces a library instead of a binary."
fi

if [ -n "${JS_FILES}" ]; then
    log_info "JavaScript files generated:"
    for js_file in ${JS_FILES}; do
        if [ -f "${js_file}" ]; then
            FILE_SIZE=$(ls -lh "${js_file}" | awk '{print $5}')
            echo "  ${js_file##*/}: ${FILE_SIZE}"
        fi
    done
    echo ""
fi

# ============================================================================
# Summary
# ============================================================================

echo ""
echo "=============================================="
echo "  Summary"
echo "=============================================="
echo ""
log_success "Minimal WASM configuration test completed successfully!"
echo ""
echo "Build directory:  ${BUILD_DIR}"
echo "Configure log:    ${CMAKE_LOG}"
echo "Build log:        ${BUILD_LOG}"
echo "Build time:       ${BUILD_DURATION} seconds"
echo ""
echo "Next steps:"
echo "  - Analyze size: ./scripts/analyze-size.sh ${BUILD_DIR}"
echo "  - Test in browser: Import the generated WASM module"
echo "  - Deploy: Copy artifacts to your web server or CDN"
echo ""
