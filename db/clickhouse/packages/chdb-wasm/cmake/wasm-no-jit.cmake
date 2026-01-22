# wasm-no-jit.cmake
# CMake configuration for disabling LLVM JIT compiler in WASM builds
#
# LLVM JIT compilation is incompatible with WebAssembly for several reasons:
# 1. LLVM JIT adds 50-100MB to the binary size
# 2. WASM cannot execute dynamically generated machine code
# 3. LLVM targets (X86, AArch64, etc.) are architecture-specific, not WASM
#
# ClickHouse has an interpreter fallback that executes all operations without
# JIT compilation, making this a safe configuration for WASM builds.
#
# Usage:
#   cmake -C cmake/wasm-no-jit.cmake ..
#   OR
#   include(cmake/wasm-no-jit.cmake)
#
# References:
#   - chdb CMake: vendor/chdb/contrib/llvm-project-cmake/CMakeLists.txt
#   - chdb target.cmake: vendor/chdb/cmake/target.cmake
#   - ClickHouse JIT: src/Interpreters/ExpressionJIT.cpp
#   - ClickHouse Aggregator JIT: src/Interpreters/Aggregator.cpp

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "=== chdb-wasm No-JIT Configuration ===")
message(STATUS "Disabling LLVM JIT compiler for WebAssembly build")
message(STATUS "")

# ============================================================================
# LLVM JIT Compilation - Disabled
# ============================================================================
# ENABLE_EMBEDDED_COMPILER controls LLVM-based JIT compilation for expressions.
# When disabled:
#   - USE_EMBEDDED_COMPILER preprocessor define is set to 0
#   - All code guarded by #if USE_EMBEDDED_COMPILER is excluded
#   - Expression evaluation falls back to interpreted execution
#   - Aggregate function compilation is skipped
#
# The LLVM libraries are completely excluded from the build when this is OFF.

set(ENABLE_EMBEDDED_COMPILER OFF CACHE BOOL "Disable LLVM-based JIT compiler (incompatible with WASM)" FORCE)
# Also set as INTERNAL to prevent any override from vendor/chdb
set(ENABLE_EMBEDDED_COMPILER OFF CACHE INTERNAL "")

message(STATUS "ENABLE_EMBEDDED_COMPILER: OFF")
message(STATUS "  - Removes LLVM dependency (~1.9GB source + build)")
message(STATUS "  - Uses interpreter fallback for expressions")

# ============================================================================
# DWARF Parser - Disabled
# ============================================================================
# ENABLE_DWARF_PARSER controls DWARF debug info parsing using LLVM libraries.
# This is used for debugging features and is not needed for WASM execution.

set(ENABLE_DWARF_PARSER OFF CACHE BOOL "Disable DWARF debug parser (uses LLVM)" FORCE)
# Also set as INTERNAL to prevent any override from vendor/chdb
set(ENABLE_DWARF_PARSER OFF CACHE INTERNAL "")

message(STATUS "ENABLE_DWARF_PARSER: OFF")
message(STATUS "  - Removes LLVM DWARF parsing dependency")

# ============================================================================
# BLAKE3 - Can be enabled independently
# ============================================================================
# BLAKE3 hash function uses a minimal subset of LLVM (LLVMSupport only).
# It can be enabled even without the full LLVM JIT compiler.
# For minimal builds, we disable it to avoid any LLVM dependency.

set(ENABLE_BLAKE3 OFF CACHE BOOL "Disable BLAKE3 (optional, uses LLVM support library)" FORCE)
# Also set as INTERNAL to prevent any override from vendor/chdb
set(ENABLE_BLAKE3 OFF CACHE INTERNAL "")

message(STATUS "ENABLE_BLAKE3: OFF")
message(STATUS "  - Removes LLVMSupport dependency")
message(STATUS "  - Standard hash functions remain available")

# ============================================================================
# Preprocessor Defines Reference
# ============================================================================
# The following preprocessor defines control JIT vs interpreter behavior:
#
# USE_EMBEDDED_COMPILER (defined in src/Common/config.h.in)
#   - Set by CMake based on ENABLE_EMBEDDED_COMPILER option
#   - Controls all JIT-related code inclusion
#   - When 0: All JIT code paths are compiled out
#
# compile_expressions (runtime setting in Settings.cpp)
#   - User-configurable setting (default: true when JIT available)
#   - Only effective when USE_EMBEDDED_COMPILER=1
#   - When USE_EMBEDDED_COMPILER=0: setting is ignored, interpreter always used
#
# compile_aggregate_expressions (runtime setting in Settings.cpp)
#   - Controls JIT compilation for aggregate functions
#   - Only effective when USE_EMBEDDED_COMPILER=1
#   - When USE_EMBEDDED_COMPILER=0: interpreter used for all aggregations
#
# Code flow when JIT is disabled:
#   1. ExpressionActions constructor checks USE_EMBEDDED_COMPILER
#   2. When USE_EMBEDDED_COMPILER=0, compileExpressions() call is skipped
#   3. linearizeActions() creates interpreted execution plan
#   4. All functions use their default (non-JIT) implementations
#
# Key source files:
#   - src/Interpreters/ExpressionActions.cpp (lines 61-64)
#   - src/Interpreters/ExpressionJIT.cpp (entire file guarded by USE_EMBEDDED_COMPILER)
#   - src/Interpreters/Aggregator.cpp (lines 543-545, 548+)
#   - src/configure_config.cmake (line 117: sets USE_EMBEDDED_COMPILER)
#   - src/Common/config.h.in (line 56: #cmakedefine01 USE_EMBEDDED_COMPILER)

# ============================================================================
# LLVM Library Dependencies Removed
# ============================================================================
# When ENABLE_EMBEDDED_COMPILER=OFF, the following LLVM libraries are excluded:
#
# Full JIT libraries (only included when ENABLE_EMBEDDED_COMPILER=ON):
#   - LLVMExecutionEngine
#   - LLVMRuntimeDyld
#   - LLVMAsmPrinter
#   - LLVMDebugInfoDWARF
#   - LLVMGlobalISel
#   - LLVMSelectionDAG
#   - LLVMMCDisassembler
#   - LLVMPasses
#   - LLVMCodeGen
#   - LLVMipo
#   - LLVMBitWriter
#   - LLVMInstrumentation
#   - LLVMScalarOpts
#   - LLVMAggressiveInstCombine
#   - LLVMInstCombine
#   - LLVMVectorize
#   - LLVMTransformUtils
#   - LLVMTarget
#   - LLVMAnalysis
#   - LLVMProfileData
#   - LLVMObject
#   - LLVMBitReader
#   - LLVMCore
#   - LLVMRemarks
#   - LLVMBitstreamReader
#   - LLVMMCParser
#   - LLVMMC
#   - LLVMBinaryFormat
#   - LLVMDebugInfoCodeView
#   - LLVMSupport
#   - LLVMDemangle
#
# Architecture-specific libraries also excluded:
#   - LLVMX86Info, LLVMX86Desc, LLVMX86CodeGen (x86_64)
#   - LLVMAArch64Info, LLVMAArch64Desc, LLVMAArch64CodeGen (ARM64)
#   - And others for PowerPC, SystemZ, RISC-V

# ============================================================================
# Verification
# ============================================================================
# To verify JIT is disabled in the build:
#
# 1. Check CMake configuration output for:
#    "Not using LLVM" message from llvm-project-cmake/CMakeLists.txt
#
# 2. Check generated config.h:
#    #define USE_EMBEDDED_COMPILER 0
#
# 3. At runtime, these settings will have no effect (interpreter always used):
#    SET compile_expressions = 1;  -- ignored when JIT disabled
#    SET compile_aggregate_expressions = 1;  -- ignored when JIT disabled
#
# 4. Binary size should be 50-100MB smaller than JIT-enabled build

# ============================================================================
# Summary
# ============================================================================

message(STATUS "")
message(STATUS "=== No-JIT Configuration Summary ===")
message(STATUS "ENABLE_EMBEDDED_COMPILER:  OFF (LLVM JIT disabled)")
message(STATUS "ENABLE_DWARF_PARSER:       OFF (debug parser disabled)")
message(STATUS "ENABLE_BLAKE3:             OFF (LLVM support library disabled)")
message(STATUS "")
message(STATUS "Preprocessor defines that will be set:")
message(STATUS "  USE_EMBEDDED_COMPILER=0")
message(STATUS "  USE_DWARF_PARSER=0")
message(STATUS "  USE_BLAKE3=0")
message(STATUS "")
message(STATUS "All expression evaluation will use interpreter fallback.")
message(STATUS "Binary size reduction: ~1.9GB (LLVM source + build artifacts)")
message(STATUS "================================================")
message(STATUS "")
