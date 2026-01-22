# CMakeLists.txt - Multi-Module WASM Build Configuration
#
# This builds two independent WASM modules:
#   - core.wasm: SQL parser and query coordinator (always loaded)
#   - format-json.wasm: JSON formatting (lazily loaded)
#
# Build instructions:
#   mkdir -p build && cd build
#   emcmake cmake ..
#   emmake make
#
# Or use the build script:
#   ./build.sh

cmake_minimum_required(VERSION 3.16)
project(chdb_multimodule VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Detect Emscripten
if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "This project must be built with Emscripten. Use: emcmake cmake ..")
endif()

# =============================================================================
# Optimization Flags (Tree-Shaking)
# =============================================================================
# These flags implement aggressive tree-shaking and dead code elimination
# for 20-45% WASM size reduction. See docs/spikes/spike-4-tree-shaking.md

# Common compiler flags for small WASM modules
set(COMMON_FLAGS
    "-Oz"                    # Optimize aggressively for size (5-10% smaller than -Os)
    "-fno-exceptions"        # No C++ exceptions
    "-fno-rtti"              # No runtime type info
    "-fdata-sections"        # Put each data item in own section (enables --gc-sections)
    "-ffunction-sections"    # Put each function in own section (enables --gc-sections)
    "-fvisibility=hidden"    # Default to hidden visibility (better stripping)
    "-DNDEBUG"               # Release mode
)

# Common linker flags for standalone WASM
# Includes tree-shaking optimizations for smaller binaries
set(COMMON_LINK_FLAGS
    "-Oz"                            # Aggressive size optimization at link time
    "-s STANDALONE_WASM=1"           # Standalone (no JS glue)
    "-s ALLOW_MEMORY_GROWTH=1"       # Dynamic memory
    "-s INITIAL_MEMORY=1048576"      # Start with 1MB
    "-s MAXIMUM_MEMORY=67108864"     # Max 64MB
    "-s STACK_SIZE=65536"            # 64KB stack
    "-s ERROR_ON_UNDEFINED_SYMBOLS=0" # Allow missing symbols
    "-sEVAL_CTORS=1"                 # Evaluate constructors at compile time
    "-sELIMINATE_DUPLICATE_FUNCTIONS=1" # Dead code elimination
    "--no-entry"                     # No main()
)

string(REPLACE ";" " " COMMON_FLAGS_STR "${COMMON_FLAGS}")
string(REPLACE ";" " " COMMON_LINK_FLAGS_STR "${COMMON_LINK_FLAGS}")

# =============================================================================
# Core Module
# =============================================================================

add_executable(core core.cpp)

target_compile_options(core PRIVATE ${COMMON_FLAGS})

set_target_properties(core PROPERTIES
    SUFFIX ".wasm"
    LINK_FLAGS "${COMMON_LINK_FLAGS_STR} \
        -s EXPORTED_FUNCTIONS=\"['_malloc','_free','_parse_sql','_get_required_format','_get_query_type','_get_table_name','_get_format','_get_column_count','_get_column','_get_limit','_get_offset','_get_error','_allocate_result_buffer','_get_result_buffer','_get_result_buffer_size','_coordinate_result','_core_version','_core_info']\" \
        -s EXPORTED_RUNTIME_METHODS=\"['cwrap','ccall','UTF8ToString','stringToUTF8','lengthBytesUTF8']\""
)

# =============================================================================
# Format JSON Module
# =============================================================================

add_executable(format-json format-json.cpp)

target_compile_options(format-json PRIVATE ${COMMON_FLAGS})

set_target_properties(format-json PROPERTIES
    SUFFIX ".wasm"
    LINK_FLAGS "${COMMON_LINK_FLAGS_STR} \
        -s EXPORTED_FUNCTIONS=\"['_malloc','_free','_format_as_json','_format_as_json_each_row','_format_as_json_compact','_parse_json','_get_output_buffer','_get_output_size','_get_error','_json_version','_json_info']\" \
        -s EXPORTED_RUNTIME_METHODS=\"['cwrap','ccall','UTF8ToString','stringToUTF8','lengthBytesUTF8']\""
)

# =============================================================================
# Custom targets
# =============================================================================

# Target to build both modules
add_custom_target(all_modules DEPENDS core format-json)

# Target to show module sizes
add_custom_target(sizes
    COMMAND ${CMAKE_COMMAND} -E echo "=== Module Sizes ==="
    COMMAND ls -lh core.wasm format-json.wasm || true
    DEPENDS all_modules
)

# Target to clean build
add_custom_target(clean_all
    COMMAND ${CMAKE_COMMAND} -E remove -f core.wasm format-json.wasm
    COMMAND ${CMAKE_COMMAND} -E remove_directory CMakeFiles
)
