# WasmOptimizations.cmake
# Size and performance optimization configuration for chdb WASM builds
#
# This module configures aggressive optimizations including:
# - Size optimization flags (-Os, -Oz)
# - Link-time optimization (LTO)
# - Dead code elimination
# - Closure Compiler integration
# - wasm-opt post-processing

cmake_minimum_required(VERSION 3.20)

# ============================================================================
# Optimization Profiles
# ============================================================================

# Available profiles: Debug, Release, MinSizeRel, RelWithDebInfo
set(CHDB_WASM_OPTIMIZATION_PROFILE "Release" CACHE STRING "Optimization profile")
set_property(CACHE CHDB_WASM_OPTIMIZATION_PROFILE PROPERTY STRINGS
    "Debug" "Release" "MinSizeRel" "RelWithDebInfo")

# ============================================================================
# Size Optimization Flags
# ============================================================================

option(CHDB_WASM_OPTIMIZE_SIZE "Enable size optimizations (-Os/-Oz)" ON)
option(CHDB_WASM_ULTRA_SIZE_OPT "Use -Oz for maximum size reduction (may impact performance)" OFF)

set(CHDB_WASM_SIZE_FLAGS "")

if(CHDB_WASM_OPTIMIZE_SIZE)
    if(CHDB_WASM_ULTRA_SIZE_OPT)
        # -Oz: Optimize aggressively for size
        list(APPEND CHDB_WASM_SIZE_FLAGS "-Oz")
        message(STATUS "chdb-wasm: Using ultra size optimization (-Oz)")
    else()
        # -Os: Optimize for size while maintaining reasonable performance
        list(APPEND CHDB_WASM_SIZE_FLAGS "-Os")
        message(STATUS "chdb-wasm: Using size optimization (-Os)")
    endif()

    # Additional size reduction flags
    list(APPEND CHDB_WASM_SIZE_FLAGS "-fno-rtti")                    # Disable RTTI
    list(APPEND CHDB_WASM_SIZE_FLAGS "-fno-unwind-tables")           # Disable unwind tables
    list(APPEND CHDB_WASM_SIZE_FLAGS "-fno-asynchronous-unwind-tables")
    list(APPEND CHDB_WASM_SIZE_FLAGS "-ffunction-sections")          # Enable function sections for DCE
    list(APPEND CHDB_WASM_SIZE_FLAGS "-fdata-sections")              # Enable data sections for DCE
    list(APPEND CHDB_WASM_SIZE_FLAGS "-fno-common")                  # Put uninitialized globals in BSS
    list(APPEND CHDB_WASM_SIZE_FLAGS "-fmerge-all-constants")        # Merge identical constants
    list(APPEND CHDB_WASM_SIZE_FLAGS "-fvisibility=hidden")          # Default hidden visibility
    list(APPEND CHDB_WASM_SIZE_FLAGS "-fvisibility-inlines-hidden")  # Hidden inline visibility
else()
    # Performance-focused optimization
    list(APPEND CHDB_WASM_SIZE_FLAGS "-O3")
    message(STATUS "chdb-wasm: Using performance optimization (-O3)")
endif()

# ============================================================================
# Link-Time Optimization (LTO)
# ============================================================================

option(CHDB_WASM_LTO "Enable Link-Time Optimization" ON)
option(CHDB_WASM_LTO_THIN "Use ThinLTO instead of full LTO (faster builds)" OFF)

set(CHDB_WASM_LTO_FLAGS "")

if(CHDB_WASM_LTO)
    if(CHDB_WASM_LTO_THIN)
        list(APPEND CHDB_WASM_LTO_FLAGS "-flto=thin")
        message(STATUS "chdb-wasm: ThinLTO enabled")
    else()
        list(APPEND CHDB_WASM_LTO_FLAGS "-flto")
        message(STATUS "chdb-wasm: Full LTO enabled")
    endif()

    # LTO-specific optimizations
    list(APPEND CHDB_WASM_LTO_FLAGS "-fwhole-program-vtables")  # Devirtualization
endif()

# ============================================================================
# Dead Code Elimination
# ============================================================================

option(CHDB_WASM_DCE "Enable aggressive dead code elimination" ON)

set(CHDB_WASM_DCE_FLAGS "")
set(CHDB_WASM_DCE_LINK_FLAGS "")

if(CHDB_WASM_DCE)
    # Compiler flags for DCE
    list(APPEND CHDB_WASM_DCE_FLAGS "-ffunction-sections")
    list(APPEND CHDB_WASM_DCE_FLAGS "-fdata-sections")

    # Emscripten-specific DCE settings
    list(APPEND CHDB_WASM_DCE_LINK_FLAGS "-sELIMINATE_DUPLICATE_FUNCTIONS=1")

    # Tree shaking for JS
    list(APPEND CHDB_WASM_DCE_LINK_FLAGS "-sIGNORE_MISSING_MAIN=1")

    # Only include necessary runtime components
    list(APPEND CHDB_WASM_DCE_LINK_FLAGS "-sINCOMING_MODULE_JS_API=['buffer','instantiateWasm','locateFile','onRuntimeInitialized','print','printErr']")

    message(STATUS "chdb-wasm: Dead code elimination enabled")
endif()

# ============================================================================
# Closure Compiler Integration
# ============================================================================

option(CHDB_WASM_CLOSURE_COMPILER "Enable Closure Compiler for JS optimization" ON)
set(CHDB_WASM_CLOSURE_LEVEL "1" CACHE STRING "Closure Compiler optimization level (0, 1, or 2)")
set_property(CACHE CHDB_WASM_CLOSURE_LEVEL PROPERTY STRINGS "0" "1" "2")

set(CHDB_WASM_CLOSURE_FLAGS "")

if(CHDB_WASM_CLOSURE_COMPILER)
    list(APPEND CHDB_WASM_CLOSURE_FLAGS "--closure=${CHDB_WASM_CLOSURE_LEVEL}")

    # Closure Compiler requires these settings
    list(APPEND CHDB_WASM_CLOSURE_FLAGS "-sUSE_CLOSURE_COMPILER=1")

    if(CHDB_WASM_CLOSURE_LEVEL STREQUAL "2")
        # Advanced optimizations require explicit exports
        list(APPEND CHDB_WASM_CLOSURE_FLAGS "-sCLOSURE_WARNINGS=error")
        message(STATUS "chdb-wasm: Closure Compiler enabled (ADVANCED_OPTIMIZATIONS)")
    else()
        message(STATUS "chdb-wasm: Closure Compiler enabled (SIMPLE_OPTIMIZATIONS)")
    endif()
endif()

# ============================================================================
# wasm-opt Post-Processing
# ============================================================================

option(CHDB_WASM_BINARYEN_OPTS "Enable wasm-opt post-processing" ON)
set(CHDB_WASM_BINARYEN_LEVEL "3" CACHE STRING "wasm-opt optimization level (0-4, or 's' for size)")
set_property(CACHE CHDB_WASM_BINARYEN_LEVEL PROPERTY STRINGS "0" "1" "2" "3" "4" "s" "z")

set(CHDB_WASM_BINARYEN_FLAGS "")
set(CHDB_WASM_BINARYEN_PASSES "")

if(CHDB_WASM_BINARYEN_OPTS)
    # Determine optimization flag based on level
    if(CHDB_WASM_BINARYEN_LEVEL STREQUAL "s")
        list(APPEND CHDB_WASM_BINARYEN_FLAGS "-sBINARYEN_EXTRA_PASSES='--shrink-level=1'")
    elseif(CHDB_WASM_BINARYEN_LEVEL STREQUAL "z")
        list(APPEND CHDB_WASM_BINARYEN_FLAGS "-sBINARYEN_EXTRA_PASSES='--shrink-level=2'")
    else()
        # Numeric optimization level
        list(APPEND CHDB_WASM_BINARYEN_FLAGS "-O${CHDB_WASM_BINARYEN_LEVEL}")
    endif()

    # Define additional Binaryen optimization passes
    set(CHDB_WASM_BINARYEN_PASSES
        "--optimize-instructions"
        "--precompute"
        "--vacuum"
        "--remove-unused-names"
        "--remove-unused-module-elements"
        "--merge-blocks"
        "--coalesce-locals"
        "--reorder-locals"
        "--remove-unused-brs"
        "--dce"
        "--simplify-locals"
        "--flatten"
        "--local-cse"
        "--code-folding"
        "--merge-similar-functions"
    )

    # Build passes string
    string(REPLACE ";" "," BINARYEN_PASSES_STR "${CHDB_WASM_BINARYEN_PASSES}")

    message(STATUS "chdb-wasm: wasm-opt post-processing enabled (level ${CHDB_WASM_BINARYEN_LEVEL})")
endif()

# ============================================================================
# Streaming Compilation Support
# ============================================================================

option(CHDB_WASM_STREAMING "Enable streaming compilation support" ON)

set(CHDB_WASM_STREAMING_FLAGS "")

if(CHDB_WASM_STREAMING)
    # Enable streaming instantiation
    list(APPEND CHDB_WASM_STREAMING_FLAGS "-sWASM_ASYNC_COMPILATION=1")

    # Support streaming fetch
    list(APPEND CHDB_WASM_STREAMING_FLAGS "-sFETCH_SUPPORT_INDEXEDDB=1")

    message(STATUS "chdb-wasm: Streaming compilation enabled")
endif()

# ============================================================================
# Code Splitting
# ============================================================================

option(CHDB_WASM_SPLIT_MODULE "Enable module splitting for lazy loading" OFF)

set(CHDB_WASM_SPLIT_FLAGS "")

if(CHDB_WASM_SPLIT_MODULE)
    list(APPEND CHDB_WASM_SPLIT_FLAGS "-sSPLIT_MODULE=1")
    message(STATUS "chdb-wasm: Module splitting enabled")
endif()

# ============================================================================
# Debug Symbol Configuration
# ============================================================================

option(CHDB_WASM_SEPARATE_DWARF "Generate separate DWARF debug info" ON)
option(CHDB_WASM_SOURCE_MAPS "Generate source maps" ON)

set(CHDB_WASM_DEBUG_SYMBOL_FLAGS "")

if(CMAKE_BUILD_TYPE MATCHES "Debug|RelWithDebInfo")
    if(CHDB_WASM_SEPARATE_DWARF)
        list(APPEND CHDB_WASM_DEBUG_SYMBOL_FLAGS "-gseparate-dwarf")
        message(STATUS "chdb-wasm: Separate DWARF enabled")
    endif()

    if(CHDB_WASM_SOURCE_MAPS)
        list(APPEND CHDB_WASM_DEBUG_SYMBOL_FLAGS "-gsource-map")
        list(APPEND CHDB_WASM_DEBUG_SYMBOL_FLAGS "-sSOURCE_MAP_BASE='/'")
        message(STATUS "chdb-wasm: Source maps enabled")
    endif()
endif()

# ============================================================================
# Memory Optimizations
# ============================================================================

set(CHDB_WASM_MEMORY_OPT_FLAGS "")

# Use more efficient memory allocator
list(APPEND CHDB_WASM_MEMORY_OPT_FLAGS "-sMALLOC='emmalloc'")

# Abort on allocation failure (cleaner than undefined behavior)
list(APPEND CHDB_WASM_MEMORY_OPT_FLAGS "-sABORTING_MALLOC=1")

# Optimize memory initialization
list(APPEND CHDB_WASM_MEMORY_OPT_FLAGS "-sMEMORY64=0")  # Stay with 32-bit addressing for smaller pointers

# ============================================================================
# Profile-Based Optimization Presets
# ============================================================================

function(chdb_set_optimization_preset target preset)
    if(preset STREQUAL "Debug")
        target_compile_options(${target} PRIVATE
            -O0
            -g3
            -DDEBUG
            -D_DEBUG
        )
        target_link_options(${target} PRIVATE
            -sASSERTIONS=2
            -sSAFE_HEAP=1
            -sSTACK_OVERFLOW_CHECK=2
        )
        message(STATUS "Applied Debug optimization preset to ${target}")

    elseif(preset STREQUAL "Release")
        target_compile_options(${target} PRIVATE
            ${CHDB_WASM_SIZE_FLAGS}
            ${CHDB_WASM_LTO_FLAGS}
            ${CHDB_WASM_DCE_FLAGS}
            -DNDEBUG
        )
        target_link_options(${target} PRIVATE
            ${CHDB_WASM_DCE_LINK_FLAGS}
            ${CHDB_WASM_CLOSURE_FLAGS}
            ${CHDB_WASM_BINARYEN_FLAGS}
            ${CHDB_WASM_STREAMING_FLAGS}
            ${CHDB_WASM_MEMORY_OPT_FLAGS}
        )
        message(STATUS "Applied Release optimization preset to ${target}")

    elseif(preset STREQUAL "MinSizeRel")
        target_compile_options(${target} PRIVATE
            -Oz
            -flto
            -fno-rtti
            -fno-exceptions
            ${CHDB_WASM_DCE_FLAGS}
            -DNDEBUG
        )
        target_link_options(${target} PRIVATE
            ${CHDB_WASM_DCE_LINK_FLAGS}
            --closure=2
            -sUSE_CLOSURE_COMPILER=1
            ${CHDB_WASM_MEMORY_OPT_FLAGS}
            -sEVAL_CTORS=1
            -sINLINING_LIMIT=1
        )
        message(STATUS "Applied MinSizeRel optimization preset to ${target}")

    elseif(preset STREQUAL "RelWithDebInfo")
        target_compile_options(${target} PRIVATE
            -Os
            ${CHDB_WASM_LTO_FLAGS}
            ${CHDB_WASM_DCE_FLAGS}
            -DNDEBUG
        )
        target_link_options(${target} PRIVATE
            ${CHDB_WASM_DCE_LINK_FLAGS}
            ${CHDB_WASM_DEBUG_SYMBOL_FLAGS}
            ${CHDB_WASM_STREAMING_FLAGS}
        )
        message(STATUS "Applied RelWithDebInfo optimization preset to ${target}")
    endif()
endfunction()

# ============================================================================
# Custom wasm-opt Post-Processing Command
# ============================================================================

# Function to add wasm-opt post-processing to a target
function(chdb_add_wasm_opt_postprocess target)
    if(NOT CHDB_WASM_BINARYEN_OPTS)
        return()
    endif()

    find_program(WASM_OPT_EXECUTABLE wasm-opt
        HINTS
            $ENV{EMSDK}/upstream/bin
            /usr/local/bin
            /usr/bin
    )

    if(NOT WASM_OPT_EXECUTABLE)
        message(WARNING "wasm-opt not found. Post-processing will be skipped.")
        return()
    endif()

    # Build wasm-opt command arguments
    set(WASM_OPT_ARGS "")

    if(CHDB_WASM_BINARYEN_LEVEL STREQUAL "s")
        list(APPEND WASM_OPT_ARGS "-Os")
    elseif(CHDB_WASM_BINARYEN_LEVEL STREQUAL "z")
        list(APPEND WASM_OPT_ARGS "-Oz")
    else()
        list(APPEND WASM_OPT_ARGS "-O${CHDB_WASM_BINARYEN_LEVEL}")
    endif()

    # Add additional passes
    list(APPEND WASM_OPT_ARGS ${CHDB_WASM_BINARYEN_PASSES})

    # Get output directory
    get_target_property(OUTPUT_DIR ${target} RUNTIME_OUTPUT_DIRECTORY)
    if(NOT OUTPUT_DIR)
        set(OUTPUT_DIR "${CMAKE_BINARY_DIR}")
    endif()

    # Add custom command for post-processing
    add_custom_command(TARGET ${target} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E echo "Running wasm-opt on ${target}.wasm..."
        COMMAND ${WASM_OPT_EXECUTABLE}
            ${WASM_OPT_ARGS}
            "${OUTPUT_DIR}/${target}.wasm"
            -o "${OUTPUT_DIR}/${target}.wasm"
        COMMAND ${CMAKE_COMMAND} -E echo "wasm-opt optimization complete"
        COMMENT "Post-processing ${target}.wasm with wasm-opt"
        VERBATIM
    )

    message(STATUS "Added wasm-opt post-processing to ${target}")
endfunction()

# ============================================================================
# Aggregate Optimization Function
# ============================================================================

# Main function to apply all optimizations to a target
function(chdb_apply_wasm_optimizations target)
    # Parse arguments
    set(options ENABLE_CLOSURE ENABLE_WASM_OPT NO_LTO)
    set(oneValueArgs PRESET)
    set(multiValueArgs EXTRA_FLAGS)
    cmake_parse_arguments(OPT "${options}" "${oneValueArgs}" "${multiValueArgs}" ${ARGN})

    # Determine preset
    if(OPT_PRESET)
        set(PRESET ${OPT_PRESET})
    else()
        set(PRESET ${CHDB_WASM_OPTIMIZATION_PROFILE})
    endif()

    # Apply preset
    chdb_set_optimization_preset(${target} ${PRESET})

    # Apply wasm-opt post-processing if requested
    if(OPT_ENABLE_WASM_OPT OR (CHDB_WASM_BINARYEN_OPTS AND NOT OPT_NO_WASM_OPT))
        chdb_add_wasm_opt_postprocess(${target})
    endif()

    # Apply extra flags
    if(OPT_EXTRA_FLAGS)
        target_compile_options(${target} PRIVATE ${OPT_EXTRA_FLAGS})
    endif()

    message(STATUS "Applied WASM optimizations to ${target} (preset: ${PRESET})")
endfunction()

# ============================================================================
# Print Optimization Summary
# ============================================================================

message(STATUS "")
message(STATUS "=== chdb-wasm Optimization Configuration ===")
message(STATUS "  Profile:           ${CHDB_WASM_OPTIMIZATION_PROFILE}")
message(STATUS "  Size Optimization: ${CHDB_WASM_OPTIMIZE_SIZE}")
message(STATUS "  Ultra Size (-Oz):  ${CHDB_WASM_ULTRA_SIZE_OPT}")
message(STATUS "  LTO:               ${CHDB_WASM_LTO}")
message(STATUS "  ThinLTO:           ${CHDB_WASM_LTO_THIN}")
message(STATUS "  DCE:               ${CHDB_WASM_DCE}")
message(STATUS "  Closure Compiler:  ${CHDB_WASM_CLOSURE_COMPILER} (level ${CHDB_WASM_CLOSURE_LEVEL})")
message(STATUS "  wasm-opt:          ${CHDB_WASM_BINARYEN_OPTS} (level ${CHDB_WASM_BINARYEN_LEVEL})")
message(STATUS "  Streaming:         ${CHDB_WASM_STREAMING}")
message(STATUS "  Module Splitting:  ${CHDB_WASM_SPLIT_MODULE}")
message(STATUS "=============================================")
message(STATUS "")
