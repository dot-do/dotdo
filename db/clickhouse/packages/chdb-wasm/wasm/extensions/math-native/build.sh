#!/bin/bash
#
# build.sh - Build the ext-math-native SIDE_MODULE
#
# This script builds the native math functions as a SIDE_MODULE that can be
# dynamically loaded via dlopen() from a MAIN_MODULE.
#
# Prerequisites:
#   - Emscripten SDK installed and activated (source emsdk_env.sh)
#
# Usage:
#   ./build.sh          # Build the module
#   ./build.sh clean    # Clean build artifacts
#   ./build.sh debug    # Build with debug info
#   ./build.sh test     # Build and run native tests
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"
DIST_DIR="${SCRIPT_DIR}/dist"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Default flags
DEBUG_FLAGS=""
OPT_FLAGS="-O2"

# Parse arguments
case "$1" in
    clean)
        log_info "Cleaning build artifacts..."
        rm -rf "${BUILD_DIR}"
        rm -rf "${DIST_DIR}"
        log_info "Clean complete."
        exit 0
        ;;
    debug)
        log_info "Building with debug information..."
        DEBUG_FLAGS="-g -gsource-map"
        OPT_FLAGS="-O0"
        ;;
    test)
        log_info "Building native tests..."
        mkdir -p "${BUILD_DIR}"
        cd "${BUILD_DIR}"
        cmake .. -DBUILD_TESTS=ON
        make
        log_info "Running tests..."
        ./test_ext_math_native
        exit 0
        ;;
esac

# Check for Emscripten
if ! command -v emcc &> /dev/null; then
    # Try to source emsdk
    if [ -f "$HOME/emsdk/emsdk_env.sh" ]; then
        log_info "Sourcing Emscripten SDK..."
        source "$HOME/emsdk/emsdk_env.sh"
    else
        log_error "emcc not found. Please activate the Emscripten SDK:"
        echo "  source /path/to/emsdk/emsdk_env.sh"
        exit 1
    fi
fi

log_info "Emscripten version: $(emcc --version | head -1)"
echo ""

# Create output directory
mkdir -p "${DIST_DIR}"

# Exported functions
EXPORTS=(
    # Initialization and metadata
    "_ext_math_native_init"
    "_ext_math_native_get_name"
    "_ext_math_native_get_version"
    "_ext_math_native_is_initialized"
    "_ext_math_native_get_call_count"

    # Trigonometric functions
    "_ch_sin"
    "_ch_cos"
    "_ch_tan"

    # Inverse trigonometric functions
    "_ch_asin"
    "_ch_acos"
    "_ch_atan"
    "_ch_atan2"

    # Hyperbolic functions
    "_ch_sinh"
    "_ch_cosh"
    "_ch_tanh"
    "_ch_asinh"
    "_ch_acosh"
    "_ch_atanh"

    # Exponential and logarithmic functions
    "_ch_exp"
    "_ch_exp2"
    "_ch_exp10"
    "_ch_log"
    "_ch_log2"
    "_ch_log10"
    "_ch_log1p"

    # Power and root functions
    "_ch_sqrt"
    "_ch_cbrt"
    "_ch_pow"
    "_ch_hypot"

    # Error and gamma functions
    "_ch_erf"
    "_ch_erfc"
    "_ch_lgamma"
    "_ch_tgamma"

    # Special functions
    "_ch_sigmoid"
    "_ch_degrees"
    "_ch_radians"

    # Comparison and utility functions
    "_ch_abs"
    "_ch_min2"
    "_ch_max2"

    # Mathematical constants
    "_ch_e"
    "_ch_pi"

    # Integer versions
    "_ch_abs_int"
)

# Join exports with commas
EXPORTS_STR=$(IFS=,; echo "${EXPORTS[*]}")

log_info "Building ext-math-native as SIDE_MODULE..."

emcc \
    "${SCRIPT_DIR}/math_native.cpp" \
    -std=c++17 \
    -sSIDE_MODULE=2 \
    -sEXPORTED_FUNCTIONS="[${EXPORTS_STR}]" \
    ${DEBUG_FLAGS} ${OPT_FLAGS} \
    -o "${DIST_DIR}/ext-math-native.wasm"

# Report results
echo ""
log_info "Build complete!"
echo ""

if [ -f "${DIST_DIR}/ext-math-native.wasm" ]; then
    SIZE=$(wc -c < "${DIST_DIR}/ext-math-native.wasm")
    log_info "Output: ${DIST_DIR}/ext-math-native.wasm"
    log_info "Size: ${SIZE} bytes"
    echo ""
    log_info "Functions exported: ${#EXPORTS[@]}"
else
    log_error "Build failed - output file not found"
    exit 1
fi

echo ""
log_info "To test, load this SIDE_MODULE from a MAIN_MODULE using dlopen()"
