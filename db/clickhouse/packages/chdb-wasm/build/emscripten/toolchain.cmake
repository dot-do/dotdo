# toolchain.cmake - Emscripten CMake toolchain file for chdb-wasm
#
# This toolchain file configures CMake to cross-compile C/C++ code to WebAssembly
# using the Emscripten SDK (emsdk).
#
# Usage:
#   cmake -S . -B build -DCMAKE_TOOLCHAIN_FILE=/path/to/toolchain.cmake
#
# Or with emcmake (recommended):
#   emcmake cmake -S . -B build
#
# Environment Requirements:
#   - EMSDK environment variable must be set, OR
#   - Emscripten must be installed in a standard location
#
# Target Environment:
#   - Cloudflare Workers (128MB memory, single-threaded)
#   - WebAssembly output only (not asm.js)
#   - No persistent filesystem

# =============================================================================
# Guard Against Multiple Inclusion
# =============================================================================

include_guard(GLOBAL)

# =============================================================================
# System Identification
# =============================================================================

set(CMAKE_SYSTEM_NAME Emscripten)
set(CMAKE_SYSTEM_VERSION 1)
set(CMAKE_SYSTEM_PROCESSOR wasm32)

# Cross-compilation settings
set(CMAKE_CROSSCOMPILING TRUE)
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

# Target triple for WASM
set(TARGET_TRIPLE "wasm32-unknown-emscripten")

# =============================================================================
# Emscripten SDK Detection
# =============================================================================

# Try to find the Emscripten SDK from various sources
if(DEFINED ENV{EMSDK})
    set(EMSDK_PATH "$ENV{EMSDK}")
elseif(EXISTS "/opt/emsdk")
    set(EMSDK_PATH "/opt/emsdk")
elseif(EXISTS "$ENV{HOME}/emsdk")
    set(EMSDK_PATH "$ENV{HOME}/emsdk")
elseif(EXISTS "/usr/local/emsdk")
    set(EMSDK_PATH "/usr/local/emsdk")
elseif(EXISTS "/usr/lib/emscripten")
    # Debian/Ubuntu package location
    set(EMSDK_PATH "/usr/lib/emscripten")
else()
    message(FATAL_ERROR
        "Emscripten SDK not found!\n"
        "\n"
        "Please install Emscripten and set the EMSDK environment variable:\n"
        "\n"
        "  # Clone and install emsdk\n"
        "  git clone https://github.com/emscripten-core/emsdk.git\n"
        "  cd emsdk\n"
        "  ./emsdk install latest\n"
        "  ./emsdk activate latest\n"
        "  source ./emsdk_env.sh\n"
        "\n"
        "  # Then run cmake with:\n"
        "  emcmake cmake -S . -B build\n"
    )
endif()

# Set EMSDK in cache for other modules
set(EMSDK "${EMSDK_PATH}" CACHE PATH "Emscripten SDK path")

# Emscripten upstream path
set(EMSCRIPTEN_ROOT "${EMSDK_PATH}/upstream/emscripten" CACHE PATH "Emscripten root")

# Verify the Emscripten root exists
if(NOT EXISTS "${EMSCRIPTEN_ROOT}/emcc")
    # Try alternative structure
    if(EXISTS "${EMSDK_PATH}/emcc")
        set(EMSCRIPTEN_ROOT "${EMSDK_PATH}")
    else()
        message(FATAL_ERROR
            "Emscripten compiler not found at ${EMSCRIPTEN_ROOT}\n"
            "Please ensure Emscripten is properly installed and activated."
        )
    endif()
endif()

# =============================================================================
# Compiler Configuration
# =============================================================================

# Find Emscripten compilers
find_program(CMAKE_C_COMPILER
    NAMES emcc emcc.py
    PATHS "${EMSCRIPTEN_ROOT}"
    NO_DEFAULT_PATH
    REQUIRED
)

find_program(CMAKE_CXX_COMPILER
    NAMES em++ em++.py
    PATHS "${EMSCRIPTEN_ROOT}"
    NO_DEFAULT_PATH
    REQUIRED
)

find_program(CMAKE_AR
    NAMES emar emar.py
    PATHS "${EMSCRIPTEN_ROOT}"
    NO_DEFAULT_PATH
    REQUIRED
)

find_program(CMAKE_RANLIB
    NAMES emranlib emranlib.py
    PATHS "${EMSCRIPTEN_ROOT}"
    NO_DEFAULT_PATH
    REQUIRED
)

find_program(CMAKE_NM
    NAMES llvm-nm emnm
    PATHS "${EMSCRIPTEN_ROOT}"
    NO_DEFAULT_PATH
)

# Set compiler identification (Emscripten is a Clang variant)
set(CMAKE_C_COMPILER_ID "Clang")
set(CMAKE_CXX_COMPILER_ID "Clang")
set(CMAKE_C_COMPILER_FRONTEND_VARIANT "GNU")
set(CMAKE_CXX_COMPILER_FRONTEND_VARIANT "GNU")

# =============================================================================
# Compiler Flags for Size Optimization
# =============================================================================
# These flags are optimized for minimal WASM binary size, suitable for
# Cloudflare Workers and other edge environments.

# Size optimization flags
set(EMSCRIPTEN_SIZE_FLAGS
    "-Oz"                            # Aggressive size optimization (smaller than -Os)
    "-flto"                          # Link-time optimization for dead code elimination
    "-fno-exceptions"                # Disable C++ exceptions (big size savings)
    "-fno-rtti"                      # Disable RTTI (type_info, dynamic_cast)
    "-fno-unwind-tables"             # No unwinding tables (smaller binary)
    "-fno-asynchronous-unwind-tables" # No async unwind tables
    "-fvisibility=hidden"            # Hide all symbols by default
    "-fvisibility-inlines-hidden"    # Hide inline functions
    "-ffunction-sections"            # Each function in own section (DCE)
    "-fdata-sections"                # Each data item in own section (DCE)
    "-fmerge-all-constants"          # Merge identical constant values
    "-fno-math-errno"                # Don't set errno for math functions
    "-fno-signed-zeros"              # Allow floating-point optimizations
)

# WASM feature flags (supported by modern browsers and Cloudflare Workers)
set(EMSCRIPTEN_WASM_FEATURES
    "-msimd128"                      # SIMD128 operations (Workers compatible)
    "-mbulk-memory"                  # Bulk memory operations
    "-mnontrapping-fptoint"          # Non-trapping float-to-int conversions
    "-msign-ext"                     # Sign extension operations
    # Note: Threads (-pthread) intentionally NOT included for Workers
)

# Combine into initial flags
list(JOIN EMSCRIPTEN_SIZE_FLAGS " " SIZE_FLAGS_STR)
list(JOIN EMSCRIPTEN_WASM_FEATURES " " WASM_FEATURES_STR)

set(CMAKE_C_FLAGS_INIT "${SIZE_FLAGS_STR} ${WASM_FEATURES_STR}")
set(CMAKE_CXX_FLAGS_INIT "${SIZE_FLAGS_STR} ${WASM_FEATURES_STR}")

# =============================================================================
# Build Type Specific Flags
# =============================================================================

# Release: Maximum optimization for size
set(CMAKE_C_FLAGS_RELEASE_INIT "-DNDEBUG")
set(CMAKE_CXX_FLAGS_RELEASE_INIT "-DNDEBUG")

# MinSizeRel: Same as Release for WASM
set(CMAKE_C_FLAGS_MINSIZEREL_INIT "-DNDEBUG")
set(CMAKE_CXX_FLAGS_MINSIZEREL_INIT "-DNDEBUG")

# Debug: Enable debug info and source maps
set(CMAKE_C_FLAGS_DEBUG_INIT "-O0 -g3 -gsource-map")
set(CMAKE_CXX_FLAGS_DEBUG_INIT "-O0 -g3 -gsource-map")

# RelWithDebInfo: Optimized with debug info
set(CMAKE_C_FLAGS_RELWITHDEBINFO_INIT "-O2 -g -DNDEBUG")
set(CMAKE_CXX_FLAGS_RELWITHDEBINFO_INIT "-O2 -g -DNDEBUG")

# =============================================================================
# Linker Flags for Cloudflare Workers
# =============================================================================
# These flags configure the WASM output for Cloudflare Workers constraints:
# - 128MB memory limit
# - Single-threaded execution
# - No filesystem access

set(EMSCRIPTEN_LINK_FLAGS
    # Memory Configuration (Cloudflare Workers: 128MB limit)
    "-sALLOW_MEMORY_GROWTH=1"        # Essential: Allow memory to grow
    "-sINITIAL_MEMORY=16777216"      # 16MB initial (grows as needed)
    "-sMAXIMUM_MEMORY=134217728"     # 128MB maximum
    "-sSTACK_SIZE=1048576"           # 1MB stack size
    "-sABORTING_MALLOC=0"            # Return null on OOM (don't abort)

    # WASM Output Configuration
    "-sWASM=1"                       # Output WebAssembly (not asm.js)
    "-sWASM_BIGINT=1"                # Use BigInt for 64-bit integers
    "-sSINGLE_FILE=0"                # Separate .wasm for better caching

    # Module Configuration
    "-sMODULARIZE=1"                 # Create module factory function
    "-sEXPORT_ES6=1"                 # ES6 module syntax
    "-sEXPORT_NAME='createChDBModule'" # Factory function name
    "-sENVIRONMENT='web,worker'"     # Target environments

    # Threading: Disabled for Workers
    "-sSUPPORT_LONGJMP=0"            # No setjmp/longjmp
    "-sPTHREAD_POOL_SIZE=0"          # No thread pool

    # Filesystem: Disabled (use custom VFS instead)
    "-sNO_FILESYSTEM=1"              # No Emscripten FS
    "-sFORCE_FILESYSTEM=0"           # Don't force filesystem

    # Runtime Configuration
    "-sNO_EXIT_RUNTIME=1"            # Don't exit after main()
    "-sALLOW_TABLE_GROWTH=1"         # Allow function table growth
    "-sDISABLE_EXCEPTION_CATCHING=1" # No exception catching
    "-sASSERTIONS=0"                 # No runtime assertions
    "-sMALLOC=emmalloc"              # Use emmalloc (smallest allocator)
    "-sEVAL_CTORS=1"                 # Evaluate constructors at compile time

    # Optimization
    "-Oz"                            # Size optimization
    "-flto"                          # Link-time optimization
    "--gc-sections"                  # Remove unused sections
)

# Release-only: Enable Closure compiler for JS minification
set(EMSCRIPTEN_LINK_FLAGS_RELEASE "--closure=1")
set(EMSCRIPTEN_LINK_FLAGS_MINSIZEREL "--closure=1")

# Debug: Include source maps
set(EMSCRIPTEN_LINK_FLAGS_DEBUG "-g3 -gsource-map -sASSERTIONS=2")

# Join flags into string
list(JOIN EMSCRIPTEN_LINK_FLAGS " " LINK_FLAGS_STR)

set(CMAKE_EXE_LINKER_FLAGS_INIT "${LINK_FLAGS_STR}")
set(CMAKE_SHARED_LINKER_FLAGS_INIT "${LINK_FLAGS_STR}")
set(CMAKE_MODULE_LINKER_FLAGS_INIT "${LINK_FLAGS_STR}")

set(CMAKE_EXE_LINKER_FLAGS_RELEASE_INIT "${EMSCRIPTEN_LINK_FLAGS_RELEASE}")
set(CMAKE_EXE_LINKER_FLAGS_MINSIZEREL_INIT "${EMSCRIPTEN_LINK_FLAGS_MINSIZEREL}")
set(CMAKE_EXE_LINKER_FLAGS_DEBUG_INIT "${EMSCRIPTEN_LINK_FLAGS_DEBUG}")

# =============================================================================
# CMake Search Configuration
# =============================================================================

# Only search for host programs (like cmake) on the host system
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)

# Search for libraries and includes only in the Emscripten sysroot
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)

# Emscripten sysroot
set(CMAKE_SYSROOT "${EMSCRIPTEN_ROOT}/cache/sysroot")

# =============================================================================
# Output Configuration
# =============================================================================

# Emscripten outputs .js (and .wasm)
set(CMAKE_EXECUTABLE_SUFFIX ".js")

# =============================================================================
# Threading Configuration (Disabled)
# =============================================================================
# Cloudflare Workers are single-threaded. Disable pthreads.

set(THREADS_PREFER_PTHREAD_FLAG OFF)
set(CMAKE_HAVE_THREADS_LIBRARY OFF)
set(CMAKE_USE_WIN32_THREADS_INIT OFF)
set(CMAKE_USE_PTHREADS_INIT OFF)
set(CMAKE_THREAD_LIBS_INIT "")

# =============================================================================
# Emscripten Cache Configuration
# =============================================================================

# Use Emscripten's cache for faster rebuilds
if(DEFINED ENV{EM_CACHE})
    set(EM_CACHE "$ENV{EM_CACHE}" CACHE PATH "Emscripten cache directory")
else()
    set(EM_CACHE "$ENV{HOME}/.emscripten_cache" CACHE PATH "Emscripten cache directory")
endif()

# =============================================================================
# Default Build Type
# =============================================================================

# Default to Release for production WASM builds
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE "Release" CACHE STRING "Build type" FORCE)
    set_property(CACHE CMAKE_BUILD_TYPE PROPERTY STRINGS
        "Debug" "Release" "MinSizeRel" "RelWithDebInfo"
    )
endif()

# =============================================================================
# Status Output
# =============================================================================

message(STATUS "")
message(STATUS "Emscripten Toolchain Configuration")
message(STATUS "===================================")
message(STATUS "  EMSDK Path:       ${EMSDK_PATH}")
message(STATUS "  Emscripten Root:  ${EMSCRIPTEN_ROOT}")
message(STATUS "  C Compiler:       ${CMAKE_C_COMPILER}")
message(STATUS "  C++ Compiler:     ${CMAKE_CXX_COMPILER}")
message(STATUS "  Target:           ${CMAKE_SYSTEM_NAME}/${CMAKE_SYSTEM_PROCESSOR}")
message(STATUS "  Build Type:       ${CMAKE_BUILD_TYPE}")
message(STATUS "")
message(STATUS "  Cloudflare Workers Constraints:")
message(STATUS "    Max Memory:     128MB")
message(STATUS "    Threading:      Single-threaded")
message(STATUS "    Filesystem:     Disabled (custom VFS)")
message(STATUS "===================================")
message(STATUS "")
