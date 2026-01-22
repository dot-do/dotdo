#!/bin/bash
# =============================================================================
# build.sh - Unified Build System for chdb WASM Modules
# =============================================================================
#
# This script compiles ClickHouse/chdb components to WASM using Emscripten.
# It provides a unified interface for building individual modules, config
# bundles, and generating size reports.
#
# Prerequisites:
#   - Emscripten SDK installed (emsdk)
#   - ClickHouse/chdb source at ../../../../vendor/chdb
#
# =============================================================================
# BUILD TARGETS
# =============================================================================
#
# Individual Modules:
#   ./build.sh executor       # Core SQL expression evaluator (~132KB)
#   ./build.sh memory-engine  # In-memory table engine (~162KB)
#   ./build.sh aggregates     # Aggregate functions (~153KB)
#   ./build.sh json-format    # JSON parsing/extraction
#   ./build.sh csv-format     # CSV/TSV parsing
#   ./build.sh lexer          # SQL lexer with JS bindings
#   ./build.sh parser         # SQL parser with JS bindings
#   ./build.sh standalone     # Standalone Lexer WASM (no JS)
#   ./build.sh url-table      # URL table function module
#
# Master Build Targets:
#   ./build.sh all            # Build all components
#   ./build.sh all-modules    # Build core WASM modules only (5 modules)
#
# Config-specific Bundles:
#   ./build.sh chdb-minimal   # executor + memory + aggregates
#   ./build.sh chdb-fetch     # + json + csv (for URL data fetching)
#
# Utilities:
#   ./build.sh size-report    # Show all module sizes and estimates
#   ./build.sh clean          # Clean build directory
#   ./build.sh help           # Show detailed help
#
# Testing:
#   ./build.sh test           # Test Lexer module
#   ./build.sh test-parser    # Test Parser module
#   ./build.sh test-executor  # Test Executor module
#
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

BLUE='\033[0;34m'
CYAN='\033[0;36m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() { echo -e "\n${BLUE}=== $1 ===${NC}\n"; }

# Helper function to format bytes
format_bytes() {
    local bytes=$1
    if [ $bytes -eq 0 ]; then
        echo "-"
    elif [ $bytes -lt 1024 ]; then
        echo "${bytes}B"
    elif [ $bytes -lt 1048576 ]; then
        echo "$((bytes / 1024))KB"
    else
        local mb=$((bytes / 1048576))
        local remainder=$((bytes % 1048576))
        local decimal=$((remainder * 10 / 1048576))
        if [ $decimal -gt 0 ]; then
            echo "${mb}.${decimal}MB"
        else
            echo "${mb}MB"
        fi
    fi
}

# =============================================================================
# Optimization Flags (Tree-Shaking)
# =============================================================================
# These flags implement aggressive tree-shaking and dead code elimination
# for 20-45% WASM size reduction. See docs/spikes/spike-4-tree-shaking.md

# Compile-time optimization flags
# -Oz: More aggressive size optimization than -Os (5-10% smaller)
# -flto: Link-time optimization for cross-unit inlining (5-15% smaller)
# -fdata-sections -ffunction-sections: Enable section-based GC (5-15% smaller)
OPT_COMPILE_FLAGS="-Oz -flto -fdata-sections -ffunction-sections"

# Link-time optimization flags
# -flto: Must match compile flag
# -Wl,--gc-sections: Remove unused sections
# --closure 1: Closure Compiler for JS minification (30-50% JS reduction)
# -sEVAL_CTORS=1: Evaluate constructors at compile time
OPT_LINK_FLAGS="-flto -Wl,--gc-sections --closure 1 -sEVAL_CTORS=1"

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
# Build Functions
# =============================================================================

build_lexer_standalone() {
    # Build Lexer.wasm in ClickHouse style (no JS, raw WASM)
    log_info "Building standalone Lexer.wasm (ClickHouse-style)..."

    local CHDB_SRC="$REPO_ROOT/vendor/chdb/src"

    if [ ! -f "$CHDB_SRC/Parsers/Lexer.cpp" ]; then
        log_error "chdb source not found at $CHDB_SRC"
        exit 1
    fi

    mkdir -p "$SCRIPT_DIR/dist"

    # Use clang with wasm32 target (same as ClickHouse)
    # This creates a raw .wasm file without JavaScript
    emcc \
        $OPT_COMPILE_FLAGS \
        -fno-exceptions \
        -fno-rtti \
        -DLEXER_STANDALONE_BUILD \
        -I"$CHDB_SRC" \
        -flto -Wl,--gc-sections \
        -s STANDALONE_WASM=1 \
        -s EXPORTED_FUNCTIONS='["_clickhouse_lexer_size","_clickhouse_lexer_create","_clickhouse_lexer_next_token","_clickhouse_lexer_token_is_significant","_clickhouse_lexer_token_is_error","_clickhouse_lexer_token_is_end"]' \
        --no-entry \
        "$CHDB_SRC/Parsers/Lexer.cpp" \
        -o "$SCRIPT_DIR/dist/Lexer.wasm"

    log_info "Built: dist/Lexer.wasm ($(wc -c < "$SCRIPT_DIR/dist/Lexer.wasm") bytes)"
}

build_lexer_module() {
    # Build lexer with JavaScript bindings for easy use
    log_info "Building Lexer module with JavaScript bindings..."

    local CHDB_SRC="$REPO_ROOT/vendor/chdb/src"

    mkdir -p "$SCRIPT_DIR/dist"

    emcc \
        $OPT_COMPILE_FLAGS \
        -fno-exceptions \
        -fno-rtti \
        -DLEXER_STANDALONE_BUILD \
        -I"$CHDB_SRC" \
        $OPT_LINK_FLAGS \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='createLexerModule' \
        -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue"]' \
        -s EXPORTED_FUNCTIONS='["_malloc","_free","_lexer_create","_lexer_destroy","_lexer_next_token","_lexer_get_token_begin","_lexer_get_token_end","_lexer_get_token_type","_lexer_token_is_significant","_lexer_token_is_error","_lexer_token_is_end","_token_type_name","_lexer_test"]' \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=1048576 \
        -s ENVIRONMENT='node,web' \
        -s EXPORT_ES6=0 \
        "$SCRIPT_DIR/lexer_bindings.cpp" \
        "$CHDB_SRC/Parsers/Lexer.cpp" \
        -o "$SCRIPT_DIR/dist/lexer.js"

    log_info "Built: dist/lexer.js ($(wc -c < "$SCRIPT_DIR/dist/lexer.js") bytes)"
    log_info "Built: dist/lexer.wasm ($(wc -c < "$SCRIPT_DIR/dist/lexer.wasm") bytes)"

    # Create package.json for CommonJS compatibility
    cat > "$SCRIPT_DIR/dist/package.json" << 'EOF'
{
  "type": "commonjs"
}
EOF
}

build_parser_module() {
    # Build parser with JavaScript bindings
    # NOTE: Parser requires exceptions enabled (-fexceptions) which adds ~30KB
    log_info "Building Parser module with JavaScript bindings..."
    log_warn "Parser requires -fexceptions flag (adds ~30KB to WASM size)"

    local CHDB_SRC="$REPO_ROOT/vendor/chdb/src"

    mkdir -p "$SCRIPT_DIR/dist"

    # Parser needs:
    # - Lexer.cpp (lexical analysis)
    # - TokenIterator.cpp (token stream handling)
    # - Our parser_bindings.cpp (JS interface)
    #
    # Key differences from Lexer build:
    # - Enables exceptions (-fexceptions)
    # - Uses PARSER_STANDALONE_BUILD flag
    # - Includes ParserStandalone.h for stubs

    # IMPORTANT: We do NOT define LEXER_STANDALONE_BUILD here because
    # LexerStandalone.h conflicts with standard library headers.
    # Instead, PARSER_STANDALONE_BUILD provides its own stubs for the
    # dependencies that Lexer.cpp needs.
    #
    # Include order is critical:
    # 1. Our stub include directory (provides base/defines.h, etc.)
    # 2. chdb src directory (for Parsers/Lexer.h, etc.)
    emcc \
        -std=c++20 \
        -Oz -flto -fdata-sections -ffunction-sections \
        -fexceptions \
        -fno-rtti \
        -DPARSER_STANDALONE_BUILD \
        -I"$SCRIPT_DIR/include" \
        -I"$SCRIPT_DIR" \
        -I"$CHDB_SRC" \
        $OPT_LINK_FLAGS \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='createParserModule' \
        -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue"]' \
        -s EXPORTED_FUNCTIONS='["_malloc","_free","_parser_create","_parser_destroy","_parser_get_token_count","_parser_check_balanced","_parser_get_unmatched_paren_pos","_parser_validate_tokens","_parser_get_error_pos","_parser_get_token","_parser_test"]' \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=2097152 \
        -s ENVIRONMENT='node,web' \
        -s EXPORT_ES6=0 \
        -s DISABLE_EXCEPTION_CATCHING=0 \
        "$SCRIPT_DIR/parser_bindings.cpp" \
        "$CHDB_SRC/Parsers/Lexer.cpp" \
        "$CHDB_SRC/Parsers/TokenIterator.cpp" \
        -o "$SCRIPT_DIR/dist/parser.js" \
        2>&1

    if [ $? -eq 0 ]; then
        log_info "Built: dist/parser.js ($(wc -c < "$SCRIPT_DIR/dist/parser.js") bytes)"
        log_info "Built: dist/parser.wasm ($(wc -c < "$SCRIPT_DIR/dist/parser.wasm") bytes)"
    else
        log_error "Parser build failed!"
        return 1
    fi
}

build_real_parser_module() {
    # Build REAL chdb Parser with PARSER_STANDALONE_BUILD mode
    # This compiles the actual ClickHouse parser infrastructure to WASM
    # instead of using a reimplemented parser.
    log_info "Building REAL Parser module with PARSER_STANDALONE_BUILD..."
    log_info "This uses actual ClickHouse parser code: Lexer, TokenIterator, IParser, IParserBase, CommonParsers"

    local CHDB_SRC="$REPO_ROOT/vendor/chdb/src"

    if [ ! -f "$CHDB_SRC/Parsers/Lexer.cpp" ]; then
        log_error "chdb source not found at $CHDB_SRC"
        exit 1
    fi

    mkdir -p "$SCRIPT_DIR/dist"

    # PARSER_STANDALONE_BUILD mode:
    # - Uses include stubs (base/defines.h, Common/Exception.h, etc.) to eliminate heavy dependencies
    # - Compiles REAL ClickHouse parser infrastructure:
    #   - Lexer.cpp: Lexical analysis
    #   - TokenIterator.cpp: Token stream handling
    #   - IParser.cpp: Base parser class with position tracking
    #   - IParserBase.cpp: Common parser implementation
    #   - CommonParsers.cpp: Keyword parsing (ParserKeyword, ParserToken, etc.)
    #
    # Key build flags:
    # - C++23 required for std::string_view::contains()
    # - NDEBUG to disable some debug-only code paths
    # - fexceptions required for exception handling in parsers
    #
    # Include order is critical:
    # 1. Our stub include directory (provides base/defines.h, Common/Exception.h, etc.)
    # 2. chdb src directory (for Parsers/Lexer.h, etc.)

    emcc \
        -std=c++23 \
        -Oz -flto -fdata-sections -ffunction-sections \
        -fexceptions \
        -fno-rtti \
        -DPARSER_STANDALONE_BUILD \
        -DNDEBUG \
        -I"$SCRIPT_DIR/include" \
        -I"$CHDB_SRC" \
        $OPT_LINK_FLAGS \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='createRealParserModule' \
        -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue"]' \
        -s EXPORTED_FUNCTIONS='["_malloc","_free","_real_parser_create","_real_parser_destroy","_real_parser_get_token_count","_real_parser_check_balanced","_real_parser_get_unmatched_paren_pos","_real_parser_validate_tokens","_real_parser_get_error_pos","_real_parser_get_token","_real_parser_parse_keyword","_real_parser_test"]' \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=4194304 \
        -s ENVIRONMENT='node,web' \
        -s EXPORT_ES6=0 \
        -s DISABLE_EXCEPTION_CATCHING=0 \
        "$SCRIPT_DIR/real_parser_bindings.cpp" \
        "$SCRIPT_DIR/parser_error_codes.cpp" \
        "$CHDB_SRC/Parsers/Lexer.cpp" \
        "$CHDB_SRC/Parsers/TokenIterator.cpp" \
        "$CHDB_SRC/Parsers/IParser.cpp" \
        "$CHDB_SRC/Parsers/IParserBase.cpp" \
        "$CHDB_SRC/Parsers/CommonParsers.cpp" \
        -o "$SCRIPT_DIR/dist/real_parser.js" \
        2>&1

    if [ $? -eq 0 ]; then
        log_info "Built: dist/real_parser.js ($(wc -c < "$SCRIPT_DIR/dist/real_parser.js") bytes)"
        log_info "Built: dist/real_parser.wasm ($(wc -c < "$SCRIPT_DIR/dist/real_parser.wasm") bytes)"
        log_info "This module uses REAL ClickHouse parser code!"
    else
        log_error "Real Parser build failed!"
        return 1
    fi
}

build_executor_module() {
    # Build minimal SQL executor with expression evaluation
    # This is a standalone module that doesn't require full ClickHouse
    log_info "Building Executor module (minimal SQL expression evaluator)..."

    mkdir -p "$SCRIPT_DIR/dist"

    # Executor is completely standalone - no ClickHouse dependencies
    # Supports: SELECT <literal|expr> [AS alias], ...
    # Expressions: +, -, *, /, %, parentheses, integers, floats, strings
    emcc \
        -std=c++17 \
        $OPT_COMPILE_FLAGS \
        -fno-exceptions \
        -fno-rtti \
        -DEXECUTOR_STANDALONE_BUILD \
        $OPT_LINK_FLAGS \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='createExecutorModule' \
        -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue"]' \
        -s EXPORTED_FUNCTIONS='["_malloc","_free","_executor_create","_executor_destroy","_executor_query","_executor_get_result","_executor_get_result_len","_executor_get_error","_executor_test","_executor_version"]' \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=1048576 \
        -s ENVIRONMENT='node,web' \
        -s EXPORT_ES6=0 \
        "$SCRIPT_DIR/executor_bindings.cpp" \
        -o "$SCRIPT_DIR/dist/executor.js" \
        2>&1

    if [ $? -eq 0 ]; then
        log_info "Built: dist/executor.js ($(wc -c < "$SCRIPT_DIR/dist/executor.js") bytes)"
        log_info "Built: dist/executor.wasm ($(wc -c < "$SCRIPT_DIR/dist/executor.wasm") bytes)"
    else
        log_error "Executor build failed!"
        return 1
    fi
}

build_functions_standalone_module() {
    # Build standalone chdb Functions module with accurate comparison operators
    # Uses REAL ClickHouse comparison algorithms (AccurateComparison.h)
    # Based on CHDB_MINIMAL_FUNCTIONS whitelist from vendor/chdb/src/Functions/CMakeLists.txt
    log_info "Building Standalone Functions module (REAL chdb comparison functions)..."

    mkdir -p "$SCRIPT_DIR/dist"

    # Compile with C++20 for concepts support used in FunctionsStandalone.h
    emcc \
        -std=c++20 \
        $OPT_COMPILE_FLAGS \
        -fno-exceptions \
        -fno-rtti \
        -DCHDB_MINIMAL_FUNCTIONS \
        $OPT_LINK_FLAGS \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='createFunctionsModule' \
        -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue"]' \
        -s EXPORTED_FUNCTIONS='["_malloc","_free","_chdb_functions_version","_chdb_equals_int64","_chdb_equals_double","_chdb_equals_int_double","_chdb_equals_double_int","_chdb_less_int64","_chdb_less_double","_chdb_less_int_double","_chdb_less_double_int","_chdb_less_or_equals_int64","_chdb_less_or_equals_double","_chdb_greater_int64","_chdb_greater_double","_chdb_greater_or_equals_int64","_chdb_greater_or_equals_double","_chdb_compare_int8_uint8","_chdb_functions_test"]' \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=1048576 \
        -s ENVIRONMENT='node,web' \
        -s EXPORT_ES6=0 \
        "$SCRIPT_DIR/functions_standalone.cpp" \
        -o "$SCRIPT_DIR/dist/functions.js" \
        2>&1

    if [ $? -eq 0 ]; then
        log_info "Built: dist/functions.js ($(wc -c < "$SCRIPT_DIR/dist/functions.js") bytes)"
        log_info "Built: dist/functions.wasm ($(wc -c < "$SCRIPT_DIR/dist/functions.wasm") bytes)"
        log_info "This module uses REAL ClickHouse accurate comparison algorithms!"
    else
        log_error "Functions Standalone build failed!"
        return 1
    fi
}

run_functions_tests() {
    log_info "Running standalone functions tests..."

    if [ ! -f "$SCRIPT_DIR/dist/functions.js" ]; then
        log_warn "Functions module not built. Building first..."
        build_functions_standalone_module
    fi

    node -e "
const createFunctionsModule = require('./dist/functions.js');
(async () => {
    console.log('=== chdb Standalone Functions WASM Test ===\\n');
    const Module = await createFunctionsModule();
    console.log('Functions module loaded successfully!');
    console.log('Version:', Module.UTF8ToString(Module._chdb_functions_version()));
    console.log('');
    console.log('Test 1: Running built-in self-test (C++ tests, includes int64)...');
    const testResult = Module._chdb_functions_test();
    console.log('  Result:', testResult === 0 ? 'PASS' : 'FAIL (code: ' + testResult + ')');
    console.log('');
    console.log('Test 2: Double comparison (JS can only pass doubles directly)...');
    console.log('  42.0 == 42.0:', Module._chdb_equals_double(42.0, 42.0) === 1 ? 'true' : 'false');
    console.log('  42.0 < 43.0:', Module._chdb_less_double(42.0, 43.0) === 1 ? 'true' : 'false');
    console.log('  43.0 < 42.0:', Module._chdb_less_double(43.0, 42.0) === 1 ? 'true' : 'false');
    console.log('');
    console.log('Test 3: Mixed signedness comparison (Int8(-1) vs UInt8(255))...');
    // This is the key test for accurate comparison:
    // Standard C++ would convert -1 to 255 (same bit pattern), making them equal
    // Accurate comparison correctly handles: -1 < 255 (negative is less than positive)
    const compareResult = Module._chdb_compare_int8_uint8(-1, 255);
    console.log('  compare(Int8(-1), UInt8(255)):', compareResult);
    console.log('  Expected: -1 (because -1 < 255 with accurate comparison)');
    console.log('  Result:', compareResult === -1 ? 'PASS - Accurate comparison works!' : 'FAIL');
    console.log('');
    console.log('=== All functions tests complete ===');
})();
"
}

build_aggregates_module() {
    # Build SQL executor with ClickHouse-style aggregate functions
    # Uses AggregatesStandalone.h which provides interfaces matching real ClickHouse:
    #   - IAggregateFunction, AggregateFunctionFactory, AggregateState
    # Adds: COUNT(*), COUNT(col), COUNT(DISTINCT), SUM, AVG, MIN, MAX, UNIQ
    # Supports: UNION ALL, subqueries in FROM clause
    log_info "Building Aggregates module (SQL executor with ClickHouse-style aggregate functions)..."

    mkdir -p "$SCRIPT_DIR/dist"

    # Build v2 with ClickHouse-style aggregate functions
    emcc \
        -std=c++17 \
        $OPT_COMPILE_FLAGS \
        -fno-exceptions \
        -fno-rtti \
        -DEXECUTOR_STANDALONE_BUILD \
        -I"$SCRIPT_DIR" \
        $OPT_LINK_FLAGS \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='createAggExecutorModule' \
        -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue"]' \
        -s EXPORTED_FUNCTIONS='["_malloc","_free","_agg_executor_create","_agg_executor_destroy","_agg_executor_query","_agg_executor_get_result","_agg_executor_get_result_len","_agg_executor_get_error","_agg_executor_test","_agg_executor_version"]' \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=2097152 \
        -s ENVIRONMENT='node,web' \
        -s EXPORT_ES6=0 \
        "$SCRIPT_DIR/aggregates_v2.cpp" \
        -o "$SCRIPT_DIR/dist/aggregates.js" \
        2>&1

    if [ $? -eq 0 ]; then
        log_info "Built: dist/aggregates.js ($(wc -c < "$SCRIPT_DIR/dist/aggregates.js") bytes)"
        log_info "Built: dist/aggregates.wasm ($(wc -c < "$SCRIPT_DIR/dist/aggregates.wasm") bytes)"
        log_info "This module uses ClickHouse-style aggregate function interfaces!"
    else
        log_error "Aggregates build failed!"
        return 1
    fi
}

build_memory_engine_module() {
    # Build memory engine with in-memory table support
    # Extends executor with CREATE TABLE, INSERT, SELECT FROM table
    log_info "Building Memory Engine module (in-memory SQL tables)..."

    mkdir -p "$SCRIPT_DIR/dist"

    # Memory engine is standalone - no ClickHouse dependencies
    # Supports: CREATE TABLE ... ENGINE = Memory, INSERT INTO, SELECT FROM, DROP TABLE
    emcc \
        -std=c++17 \
        $OPT_COMPILE_FLAGS \
        -fno-exceptions \
        -fno-rtti \
        -DMEMORY_ENGINE_BUILD \
        $OPT_LINK_FLAGS \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='createMemoryEngineModule' \
        -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue"]' \
        -s EXPORTED_FUNCTIONS='["_malloc","_free","_memory_engine_create","_memory_engine_destroy","_memory_engine_query","_memory_engine_get_result","_memory_engine_get_result_len","_memory_engine_get_error","_memory_engine_reset","_memory_engine_test","_memory_engine_version"]' \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=2097152 \
        -s ENVIRONMENT='node,web' \
        -s EXPORT_ES6=0 \
        "$SCRIPT_DIR/memory_engine.cpp" \
        -o "$SCRIPT_DIR/dist/memory_engine.js" \
        2>&1

    if [ $? -eq 0 ]; then
        log_info "Built: dist/memory_engine.js ($(wc -c < "$SCRIPT_DIR/dist/memory_engine.js") bytes)"
        log_info "Built: dist/memory_engine.wasm ($(wc -c < "$SCRIPT_DIR/dist/memory_engine.wasm") bytes)"
    else
        log_error "Memory Engine build failed!"
        return 1
    fi
}

build_storage_memory_real_module() {
    # Build REAL ClickHouse StorageMemory compiled to WASM
    # Uses actual ClickHouse patterns from vendor/chdb/src/Storages/StorageMemory.cpp:
    #   - MultiVersion<Blocks> data storage (copy-on-write)
    #   - Block-based columnar storage
    #   - Atomic counters for rows/bytes tracking
    #   - Snapshot-based reads for consistency
    log_info "Building REAL StorageMemory module (ClickHouse patterns compiled to WASM)..."
    log_info "  - Uses MultiVersion<Blocks> from real StorageMemory.cpp"
    log_info "  - Block-based columnar storage (like ClickHouse)"
    log_info "  - StorageStandalone.h provides minimal stubs for heavy dependencies"

    mkdir -p "$SCRIPT_DIR/dist"

    # Compile REAL StorageMemory patterns to WASM
    # Uses StorageStandalone.h for minimal ClickHouse type stubs
    emcc \
        -std=c++17 \
        $OPT_COMPILE_FLAGS \
        -fno-exceptions \
        -fno-rtti \
        -DSTORAGE_MEMORY_REAL_BUILD \
        -I"$SCRIPT_DIR" \
        $OPT_LINK_FLAGS \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='createStorageMemoryRealModule' \
        -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue"]' \
        -s EXPORTED_FUNCTIONS='["_malloc","_free","_storage_memory_create","_storage_memory_destroy","_storage_memory_query","_storage_memory_get_result","_storage_memory_get_result_len","_storage_memory_get_error","_storage_memory_reset","_storage_memory_test","_storage_memory_version"]' \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=2097152 \
        -s ENVIRONMENT='node,web' \
        -s EXPORT_ES6=0 \
        "$SCRIPT_DIR/storage_memory_real.cpp" \
        -o "$SCRIPT_DIR/dist/storage_memory_real.js" \
        2>&1

    if [ $? -eq 0 ]; then
        log_info "Built: dist/storage_memory_real.js ($(wc -c < "$SCRIPT_DIR/dist/storage_memory_real.js") bytes)"
        log_info "Built: dist/storage_memory_real.wasm ($(wc -c < "$SCRIPT_DIR/dist/storage_memory_real.wasm") bytes)"
        log_info "This module uses REAL ClickHouse StorageMemory patterns!"
    else
        log_error "REAL StorageMemory build failed!"
        return 1
    fi
}

build_json_format_module() {
    # Build JSON format parser module
    # Supports: JSON parsing, JSONEachRow, JSONCompact, type coercion, schema inference
    log_info "Building JSON Format module (JSON parsing and extraction)..."

    mkdir -p "$SCRIPT_DIR/dist"

    # JSON format is completely standalone - no ClickHouse dependencies
    # Supports: JSONExtract*, JSONHas, JSONLength, JSONType, schema inference
    emcc \
        -std=c++17 \
        $OPT_COMPILE_FLAGS \
        -fno-exceptions \
        -fno-rtti \
        -DJSON_FORMAT_BUILD \
        $OPT_LINK_FLAGS \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='createJSONFormatModule' \
        -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue"]' \
        -s EXPORTED_FUNCTIONS='["_malloc","_free","_json_format_create","_json_format_destroy","_json_parse","_json_parse_each_row","_json_parse_compact","_json_extract_string","_json_extract_int","_json_extract_float","_json_extract_bool","_json_extract_array_raw","_json_has","_json_length","_json_type","_json_infer_schema","_json_infer_schema_each_row","_json_serialize","_json_get_result","_json_get_result_len","_json_get_error","_json_format_test","_json_format_version"]' \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=1048576 \
        -s ENVIRONMENT='node,web' \
        -s EXPORT_ES6=0 \
        "$SCRIPT_DIR/json_format.cpp" \
        -o "$SCRIPT_DIR/dist/json_format.js" \
        2>&1

    if [ $? -eq 0 ]; then
        log_info "Built: dist/json_format.js ($(wc -c < "$SCRIPT_DIR/dist/json_format.js") bytes)"
        log_info "Built: dist/json_format.wasm ($(wc -c < "$SCRIPT_DIR/dist/json_format.wasm") bytes)"
    else
        log_error "JSON Format build failed!"
        return 1
    fi
}

build_csv_format_module() {
    # Build CSV/TSV format parser module
    # Supports: CSV, TSV, CSVWithNames, TSVWithNames, type inference
    log_info "Building CSV Format module (CSV/TSV parser with type inference)..."

    mkdir -p "$SCRIPT_DIR/dist"

    # CSV format parser is standalone - no ClickHouse dependencies
    # Features: configurable delimiter, quote handling, type inference, NULL values
    emcc \
        -std=c++17 \
        $OPT_COMPILE_FLAGS \
        -fno-exceptions \
        -fno-rtti \
        -DCSV_FORMAT_BUILD \
        $OPT_LINK_FLAGS \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='createCSVParserModule' \
        -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue"]' \
        -s EXPORTED_FUNCTIONS='["_malloc","_free","_csv_parser_create","_csv_parser_destroy","_csv_parser_set_csv","_csv_parser_set_tsv","_csv_parser_set_delimiter","_csv_parser_set_quote","_csv_parser_set_null_value","_csv_parser_set_skip_empty","_csv_parser_set_infer_types","_csv_parser_set_max_rows","_csv_parser_parse","_csv_parser_get_result","_csv_parser_get_result_len","_csv_parser_get_error","_csv_parser_get_row_count","_csv_parser_get_column_count","_csv_parser_get_column_name","_csv_parser_get_column_type","_csv_parser_test","_csv_parser_version"]' \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=1048576 \
        -s ENVIRONMENT='node,web' \
        -s EXPORT_ES6=0 \
        "$SCRIPT_DIR/csv_format.cpp" \
        -o "$SCRIPT_DIR/dist/csv_format.js" \
        2>&1

    if [ $? -eq 0 ]; then
        log_info "Built: dist/csv_format.js ($(wc -c < "$SCRIPT_DIR/dist/csv_format.js") bytes)"
        log_info "Built: dist/csv_format.wasm ($(wc -c < "$SCRIPT_DIR/dist/csv_format.wasm") bytes)"
    else
        log_error "CSV Format build failed!"
        return 1
    fi
}

build_url_table_function_module() {
    # Build URL table function module
    # Implements url() table function that fetches from URLs via JavaScript fetch()
    # Supports: JSON, JSONEachRow, CSV, TSV formats
    log_info "Building URL Table Function module (url() with JavaScript fetch bridge)..."

    mkdir -p "$SCRIPT_DIR/dist"

    # URL table function uses EM_JS to bridge to JavaScript fetch()
    # Supports: SELECT * FROM url('https://...', 'JSON') WHERE ...
    emcc \
        -std=c++17 \
        $OPT_COMPILE_FLAGS \
        -fno-exceptions \
        -fno-rtti \
        -DURL_TABLE_FUNCTION_BUILD \
        $OPT_LINK_FLAGS \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='createURLTableModule' \
        -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue"]' \
        -s EXPORTED_FUNCTIONS='["_malloc","_free","_url_query_create","_url_query_destroy","_url_query_execute","_url_query_get_result","_url_query_get_result_len","_url_query_get_error","_url_query_test","_url_query_version"]' \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=2097152 \
        -s ENVIRONMENT='node,web,worker' \
        -s EXPORT_ES6=0 \
        "$SCRIPT_DIR/url_table_function.cpp" \
        -o "$SCRIPT_DIR/dist/url_table_function.js" \
        2>&1

    if [ $? -eq 0 ]; then
        log_info "Built: dist/url_table_function.js ($(wc -c < "$SCRIPT_DIR/dist/url_table_function.js") bytes)"
        log_info "Built: dist/url_table_function.wasm ($(wc -c < "$SCRIPT_DIR/dist/url_table_function.wasm") bytes)"
    else
        log_error "URL Table Function build failed!"
        return 1
    fi
}

build_vfs_module() {
    # Build VFS module for MergeTree storage on Cloudflare Workers
    # Uses EM_ASYNC_JS for async operations bridging to JavaScript VFS
    # See: wasm/docs/MERGETREE_VFS_DESIGN.md
    log_info "Building VFS module (MergeTree storage bridge for DO/R2)..."
    log_info "  - Uses EM_ASYNC_JS for async file operations"
    log_info "  - Bridges to JavaScript VFSBridge class"
    log_info "  - Supports: open, close, read, write, seek, stat, mkdir, readdir"

    mkdir -p "$SCRIPT_DIR/dist"

    # VFS module requires JSPI (JavaScript Promise Integration) for async operations
    # The EM_ASYNC_JS bindings call into Module.vfsBridge which is set up by vfs_bridge.ts
    emcc \
        -std=c++17 \
        $OPT_COMPILE_FLAGS \
        -fno-exceptions \
        -fno-rtti \
        -DVFS_MODULE_BUILD \
        -I"$SCRIPT_DIR/vfs" \
        $OPT_LINK_FLAGS \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='createVFSModule' \
        -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue"]' \
        -s EXPORTED_FUNCTIONS='["_malloc","_free","_vfs_init","_vfs_shutdown","_vfs_open","_vfs_close","_vfs_read","_vfs_write","_vfs_seek","_vfs_stat","_vfs_fstat","_vfs_mkdir","_vfs_opendir","_vfs_readdir","_vfs_closedir","_vfs_unlink","_vfs_rmdir","_vfs_rename","_vfs_fsync"]' \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=1048576 \
        -s ENVIRONMENT='node,web,worker' \
        -s EXPORT_ES6=0 \
        -s ASYNCIFY \
        -s ASYNCIFY_IMPORTS='["js_vfs_open","js_vfs_close","js_vfs_read","js_vfs_write","js_vfs_stat","js_vfs_fstat","js_vfs_mkdir","js_vfs_opendir","js_vfs_unlink","js_vfs_rmdir","js_vfs_rename","js_vfs_fsync","js_vfs_init","js_vfs_shutdown"]' \
        "$SCRIPT_DIR/vfs/vfs_impl.cpp" \
        -o "$SCRIPT_DIR/dist/vfs.js" \
        2>&1

    if [ $? -eq 0 ]; then
        log_info "Built: dist/vfs.js ($(wc -c < "$SCRIPT_DIR/dist/vfs.js") bytes)"
        log_info "Built: dist/vfs.wasm ($(wc -c < "$SCRIPT_DIR/dist/vfs.wasm") bytes)"
        log_info "Note: Set Module.vfsBridge to a VFSBridge instance before WASM init"
    else
        log_error "VFS module build failed!"
        return 1
    fi
}

build_mergetree_module() {
    # Build MergeTree reader module for reading ClickHouse MergeTree parts
    # Uses MergeTreeStandalone.h for minimal ClickHouse type stubs
    # Bridges file I/O to VFS for Cloudflare R2/Durable Objects
    # See: wasm/docs/MERGETREE_VFS_DESIGN.md
    log_info "Building MergeTree Reader module..."
    log_info "  - Reads MergeTree part structure (columns.txt, count.txt, *.mrk2, *.bin)"
    log_info "  - Mark-based seeking for efficient range reads"
    log_info "  - VFS bridge for R2/Durable Objects storage"
    log_info "  - Standalone stubs for ClickHouse dependencies"

    mkdir -p "$SCRIPT_DIR/dist"

    # MergeTree reader is built with:
    # - MergeTreeStandalone.h: Minimal ClickHouse type stubs (Arena, ThreadPool, Logger, etc.)
    # - DataPartStorageVFS: IDataPartStorage implementation using VFS
    # - mergetree_bindings.cpp: C API for JavaScript
    # - vfs_impl.cpp: VFS implementation with async JavaScript bridge
    #
    # Uses ASYNCIFY for async VFS operations (file reads via R2)
    emcc \
        -std=c++17 \
        $OPT_COMPILE_FLAGS \
        -fno-exceptions \
        -fno-rtti \
        -DMERGETREE_STANDALONE_BUILD \
        -I"$SCRIPT_DIR/mergetree" \
        -I"$SCRIPT_DIR/vfs" \
        -I"$SCRIPT_DIR" \
        $OPT_LINK_FLAGS \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='createMergeTreeModule' \
        -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","getValue","setValue"]' \
        -s EXPORTED_FUNCTIONS='["_malloc","_free","_mergetree_reader_create","_mergetree_reader_destroy","_mergetree_reader_get_row_count","_mergetree_reader_get_column_count","_mergetree_reader_get_mark_count","_mergetree_reader_get_column_name","_mergetree_reader_get_column_type","_mergetree_reader_read_marks","_mergetree_reader_read_column_raw","_mergetree_get_result","_mergetree_get_result_len","_mergetree_get_error","_mergetree_version","_mergetree_test"]' \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=4194304 \
        -s ENVIRONMENT='node,web,worker' \
        -s EXPORT_ES6=0 \
        -s ASYNCIFY \
        -s ASYNCIFY_IMPORTS='["js_vfs_open","js_vfs_close","js_vfs_read","js_vfs_write","js_vfs_stat","js_vfs_fstat","js_vfs_mkdir","js_vfs_opendir","js_vfs_readdir","js_vfs_closedir","js_vfs_unlink","js_vfs_rmdir","js_vfs_rename","js_vfs_fsync","js_vfs_init","js_vfs_shutdown"]' \
        "$SCRIPT_DIR/mergetree/mergetree_bindings.cpp" \
        "$SCRIPT_DIR/mergetree/DataPartStorageVFS.cpp" \
        "$SCRIPT_DIR/vfs/vfs_impl.cpp" \
        -o "$SCRIPT_DIR/dist/mergetree.js" \
        2>&1

    if [ $? -eq 0 ]; then
        log_info "Built: dist/mergetree.js ($(wc -c < "$SCRIPT_DIR/dist/mergetree.js") bytes)"
        log_info "Built: dist/mergetree.wasm ($(wc -c < "$SCRIPT_DIR/dist/mergetree.wasm") bytes)"
        log_info "Note: Set Module.vfsBridge to a VFSBridge instance before WASM init"
    else
        log_error "MergeTree module build failed!"
        return 1
    fi
}

run_mergetree_tests() {
    log_info "Running MergeTree reader tests..."

    if [ ! -f "$SCRIPT_DIR/dist/mergetree.js" ]; then
        log_warn "MergeTree module not built. Building first..."
        build_mergetree_module
    fi

    # Run inline test
    node -e "
const createMergeTreeModule = require('./dist/mergetree.js');
(async () => {
    console.log('=== MergeTree Reader WASM Test ===\\n');

    // Create a mock VFS bridge for testing
    // The VFS implementation expects methods with vfs_* prefix
    // Path parameters are passed as pointers, so we use Module.UTF8ToString to convert
    let Module;  // Will be set after module load

    const mockVfsBridge = {
        files: new Map(),
        handles: new Map(),
        nextHandle: 1,

        async vfs_init(databasePtr, tablePtr) {
            const database = Module.UTF8ToString(databasePtr);
            const table = Module.UTF8ToString(tablePtr);
            console.log('  VFS init:', database, table);
            return 0;
        },

        async vfs_shutdown() {
            console.log('  VFS shutdown');
            return 0;
        },

        async vfs_open(pathPtr, flags) {
            const path = Module.UTF8ToString(pathPtr);
            console.log('  VFS open:', path);
            // Return error for non-existent files
            return -2; // ENOENT
        },

        async vfs_close(handle) {
            return 0;
        },

        async vfs_read(handle, buffer, size) {
            return 0;
        },

        vfs_seek(handle, offset, whence) {
            return 0;
        },

        async vfs_stat(pathPtr, stPtr) {
            const path = Module.UTF8ToString(pathPtr);
            console.log('  VFS stat:', path);
            // Return file not found
            return -2; // VFS_ENOENT
        },

        async vfs_fstat(handle, stPtr) {
            return -9; // EBADF
        },

        async vfs_opendir(pathPtr) {
            return -2;
        },

        vfs_readdir(handle, entryPtr) {
            return -2; // VFS_ENOENT - no more entries
        },

        vfs_closedir(handle) {
            return 0;
        }
    };

    Module = await createMergeTreeModule({
        vfsBridge: mockVfsBridge
    });
    console.log('MergeTree module loaded successfully!');
    console.log('Version:', Module.UTF8ToString(Module._mergetree_version()));
    console.log('');

    // Test 1: Built-in self-test
    console.log('Test 1: Running built-in self-test...');
    const testResult = Module._mergetree_test();
    console.log('  Result:', testResult === 0 ? 'PASS' : 'FAIL (code: ' + testResult + ')');
    console.log('');

    // Test 2: Try to create reader (will fail gracefully due to mock VFS)
    console.log('Test 2: Creating reader for non-existent part...');
    const database = 'default';
    const table = 'test';
    const partition = '202401';
    const partName = 'test_part';

    const dbPtr = Module._malloc(database.length + 1);
    Module.stringToUTF8(database, dbPtr, database.length + 1);
    const tablePtr = Module._malloc(table.length + 1);
    Module.stringToUTF8(table, tablePtr, table.length + 1);
    const partitionPtr = Module._malloc(partition.length + 1);
    Module.stringToUTF8(partition, partitionPtr, partition.length + 1);
    const partNamePtr = Module._malloc(partName.length + 1);
    Module.stringToUTF8(partName, partNamePtr, partName.length + 1);

    const reader = Module._mergetree_reader_create(dbPtr, tablePtr, partitionPtr, partNamePtr);
    console.log('  Reader handle:', reader);
    console.log('  Result:', reader < 0 ? 'PASS (expected failure for non-existent part)' : 'Reader created');

    if (reader > 0) {
        const error = Module.UTF8ToString(Module._mergetree_get_error());
        if (error) console.log('  Error:', error);

        // Clean up
        Module._mergetree_reader_destroy(reader);
    }

    Module._free(dbPtr);
    Module._free(tablePtr);
    Module._free(partitionPtr);
    Module._free(partNamePtr);

    // Test 3: Result buffer operations
    console.log('');
    console.log('Test 3: Result buffer operations...');
    const resultLen = Module._mergetree_get_result_len();
    console.log('  Result buffer length:', resultLen);
    console.log('  Result:', resultLen >= 0 ? 'PASS' : 'FAIL');

    console.log('');
    console.log('=== All MergeTree tests complete ===');
})();
"
}

build_all() {
    log_info "Building all chdb-wasm components..."
    echo ""

    build_lexer_standalone
    echo ""
    build_lexer_module
    echo ""
    build_parser_module
    echo ""
    build_executor_module
    echo ""
    build_aggregates_module
    echo ""
    build_memory_engine_module
    echo ""
    build_json_format_module
    echo ""
    build_csv_format_module
    echo ""
    build_url_table_function_module

    echo ""
    log_info "Build complete!"
    echo ""
    echo "Output files:"
    ls -lh "$SCRIPT_DIR/dist/"
}

# =============================================================================
# Master Build Target: All Modules
# =============================================================================

build_all_modules() {
    # Build all core WASM modules (executor, memory_engine, aggregates, json_format, csv_format)
    # This is the master build target for the modular architecture
    log_section "Building ALL WASM Modules"

    local start_time=$(date +%s)
    local build_count=0
    local fail_count=0

    # Build executor module
    echo -e "${CYAN}[1/5]${NC} Building executor module..."
    if build_executor_module; then
        ((build_count++))
    else
        ((fail_count++))
    fi
    echo ""

    # Build memory engine module
    echo -e "${CYAN}[2/5]${NC} Building memory_engine module..."
    if build_memory_engine_module; then
        ((build_count++))
    else
        ((fail_count++))
    fi
    echo ""

    # Build aggregates module
    echo -e "${CYAN}[3/5]${NC} Building aggregates module..."
    if build_aggregates_module; then
        ((build_count++))
    else
        ((fail_count++))
    fi
    echo ""

    # Build JSON format module
    echo -e "${CYAN}[4/5]${NC} Building json_format module..."
    if build_json_format_module; then
        ((build_count++))
    else
        ((fail_count++))
    fi
    echo ""

    # Build CSV format module
    echo -e "${CYAN}[5/5]${NC} Building csv_format module..."
    if build_csv_format_module; then
        ((build_count++))
    else
        ((fail_count++))
    fi
    echo ""

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    log_section "Build Summary"
    log_info "Modules built: $build_count/5"
    if [ $fail_count -gt 0 ]; then
        log_error "Modules failed: $fail_count"
    fi
    log_info "Build time: ${duration}s"
    echo ""

    # Show size report
    show_size_report

    if [ $fail_count -gt 0 ]; then
        return 1
    fi
    return 0
}

# =============================================================================
# Config-specific Build Targets
# =============================================================================

build_chdb_minimal() {
    # chdb-minimal: executor + memory + aggregates
    # Minimal SQL capabilities for constrained environments
    log_section "chdb-minimal Configuration"
    echo "  Modules: executor + memory_engine + aggregates"
    echo "  Target: Minimal SQL for constrained environments"
    echo ""

    local start_time=$(date +%s)
    local build_count=0
    local fail_count=0

    # Build executor module
    echo -e "${CYAN}[1/3]${NC} Building executor module..."
    if build_executor_module; then
        ((build_count++))
    else
        ((fail_count++))
    fi
    echo ""

    # Build memory engine module
    echo -e "${CYAN}[2/3]${NC} Building memory_engine module..."
    if build_memory_engine_module; then
        ((build_count++))
    else
        ((fail_count++))
    fi
    echo ""

    # Build aggregates module
    echo -e "${CYAN}[3/3]${NC} Building aggregates module..."
    if build_aggregates_module; then
        ((build_count++))
    else
        ((fail_count++))
    fi
    echo ""

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    log_section "chdb-minimal Build Summary"
    log_info "Modules built: $build_count/3"
    if [ $fail_count -gt 0 ]; then
        log_error "Modules failed: $fail_count"
    fi
    log_info "Build time: ${duration}s"
    echo ""

    # Calculate total size
    local total_size=0
    if [ -f "$SCRIPT_DIR/dist/executor.wasm" ]; then
        local size=$(wc -c < "$SCRIPT_DIR/dist/executor.wasm" | tr -d ' ')
        total_size=$((total_size + size))
        echo "  executor.wasm:      $(format_bytes $size)"
    fi
    if [ -f "$SCRIPT_DIR/dist/memory_engine.wasm" ]; then
        local size=$(wc -c < "$SCRIPT_DIR/dist/memory_engine.wasm" | tr -d ' ')
        total_size=$((total_size + size))
        echo "  memory_engine.wasm: $(format_bytes $size)"
    fi
    if [ -f "$SCRIPT_DIR/dist/aggregates.wasm" ]; then
        local size=$(wc -c < "$SCRIPT_DIR/dist/aggregates.wasm" | tr -d ' ')
        total_size=$((total_size + size))
        echo "  aggregates.wasm:    $(format_bytes $size)"
    fi
    echo ""
    echo "  Total WASM size:    $(format_bytes $total_size)"

    # Estimate gzipped size (typically ~30-40% of original for WASM)
    local gzip_size=$((total_size * 35 / 100))
    echo "  Estimated gzipped:  ~$(format_bytes $gzip_size)"
    echo ""

    if [ $fail_count -gt 0 ]; then
        return 1
    fi
    return 0
}

build_chdb_fetch() {
    # chdb-fetch: executor + memory + aggregates + json + csv
    # Lightweight config for HTTP data fetching and transformation
    log_section "chdb-fetch Configuration"
    echo "  Modules: executor + memory + aggregates + json + csv"
    echo "  Target: HTTP data fetching and transformation"
    echo ""

    local start_time=$(date +%s)
    local build_count=0
    local fail_count=0

    # Build executor module
    echo -e "${CYAN}[1/5]${NC} Building executor module..."
    if build_executor_module; then
        ((build_count++))
    else
        ((fail_count++))
    fi
    echo ""

    # Build memory engine module
    echo -e "${CYAN}[2/5]${NC} Building memory_engine module..."
    if build_memory_engine_module; then
        ((build_count++))
    else
        ((fail_count++))
    fi
    echo ""

    # Build aggregates module
    echo -e "${CYAN}[3/5]${NC} Building aggregates module..."
    if build_aggregates_module; then
        ((build_count++))
    else
        ((fail_count++))
    fi
    echo ""

    # Build JSON format module
    echo -e "${CYAN}[4/5]${NC} Building json_format module..."
    if build_json_format_module; then
        ((build_count++))
    else
        ((fail_count++))
    fi
    echo ""

    # Build CSV format module
    echo -e "${CYAN}[5/5]${NC} Building csv_format module..."
    if build_csv_format_module; then
        ((build_count++))
    else
        ((fail_count++))
    fi
    echo ""

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    log_section "chdb-fetch Build Summary"
    log_info "Modules built: $build_count/5"
    if [ $fail_count -gt 0 ]; then
        log_error "Modules failed: $fail_count"
    fi
    log_info "Build time: ${duration}s"
    echo ""

    # Calculate total size
    local total_size=0
    if [ -f "$SCRIPT_DIR/dist/executor.wasm" ]; then
        local size=$(wc -c < "$SCRIPT_DIR/dist/executor.wasm" | tr -d ' ')
        total_size=$((total_size + size))
        echo "  executor.wasm:      $(format_bytes $size)"
    fi
    if [ -f "$SCRIPT_DIR/dist/memory_engine.wasm" ]; then
        local size=$(wc -c < "$SCRIPT_DIR/dist/memory_engine.wasm" | tr -d ' ')
        total_size=$((total_size + size))
        echo "  memory_engine.wasm: $(format_bytes $size)"
    fi
    if [ -f "$SCRIPT_DIR/dist/aggregates.wasm" ]; then
        local size=$(wc -c < "$SCRIPT_DIR/dist/aggregates.wasm" | tr -d ' ')
        total_size=$((total_size + size))
        echo "  aggregates.wasm:    $(format_bytes $size)"
    fi
    if [ -f "$SCRIPT_DIR/dist/json_format.wasm" ]; then
        local size=$(wc -c < "$SCRIPT_DIR/dist/json_format.wasm" | tr -d ' ')
        total_size=$((total_size + size))
        echo "  json_format.wasm:   $(format_bytes $size)"
    fi
    if [ -f "$SCRIPT_DIR/dist/csv_format.wasm" ]; then
        local size=$(wc -c < "$SCRIPT_DIR/dist/csv_format.wasm" | tr -d ' ')
        total_size=$((total_size + size))
        echo "  csv_format.wasm:    $(format_bytes $size)"
    fi
    echo ""
    echo "  Total WASM size:    $(format_bytes $total_size)"

    # Estimate gzipped size
    local gzip_size=$((total_size * 35 / 100))
    echo "  Estimated gzipped:  ~$(format_bytes $gzip_size)"
    echo ""
    log_info "Note: URL table function module can be added for remote data access."
    echo ""

    if [ $fail_count -gt 0 ]; then
        return 1
    fi
    return 0
}

# =============================================================================
# Size Report
# =============================================================================

show_size_report() {
    log_section "WASM Module Size Report"

    local total_wasm=0
    local total_js=0

    # Define modules to check
    local modules=("executor" "memory_engine" "aggregates" "json_format" "csv_format" "lexer" "parser" "url_table_function")

    printf "%-20s %12s %12s %12s\n" "Module" "WASM Size" "JS Size" "Est. Gzip"
    printf "%-20s %12s %12s %12s\n" "--------------------" "------------" "------------" "------------"

    for mod in "${modules[@]}"; do
        local wasm_file="$SCRIPT_DIR/dist/${mod}.wasm"
        local js_file="$SCRIPT_DIR/dist/${mod}.js"
        local wasm_size=0
        local js_size=0

        if [ -f "$wasm_file" ]; then
            wasm_size=$(wc -c < "$wasm_file" | tr -d ' ')
            total_wasm=$((total_wasm + wasm_size))
        fi

        if [ -f "$js_file" ]; then
            js_size=$(wc -c < "$js_file" | tr -d ' ')
            total_js=$((total_js + js_size))
        fi

        if [ $wasm_size -gt 0 ] || [ $js_size -gt 0 ]; then
            local wasm_str=$(format_bytes $wasm_size)
            local js_str=$(format_bytes $js_size)
            local gzip_est=$((wasm_size * 35 / 100))
            local gzip_str=$(format_bytes $gzip_est)
            printf "%-20s %12s %12s %12s\n" "$mod" "$wasm_str" "$js_str" "~$gzip_str"
        fi
    done

    echo ""
    printf "%-20s %12s %12s %12s\n" "--------------------" "------------" "------------" "------------"
    local total_str=$(format_bytes $total_wasm)
    local total_js_str=$(format_bytes $total_js)
    local total_gzip=$((total_wasm * 35 / 100))
    local total_gzip_str=$(format_bytes $total_gzip)
    printf "%-20s %12s %12s %12s\n" "TOTAL" "$total_str" "$total_js_str" "~$total_gzip_str"
    echo ""

    # Show config bundles
    echo "Config Bundle Estimates:"
    echo ""

    # chdb-minimal
    local minimal_size=0
    for mod in "executor" "memory_engine" "aggregates"; do
        local wasm_file="$SCRIPT_DIR/dist/${mod}.wasm"
        if [ -f "$wasm_file" ]; then
            local size=$(wc -c < "$wasm_file" | tr -d ' ')
            minimal_size=$((minimal_size + size))
        fi
    done
    local minimal_gzip=$((minimal_size * 35 / 100))
    printf "  %-18s %s (gzip: ~%s)\n" "chdb-minimal:" "$(format_bytes $minimal_size)" "$(format_bytes $minimal_gzip)"

    # chdb-fetch
    local fetch_size=0
    for mod in "executor" "memory_engine" "aggregates" "json_format" "csv_format"; do
        local wasm_file="$SCRIPT_DIR/dist/${mod}.wasm"
        if [ -f "$wasm_file" ]; then
            local size=$(wc -c < "$wasm_file" | tr -d ' ')
            fetch_size=$((fetch_size + size))
        fi
    done
    local fetch_gzip=$((fetch_size * 35 / 100))
    printf "  %-18s %s (gzip: ~%s)\n" "chdb-fetch:" "$(format_bytes $fetch_size)" "$(format_bytes $fetch_gzip)"
    echo ""
}

clean() {
    log_info "Cleaning build directory..."
    rm -rf "$SCRIPT_DIR/dist" "$SCRIPT_DIR/build"
    log_info "Clean complete."
}

run_tests() {
    log_info "Running tests..."

    if [ ! -f "$SCRIPT_DIR/dist/lexer.js" ]; then
        log_warn "Lexer module not built. Building first..."
        build_lexer_module
    fi

    # Run the test script
    if [ -f "$SCRIPT_DIR/test_lexer.cjs" ]; then
        node "$SCRIPT_DIR/test_lexer.cjs"
    else
        log_warn "No test script found. Creating a basic test..."
        create_test_script
        node "$SCRIPT_DIR/test_lexer.cjs"
    fi
}

run_parser_tests() {
    log_info "Running parser tests..."

    if [ ! -f "$SCRIPT_DIR/dist/parser.js" ]; then
        log_warn "Parser module not built. Building first..."
        build_parser_module
    fi

    # Run inline test
    node -e "
const createParserModule = require('./dist/parser.js');
(async () => {
    console.log('=== ClickHouse SQL Parser WASM Test ===\\n');

    const Module = await createParserModule();
    console.log('Parser module loaded successfully!\\n');

    // Test 1: Built-in self-test
    console.log('Test 1: Running built-in self-test...');
    const testResult = Module._parser_test();
    console.log('  Result:', testResult === 0 ? 'PASS' : 'FAIL (code: ' + testResult + ')');
    console.log('');

    // Test 2: Token count
    console.log('Test 2: Counting tokens...');
    const sql = 'SELECT id, name FROM users WHERE age > 21';
    const sqlLen = sql.length;
    const sqlPtr = Module._malloc(sqlLen + 1);
    Module.stringToUTF8(sql, sqlPtr, sqlLen + 1);

    const parser = Module._parser_create(sqlPtr, sqlLen);
    const tokenCount = Module._parser_get_token_count(parser);
    console.log('  SQL:', sql);
    console.log('  Token count:', tokenCount);
    console.log('  Result:', tokenCount >= 10 ? 'PASS' : 'FAIL');
    console.log('');

    // Test 3: Balanced parentheses
    console.log('Test 3: Checking balanced parentheses...');
    const balanced = Module._parser_check_balanced(parser);
    console.log('  Balanced:', balanced === 1 ? 'Yes' : 'No');
    console.log('  Result:', balanced === 1 ? 'PASS' : 'FAIL');
    console.log('');

    // Test 4: Validate tokens (no errors)
    console.log('Test 4: Validating tokens...');
    const valid = Module._parser_validate_tokens(parser);
    console.log('  Valid:', valid === 1 ? 'Yes' : 'No');
    console.log('  Result:', valid === 1 ? 'PASS' : 'FAIL');

    Module._parser_destroy(parser);
    Module._free(sqlPtr);

    // Test 5: Unbalanced parentheses detection
    console.log('');
    console.log('Test 5: Detecting unbalanced parentheses...');
    const badSql = 'SELECT (id FROM users';
    const badSqlLen = badSql.length;
    const badSqlPtr = Module._malloc(badSqlLen + 1);
    Module.stringToUTF8(badSql, badSqlPtr, badSqlLen + 1);

    const badParser = Module._parser_create(badSqlPtr, badSqlLen);
    const badBalanced = Module._parser_check_balanced(badParser);
    const unmatchedPos = Module._parser_get_unmatched_paren_pos(badParser);
    console.log('  SQL:', badSql);
    console.log('  Balanced:', badBalanced === 1 ? 'Yes' : 'No');
    console.log('  Unmatched paren at position:', unmatchedPos);
    console.log('  Result:', badBalanced === 0 && unmatchedPos >= 0 ? 'PASS' : 'FAIL');

    Module._parser_destroy(badParser);
    Module._free(badSqlPtr);

    console.log('');
    console.log('=== All parser tests complete ===');
})();
"
}

run_real_parser_tests() {
    log_info "Running REAL parser tests..."

    if [ ! -f "$SCRIPT_DIR/dist/real_parser.js" ]; then
        log_warn "Real Parser module not built. Building first..."
        build_real_parser_module
    fi

    # Run inline test for the REAL parser
    node -e "
const createRealParserModule = require('./dist/real_parser.js');
(async () => {
    console.log('=== REAL ClickHouse SQL Parser WASM Test ===\\n');

    const Module = await createRealParserModule();
    console.log('Real Parser module loaded successfully!\\n');

    // Test 1: Built-in self-test
    console.log('Test 1: Running built-in self-test...');
    const testResult = Module._real_parser_test();
    console.log('  Result:', testResult === 0 ? 'PASS' : 'FAIL (code: ' + testResult + ')');
    console.log('');

    // Test 2: Token count
    console.log('Test 2: Counting tokens...');
    const sql = 'SELECT id, name FROM users WHERE age > 21';
    const sqlLen = sql.length;
    const sqlPtr = Module._malloc(sqlLen + 1);
    Module.stringToUTF8(sql, sqlPtr, sqlLen + 1);

    const parser = Module._real_parser_create(sqlPtr, sqlLen);
    const tokenCount = Module._real_parser_get_token_count(parser);
    console.log('  SQL:', sql);
    console.log('  Token count:', tokenCount);
    console.log('  Result:', tokenCount >= 10 ? 'PASS' : 'FAIL');
    console.log('');

    // Test 3: Balanced parentheses
    console.log('Test 3: Checking balanced parentheses...');
    const balanced = Module._real_parser_check_balanced(parser);
    console.log('  Balanced:', balanced === 1 ? 'Yes' : 'No');
    console.log('  Result:', balanced === 1 ? 'PASS' : 'FAIL');
    console.log('');

    // Test 4: Parse SELECT keyword using REAL ParserKeyword
    console.log('Test 4: Parsing SELECT keyword with REAL ParserKeyword...');
    const endTokenPtr = Module._malloc(8);
    const keywordPtr = Module._malloc(16);
    Module.stringToUTF8('SELECT', keywordPtr, 16);

    const selectParsed = Module._real_parser_parse_keyword(parser, keywordPtr, 0, endTokenPtr);
    const endToken = Module.getValue(endTokenPtr, 'i32');
    console.log('  Keyword: SELECT');
    console.log('  Parsed:', selectParsed === 1 ? 'Yes' : 'No');
    console.log('  End token index:', endToken);
    console.log('  Result:', selectParsed === 1 ? 'PASS' : 'FAIL');

    Module._free(endTokenPtr);
    Module._free(keywordPtr);
    Module._real_parser_destroy(parser);
    Module._free(sqlPtr);

    // Test 5: Parse compound keyword (ORDER BY)
    console.log('');
    console.log('Test 5: Parsing compound keyword ORDER BY...');
    const sql2 = 'ORDER BY name ASC';
    const sql2Len = sql2.length;
    const sql2Ptr = Module._malloc(sql2Len + 1);
    Module.stringToUTF8(sql2, sql2Ptr, sql2Len + 1);

    const parser2 = Module._real_parser_create(sql2Ptr, sql2Len);
    const endTokenPtr2 = Module._malloc(8);
    const keywordPtr2 = Module._malloc(16);
    Module.stringToUTF8('ORDER BY', keywordPtr2, 16);

    const orderByParsed = Module._real_parser_parse_keyword(parser2, keywordPtr2, 0, endTokenPtr2);
    const endToken2 = Module.getValue(endTokenPtr2, 'i32');
    console.log('  SQL:', sql2);
    console.log('  Keyword: ORDER BY');
    console.log('  Parsed:', orderByParsed === 1 ? 'Yes' : 'No');
    console.log('  End token index:', endToken2);
    console.log('  Result:', orderByParsed === 1 ? 'PASS' : 'FAIL');

    Module._free(endTokenPtr2);
    Module._free(keywordPtr2);
    Module._real_parser_destroy(parser2);
    Module._free(sql2Ptr);

    console.log('');
    console.log('=== All REAL parser tests complete ===');
})();
"
}

run_executor_tests() {
    log_info "Running executor tests..."

    if [ ! -f "$SCRIPT_DIR/dist/executor.js" ]; then
        log_warn "Executor module not built. Building first..."
        build_executor_module
    fi

    # Run inline test
    node -e "
const createExecutorModule = require('./dist/executor.js');
(async () => {
    console.log('=== Minimal SQL Executor WASM Test ===\\n');

    const Module = await createExecutorModule();
    console.log('Executor module loaded successfully!');
    console.log('Version:', Module.UTF8ToString(Module._executor_version()));
    console.log('');

    // Test 1: Built-in self-test
    console.log('Test 1: Running built-in self-test...');
    const testResult = Module._executor_test();
    console.log('  Result:', testResult === 0 ? 'PASS' : 'FAIL (code: ' + testResult + ')');
    console.log('');

    // Create executor context
    const exec = Module._executor_create();

    // Helper function to run a query
    function runQuery(sql, format = 'CSV') {
        const sqlPtr = Module._malloc(sql.length + 1);
        Module.stringToUTF8(sql, sqlPtr, sql.length + 1);

        // Allocate format string in WASM memory
        const formatPtr = Module._malloc(format.length + 1);
        Module.stringToUTF8(format, formatPtr, format.length + 1);

        const result = Module._executor_query(exec, sqlPtr, sql.length, formatPtr);
        Module._free(sqlPtr);
        Module._free(formatPtr);

        if (result === 0) {
            const output = Module.UTF8ToString(Module._executor_get_result(exec));
            return { success: true, output };
        } else {
            const error = Module.UTF8ToString(Module._executor_get_error(exec));
            return { success: false, error };
        }
    }

    // Test 2: Simple integer literal
    console.log('Test 2: SELECT 1 + 2 AS result');
    let r = runQuery('SELECT 1 + 2 AS result');
    console.log('  Success:', r.success);
    if (r.success) {
        console.log('  Output:', r.output.trim());
        console.log('  Result:', r.output.includes('3') ? 'PASS' : 'FAIL');
    } else {
        console.log('  Error:', r.error);
    }
    console.log('');

    // Test 3: String literal
    console.log(\"Test 3: SELECT 'hello' AS greeting\");
    r = runQuery(\"SELECT 'hello' AS greeting\");
    console.log('  Success:', r.success);
    if (r.success) {
        console.log('  Output:', r.output.trim());
        console.log('  Result:', r.output.includes('hello') ? 'PASS' : 'FAIL');
    } else {
        console.log('  Error:', r.error);
    }
    console.log('');

    // Test 4: Complex expression
    console.log('Test 4: SELECT (1 + 2) * 3 - 4 AS calc');
    r = runQuery('SELECT (1 + 2) * 3 - 4 AS calc');
    console.log('  Success:', r.success);
    if (r.success) {
        console.log('  Output:', r.output.trim());
        // (1+2)*3-4 = 3*3-4 = 9-4 = 5
        console.log('  Result:', r.output.includes('5') ? 'PASS' : 'FAIL');
    } else {
        console.log('  Error:', r.error);
    }
    console.log('');

    // Test 5: Multiple columns
    console.log('Test 5: SELECT 1, 2, 3');
    r = runQuery('SELECT 1, 2, 3');
    console.log('  Success:', r.success);
    if (r.success) {
        console.log('  Output:', r.output.trim());
    }
    console.log('');

    // Test 6: JSON output
    console.log('Test 6: SELECT 42 AS answer (JSON format)');
    r = runQuery('SELECT 42 AS answer', 'JSON');
    console.log('  Success:', r.success);
    if (r.success) {
        console.log('  Output:', r.output);
    }
    console.log('');

    // Test 7: Float arithmetic
    console.log('Test 7: SELECT 3.14 * 2 AS pi_doubled');
    r = runQuery('SELECT 3.14 * 2 AS pi_doubled');
    console.log('  Success:', r.success);
    if (r.success) {
        console.log('  Output:', r.output.trim());
        console.log('  Result:', r.output.includes('6.28') ? 'PASS' : 'FAIL');
    }
    console.log('');

    // Clean up
    Module._executor_destroy(exec);

    console.log('=== All executor tests complete ===');
})();
"
}

run_storage_memory_real_tests() {
    log_info "Running REAL StorageMemory tests..."

    if [ ! -f "$SCRIPT_DIR/dist/storage_memory_real.js" ]; then
        log_warn "REAL StorageMemory module not built. Building first..."
        build_storage_memory_real_module
    fi

    # Run inline test
    node -e "
const createModule = require('./dist/storage_memory_real.js');
(async () => {
    console.log('=== REAL ClickHouse StorageMemory WASM Test ===\\n');

    const Module = await createModule();
    console.log('Module loaded successfully!');
    console.log('Version:', Module.UTF8ToString(Module._storage_memory_version()));
    console.log('');

    // Test 1: Built-in self-test
    console.log('Test 1: Running built-in self-test...');
    const testResult = Module._storage_memory_test();
    console.log('  Result:', testResult === 0 ? 'PASS' : 'FAIL (code: ' + testResult + ')');
    console.log('');

    // Create engine context
    const ctx = Module._storage_memory_create();

    // Helper function to run a query
    function runQuery(sql, format = 'CSV') {
        const sqlPtr = Module._malloc(sql.length + 1);
        Module.stringToUTF8(sql, sqlPtr, sql.length + 1);

        const formatPtr = Module._malloc(format.length + 1);
        Module.stringToUTF8(format, formatPtr, format.length + 1);

        const result = Module._storage_memory_query(ctx, sqlPtr, sql.length, formatPtr);
        Module._free(sqlPtr);
        Module._free(formatPtr);

        if (result === 0) {
            const output = Module.UTF8ToString(Module._storage_memory_get_result(ctx));
            return { success: true, output };
        } else {
            const error = Module.UTF8ToString(Module._storage_memory_get_error(ctx));
            return { success: false, error };
        }
    }

    // Test 2: Create table
    console.log('Test 2: CREATE TABLE products');
    let r = runQuery('CREATE TABLE products (id Int32, name String, price Float64) ENGINE = Memory');
    console.log('  Success:', r.success);
    if (r.success) console.log('  Output:', r.output.trim());
    else console.log('  Error:', r.error);
    console.log('');

    // Test 3: Insert data
    console.log('Test 3: INSERT INTO products');
    r = runQuery(\"INSERT INTO products VALUES (1, 'Widget', 9.99), (2, 'Gadget', 19.99), (3, 'Gizmo', 14.99)\");
    console.log('  Success:', r.success);
    if (r.success) console.log('  Output:', r.output.trim());
    else console.log('  Error:', r.error);
    console.log('');

    // Test 4: SELECT *
    console.log('Test 4: SELECT * FROM products');
    r = runQuery('SELECT * FROM products');
    console.log('  Success:', r.success);
    if (r.success) {
        console.log('  Output:');
        r.output.trim().split('\\n').forEach(line => console.log('    ' + line));
    } else {
        console.log('  Error:', r.error);
    }
    console.log('');

    // Test 5: SELECT with WHERE
    console.log('Test 5: SELECT name, price FROM products WHERE price > 10');
    r = runQuery('SELECT name, price FROM products WHERE price > 10');
    console.log('  Success:', r.success);
    if (r.success) {
        console.log('  Output:');
        r.output.trim().split('\\n').forEach(line => console.log('    ' + line));
        // Should have Gadget and Gizmo, but not Widget
        const hasGadget = r.output.includes('Gadget');
        const hasGizmo = r.output.includes('Gizmo');
        const hasWidget = r.output.includes('Widget');
        console.log('  Result:', hasGadget && hasGizmo && !hasWidget ? 'PASS' : 'FAIL');
    } else {
        console.log('  Error:', r.error);
    }
    console.log('');

    // Test 6: SELECT with expression
    console.log('Test 6: SELECT name, price * 2 AS double_price FROM products WHERE id = 1');
    r = runQuery('SELECT name, price * 2 AS double_price FROM products WHERE id = 1');
    console.log('  Success:', r.success);
    if (r.success) {
        console.log('  Output:');
        r.output.trim().split('\\n').forEach(line => console.log('    ' + line));
        // 9.99 * 2 = 19.98
        console.log('  Result:', r.output.includes('19.98') ? 'PASS' : 'FAIL');
    } else {
        console.log('  Error:', r.error);
    }
    console.log('');

    // Test 7: JSON output
    console.log('Test 7: SELECT * FROM products (JSON format)');
    r = runQuery('SELECT * FROM products', 'JSON');
    console.log('  Success:', r.success);
    if (r.success) {
        console.log('  Output (first 200 chars):');
        console.log('    ' + r.output.substring(0, 200));
    }
    console.log('');

    // Test 8: SHOW TABLES
    console.log('Test 8: SHOW TABLES');
    r = runQuery('SHOW TABLES');
    console.log('  Success:', r.success);
    if (r.success) {
        console.log('  Output:', r.output.trim());
        console.log('  Result:', r.output.includes('products') ? 'PASS' : 'FAIL');
    }
    console.log('');

    // Test 9: TRUNCATE TABLE
    console.log('Test 9: TRUNCATE TABLE products');
    r = runQuery('TRUNCATE TABLE products');
    console.log('  Success:', r.success);
    if (r.success) console.log('  Output:', r.output.trim());
    console.log('');

    // Verify truncate
    console.log('Test 9b: Verify truncate (SELECT * FROM products)');
    r = runQuery('SELECT * FROM products');
    console.log('  Success:', r.success);
    // Should only have header, no data
    const lines = r.output.trim().split('\\n').filter(l => l.trim());
    console.log('  Row count:', lines.length - 1);  // -1 for header
    console.log('  Result:', lines.length === 1 ? 'PASS' : 'FAIL');
    console.log('');

    // Test 10: DROP TABLE
    console.log('Test 10: DROP TABLE products');
    r = runQuery('DROP TABLE products');
    console.log('  Success:', r.success);
    if (r.success) console.log('  Output:', r.output.trim());
    console.log('');

    // Clean up
    Module._storage_memory_destroy(ctx);

    console.log('=== All REAL StorageMemory tests complete ===');
})();
"
}

create_test_script() {
    cat > "$SCRIPT_DIR/test_lexer.cjs" << 'TESTEOF'
/**
 * test_lexer.cjs - Test the ClickHouse SQL Lexer WASM module
 */

const path = require('path');

async function main() {
    console.log('=== ClickHouse SQL Lexer WASM Test ===\n');

    // Load the module
    const createLexerModule = require('./dist/lexer.js');
    const Module = await createLexerModule();

    console.log('Module loaded successfully!\n');

    // Test 1: Basic lexer test function
    console.log('Test 1: Running built-in self-test...');
    const testResult = Module._lexer_test();
    console.log(`  Result: ${testResult === 0 ? 'PASS' : 'FAIL (code: ' + testResult + ')'}\n`);

    // Test 2: Tokenize a SQL query
    console.log('Test 2: Tokenizing SQL query...');
    const sql = 'SELECT id, name FROM users WHERE age > 21';
    console.log(`  SQL: "${sql}"\n`);

    // Allocate memory for the SQL string
    const sqlLen = sql.length;
    const sqlPtr = Module._malloc(sqlLen + 1);
    Module.stringToUTF8(sql, sqlPtr, sqlLen + 1);

    // Create lexer
    const lexer = Module._lexer_create(sqlPtr, sqlLen);
    if (!lexer) {
        console.log('  ERROR: Failed to create lexer');
        return 1;
    }

    // Tokenize
    console.log('  Tokens:');
    let tokenCount = 0;
    let significantTokens = [];

    while (true) {
        const tokenType = Module._lexer_next_token(lexer);
        const begin = Module._lexer_get_token_begin(lexer);
        const end = Module._lexer_get_token_end(lexer);
        const typeName = Module.UTF8ToString(Module._token_type_name(tokenType));
        const tokenText = sql.substring(begin, end);

        tokenCount++;

        if (Module._lexer_token_is_end(tokenType)) {
            break;
        }

        if (Module._lexer_token_is_significant(tokenType)) {
            significantTokens.push({ type: typeName, text: tokenText });
            console.log(`    ${typeName.padEnd(20)} "${tokenText}"`);
        }

        if (Module._lexer_token_is_error(tokenType)) {
            console.log(`  ERROR: Token error at position ${begin}`);
            break;
        }
    }

    // Cleanup
    Module._lexer_destroy(lexer);
    Module._free(sqlPtr);

    console.log(`\n  Total tokens: ${tokenCount}`);
    console.log(`  Significant tokens: ${significantTokens.length}`);

    // Verify expected tokens
    const expectedTokens = ['SELECT', 'id', ',', 'name', 'FROM', 'users', 'WHERE', 'age', '>', '21'];
    const actualTexts = significantTokens.map(t => t.text);
    const allMatch = expectedTokens.every((t, i) => actualTexts[i] === t);

    console.log(`\n  Verification: ${allMatch ? 'PASS' : 'FAIL'}`);

    console.log('\n=== All tests complete ===');
    return allMatch ? 0 : 1;
}

main().then(code => process.exit(code)).catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
TESTEOF
}

# =============================================================================
# Main
# =============================================================================

echo ""
echo "=================================================="
echo "  chdb-wasm Unified Build System"
echo "=================================================="
echo ""

setup_emscripten

echo "emcc version: $(emcc --version | head -1)"
echo ""

case "${1:-all}" in
    # Individual module builds
    lexer)
        build_lexer_module
        ;;
    standalone)
        build_lexer_standalone
        ;;
    parser)
        build_parser_module
        ;;
    real-parser)
        build_real_parser_module
        ;;
    executor)
        build_executor_module
        ;;
    functions)
        build_functions_standalone_module
        ;;
    aggregates)
        build_aggregates_module
        ;;
    memory-engine)
        build_memory_engine_module
        ;;
    storage-memory-real)
        build_storage_memory_real_module
        ;;
    json-format)
        build_json_format_module
        ;;
    csv-format)
        build_csv_format_module
        ;;
    url-table)
        build_url_table_function_module
        ;;
    vfs)
        build_vfs_module
        ;;
    mergetree)
        build_mergetree_module
        ;;

    # Master build targets
    all)
        build_all
        ;;
    all-modules)
        build_all_modules
        ;;

    # Config-specific builds
    chdb-minimal)
        build_chdb_minimal
        ;;
    chdb-fetch)
        build_chdb_fetch
        ;;

    # Utilities
    size-report)
        show_size_report
        ;;
    clean)
        clean
        ;;

    # Testing
    test)
        run_tests
        ;;
    test-parser)
        run_parser_tests
        ;;
    test-real-parser)
        run_real_parser_tests
        ;;
    test-executor)
        run_executor_tests
        ;;
    test-functions)
        run_functions_tests
        ;;
    test-storage-memory-real)
        run_storage_memory_real_tests
        ;;
    test-mergetree)
        run_mergetree_tests
        ;;

    # Help
    help|-h|--help)
        echo "Usage: $0 [command]"
        echo ""
        echo "chdb-wasm Unified Build System"
        echo ""
        echo "Individual Module Builds:"
        echo "  executor             Build minimal SQL executor (~132KB)"
        echo "  functions            Build REAL chdb comparison functions (AccurateComparison)"
        echo "  memory-engine        Build Memory Engine module (~162KB)"
        echo "  storage-memory-real  Build REAL ClickHouse StorageMemory patterns"
        echo "  aggregates           Build SQL executor with aggregates (~153KB)"
        echo "  json-format          Build JSON format parser"
        echo "  csv-format           Build CSV/TSV format parser"
        echo "  lexer                Build Lexer module with JS bindings"
        echo "  parser               Build Parser module with JS bindings"
        echo "  real-parser          Build REAL chdb Parser with PARSER_STANDALONE_BUILD"
        echo "  standalone           Build standalone Lexer WASM (no JS)"
        echo "  url-table            Build URL table function module"
        echo "  vfs                  Build VFS module for MergeTree (DO/R2 bridge)"
        echo "  mergetree            Build MergeTree reader module (part reading)"
        echo ""
        echo "Master Build Targets:"
        echo "  all              Build all components (default)"
        echo "  all-modules      Build all 5 core WASM modules"
        echo ""
        echo "Config-specific Builds:"
        echo "  chdb-minimal     Build: executor + memory + aggregates"
        echo "  chdb-fetch       Build: + json + csv (for URL data)"
        echo ""
        echo "Utilities:"
        echo "  size-report      Show all module sizes and estimates"
        echo "  clean            Clean build directory"
        echo ""
        echo "Testing:"
        echo "  test                     Test Lexer module"
        echo "  test-parser              Test Parser module"
        echo "  test-executor            Test Executor module"
        echo "  test-functions           Test REAL chdb Functions module"
        echo "  test-storage-memory-real Test REAL StorageMemory module"
        echo "  test-mergetree           Test MergeTree reader module"
        echo ""
        echo "Examples:"
        echo "  $0 chdb-minimal  # Build minimal bundle for Cloudflare"
        echo "  $0 size-report   # Show current module sizes"
        echo "  $0 all-modules   # Build all modules and show report"
        echo ""
        exit 0
        ;;

    *)
        echo "Unknown command: $1"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Run '$0 help' for available commands."
        exit 1
        ;;
esac
