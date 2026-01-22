# Architecture detection with WASM/Emscripten support
# This is a patched version of cmake/arch.cmake for chdb-wasm builds

if (CMAKE_SYSTEM_PROCESSOR MATCHES "amd64|x86_64")
    if (CMAKE_LIBRARY_ARCHITECTURE MATCHES "i386")
        message (FATAL_ERROR "32bit platforms are not supported")
    endif ()
    set (ARCH_AMD64 1)
elseif (CMAKE_SYSTEM_PROCESSOR MATCHES "^(aarch64.*|AARCH64.*|arm64.*|ARM64.*)")
    set (ARCH_AARCH64 1)
elseif (CMAKE_SYSTEM_PROCESSOR MATCHES "^(powerpc64le.*|ppc64le.*|PPC64LE.*)")
    set (ARCH_PPC64LE 1)
elseif (CMAKE_SYSTEM_PROCESSOR MATCHES "^(s390x.*|S390X.*)")
    set (ARCH_S390X 1)
elseif (CMAKE_SYSTEM_PROCESSOR MATCHES "riscv64")
    set (ARCH_RISCV64 1)
elseif (CMAKE_SYSTEM_PROCESSOR MATCHES "loongarch64")
    set (ARCH_LOONGARCH64 1)
elseif (CMAKE_SYSTEM_PROCESSOR MATCHES "^(wasm32|wasm64|WASM)")
    # WebAssembly target via Emscripten
    set (ARCH_WASM 1)
    set (ARCH_WASM32 1)

    # WASM-specific architecture settings
    # WASM uses 32-bit pointers (wasm32) or 64-bit (wasm64)
    if (CMAKE_SYSTEM_PROCESSOR MATCHES "wasm64")
        set (ARCH_WASM64 1)
        set (ARCH_WASM32 0)
    endif ()

    # No native SIMD by default (can be enabled with -msimd128)
    set (NO_SIMD 1)

    # WASM is little-endian
    set (LITTLE_ENDIAN 1)

    message (STATUS "Building for WebAssembly target: ${CMAKE_SYSTEM_PROCESSOR}")
elseif (EMSCRIPTEN)
    # Fallback detection via Emscripten toolchain
    set (ARCH_WASM 1)
    set (ARCH_WASM32 1)
    set (NO_SIMD 1)
    set (LITTLE_ENDIAN 1)
    message (STATUS "Building for WebAssembly via Emscripten")
else ()
    message (FATAL_ERROR "Platform ${CMAKE_SYSTEM_PROCESSOR} is not supported")
endif ()
