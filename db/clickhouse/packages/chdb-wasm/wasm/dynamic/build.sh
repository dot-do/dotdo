#!/bin/bash
#
# build.sh - Build the Emscripten Dynamic Linking POC
#
# Prerequisites:
#   - Emscripten SDK installed and activated (source emsdk_env.sh)
#
# Usage:
#   ./build.sh          # Build both modules
#   ./build.sh clean    # Clean build artifacts
#   ./build.sh debug    # Build with debug info
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"

# Default flags
DEBUG_FLAGS=""
OPT_FLAGS="-O2"

# Parse arguments
case "$1" in
    clean)
        echo "Cleaning build artifacts..."
        rm -rf "${BUILD_DIR}"
        rm -f "${SCRIPT_DIR}/core.js" "${SCRIPT_DIR}/core.wasm"
        rm -f "${SCRIPT_DIR}/extension.wasm"
        echo "Done."
        exit 0
        ;;
    debug)
        echo "Building with debug information..."
        DEBUG_FLAGS="-g -gsource-map"
        OPT_FLAGS="-O0"
        ;;
esac

# Check for Emscripten
if ! command -v emcc &> /dev/null; then
    echo "Error: emcc not found. Please activate the Emscripten SDK:"
    echo "  source /path/to/emsdk/emsdk_env.sh"
    exit 1
fi

echo "Emscripten version: $(emcc --version | head -1)"
echo ""

# Create build directory
mkdir -p "${BUILD_DIR}"

# ============================================================================
# Core Module (MAIN_MODULE)
# ============================================================================

echo "Building core.cpp (MAIN_MODULE)..."

CORE_EXPORTS=(
    "_main"
    "_core_init"
    "_core_get_version"
    "_core_alloc"
    "_core_free"
    "_core_log"
    "_core_set_error"
    "_core_get_error"
    "_core_get_shared_state"
    "_core_register_extension"
    "_core_get_extension_count"
    "_core_increment_query_count"
    "_core_get_query_count"
    "_core_add"
    "_core_multiply"
    "_core_process_buffer"
    "_malloc"
    "_free"
)

CORE_RUNTIME_METHODS=(
    "ccall"
    "cwrap"
    "addFunction"
    "removeFunction"
    "UTF8ToString"
    "stringToUTF8"
    "getValue"
    "setValue"
    "loadDynamicLibrary"
    "wasmTable"
)

# Join arrays with commas
CORE_EXPORTS_STR=$(IFS=,; echo "${CORE_EXPORTS[*]}")
CORE_RUNTIME_STR=$(IFS=,; echo "${CORE_RUNTIME_METHODS[*]}")

emcc "${SCRIPT_DIR}/core.cpp" \
    -sMAIN_MODULE=2 \
    -sEXPORTED_FUNCTIONS="[${CORE_EXPORTS_STR}]" \
    -sEXPORTED_RUNTIME_METHODS="[${CORE_RUNTIME_STR}]" \
    -sALLOW_TABLE_GROWTH=1 \
    -sALLOW_MEMORY_GROWTH=1 \
    -sINITIAL_MEMORY=16777216 \
    -sSTACK_SIZE=1048576 \
    -sMODULARIZE=1 \
    -sEXPORT_NAME='createCoreModule' \
    -sENVIRONMENT='web,node' \
    -sNO_EXIT_RUNTIME=1 \
    ${DEBUG_FLAGS} ${OPT_FLAGS} \
    -o "${BUILD_DIR}/core.js"

echo "  -> ${BUILD_DIR}/core.js"
echo "  -> ${BUILD_DIR}/core.wasm"

# ============================================================================
# Extension Module (SIDE_MODULE)
# ============================================================================

echo ""
echo "Building extension.cpp (SIDE_MODULE)..."

EXTENSION_EXPORTS=(
    "_extension_init"
    "_extension_get_name"
    "_extension_get_version"
    "_extension_is_initialized"
    "_extension_factorial"
    "_extension_fibonacci"
    "_extension_power"
    "_extension_sum_array"
    "_extension_create_sequence"
    "_extension_free_buffer"
    "_extension_get_computation_count"
    "_extension_is_prime"
    "_extension_count_primes"
)

EXTENSION_EXPORTS_STR=$(IFS=,; echo "${EXTENSION_EXPORTS[*]}")

emcc "${SCRIPT_DIR}/extension.cpp" \
    -sSIDE_MODULE=2 \
    -sEXPORTED_FUNCTIONS="[${EXTENSION_EXPORTS_STR}]" \
    ${DEBUG_FLAGS} ${OPT_FLAGS} \
    -o "${BUILD_DIR}/extension.wasm"

echo "  -> ${BUILD_DIR}/extension.wasm"

# ============================================================================
# Report file sizes
# ============================================================================

echo ""
echo "Build complete. File sizes:"
echo ""
ls -lh "${BUILD_DIR}/core.js" "${BUILD_DIR}/core.wasm" "${BUILD_DIR}/extension.wasm" 2>/dev/null || true

echo ""
echo "To test:"
echo "  cd ${BUILD_DIR}"
echo "  cp ../loader.js ../test.html ."
echo "  python3 -m http.server 8080"
echo "  # Open http://localhost:8080/test.html"
