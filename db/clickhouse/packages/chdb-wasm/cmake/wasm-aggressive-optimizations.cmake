# wasm-aggressive-optimizations.cmake
# Aggressive WASM build optimizations for chdb to minimize binary size
#
# Based on DuckDB's successful WASM optimization strategy that achieves ~10MB binaries.
# This module configures the most aggressive size reduction settings possible.
#
# Usage:
#   include(cmake/wasm-aggressive-optimizations.cmake)
#   # Then call: chdb_apply_aggressive_wasm_optimizations(target_name)
#
# Key Optimizations:
#   1. Emscripten optimization flags (-Oz, -flto, --closure 1)
#   2. Post-build wasm-opt integration (-Oz passes)
#   3. Symbol stripping and minimal exports
#   4. Memory optimization for edge environments
#   5. Dead code elimination and tree shaking

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  AGGRESSIVE WASM Optimization Configuration")
message(STATUS "  Inspired by DuckDB WASM's ~10MB achievement")
message(STATUS "================================================================")
message(STATUS "")

# ============================================================================
# Configuration Options
# ============================================================================

option(CHDB_WASM_AGGRESSIVE_SIZE "Enable most aggressive size optimizations" ON)
option(CHDB_WASM_USE_CLOSURE "Enable Closure Compiler for JS minification" ON)
option(CHDB_WASM_USE_WASM_OPT "Enable wasm-opt post-processing" ON)
option(CHDB_WASM_MINIMAL_RUNTIME "Use Emscripten minimal runtime" OFF)
option(CHDB_WASM_NO_FILESYSTEM "Disable filesystem support completely" OFF)
option(CHDB_WASM_STRIP_DEBUG "Strip all debug symbols" ON)

# ============================================================================
# 1. Emscripten Optimization Flags
# ============================================================================
# These flags are the core of size optimization, following DuckDB's approach.

# Size-focused compilation flags
set(CHDB_AGGRESSIVE_COMPILE_FLAGS
    # Primary size optimization
    "-Oz"                            # Optimize aggressively for size (smaller than -Os)

    # Link-time optimization for cross-module DCE
    # NOTE: LTO disabled - causes "attempt to add bitcode file after LTO" errors
    # with Emscripten when mixing LTO and non-LTO object files (e.g., libc htonl.o)
    # "-flto"                        # Full LTO (disabled due to bitcode compatibility)

    # Disable C++ runtime features we don't need
    "-fno-exceptions"                # Disable C++ exceptions (~5-10% size reduction)
    "-fno-rtti"                      # Disable runtime type information (~3-5% reduction)
    "-fno-unwind-tables"             # No stack unwinding tables
    "-fno-asynchronous-unwind-tables"

    # Enable dead code elimination
    "-ffunction-sections"            # Put each function in own section
    "-fdata-sections"                # Put each data item in own section

    # Symbol visibility for better stripping
    "-fvisibility=hidden"            # Default to hidden visibility
    "-fvisibility-inlines-hidden"    # Hide inline functions

    # Miscellaneous size reductions
    "-fmerge-all-constants"          # Merge identical constants
    "-fno-common"                    # Put uninitialized globals in .bss
    "-fno-math-errno"                # Don't set errno for math functions
    "-fno-signed-zeros"              # Treat -0.0 == +0.0
    "-fno-trapping-math"             # Allow optimizations assuming no FP traps
    "-fomit-frame-pointer"           # Don't save frame pointer (saves stack ops)
    "-fno-stack-protector"           # No stack protector (WASM is sandboxed)
    "-fno-ident"                     # Don't emit compiler identification
    "-fno-threadsafe-statics"        # No thread-safe static init (single-threaded)
)

# Modern WASM features (supported by all modern browsers)
set(CHDB_AGGRESSIVE_WASM_FEATURES
    "-msimd128"                      # SIMD for vectorized operations
    "-mbulk-memory"                  # Efficient memory operations
    "-mnontrapping-fptoint"          # Non-trapping float-to-int
    "-msign-ext"                     # Sign extension instructions
    "-mmutable-globals"              # Mutable global imports/exports
    "-mreference-types"              # Reference types support
)

message(STATUS "[Compile Flags]")
message(STATUS "  -Oz: Maximum size optimization")
message(STATUS "  -flto: DISABLED (bitcode compatibility issues)")
message(STATUS "  -fno-exceptions: C++ exceptions disabled")
message(STATUS "  -fno-rtti: Runtime type info disabled")
message(STATUS "  WASM features: SIMD, bulk-memory, sign-ext")

# ============================================================================
# 2. Emscripten Linker Flags for Size
# ============================================================================

# Core linker optimization flags
# Note: --gc-sections is NOT supported by wasm-ld (emscripten linker)
# Dead code elimination is handled by -Oz and -sELIMINATE_DUPLICATE_FUNCTIONS instead
set(CHDB_AGGRESSIVE_LINK_FLAGS
    # Size optimization
    "-Oz"
    # "-flto"                        # Disabled - causes bitcode compatibility issues

    # Closure Compiler for JavaScript minification
    # Level 1: Simple optimizations (safe)
    # Level 2: Advanced optimizations (may break some JS interop)
    "--closure=1"

    # Disable runtime assertions
    "-sASSERTIONS=0"

    # Evaluate constructors at compile time
    "-sEVAL_CTORS=2"

    # Use smallest memory allocator (emmalloc for single-threaded)
    "-sMALLOC=emmalloc"

    # Dead code elimination (wasm-ld native method)
    "-sELIMINATE_DUPLICATE_FUNCTIONS=1"

    # Disable features we don't need
    "-sSUPPORT_LONGJMP=0"
    "-sDISABLE_EXCEPTION_CATCHING=1"

    # Runtime behavior
    "-sABORTING_MALLOC=0"            # Return null on malloc failure
    "-sNO_EXIT_RUNTIME=1"            # Keep runtime alive

    # Minimal inlining (smaller code)
    "-sINLINING_LIMIT=1"

    # Use TextDecoder (smaller than manual UTF-8)
    "-sTEXTDECODER=2"

    # Don't require main()
    "-sIGNORE_MISSING_MAIN=1"
)

# Optional: Minimal runtime (very aggressive, may break some features)
if(CHDB_WASM_MINIMAL_RUNTIME)
    list(APPEND CHDB_AGGRESSIVE_LINK_FLAGS
        "-sMINIMAL_RUNTIME=1"
        "-sSUPPORT_ERRNO=0"
        "-sAUTO_JS_LIBRARIES=0"
        "-sAUTO_ARCHIVE_INDEXES=0"
    )
    message(STATUS "  MINIMAL_RUNTIME: Enabled (experimental)")
endif()

# Optional: Disable filesystem completely
if(CHDB_WASM_NO_FILESYSTEM)
    list(APPEND CHDB_AGGRESSIVE_LINK_FLAGS
        "-sFILESYSTEM=0"
        "-sNO_FILESYSTEM=1"
    )
    message(STATUS "  FILESYSTEM: Disabled (pure memory mode)")
else()
    # Use minimal filesystem if needed
    list(APPEND CHDB_AGGRESSIVE_LINK_FLAGS
        "-sFORCE_FILESYSTEM=0"
    )
endif()

message(STATUS "[Linker Flags]")
message(STATUS "  Closure Compiler: Level 1")
message(STATUS "  Assertions: Disabled")
message(STATUS "  Exception catching: Disabled")
message(STATUS "  Allocator: emmalloc")

# ============================================================================
# 3. Memory Optimization for Edge Environments
# ============================================================================
# Cloudflare Workers: 128MB memory limit
# AWS Lambda@Edge: 128MB
# Vercel Edge: 128MB
# Browsers: 2-4GB typically addressable

set(CHDB_AGGRESSIVE_MEMORY_FLAGS
    # Start with small initial memory
    "-sINITIAL_MEMORY=16777216"      # 16MB initial (minimum for chdb)

    # Maximum memory for edge environments
    "-sMAXIMUM_MEMORY=536870912"     # 512MB max (adjustable)

    # Stack size
    "-sSTACK_SIZE=524288"            # 512KB stack

    # Allow memory to grow
    "-sALLOW_MEMORY_GROWTH=1"

    # Geometric memory growth (more efficient than linear)
    "-sMEMORY_GROWTH_GEOMETRIC_STEP=0.20"   # Grow by 20%
    "-sMEMORY_GROWTH_GEOMETRIC_CAP=67108864" # Cap growth at 64MB per step
)

message(STATUS "[Memory Configuration]")
message(STATUS "  Initial: 16MB")
message(STATUS "  Maximum: 512MB")
message(STATUS "  Stack: 512KB")
message(STATUS "  Growth: Geometric (20% steps, 64MB cap)")

# ============================================================================
# 4. Symbol Stripping and Export Configuration
# ============================================================================

# Minimal exports - only what's needed for the API
set(CHDB_MINIMAL_EXPORTS
    "_malloc"
    "_free"
    "_chdb_query"
    "_chdb_create"
    "_chdb_destroy"
    "_chdb_get_version"
    "_chdb_get_memory_stats"
    "_chdb_clear_cache"
)

# Minimal runtime methods
set(CHDB_MINIMAL_RUNTIME_METHODS
    "ccall"
    "cwrap"
    "UTF8ToString"
    "stringToUTF8"
    "lengthBytesUTF8"
)

# Build export strings
list(JOIN CHDB_MINIMAL_EXPORTS "','" EXPORTS_STR)
list(JOIN CHDB_MINIMAL_RUNTIME_METHODS "','" METHODS_STR)

set(CHDB_AGGRESSIVE_EXPORT_FLAGS
    "-sEXPORT_NAME='createChdb'"     # Clean factory name
    "-sEXPORTED_FUNCTIONS=['${EXPORTS_STR}']"
    "-sEXPORTED_RUNTIME_METHODS=['${METHODS_STR}']"
    "-sALLOW_TABLE_GROWTH=1"         # Allow function table growth
)

# Strip debug symbols in release
if(CHDB_WASM_STRIP_DEBUG)
    list(APPEND CHDB_AGGRESSIVE_LINK_FLAGS
        "-g0"                        # No debug info
        "--strip-all"                # Strip all symbols
    )
    message(STATUS "[Debug Symbols] Stripped")
endif()

message(STATUS "[Exports]")
message(STATUS "  Factory: createChdb")
message(STATUS "  Functions: ${CHDB_MINIMAL_EXPORTS}")

# ============================================================================
# 5. Output Configuration
# ============================================================================

set(CHDB_AGGRESSIVE_OUTPUT_FLAGS
    "-sWASM=1"                       # Output WebAssembly
    "-sWASM_BIGINT=1"                # Use BigInt for i64
    "-sMODULARIZE=1"                 # Create factory function
    "-sEXPORT_ES6=1"                 # ES6 module
    "-sENVIRONMENT='web,worker'"     # Target environments
    "-sSINGLE_FILE=0"                # Keep WASM separate (better caching)
)

message(STATUS "[Output]")
message(STATUS "  Format: ES6 module")
message(STATUS "  WASM: Separate file (cacheable)")
message(STATUS "  Target: web, worker")

# ============================================================================
# 6. wasm-opt Post-Processing Configuration
# ============================================================================
# wasm-opt from Binaryen can further reduce binary size by 10-20%

# wasm-opt optimization passes for size
set(CHDB_WASM_OPT_PASSES
    # Size optimization
    "-Oz"

    # General optimization passes
    "--optimize-instructions"
    "--precompute"
    "--precompute-propagate"

    # Dead code elimination
    "--vacuum"
    "--remove-unused-names"
    "--remove-unused-module-elements"
    "--remove-unused-brs"
    "--dce"

    # Code simplification
    "--simplify-locals"
    "--simplify-locals-notee"
    "--simplify-globals"
    "--merge-blocks"
    "--merge-locals"

    # Code folding and deduplication
    "--code-folding"
    "--merge-similar-functions"
    "--duplicate-function-elimination"

    # Local optimization
    "--coalesce-locals"
    "--coalesce-locals-learning"
    "--reorder-locals"
    "--local-cse"
    "--flatten"

    # Stack optimization
    "--pick-load-signs"
    "--optimize-stack-ir"

    # Memory optimization
    "--memory-packing"

    # Final cleanup
    "--strip-producers"
    "--strip-target-features"
)

message(STATUS "[wasm-opt]")
message(STATUS "  Optimization: -Oz")
message(STATUS "  Passes: DCE, merge-similar-functions, code-folding, etc.")

# ============================================================================
# Function: Apply Aggressive Optimizations to Target
# ============================================================================

function(chdb_apply_aggressive_wasm_optimizations target)
    message(STATUS "")
    message(STATUS "Applying AGGRESSIVE WASM optimizations to: ${target}")
    message(STATUS "")

    # Apply compile flags
    target_compile_options(${target} PRIVATE
        ${CHDB_AGGRESSIVE_COMPILE_FLAGS}
        ${CHDB_AGGRESSIVE_WASM_FEATURES}
    )

    # Apply compile definitions
    target_compile_definitions(${target} PRIVATE
        NDEBUG=1
        CHDB_WASM=1
        CHDB_SINGLE_THREADED=1
        CHDB_AGGRESSIVE_OPT=1
    )

    # Apply all link flags
    target_link_options(${target} PRIVATE
        ${CHDB_AGGRESSIVE_LINK_FLAGS}
        ${CHDB_AGGRESSIVE_MEMORY_FLAGS}
        ${CHDB_AGGRESSIVE_EXPORT_FLAGS}
        ${CHDB_AGGRESSIVE_OUTPUT_FLAGS}
    )

    # Set output properties
    set_target_properties(${target} PROPERTIES
        SUFFIX ".js"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/dist/optimized"
    )

    # Add wasm-opt post-processing if enabled
    if(CHDB_WASM_USE_WASM_OPT)
        chdb_add_wasm_opt_postbuild(${target})
    endif()

    message(STATUS "Aggressive optimizations applied to: ${target}")
endfunction()

# ============================================================================
# Function: Add wasm-opt Post-Build Step
# ============================================================================

function(chdb_add_wasm_opt_postbuild target)
    # Find wasm-opt executable
    find_program(WASM_OPT_EXECUTABLE wasm-opt
        HINTS
            $ENV{EMSDK}/upstream/bin
            $ENV{BINARYEN}/bin
            /usr/local/bin
            /usr/bin
            /opt/homebrew/bin
        DOC "wasm-opt binary optimizer"
    )

    if(NOT WASM_OPT_EXECUTABLE)
        message(WARNING "wasm-opt not found. Post-processing will be skipped.")
        message(WARNING "Install Binaryen or set EMSDK/BINARYEN environment variable.")
        return()
    endif()

    message(STATUS "Found wasm-opt: ${WASM_OPT_EXECUTABLE}")

    # Get output directory
    get_target_property(OUTPUT_DIR ${target} RUNTIME_OUTPUT_DIRECTORY)
    if(NOT OUTPUT_DIR)
        set(OUTPUT_DIR "${CMAKE_BINARY_DIR}/dist")
    endif()

    # Get output name
    get_target_property(OUTPUT_NAME ${target} OUTPUT_NAME)
    if(NOT OUTPUT_NAME)
        set(OUTPUT_NAME ${target})
    endif()

    # Define paths
    set(WASM_INPUT "${OUTPUT_DIR}/${OUTPUT_NAME}.wasm")
    set(WASM_OUTPUT "${OUTPUT_DIR}/${OUTPUT_NAME}.wasm")
    set(WASM_BACKUP "${OUTPUT_DIR}/${OUTPUT_NAME}.wasm.pre-opt")

    # Add custom command for wasm-opt post-processing
    add_custom_command(TARGET ${target} POST_BUILD
        COMMENT "Running wasm-opt on ${OUTPUT_NAME}.wasm for size optimization..."

        # Backup original
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${WASM_INPUT}" "${WASM_BACKUP}"

        # Run wasm-opt with all passes
        COMMAND ${WASM_OPT_EXECUTABLE}
            ${CHDB_WASM_OPT_PASSES}
            "${WASM_BACKUP}"
            -o "${WASM_OUTPUT}"

        # Report size change
        COMMAND ${CMAKE_COMMAND} -E echo "wasm-opt optimization complete:"
        COMMAND ${CMAKE_COMMAND} -E echo "  Before: $(stat -f%z '${WASM_BACKUP}' 2>/dev/null || stat -c%s '${WASM_BACKUP}') bytes"
        COMMAND ${CMAKE_COMMAND} -E echo "  After:  $(stat -f%z '${WASM_OUTPUT}' 2>/dev/null || stat -c%s '${WASM_OUTPUT}') bytes"

        VERBATIM
    )

    message(STATUS "Added wasm-opt post-build step for ${target}")
endfunction()

# ============================================================================
# Function: Create Size Report
# ============================================================================

function(chdb_add_size_report target)
    get_target_property(OUTPUT_DIR ${target} RUNTIME_OUTPUT_DIRECTORY)
    if(NOT OUTPUT_DIR)
        set(OUTPUT_DIR "${CMAKE_BINARY_DIR}/dist")
    endif()

    get_target_property(OUTPUT_NAME ${target} OUTPUT_NAME)
    if(NOT OUTPUT_NAME)
        set(OUTPUT_NAME ${target})
    endif()

    set(JS_FILE "${OUTPUT_DIR}/${OUTPUT_NAME}.js")
    set(WASM_FILE "${OUTPUT_DIR}/${OUTPUT_NAME}.wasm")
    set(REPORT_FILE "${OUTPUT_DIR}/SIZE_REPORT.txt")

    add_custom_command(TARGET ${target} POST_BUILD
        COMMENT "Generating size report..."
        COMMAND ${CMAKE_COMMAND} -E echo "chdb-wasm Size Report" > "${REPORT_FILE}"
        COMMAND ${CMAKE_COMMAND} -E echo "=====================" >> "${REPORT_FILE}"
        COMMAND ${CMAKE_COMMAND} -E echo "" >> "${REPORT_FILE}"
        COMMAND ${CMAKE_COMMAND} -E echo "Build Configuration:" >> "${REPORT_FILE}"
        COMMAND ${CMAKE_COMMAND} -E echo "  Profile: Aggressive Optimization" >> "${REPORT_FILE}"
        COMMAND ${CMAKE_COMMAND} -E echo "  -Oz:     Enabled" >> "${REPORT_FILE}"
        COMMAND ${CMAKE_COMMAND} -E echo "  LTO:     Disabled (bitcode compatibility)" >> "${REPORT_FILE}"
        COMMAND ${CMAKE_COMMAND} -E echo "  Closure: Level 1" >> "${REPORT_FILE}"
        COMMAND ${CMAKE_COMMAND} -E echo "  wasm-opt: Enabled" >> "${REPORT_FILE}"
        COMMAND ${CMAKE_COMMAND} -E echo "" >> "${REPORT_FILE}"
        VERBATIM
    )
endfunction()

# ============================================================================
# Optimization Impact Summary
# ============================================================================

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  Expected Size Impact from Aggressive Optimizations")
message(STATUS "================================================================")
message(STATUS "")
message(STATUS "Optimization                    | Expected Savings")
message(STATUS "--------------------------------|------------------")
message(STATUS "-Oz (vs -O3)                    | ~15-25%")
message(STATUS "LTO (disabled - bitcode issue) | N/A")
message(STATUS "Closure Compiler (JS)          | ~30-50% JS size")
message(STATUS "wasm-opt post-processing       | ~10-20% WASM size")
message(STATUS "Symbol stripping               | ~5-10%")
message(STATUS "Disable exceptions/RTTI        | ~5-10%")
message(STATUS "emmalloc (vs dlmalloc)         | ~10KB")
message(STATUS "Disable filesystem             | ~50-100KB")
message(STATUS "Minimal exports                | ~5-10KB")
message(STATUS "--------------------------------|------------------")
message(STATUS "TOTAL ESTIMATED                | ~40-60% smaller")
message(STATUS "")
message(STATUS "Reference: DuckDB WASM achieves ~10MB with similar approach")
message(STATUS "Target: <15MB uncompressed, <5MB gzipped for chdb")
message(STATUS "")
message(STATUS "================================================================")
message(STATUS "")
