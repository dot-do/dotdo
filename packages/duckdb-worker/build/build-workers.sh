#!/bin/bash
# =============================================================================
# DuckDB WASM Build Script for Cloudflare Workers
# =============================================================================
#
# This script builds DuckDB to WASM with Workers-compatible flags.
# It produces a minimal WASM binary without problematic imports.
#
# Key optimizations:
# - No dynamic linking (GOT.func, GOT.mem removed)
# - Single-threaded (no pthread/SharedArrayBuffer)
# - Memory-only filesystem (MEMFS)
# - Minimal import requirements for Workers instantiation
# - Size-optimized with -Oz and closure compiler
#
# Usage: ./build-workers.sh [--debug|--release|--size]
#
set -e

# Configuration
BUILD_TYPE="${1:---release}"
DUCKDB_DIR="/build/duckdb"
BUILD_DIR="${DUCKDB_DIR}/build-wasm"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"
SIZE_OPTIMIZED=false
MINIMAL_BUILD=false

# Check for --minimal flag
if [[ "$*" == *"--minimal"* ]]; then
    MINIMAL_BUILD=true
fi

echo "=============================================="
echo "DuckDB WASM Build for Cloudflare Workers"
echo "=============================================="
echo "Build type: ${BUILD_TYPE}"
echo "DuckDB source: ${DUCKDB_DIR}"
echo "Output directory: ${OUTPUT_DIR}"
echo ""

# Apply Emscripten-specific modifications
echo "Applying Emscripten modifications..."
cd "${DUCKDB_DIR}"

# Make Threads optional for Emscripten builds
# DuckDB has find_package(Threads REQUIRED) in multiple CMakeLists.txt files
# We need to patch all of them AND create a stub Threads::Threads target
echo "  Making Threads optional for Emscripten..."

# Find and patch all CMakeLists.txt files that require Threads
for file in $(find . -name "CMakeLists.txt" -exec grep -l "find_package(Threads REQUIRED)" {} \;); do
    echo "    Patching $file..."
    # Use | as delimiter since file paths contain /
    # For Emscripten: skip find_package but create an empty Threads::Threads interface target
    sed -i 's|find_package(Threads REQUIRED)|if(NOT EMSCRIPTEN)\n  find_package(Threads REQUIRED)\nelse()\n  message(STATUS "Emscripten: creating stub Threads::Threads")\n  if(NOT TARGET Threads::Threads)\n    add_library(Threads::Threads INTERFACE IMPORTED)\n  endif()\nendif()|g' "$file"
done

# Apply any additional patches if they exist
if [ -d "/build/patches" ] && [ "$(ls -A /build/patches 2>/dev/null)" ]; then
    echo "Applying patches..."
    for patch in /build/patches/*.patch; do
        if [ -f "$patch" ]; then
            echo "  Applying $(basename $patch)..."
            git apply "$patch" || echo "  Warning: Patch may already be applied"
        fi
    done
fi
echo ""

# Clean previous build
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"

cd "${DUCKDB_DIR}"

# -----------------------------------------------------------------------------
# Emscripten Configuration
# -----------------------------------------------------------------------------
# These flags produce a Workers-compatible WASM module

# Core Emscripten flags for Workers compatibility
EMCC_FLAGS=(
    # Disable dynamic linking (removes GOT.func/GOT.mem)
    "-sMAIN_MODULE=0"
    "-sDYNAMIC_EXECUTION=0"
    "-sRELOCATABLE=0"

    # Memory configuration
    "-sINITIAL_MEMORY=16777216"      # 16MB initial
    "-sMAXIMUM_MEMORY=134217728"      # 128MB max (Workers limit)
    "-sALLOW_MEMORY_GROWTH=1"
    "-sSTACK_SIZE=1048576"            # 1MB stack

    # Single-threaded (Workers constraint)
    "-sUSE_PTHREADS=0"
    "-sSINGLE_FILE=0"

    # Filesystem - DISABLED for Workers (memory-only via runtime.ts)
    "-sFILESYSTEM=0"
    "-sNODERAWFS=0"

    # Module configuration
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sEXPORT_NAME='createDuckDB'"
    "-sENVIRONMENT=web"

    # Export settings
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','stringToUTF8','lengthBytesUTF8','stackSave','stackRestore','stackAlloc']"

    # Exported functions (DuckDB C API)
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_duckdb_open','_duckdb_open_ext','_duckdb_close','_duckdb_connect','_duckdb_disconnect','_duckdb_query','_duckdb_destroy_result','_duckdb_column_count','_duckdb_row_count','_duckdb_column_name','_duckdb_column_type','_duckdb_value_varchar','_duckdb_value_int64','_duckdb_value_double','_duckdb_value_is_null','_duckdb_result_error','_duckdb_prepare','_duckdb_bind_boolean','_duckdb_bind_int32','_duckdb_bind_int64','_duckdb_bind_double','_duckdb_bind_varchar','_duckdb_bind_null','_duckdb_execute_prepared','_duckdb_destroy_prepare','_duckdb_appender_create','_duckdb_appender_destroy','_duckdb_append_bool','_duckdb_append_int32','_duckdb_append_int64','_duckdb_append_double','_duckdb_append_varchar','_duckdb_append_null','_duckdb_appender_end_row','_duckdb_appender_flush','_duckdb_appender_close']"

    # Disable features not needed in Workers
    "-sASSERTIONS=0"
    "-sDISABLE_EXCEPTION_CATCHING=1"
    "-sNO_EXIT_RUNTIME=1"
    "-sABORTING_MALLOC=0"

    # WASI compatibility (minimal)
    "-sSTANDALONE_WASM=0"

    # Error handling
    "-sERROR_ON_UNDEFINED_SYMBOLS=0"
)

# Build-type specific flags
case "${BUILD_TYPE}" in
    --debug)
        echo "Building DEBUG configuration..."
        EMCC_FLAGS+=(
            "-O0"
            "-g3"
            "-sASSERTIONS=2"
            "-sSAFE_HEAP=1"
        )
        CMAKE_BUILD_TYPE="Debug"
        ;;
    --size)
        echo "Building SIZE-OPTIMIZED configuration..."
        EMCC_FLAGS+=(
            "-Oz"                      # Optimize for size
            "-flto=thin"               # Thin LTO (faster, still good size reduction)
            "-fno-exceptions"          # No C++ exceptions
            "-fno-rtti"                # No runtime type info
            "-sEVAL_CTORS=1"           # Evaluate constructors at compile time
            "-sEMIT_SYMBOL_MAP=0"      # No symbol map
            "-sSUPPORT_LONGJMP=0"      # Disable longjmp support
        )
        CMAKE_BUILD_TYPE="MinSizeRel"
        SIZE_OPTIMIZED=true
        ;;
    --release|*)
        echo "Building RELEASE configuration..."
        # Note: LTO disabled due to incompatibility with Emscripten system libraries
        # (causes "attempt to add bitcode file after LTO" errors with htons/htonl)
        EMCC_FLAGS+=(
            "-O3"
        )
        CMAKE_BUILD_TYPE="Release"
        ;;
esac

# Join flags for CMake
EMCC_CFLAGS="${EMCC_FLAGS[*]}"
EMCC_LDFLAGS="${EMCC_FLAGS[*]}"

# -----------------------------------------------------------------------------
# CMake Configuration
# -----------------------------------------------------------------------------

echo ""
echo "Configuring CMake..."
echo ""

emcmake cmake -B "${BUILD_DIR}" \
    -G Ninja \
    -DCMAKE_BUILD_TYPE="${CMAKE_BUILD_TYPE}" \
    -DCMAKE_C_FLAGS="${EMCC_CFLAGS}" \
    -DCMAKE_CXX_FLAGS="${EMCC_CFLAGS}" \
    -DCMAKE_EXE_LINKER_FLAGS="${EMCC_LDFLAGS}" \
    \
    -DBUILD_SHELL=OFF \
    -DBUILD_UNITTESTS=OFF \
    -DBUILD_BENCHMARKS=OFF \
    -DBUILD_PARQUET_EXTENSION=$([ "${MINIMAL_BUILD}" = true ] && echo "OFF" || echo "ON") \
    -DBUILD_JSON_EXTENSION=ON \
    -DBUILD_JEMALLOC_EXTENSION=OFF \
    -DBUILD_ICU_EXTENSION=OFF \
    -DBUILD_TPCH_EXTENSION=OFF \
    -DBUILD_TPCDS_EXTENSION=OFF \
    -DBUILD_FTS_EXTENSION=OFF \
    -DBUILD_HTTPFS_EXTENSION=OFF \
    -DBUILD_VISUALIZER_EXTENSION=OFF \
    -DBUILD_SUBSTRAIT_EXTENSION=OFF \
    \
    -DENABLE_EXTENSION_AUTOLOADING=OFF \
    -DENABLE_SANITIZER=OFF \
    -DENABLE_UBSAN=OFF \
    -DENABLE_THREAD_SANITIZER=OFF \
    \
    -DDUCKDB_EXPLICIT_PLATFORM="wasm32-emscripten" \
    -DFORCE_ASSERT_EVERYTHING=OFF \
    -DDISABLE_UNITY=ON

# -----------------------------------------------------------------------------
# Build
# -----------------------------------------------------------------------------

echo ""
echo "Building DuckDB WASM..."
echo ""

# Detect number of CPUs for parallel build
NPROC=$(nproc 2>/dev/null || echo 4)
cmake --build "${BUILD_DIR}" --parallel "${NPROC}"

# -----------------------------------------------------------------------------
# Link WASM Module
# -----------------------------------------------------------------------------

echo ""
echo "Linking DuckDB WASM module..."
echo ""

mkdir -p "${OUTPUT_DIR}"

# Find all static libraries needed for linking
# DuckDB is split across many .a files that must be linked together
echo "Finding static libraries..."

ALL_LIBS=""

# Main DuckDB static lib
STATIC_LIB="${BUILD_DIR}/src/libduckdb_static.a"
if [ -f "${STATIC_LIB}" ]; then
    ALL_LIBS="${ALL_LIBS} ${STATIC_LIB}"
    echo "  Found: libduckdb_static.a"
fi

# Third-party libraries (order matters for symbol resolution)
for lib in \
    third_party/fmt/libduckdb_fmt.a \
    third_party/re2/libduckdb_re2.a \
    third_party/miniz/libduckdb_miniz.a \
    third_party/utf8proc/libduckdb_utf8proc.a \
    third_party/hyperloglog/libduckdb_hyperloglog.a \
    third_party/fastpforlib/libduckdb_fastpforlib.a \
    third_party/mbedtls/libduckdb_mbedtls.a \
    third_party/fsst/libduckdb_fsst.a \
    third_party/yyjson/libduckdb_yyjson.a \
    third_party/libpg_query/libduckdb_pg_query.a \
    third_party/skiplist/libduckdb_skiplistlib.a \
    extension/parquet/libparquet_extension.a; do
    if [ -f "${BUILD_DIR}/${lib}" ]; then
        ALL_LIBS="${ALL_LIBS} ${BUILD_DIR}/${lib}"
        echo "  Found: $(basename ${lib})"
    fi
done

if [ -z "${ALL_LIBS}" ]; then
    echo "ERROR: No static libraries found!"
    exit 1
fi

echo "Linking ${ALL_LIBS}"

# Set optimization level based on build type
if [ "${SIZE_OPTIMIZED}" = true ]; then
    OPT_LEVEL="-Oz"
    echo "Using size optimization (-Oz)"
else
    OPT_LEVEL="-O3"
    echo "Using performance optimization (-O3)"
fi

# Link all static libraries into a WASM module with ES6 exports
# Use --whole-archive to ensure all symbols are included
emcc \
    -Wl,--whole-archive ${ALL_LIBS} -Wl,--no-whole-archive \
    -o "${OUTPUT_DIR}/duckdb-worker.js" \
    -sMAIN_MODULE=0 \
    -sDYNAMIC_EXECUTION=0 \
    -sRELOCATABLE=0 \
    -sINITIAL_MEMORY=16777216 \
    -sMAXIMUM_MEMORY=134217728 \
    -sALLOW_MEMORY_GROWTH=1 \
    -sSTACK_SIZE=1048576 \
    -sUSE_PTHREADS=0 \
    -sFILESYSTEM=0 \
    -sMODULARIZE=1 \
    -sEXPORT_ES6=1 \
    -sEXPORT_NAME='createDuckDB' \
    -sENVIRONMENT=web \
    -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","lengthBytesUTF8","stackSave","stackRestore","stackAlloc"]' \
    -sEXPORTED_FUNCTIONS='["_malloc","_free","_duckdb_open","_duckdb_open_ext","_duckdb_close","_duckdb_connect","_duckdb_disconnect","_duckdb_query","_duckdb_destroy_result","_duckdb_column_count","_duckdb_row_count","_duckdb_column_name","_duckdb_column_type","_duckdb_value_varchar","_duckdb_value_int64","_duckdb_value_double","_duckdb_value_is_null","_duckdb_result_error","_duckdb_prepare","_duckdb_bind_boolean","_duckdb_bind_int32","_duckdb_bind_int64","_duckdb_bind_double","_duckdb_bind_varchar","_duckdb_bind_null","_duckdb_execute_prepared","_duckdb_destroy_prepare","_duckdb_appender_create","_duckdb_appender_destroy","_duckdb_append_bool","_duckdb_append_int32","_duckdb_append_int64","_duckdb_append_double","_duckdb_append_varchar","_duckdb_append_null","_duckdb_appender_end_row","_duckdb_appender_flush","_duckdb_appender_close"]' \
    -sASSERTIONS=0 \
    -sDISABLE_EXCEPTION_CATCHING=1 \
    -sNO_EXIT_RUNTIME=1 \
    -sABORTING_MALLOC=0 \
    -sERROR_ON_UNDEFINED_SYMBOLS=0 \
    ${OPT_LEVEL}

echo "Linking complete!"

# Check for generated files
WASM_FILE="${OUTPUT_DIR}/duckdb-worker.wasm"
JS_FILE="${OUTPUT_DIR}/duckdb-worker.js"

if [ ! -f "${WASM_FILE}" ]; then
    echo "ERROR: WASM file not generated!"
    exit 1
fi

echo "Generated WASM: ${WASM_FILE}"
echo "Generated JS: ${JS_FILE}"

# Generate WASM info
echo ""
echo "WASM Analysis:"
echo "--------------"
wasm-objdump -h "${OUTPUT_DIR}/duckdb-worker.wasm" 2>/dev/null || true

# Check for problematic imports
echo ""
echo "Import Analysis:"
echo "----------------"
if command -v wasm-objdump &> /dev/null; then
    IMPORTS=$(wasm-objdump -j Import -x "${OUTPUT_DIR}/duckdb-worker.wasm" 2>/dev/null || true)
    echo "${IMPORTS}"

    # Check for GOT imports (problematic for Workers)
    if echo "${IMPORTS}" | grep -q "GOT"; then
        echo ""
        echo "WARNING: WASM contains GOT imports which may cause issues in Workers!"
        echo "Consider using -sRELOCATABLE=0 and -sMAIN_MODULE=0"
    fi
fi

# File size info
WASM_SIZE=$(stat -c%s "${OUTPUT_DIR}/duckdb-worker.wasm" 2>/dev/null || stat -f%z "${OUTPUT_DIR}/duckdb-worker.wasm" 2>/dev/null || echo "unknown")
echo ""
echo "Output file size: ${WASM_SIZE} bytes"

# Generate TypeScript declarations helper
cat > "${OUTPUT_DIR}/duckdb-worker.d.ts" << 'EOF'
/**
 * DuckDB WASM Module for Cloudflare Workers
 * Auto-generated type declarations
 */

export interface DuckDBModule {
  // Memory views
  HEAP8: Int8Array;
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;

  // Runtime methods
  ccall(ident: string, returnType: string | null, argTypes: string[], args: unknown[]): unknown;
  cwrap(ident: string, returnType: string | null, argTypes: string[]): (...args: unknown[]) => unknown;
  UTF8ToString(ptr: number, maxBytesToRead?: number): string;
  stringToUTF8(str: string, outPtr: number, maxBytesToWrite: number): void;
  lengthBytesUTF8(str: string): number;
  stackSave(): number;
  stackRestore(ptr: number): void;
  stackAlloc(size: number): number;

  // Memory management
  _malloc(size: number): number;
  _free(ptr: number): void;

  // DuckDB C API
  _duckdb_open(path: number, outDb: number): number;
  _duckdb_open_ext(path: number, outDb: number, config: number, outError: number): number;
  _duckdb_close(db: number): void;
  _duckdb_connect(db: number, outConn: number): number;
  _duckdb_disconnect(conn: number): void;
  _duckdb_query(conn: number, query: number, outResult: number): number;
  _duckdb_destroy_result(result: number): void;
  _duckdb_column_count(result: number): number;
  _duckdb_row_count(result: number): bigint;
  _duckdb_column_name(result: number, col: number): number;
  _duckdb_column_type(result: number, col: number): number;
  _duckdb_value_varchar(result: number, col: number, row: number): number;
  _duckdb_value_int64(result: number, col: number, row: number): bigint;
  _duckdb_value_double(result: number, col: number, row: number): number;
  _duckdb_value_is_null(result: number, col: number, row: number): number;
  _duckdb_result_error(result: number): number;

  // Prepared statements
  _duckdb_prepare(conn: number, query: number, outStmt: number): number;
  _duckdb_bind_boolean(stmt: number, idx: number, val: number): number;
  _duckdb_bind_int32(stmt: number, idx: number, val: number): number;
  _duckdb_bind_int64(stmt: number, idx: number, val: bigint): number;
  _duckdb_bind_double(stmt: number, idx: number, val: number): number;
  _duckdb_bind_varchar(stmt: number, idx: number, val: number): number;
  _duckdb_bind_null(stmt: number, idx: number): number;
  _duckdb_execute_prepared(stmt: number, outResult: number): number;
  _duckdb_destroy_prepare(stmt: number): void;

  // Appender API
  _duckdb_appender_create(conn: number, schema: number, table: number, outAppender: number): number;
  _duckdb_appender_destroy(appender: number): number;
  _duckdb_append_bool(appender: number, val: number): number;
  _duckdb_append_int32(appender: number, val: number): number;
  _duckdb_append_int64(appender: number, val: bigint): number;
  _duckdb_append_double(appender: number, val: number): number;
  _duckdb_append_varchar(appender: number, val: number): number;
  _duckdb_append_null(appender: number): number;
  _duckdb_appender_end_row(appender: number): number;
  _duckdb_appender_flush(appender: number): number;
  _duckdb_appender_close(appender: number): number;
}

export interface DuckDBModuleConfig {
  locateFile?: (path: string, prefix: string) => string;
  wasmBinary?: ArrayBuffer;
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void
  ) => void;
}

export default function createDuckDB(config?: DuckDBModuleConfig): Promise<DuckDBModule>;
EOF

echo ""
echo "=============================================="
echo "Build Complete!"
echo "=============================================="
echo "Output files:"
ls -la "${OUTPUT_DIR}"
echo ""
echo "To use in Workers, import the WASM file statically:"
echo "  import wasmModule from './duckdb-worker.wasm'"
