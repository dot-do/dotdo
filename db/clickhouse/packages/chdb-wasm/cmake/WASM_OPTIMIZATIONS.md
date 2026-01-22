# WASM Build Optimizations for chdb

This document describes the aggressive WASM build optimizations configured for chdb,
inspired by DuckDB's successful approach to achieving a ~10MB WASM binary.

## Quick Start

```bash
# Build with all aggressive optimizations
cmake -S . -B build \
  -DCMAKE_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake \
  -DBUILD_ULTRA_MINIMAL=ON \
  -DCHDB_WASM_AGGRESSIVE_SIZE=ON \
  -DCHDB_WASM_USE_CLOSURE=ON \
  -DCHDB_WASM_USE_WASM_OPT=ON

cmake --build build --target chdb-wasm-ultra-minimal
```

## Optimization Categories

### 1. Emscripten Optimization Flags

| Flag | Description | Size Impact |
|------|-------------|-------------|
| `-Oz` | Maximum size optimization (vs `-O3`) | ~15-25% smaller |
| `-flto` | Link-time optimization | ~5-15% smaller |
| `--closure 1` | Closure Compiler for JS | ~30-50% JS size |
| `-fno-exceptions` | Disable C++ exceptions | ~5-10% smaller |
| `-fno-rtti` | Disable runtime type info | ~3-5% smaller |
| `-ffunction-sections` | Enable dead code elimination | varies |
| `-fdata-sections` | Enable unused data elimination | varies |
| `-fvisibility=hidden` | Default hidden visibility | helps stripping |
| `-fmerge-all-constants` | Merge identical constants | ~1-2% smaller |

### 2. Post-Build wasm-opt Integration

The `wasm-opt` tool from Binaryen provides additional ~10-20% size reduction.

**Key passes:**
- `--optimize-instructions` - Instruction-level optimization
- `--merge-similar-functions` - Deduplicate similar functions
- `--code-folding` - Fold identical code sequences
- `--vacuum` - Remove dead code
- `--dce` - Dead code elimination
- `--coalesce-locals` - Merge local variables
- `--memory-packing` - Optimize memory layout

**Usage:**
```cmake
# Automatically applied when CHDB_WASM_USE_WASM_OPT=ON
chdb_add_wasm_opt_postbuild(your_target)
```

### 3. Symbol Stripping

| Setting | Description |
|---------|-------------|
| `-g0` | No debug info |
| `--strip-all` | Strip all symbols |
| `EXPORT_NAME='createChdb'` | Single clean export |
| Minimal exports | Only essential functions |

**Exported Functions (minimal):**
- `_malloc`, `_free`
- `_chdb_query`
- `_chdb_create`, `_chdb_destroy`
- `_chdb_get_version`

### 4. Memory Optimization

| Setting | Value | Purpose |
|---------|-------|---------|
| `INITIAL_MEMORY` | 16MB | Small initial footprint |
| `MAXIMUM_MEMORY` | 512MB | Reasonable upper bound |
| `STACK_SIZE` | 512KB | Adequate for SQL parsing |
| `ALLOW_MEMORY_GROWTH` | 1 | Dynamic allocation |
| `MALLOC` | emmalloc | Smallest allocator |

**Memory Growth Strategy:**
- Geometric growth: 20% per step
- Growth cap: 64MB per expansion
- Total budget: Up to 512MB

### 5. Runtime Feature Disabling

| Feature | Flag | Size Saved |
|---------|------|-----------|
| Exception catching | `DISABLE_EXCEPTION_CATCHING=1` | ~50-100KB |
| longjmp support | `SUPPORT_LONGJMP=0` | ~10-20KB |
| Assertions | `ASSERTIONS=0` | ~50KB |
| Full filesystem | `FILESYSTEM=0` | ~50-100KB |

## Expected Size Savings

### Baseline vs Optimized

| Component | Baseline | Optimized | Savings |
|-----------|----------|-----------|---------|
| Core SQL engine | ~20MB | ~8-12MB | 40-60% |
| JavaScript glue | ~500KB | ~100KB | 80% |
| Total WASM | ~25MB | ~10-15MB | 40-60% |
| Gzipped | ~8MB | ~3-5MB | 40-60% |

### Feature Disabling Impact

| Disabled Feature | Estimated Savings |
|-----------------|-------------------|
| LLVM/JIT compiler | ~1.9GB (source), ~20MB compiled |
| Cloud storage (S3, Azure, GCS) | ~17-26MB |
| Message queues (Kafka, AMQP) | ~3.5-6MB |
| Database connectors | ~11-19MB |
| Arrow/Parquet/ORC formats | ~23-33MB |
| Geospatial (H3, S2) | ~2-3MB |
| ICU/NLP libraries | ~5-10MB |

## Configuration Files

### wasm-aggressive-optimizations.cmake

Main optimization module. Provides:
- `chdb_apply_aggressive_wasm_optimizations(target)` - Apply all optimizations
- `chdb_add_wasm_opt_postbuild(target)` - Add wasm-opt post-processing

### wasm-ultra-minimal.cmake

Ultra-minimal profile targeting <15MB:
- Memory engine only
- Basic SQL functions only
- No filesystem
- Cloudflare Workers compatible

### wasm-build.cmake

Core WASM build configuration:
- Emscripten toolchain setup
- Base compiler/linker flags
- Memory configuration

### wasm-integrations.cmake

Disables external integrations:
- Cloud storage
- Message queues
- Database connectors
- Network protocols

## Usage in CMakeLists.txt

```cmake
# Include the optimization module
include(cmake/wasm-aggressive-optimizations.cmake)

# Create your target
add_executable(my-wasm-target src/main.cpp)

# Apply aggressive optimizations
chdb_apply_aggressive_wasm_optimizations(my-wasm-target)
```

## Build Profiles

### Standard Profile
- Target size: ~50-80MB
- Full WASM-compatible features
- Use for development/testing

### Minimal Profile
- Target size: ~20-30MB
- Reduced feature set
- Use for general web deployment

### Ultra-Minimal Profile
- Target size: <15MB uncompressed, <5MB gzipped
- Memory engine only
- Use for Cloudflare Workers, edge functions

## Verification

After building, verify the binary size:

```bash
# Check WASM size
ls -lh build/dist/*.wasm

# Check gzipped size
gzip -c build/dist/chdb.wasm | wc -c

# Analyze with wasm-objdump (from wabt)
wasm-objdump -h build/dist/chdb.wasm
```

## References

- [DuckDB WASM](https://duckdb.org/docs/api/wasm) - Achieves ~10MB with similar approach
- [Emscripten Optimizing Code](https://emscripten.org/docs/optimizing/Optimizing-Code.html)
- [Binaryen wasm-opt](https://github.com/WebAssembly/binaryen)
- [Reducing WASM Binary Size](https://nicolo.io/blog/2024-03-31-reducing-wasm-binary-size)
