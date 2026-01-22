# Spike 4: Aggressive Tree-Shaking and Dead Code Elimination

## Goal

Identify and document Emscripten optimization flags to reduce WASM binary size through tree-shaking, dead code elimination (DCE), and link-time optimization (LTO).

## Current State

### Current WASM Module Sizes

| Module | Size (bytes) | Size (KB) |
|--------|-------------|-----------|
| executor.wasm | 188,378 | 184 KB |
| memory_engine.wasm | 165,844 | 162 KB |
| aggregates.wasm | 168,686 | 165 KB |
| json_format.wasm | 143,550 | 140 KB |
| csv_format.wasm | 140,218 | 137 KB |
| mergetree.wasm | 290,712 | 284 KB |
| storage_memory_real.wasm | 199,287 | 195 KB |
| real_parser.wasm | 30,902 | 30 KB |
| parser.wasm | 23,400 | 23 KB |
| functions.wasm | 16,920 | 17 KB |
| Lexer.wasm | 14,721 | 14 KB |
| **Total** | **1,382,618** | **~1.35 MB** |

### Current Optimization Flags in build.sh

```bash
# Compiler flags (applied consistently across modules)
-std=c++17          # C++ standard
-Os                 # Optimize for size (good choice)
-fno-exceptions     # Disable exceptions (saves ~15%)
-fno-rtti           # Disable RTTI (saves space)

# Linker flags
-s WASM=1
-s MODULARIZE=1
-s ALLOW_MEMORY_GROWTH=1
-s INITIAL_MEMORY=1048576-4194304  # Varies by module
-s ENVIRONMENT='node,web'
-s EXPORT_ES6=0
```

### Current Flags NOT Being Used

The following optimization flags are available but not currently applied:

| Flag | Status | Impact |
|------|--------|--------|
| `-flto` | NOT USED | Link-time optimization for cross-unit inlining |
| `--closure 1` | NOT USED | Closure Compiler for JS minification |
| `-s EVAL_CTORS=1` | NOT USED | Evaluate constructors at compile time |
| `-Oz` | NOT USED | More aggressive size optimization than -Os |
| `-fdata-sections` | NOT USED | Put each data item in own section |
| `-ffunction-sections` | NOT USED | Put each function in own section |
| `-Wl,--gc-sections` | NOT USED | Garbage collect unused sections |
| `-s MINIMAL_RUNTIME=1` | NOT USED | Smaller runtime (with limitations) |
| `-s ASSERTIONS=0` | NOT USED | Disable assertions (implied at -O1+) |

## Optimization Flags Analysis

### 1. Link-Time Optimization (`-flto`)

**Description:** Enables whole-program optimization at link time, allowing the compiler to inline functions across compilation units and eliminate more dead code.

**Expected Impact:** 5-15% size reduction

**Risk:** Increased build time, potential for subtle bugs with complex C++ code

**Recommendation:** APPLY - This is a safe, well-tested optimization.

```bash
# Add to both compile and link flags
-flto
```

### 2. Closure Compiler (`--closure 1`)

**Description:** Runs Google's Closure Compiler on the JavaScript glue code, performing aggressive minification and dead code elimination.

**Expected Impact:** 30-50% reduction in JS file size (not WASM)

**Risk:** May break code that uses dynamic property access; requires `MODULARIZE=1`

**Recommendation:** APPLY for production builds

```bash
# Add to link flags
--closure 1
```

### 3. EVAL_CTORS (`-sEVAL_CTORS=1`)

**Description:** Evaluates global constructors at compile time and "snapshots" the results into the WASM binary. This can reduce both startup time and code size.

**Mode 1 (safe):** Stops at any import call
**Mode 2 (unsafe):** Ignores argc/argv and environment variables

**Expected Impact:** Variable (0-20%), depends on static initialization patterns

**Risk:** Mode 2 can break programs that read environment variables or command-line args

**Recommendation:** TEST with mode 1 first

```bash
# Add to link flags
-sEVAL_CTORS=1
```

### 4. Oz vs Os Optimization

**Description:** `-Oz` optimizes more aggressively for size than `-Os`, potentially at the cost of performance.

**Expected Impact:** 5-10% additional size reduction over -Os

**Risk:** May reduce runtime performance

**Recommendation:** TEST - benchmark both size and performance

```bash
# Replace -Os with
-Oz
```

### 5. Section-Based Garbage Collection

**Description:** `-fdata-sections` and `-ffunction-sections` place each function/data item in its own section. Combined with `-Wl,--gc-sections`, unused sections can be removed.

**Expected Impact:** 5-15% reduction for code with many unused functions

**Risk:** Slightly larger object files before linking

**Recommendation:** APPLY - standard practice for embedded/WASM

```bash
# Compile flags
-fdata-sections -ffunction-sections

# Link flags
-Wl,--gc-sections
```

### 6. MINIMAL_RUNTIME (`-sMINIMAL_RUNTIME=1`)

**Description:** Emits a significantly smaller runtime by removing features like:
- Memory growth handling (if not needed)
- Exception support helpers
- Full filesystem support

**Expected Impact:** 30-50% reduction in JS glue code

**Risk:** Breaks features that depend on removed runtime code

**Recommendation:** TEST CAREFULLY - incompatible with some features we may need

### 7. ENVIRONMENT Restriction

**Current:** `ENVIRONMENT='node,web'`

**Description:** Limiting environments removes code for unsupported platforms.

**Expected Impact:** ~2KB savings per environment removed

**Recommendation:** Already optimized, but consider `ENVIRONMENT='web'` for browser-only builds

### 8. MALLOC Selection (`-sMALLOC=emmalloc`)

**Description:** Uses a smaller memory allocator instead of dlmalloc.

**Expected Impact:** ~10KB reduction

**Risk:** Slightly slower allocation, fragmentation in long-running apps

**Recommendation:** TEST for worker environment

## Recommended Build Configuration

### Conservative (Safe) Optimizations

Apply these flags for immediate gains with minimal risk:

```bash
# Compile flags
COMMON_CXX_FLAGS="-std=c++17 -Oz -fno-exceptions -fno-rtti -flto -fdata-sections -ffunction-sections"

# Link flags (add to existing)
-flto
-Wl,--gc-sections
--closure 1  # For production builds
```

### Aggressive Optimizations (Requires Testing)

Additional flags for maximum size reduction:

```bash
# Add to link flags
-sEVAL_CTORS=1
-sMALLOC=emmalloc
-sMINIMAL_RUNTIME=1  # Only if compatible
```

## Estimated Size Reduction

| Optimization | Est. Reduction | Cumulative |
|--------------|---------------|------------|
| Baseline | 0% | 1,350 KB |
| `-Oz` (vs -Os) | 5-10% | ~1,215-1,283 KB |
| `-flto` | 5-10% | ~1,094-1,220 KB |
| `--gc-sections` | 5-10% | ~985-1,160 KB |
| `--closure 1` (JS only) | N/A WASM | JS: -40% |
| `-sEVAL_CTORS=1` | 0-10% | ~886-1,160 KB |
| `-sMALLOC=emmalloc` | ~10KB | Negligible |

**Conservative Estimate:** 20-30% reduction (945-1,080 KB)
**Aggressive Estimate:** 30-45% reduction (740-945 KB)

## Implementation Plan

### Phase 1: Safe Optimizations

1. Update `wasm/build.sh` with `-flto`, `-fdata-sections`, `-ffunction-sections`, `-Wl,--gc-sections`
2. Change `-Os` to `-Oz`
3. Add `--closure 1` for production builds
4. Measure size reduction
5. Run tests to verify functionality

### Phase 2: Aggressive Optimizations

1. Test `-sEVAL_CTORS=1`
2. Test `-sMALLOC=emmalloc` for memory-intensive modules
3. Evaluate `-sMINIMAL_RUNTIME=1` compatibility
4. Benchmark startup time and runtime performance

### Phase 3: Module-Specific Optimizations

1. Analyze each module for specific optimization opportunities
2. Consider splitting large modules
3. Implement lazy loading for optional features

## Build Script Changes

### Proposed Changes to build.sh

```bash
# BEFORE (current)
COMMON_CXX_FLAGS="-std=c++17 -Os -fno-exceptions -fno-rtti"

# AFTER (optimized)
COMMON_CXX_FLAGS="-std=c++17 -Oz -fno-exceptions -fno-rtti -flto -fdata-sections -ffunction-sections"

# Add to LINK flags for each emcc command:
# -flto -Wl,--gc-sections

# For production builds, add:
# --closure 1
```

## Risks and Trade-offs

### Build Time

- `-flto` significantly increases link time (2-5x)
- `--closure 1` adds Closure Compiler time (~10-30s)

### Runtime Performance

- `-Oz` may reduce performance vs `-Os` (benchmark required)
- `emmalloc` is slower than `dlmalloc` for heavy allocation

### Compatibility

- `--closure 1` may break dynamic property access
- `-sMINIMAL_RUNTIME` removes features that may be needed
- `-sEVAL_CTORS=2` can break env var reading

## Next Steps

1. Create a test build with conservative optimizations
2. Compare output size before/after
3. Run full test suite
4. Benchmark startup time and query performance
5. If successful, update build scripts and create size-optimized build profile

## References

- [Emscripten Optimizing Code](https://emscripten.org/docs/optimizing/Optimizing-Code.html)
- [Emscripten Compiler Settings Reference](https://emscripten.org/docs/tools_reference/settings_reference.html)
- [Emscripten emcc Reference](https://emscripten.org/docs/tools_reference/emcc.html)
