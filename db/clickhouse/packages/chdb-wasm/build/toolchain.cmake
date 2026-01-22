# toolchain.cmake - Emscripten toolchain configuration for chdb-wasm
# This file configures CMake to use Emscripten for cross-compiling to WebAssembly

# =============================================================================
# System Configuration
# =============================================================================

set(CMAKE_SYSTEM_NAME Emscripten)
set(CMAKE_SYSTEM_VERSION 1)
set(CMAKE_SYSTEM_PROCESSOR wasm32)

# =============================================================================
# Emscripten SDK Detection
# =============================================================================

# Try to find EMSDK from environment or common locations
if(DEFINED ENV{EMSDK})
    set(EMSDK_PATH "$ENV{EMSDK}")
elseif(EXISTS "/opt/emsdk")
    set(EMSDK_PATH "/opt/emsdk")
elseif(EXISTS "$ENV{HOME}/emsdk")
    set(EMSDK_PATH "$ENV{HOME}/emsdk")
elseif(EXISTS "/usr/local/emsdk")
    set(EMSDK_PATH "/usr/local/emsdk")
else()
    message(FATAL_ERROR
        "Emscripten SDK not found. Please set EMSDK environment variable or install emsdk to a standard location.\n"
        "Installation:\n"
        "  git clone https://github.com/emscripten-core/emsdk.git\n"
        "  cd emsdk && ./emsdk install latest && ./emsdk activate latest\n"
        "  source ./emsdk_env.sh"
    )
endif()

message(STATUS "Using Emscripten SDK from: ${EMSDK_PATH}")

# =============================================================================
# Compiler Configuration
# =============================================================================

# Find Emscripten compilers
find_program(CMAKE_C_COMPILER
    NAMES emcc
    PATHS "${EMSDK_PATH}/upstream/emscripten"
    NO_DEFAULT_PATH
    REQUIRED
)

find_program(CMAKE_CXX_COMPILER
    NAMES em++
    PATHS "${EMSDK_PATH}/upstream/emscripten"
    NO_DEFAULT_PATH
    REQUIRED
)

find_program(CMAKE_AR
    NAMES emar
    PATHS "${EMSDK_PATH}/upstream/emscripten"
    NO_DEFAULT_PATH
    REQUIRED
)

find_program(CMAKE_RANLIB
    NAMES emranlib
    PATHS "${EMSDK_PATH}/upstream/emscripten"
    NO_DEFAULT_PATH
    REQUIRED
)

# Set compiler IDs
set(CMAKE_C_COMPILER_ID Clang)
set(CMAKE_CXX_COMPILER_ID Clang)
set(CMAKE_C_COMPILER_FRONTEND_VARIANT GNU)
set(CMAKE_CXX_COMPILER_FRONTEND_VARIANT GNU)

# =============================================================================
# Size Optimization Compiler Flags
# =============================================================================

# Base optimization flags for smallest binary size
set(EMSCRIPTEN_OPTIMIZATION_FLAGS
    "-Oz"                           # Aggressive size optimization (smaller than -Os)
    "-flto"                         # Link-time optimization
    "-fno-exceptions"               # Disable C++ exceptions
    "-fno-rtti"                     # Disable runtime type information
    "-fno-unwind-tables"            # Don't generate unwind tables
    "-fno-asynchronous-unwind-tables"
    "-fvisibility=hidden"           # Hide symbols by default
    "-fvisibility-inlines-hidden"   # Hide inline functions
    "-ffunction-sections"           # Enable dead code elimination
    "-fdata-sections"               # Enable unused data elimination
    "-fmerge-all-constants"         # Merge identical constants
    "-fno-math-errno"               # Don't set errno for math functions
    "-fno-signed-zeros"             # Allow optimizations ignoring signed zeros
)

# Additional WASM-specific flags
set(EMSCRIPTEN_WASM_FLAGS
    "-msimd128"                     # Enable SIMD (supported in Workers)
    "-mbulk-memory"                 # Enable bulk memory operations
    "-mnontrapping-fptoint"         # Non-trapping float-to-int conversions
    "-msign-ext"                    # Sign extension operations
)

# Join flags into strings
string(REPLACE ";" " " EMSCRIPTEN_OPT_FLAGS_STR "${EMSCRIPTEN_OPTIMIZATION_FLAGS}")
string(REPLACE ";" " " EMSCRIPTEN_WASM_FLAGS_STR "${EMSCRIPTEN_WASM_FLAGS}")

# Set compiler flags
set(CMAKE_C_FLAGS_INIT "${EMSCRIPTEN_OPT_FLAGS_STR} ${EMSCRIPTEN_WASM_FLAGS_STR}")
set(CMAKE_CXX_FLAGS_INIT "${EMSCRIPTEN_OPT_FLAGS_STR} ${EMSCRIPTEN_WASM_FLAGS_STR}")

# Release-specific flags
set(CMAKE_C_FLAGS_RELEASE_INIT "-DNDEBUG")
set(CMAKE_CXX_FLAGS_RELEASE_INIT "-DNDEBUG")

# Debug flags (less aggressive optimization for debugging)
set(CMAKE_C_FLAGS_DEBUG_INIT "-O0 -g3 -gsource-map")
set(CMAKE_CXX_FLAGS_DEBUG_INIT "-O0 -g3 -gsource-map")

# RelWithDebInfo for profiling
set(CMAKE_C_FLAGS_RELWITHDEBINFO_INIT "-O2 -g -DNDEBUG")
set(CMAKE_CXX_FLAGS_RELWITHDEBINFO_INIT "-O2 -g -DNDEBUG")

# MinSizeRel - maximum size optimization
set(CMAKE_C_FLAGS_MINSIZEREL_INIT "-Oz -DNDEBUG")
set(CMAKE_CXX_FLAGS_MINSIZEREL_INIT "-Oz -DNDEBUG")

# =============================================================================
# WASM-Specific Linker Flags
# =============================================================================

set(EMSCRIPTEN_LINK_FLAGS
    # Memory configuration
    "-sALLOW_MEMORY_GROWTH=1"       # Allow WASM memory to grow
    "-sINITIAL_MEMORY=67108864"     # 64MB initial (good for Workers)
    "-sMAXIMUM_MEMORY=134217728"    # 128MB max (Cloudflare Workers limit)
    "-sSTACK_SIZE=1048576"          # 1MB stack

    # WASM output configuration
    "-sWASM=1"                      # Output WebAssembly
    "-sWASM_BIGINT=1"               # Use BigInt for i64
    "-sSUPPORT_LONGJMP=0"           # Disable longjmp (not needed)

    # Environment targeting
    "-sENVIRONMENT='web,worker'"    # Target web and worker environments
    "-sMODULARIZE=1"                # Create ES module
    "-sEXPORT_ES6=1"                # Export as ES6 module

    # Runtime configuration
    "-sNO_EXIT_RUNTIME=1"           # Don't exit after main()
    "-sABORTING_MALLOC=0"           # Return null on malloc failure
    "-sALLOW_TABLE_GROWTH=1"        # Allow function table growth

    # Optimization
    "-sDISABLE_EXCEPTION_CATCHING=1" # Disable exception catching
    "-sASSERTIONS=0"                # Disable assertions
    "-sEVAL_CTORS=1"                # Evaluate constructors at compile time

    # Filesystem (minimal)
    "-sNO_FILESYSTEM=0"             # We need basic filesystem for data
    "-sFILESYSTEM=0"                # But don't include full filesystem

    # Code generation
    "-sMALLOC=emmalloc"             # Use smaller allocator
    "-sSINGLE_FILE=0"               # Separate .wasm file for caching
)

string(REPLACE ";" " " EMSCRIPTEN_LINK_FLAGS_STR "${EMSCRIPTEN_LINK_FLAGS}")

set(CMAKE_EXE_LINKER_FLAGS_INIT "${EMSCRIPTEN_LINK_FLAGS_STR}")
set(CMAKE_SHARED_LINKER_FLAGS_INIT "${EMSCRIPTEN_LINK_FLAGS_STR}")

# Release linker flags - enable Closure compiler
set(CMAKE_EXE_LINKER_FLAGS_RELEASE_INIT "--closure=1")
set(CMAKE_EXE_LINKER_FLAGS_MINSIZEREL_INIT "--closure=1")

# =============================================================================
# CMake Configuration
# =============================================================================

# Don't look for host programs
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)

# Only look in the target system for libraries and includes
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)

# Emscripten outputs .js and .wasm
set(CMAKE_EXECUTABLE_SUFFIX ".js")

# Disable features not supported in Emscripten
set(THREADS_PREFER_PTHREAD_FLAG OFF)
set(CMAKE_THREAD_LIBS_INIT "")
set(CMAKE_HAVE_THREADS_LIBRARY OFF)
set(CMAKE_USE_WIN32_THREADS_INIT OFF)
set(CMAKE_USE_PTHREADS_INIT OFF)

# Set target triple
set(TARGET_TRIPLE "wasm32-unknown-emscripten")

# =============================================================================
# Cache Configuration
# =============================================================================

# Enable Emscripten port caching
set(EM_CACHE "$ENV{HOME}/.emscripten_cache" CACHE PATH "Emscripten cache directory")

# =============================================================================
# Build Type Default
# =============================================================================

# Default to Release build for production WASM
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE "Release" CACHE STRING "Build type" FORCE)
endif()

message(STATUS "Emscripten toolchain configured")
message(STATUS "  C Compiler: ${CMAKE_C_COMPILER}")
message(STATUS "  C++ Compiler: ${CMAKE_CXX_COMPILER}")
message(STATUS "  Build Type: ${CMAKE_BUILD_TYPE}")
