#!/bin/bash
# build-modular.sh - Build chdb components as modular WASM with MAIN_MODULE/SIDE_MODULE
#
# This script compiles ClickHouse/chdb components using Emscripten's dynamic linking:
# - Core module (MAIN_MODULE=2): Provides base infrastructure
# - Side modules (SIDE_MODULE=2): Extend core with additional features
#
# Architecture:
#   executor.wasm (MAIN_MODULE) - Base SQL expression evaluator
#     |
#     +-- memory_engine.side.wasm (SIDE_MODULE) - In-memory tables
#     +-- aggregates.side.wasm (SIDE_MODULE) - Aggregate functions
#
# Prerequisites:
#   - Emscripten SDK installed (emsdk)
#
# Usage:
#   ./build-modular.sh          # Build all modular components
#   ./build-modular.sh core     # Build only the core module
#   ./build-modular.sh memory   # Build memory_engine side module
#   ./build-modular.sh agg      # Build aggregates side module
#   ./build-modular.sh clean    # Clean modular build directory
#   ./build-modular.sh test     # Build and test modular loading

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() { echo -e "\n${BLUE}=== $1 ===${NC}\n"; }

# =============================================================================
# Emscripten Setup
# =============================================================================

setup_emscripten() {
    if command -v emcc &> /dev/null; then
        log_info "emcc already available: $(which emcc)"
        return 0
    fi

    # Try to source emsdk
    if [ -f "$HOME/emsdk/emsdk_env.sh" ]; then
        log_info "Sourcing Emscripten SDK from $HOME/emsdk..."
        source "$HOME/emsdk/emsdk_env.sh"
        return 0
    fi

    log_error "Emscripten SDK not found!"
    echo ""
    echo "Please install Emscripten SDK:"
    echo "  git clone https://github.com/emscripten-core/emsdk.git ~/emsdk"
    echo "  cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest"
    echo ""
    exit 1
}

# =============================================================================
# Output Directory
# =============================================================================

MODULAR_DIST="$SCRIPT_DIR/dist/modular"

# =============================================================================
# Optimization Flags (Tree-Shaking)
# =============================================================================
# These flags implement aggressive tree-shaking and dead code elimination
# for 20-45% WASM size reduction. See docs/spikes/spike-4-tree-shaking.md

# Compile-time optimization flags
OPT_COMPILE_FLAGS="-Oz -flto -fdata-sections -ffunction-sections"

# Link-time optimization flags
OPT_LINK_FLAGS="-flto -Wl,--gc-sections --closure 1 -sEVAL_CTORS=1"

# =============================================================================
# Common Flags
# =============================================================================

# Common C++ flags (with tree-shaking optimizations)
COMMON_CXX_FLAGS="-std=c++17 $OPT_COMPILE_FLAGS -fno-exceptions -fno-rtti"

# Exported functions for the core module (all public symbols)
# Include dlopen/dlsym/dlclose for dynamic loading
CORE_EXPORTED_FUNCTIONS='["_malloc","_free","_executor_create","_executor_destroy","_executor_query","_executor_get_result","_executor_get_result_len","_executor_get_error","_executor_test","_executor_version","_dlopen","_dlsym","_dlclose","_dlerror"]'

# Exported runtime methods
RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue","addFunction","removeFunction","dynCall","allocateUTF8","FS"]'

# =============================================================================
# Build Core Module (MAIN_MODULE=2)
# =============================================================================

build_core_module() {
    log_section "Building Core Module (MAIN_MODULE=2)"

    mkdir -p "$MODULAR_DIST"

    # MAIN_MODULE=2 creates a main module that can load side modules via dlopen
    # Key flags:
    # - MAIN_MODULE=2: Selective export mode (smaller than =1)
    # - EXPORT_ALL=1: Export all symbols for side modules to use
    # - ALLOW_TABLE_GROWTH=1: Allow function table to grow for dlopen

    log_info "Compiling executor core as MAIN_MODULE=2..."

    emcc \
        $COMMON_CXX_FLAGS \
        -DEXECUTOR_STANDALONE_BUILD \
        -DMODULAR_BUILD \
        $OPT_LINK_FLAGS \
        -sMAIN_MODULE=2 \
        -sWASM=1 \
        -sMODULARIZE=1 \
        -sEXPORT_NAME='createCoreModule' \
        -sEXPORTED_RUNTIME_METHODS="$RUNTIME_METHODS" \
        -sEXPORTED_FUNCTIONS="$CORE_EXPORTED_FUNCTIONS" \
        -sALLOW_MEMORY_GROWTH=1 \
        -sINITIAL_MEMORY=2097152 \
        -sALLOW_TABLE_GROWTH=1 \
        -sENVIRONMENT='node,web' \
        -sEXPORT_ES6=0 \
        -sFORCE_FILESYSTEM=1 \
        "$SCRIPT_DIR/executor_bindings.cpp" \
        -o "$MODULAR_DIST/core.js" \
        2>&1

    if [ $? -eq 0 ]; then
        local js_size=$(wc -c < "$MODULAR_DIST/core.js")
        local wasm_size=$(wc -c < "$MODULAR_DIST/core.wasm")
        log_info "Built: core.js ($js_size bytes)"
        log_info "Built: core.wasm ($wasm_size bytes)"
    else
        log_error "Core module build failed!"
        return 1
    fi
}

# =============================================================================
# Build Memory Engine Side Module (SIDE_MODULE=2)
# =============================================================================

build_memory_side_module() {
    log_section "Building Memory Engine Side Module (SIDE_MODULE=2)"

    mkdir -p "$MODULAR_DIST"

    # SIDE_MODULE=2 creates a module that can be loaded via dlopen
    # Key flags:
    # - SIDE_MODULE=2: Selective export mode
    # - No MODULARIZE (side modules are raw .wasm files)

    log_info "Compiling memory_engine as SIDE_MODULE=2..."

    emcc \
        $COMMON_CXX_FLAGS \
        -DMEMORY_ENGINE_BUILD \
        -DMODULAR_BUILD \
        -flto -Wl,--gc-sections \
        -sSIDE_MODULE=2 \
        -sWASM=1 \
        "$SCRIPT_DIR/memory_engine.cpp" \
        -o "$MODULAR_DIST/memory_engine.side.wasm" \
        2>&1

    if [ $? -eq 0 ]; then
        local wasm_size=$(wc -c < "$MODULAR_DIST/memory_engine.side.wasm")
        log_info "Built: memory_engine.side.wasm ($wasm_size bytes)"
    else
        log_error "Memory Engine side module build failed!"
        return 1
    fi
}

# =============================================================================
# Build Aggregates Side Module (SIDE_MODULE=2)
# =============================================================================

build_aggregates_side_module() {
    log_section "Building Aggregates Side Module (SIDE_MODULE=2)"

    mkdir -p "$MODULAR_DIST"

    log_info "Compiling aggregates as SIDE_MODULE=2..."

    emcc \
        $COMMON_CXX_FLAGS \
        -DEXECUTOR_STANDALONE_BUILD \
        -DMODULAR_BUILD \
        -flto -Wl,--gc-sections \
        -sSIDE_MODULE=2 \
        -sWASM=1 \
        "$SCRIPT_DIR/aggregates.cpp" \
        -o "$MODULAR_DIST/aggregates.side.wasm" \
        2>&1

    if [ $? -eq 0 ]; then
        local wasm_size=$(wc -c < "$MODULAR_DIST/aggregates.side.wasm")
        log_info "Built: aggregates.side.wasm ($wasm_size bytes)"
    else
        log_error "Aggregates side module build failed!"
        return 1
    fi
}

# =============================================================================
# Build All Modular Components
# =============================================================================

build_all_modular() {
    log_section "Building All Modular WASM Components"

    build_core_module
    echo ""
    build_memory_side_module
    echo ""
    build_aggregates_side_module

    echo ""
    log_section "Build Summary"

    echo "Output files in $MODULAR_DIST:"
    ls -lh "$MODULAR_DIST/"

    echo ""
    log_info "Size comparison:"
    echo ""

    # Show sizes
    if [ -f "$MODULAR_DIST/core.wasm" ]; then
        echo "  Core (MAIN_MODULE):        $(wc -c < "$MODULAR_DIST/core.wasm" | tr -d ' ') bytes"
    fi
    if [ -f "$MODULAR_DIST/memory_engine.side.wasm" ]; then
        echo "  Memory Engine (SIDE):      $(wc -c < "$MODULAR_DIST/memory_engine.side.wasm" | tr -d ' ') bytes"
    fi
    if [ -f "$MODULAR_DIST/aggregates.side.wasm" ]; then
        echo "  Aggregates (SIDE):         $(wc -c < "$MODULAR_DIST/aggregates.side.wasm" | tr -d ' ') bytes"
    fi

    # Compare with standalone builds if they exist
    echo ""
    if [ -f "$SCRIPT_DIR/dist/executor.wasm" ]; then
        echo "  For comparison (standalone builds):"
        echo "  Executor (standalone):     $(wc -c < "$SCRIPT_DIR/dist/executor.wasm" | tr -d ' ') bytes"
    fi
    if [ -f "$SCRIPT_DIR/dist/memory_engine.wasm" ]; then
        echo "  Memory Engine (standalone): $(wc -c < "$SCRIPT_DIR/dist/memory_engine.wasm" | tr -d ' ') bytes"
    fi
    if [ -f "$SCRIPT_DIR/dist/aggregates.wasm" ]; then
        echo "  Aggregates (standalone):   $(wc -c < "$SCRIPT_DIR/dist/aggregates.wasm" | tr -d ' ') bytes"
    fi
}

# =============================================================================
# Clean
# =============================================================================

clean_modular() {
    log_info "Cleaning modular build directory..."
    rm -rf "$MODULAR_DIST"
    log_info "Clean complete."
}

# =============================================================================
# Test Modular Loading
# =============================================================================

test_modular() {
    log_section "Testing Modular WASM Loading"

    # Build if not already built
    if [ ! -f "$MODULAR_DIST/core.js" ]; then
        log_warn "Core module not built. Building first..."
        build_all_modular
    fi

    # Check if module-loader.js exists
    if [ ! -f "$SCRIPT_DIR/module-loader.js" ]; then
        log_error "module-loader.js not found!"
        return 1
    fi

    # Run test
    log_info "Running modular loading test..."

    node -e "
const path = require('path');

async function test() {
    console.log('=== Modular WASM Loading Test ===\\n');

    // Load the module loader
    const { ModuleLoader } = require('./module-loader.js');

    // Create loader instance
    const loader = new ModuleLoader({
        corePath: './dist/modular/core.js',
        coreWasmPath: './dist/modular/core.wasm',
        sideModulesDir: './dist/modular'
    });

    console.log('1. Loading core module...');
    await loader.loadCore();
    console.log('   Core module loaded successfully!\\n');

    // Test core module
    console.log('2. Testing core module (executor)...');
    const coreResult = loader.executeQuery('SELECT 1 + 2 AS result');
    console.log('   Query: SELECT 1 + 2 AS result');
    console.log('   Result:', coreResult.trim());
    console.log('   Status: ' + (coreResult.includes('3') ? 'PASS' : 'FAIL') + '\\n');

    // List available side modules
    console.log('3. Available side modules:');
    const available = loader.getAvailableSideModules();
    console.log('   ' + available.join(', ') + '\\n');

    // Try loading a side module (if dlopen is supported)
    console.log('4. Attempting to load memory_engine side module...');
    try {
        const loaded = await loader.loadSideModule('memory_engine');
        if (loaded) {
            console.log('   Side module loaded successfully!');

            // Test the side module
            const memResult = loader.executeSideQuery('memory_engine', 'SELECT 1 + 2');
            console.log('   Memory engine query result:', memResult);
        } else {
            console.log('   Side module loading not supported in this environment');
        }
    } catch (err) {
        console.log('   Note: Dynamic loading may not be supported: ' + err.message);
    }

    console.log('\\n=== Test Complete ===');
}

test().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
"
}

# =============================================================================
# Main
# =============================================================================

echo ""
echo "=================================================="
echo "  chdb-wasm Modular Build Script"
echo "  (MAIN_MODULE / SIDE_MODULE Architecture)"
echo "=================================================="
echo ""

setup_emscripten

echo "emcc version: $(emcc --version | head -1)"
echo ""

case "${1:-all}" in
    core)
        build_core_module
        ;;
    memory)
        build_memory_side_module
        ;;
    agg|aggregates)
        build_aggregates_side_module
        ;;
    clean)
        clean_modular
        ;;
    test)
        test_modular
        ;;
    all)
        build_all_modular
        ;;
    *)
        echo "Unknown command: $1"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  all          Build all modular components (default)"
        echo "  core         Build core module (MAIN_MODULE=2)"
        echo "  memory       Build memory_engine side module"
        echo "  agg          Build aggregates side module"
        echo "  clean        Clean modular build directory"
        echo "  test         Build and test modular loading"
        exit 1
        ;;
esac
