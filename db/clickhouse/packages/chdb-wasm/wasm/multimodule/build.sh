#!/bin/bash
# build.sh - Build script for multi-module WASM spike
#
# Builds two independent WASM modules:
#   - core.wasm: SQL parser and query coordinator
#   - format-json.wasm: JSON formatting module
#
# Usage:
#   ./build.sh           # Build all modules
#   ./build.sh clean     # Clean build directory
#   ./build.sh sizes     # Show module sizes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check for Emscripten
check_emscripten() {
    if ! command -v emcc &> /dev/null; then
        log_error "Emscripten not found. Please install and activate Emscripten SDK."
        log_info "Installation:"
        log_info "  git clone https://github.com/emscripten-core/emsdk.git"
        log_info "  cd emsdk && ./emsdk install latest && ./emsdk activate latest"
        log_info "  source emsdk_env.sh"
        exit 1
    fi
    log_info "Found Emscripten: $(emcc --version | head -1)"
}

# Build using CMake
build_cmake() {
    check_emscripten

    log_info "Creating build directory..."
    mkdir -p "$BUILD_DIR"
    cd "$BUILD_DIR"

    log_info "Running CMake with Emscripten..."
    emcmake cmake .. -DCMAKE_BUILD_TYPE=Release

    log_info "Building modules..."
    emmake make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

    log_info "Build complete!"
    show_sizes
}

# Build directly without CMake (simpler for spike)
build_direct() {
    check_emscripten

    log_info "Creating build directory..."
    mkdir -p "$BUILD_DIR"

    # Common flags
    COMMON_FLAGS="-Os -fno-exceptions -fno-rtti -DNDEBUG"
    COMMON_LINK_FLAGS="-s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=1048576 -s MAXIMUM_MEMORY=67108864 --no-entry"

    # Build core.wasm
    log_info "Building core.wasm..."
    emcc $COMMON_FLAGS \
        -s EXPORTED_FUNCTIONS="['_malloc','_free','_parse_sql','_get_required_format','_get_query_type','_get_table_name','_get_format','_get_column_count','_get_column','_get_limit','_get_offset','_get_error','_allocate_result_buffer','_get_result_buffer','_get_result_buffer_size','_coordinate_result','_core_version','_core_info']" \
        $COMMON_LINK_FLAGS \
        -o "$BUILD_DIR/core.wasm" \
        "$SCRIPT_DIR/core.cpp"

    # Build format-json.wasm
    log_info "Building format-json.wasm..."
    emcc $COMMON_FLAGS \
        -s EXPORTED_FUNCTIONS="['_malloc','_free','_format_as_json','_format_as_json_each_row','_format_as_json_compact','_parse_json','_get_output_buffer','_get_output_size','_get_error','_json_version','_json_info']" \
        $COMMON_LINK_FLAGS \
        -o "$BUILD_DIR/format-json.wasm" \
        "$SCRIPT_DIR/format-json.cpp"

    log_info "Build complete!"
    show_sizes
}

# Show module sizes
show_sizes() {
    echo ""
    log_info "=== Module Sizes ==="
    if [ -f "$BUILD_DIR/core.wasm" ]; then
        SIZE=$(ls -lh "$BUILD_DIR/core.wasm" | awk '{print $5}')
        BYTES=$(wc -c < "$BUILD_DIR/core.wasm" | tr -d ' ')
        echo "  core.wasm:        $SIZE ($BYTES bytes)"
    fi
    if [ -f "$BUILD_DIR/format-json.wasm" ]; then
        SIZE=$(ls -lh "$BUILD_DIR/format-json.wasm" | awk '{print $5}')
        BYTES=$(wc -c < "$BUILD_DIR/format-json.wasm" | tr -d ' ')
        echo "  format-json.wasm: $SIZE ($BYTES bytes)"
    fi

    # Total
    if [ -f "$BUILD_DIR/core.wasm" ] && [ -f "$BUILD_DIR/format-json.wasm" ]; then
        TOTAL=$(( $(wc -c < "$BUILD_DIR/core.wasm") + $(wc -c < "$BUILD_DIR/format-json.wasm") ))
        echo "  -----------------------"
        echo "  Total:            $(numfmt --to=iec-i --suffix=B $TOTAL 2>/dev/null || echo "$TOTAL bytes")"
    fi
    echo ""
}

# Clean build directory
clean() {
    log_info "Cleaning build directory..."
    rm -rf "$BUILD_DIR"
    log_info "Clean complete!"
}

# Main
case "${1:-build}" in
    build)
        build_direct
        ;;
    cmake)
        build_cmake
        ;;
    clean)
        clean
        ;;
    sizes)
        show_sizes
        ;;
    *)
        echo "Usage: $0 [build|cmake|clean|sizes]"
        echo ""
        echo "Commands:"
        echo "  build   - Build modules using direct emcc (default)"
        echo "  cmake   - Build modules using CMake"
        echo "  clean   - Remove build directory"
        echo "  sizes   - Show module sizes"
        exit 1
        ;;
esac
