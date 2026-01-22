# Spike 7: JIT Function Compilation On-Demand

## Executive Summary

This spike investigates the feasibility of compiling ClickHouse functions on-demand when first used, with compiled WASM cached in R2/KV for subsequent requests.

**Key Finding: True JIT compilation is NOT feasible in Cloudflare Workers.**

Cloudflare Workers only support **pre-compiled** WebAssembly modules. `WebAssembly.instantiate()` requires modules compiled ahead of time - runtime compilation via `WebAssembly.compile()` or `WebAssembly.compileStreaming()` is not supported. However, we can achieve similar goals through **dynamic loading of pre-compiled function modules**.

## Research Findings

### 1. WebAssembly Compilation Limitations in Workers

#### What Works
- `WebAssembly.instantiate()` with pre-compiled modules
- Importing WASM as ES modules (bundled by wrangler)
- Dynamic loading from R2/Static Assets at runtime

#### What Does NOT Work
- `WebAssembly.compile()` at runtime
- `WebAssembly.compileStreaming()` at runtime
- Any form of runtime code generation

**Source:** [Cloudflare Workers WebAssembly Documentation](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)

### 2. How Pyodide/Python Workers Solve This

Cloudflare's Python Workers use an interesting approach:
1. **Pre-compile** all Pyodide modules ahead of time
2. **Memory snapshots** capture the initialized state at deploy time
3. At runtime, restore from snapshot rather than re-initialize

Key insight: They don't compile at runtime - they **load pre-compiled modules** and restore **memory state snapshots**.

**Source:** [How Python Workers Work](https://developers.cloudflare.com/workers/languages/python/how-python-workers-work/)

### 3. V8 Code Caching (Not Applicable to Workers)

V8 has native WASM code caching that:
- Caches TurboFan-compiled native code after first execution
- Only works with streaming APIs (`compileStreaming`, `instantiateStreaming`)
- Is per-user/browser, not distributable

**This is NOT available in Workers** - V8's code cache is browser-specific and not exposed to the Workers runtime.

**Source:** [V8 WebAssembly Code Caching](https://v8.dev/blog/wasm-code-caching)

### 4. ClickHouse Function Architecture

ClickHouse functions are registered at startup via `FunctionFactory`:

```cpp
// src/Functions/registerFunctions.cpp
void registerFunctions() {
    auto & factory = FunctionFactory::instance();
    for (const auto & [_, reg] : FunctionRegisterMap::instance())
        reg(factory);
}
```

Functions are compiled into the WASM binary at build time. They CANNOT be:
- Compiled independently at runtime
- Added to the function registry dynamically
- Loaded as separate WASM modules without Emscripten SIDE_MODULE support

The existing `CHDB_MINIMAL_FUNCTIONS` CMake option shows the path forward - building different WASM profiles with different function sets.

## Alternative Design: Pre-Compiled Module Loading

Since true JIT is not possible, we can achieve **similar outcomes** through a sophisticated pre-compiled module loading system.

### Architecture Overview

```
Query: SELECT abs(x), sqrt(y), h3ToGeo(z) FROM table
           |
           v
+---------------------+
|  Function Analyzer  |  Detect required functions
+---------------------+
           |
           v
+---------------------+
|  Module Router      |  Map functions to WASM modules
+---------------------+
           |
     +-----+-----+
     |     |     |
     v     v     v
+------+ +------+ +------+
| math | | geo  | | core |   Pre-compiled WASM modules
+------+ +------+ +------+
           |
           v
+---------------------+
|  Module Cache       |  KV for metadata, R2 for binaries
+---------------------+
           |
           v
+---------------------+
|  WebAssembly.       |  Load pre-compiled module
|  instantiate()      |
+---------------------+
```

### Module Organization Strategy

#### Option A: Function-Group Modules (Recommended)
Group related functions into loadable modules:

| Module | Functions | Est. Size |
|--------|-----------|-----------|
| `core.wasm` | Basic SQL (SELECT, WHERE, GROUP BY) | ~2MB |
| `math.wasm` | abs, sqrt, sin, cos, pow, log, etc. | ~200KB |
| `string.wasm` | concat, substring, upper, lower, etc. | ~300KB |
| `datetime.wasm` | toDate, formatDateTime, etc. | ~400KB |
| `geo.wasm` | H3, S2, geoDistance, etc. | ~1MB |
| `json.wasm` | JSONPath, JSONExtract*, etc. | ~500KB |
| `crypto.wasm` | SHA, MD5, cityHash, etc. | ~400KB |
| `window.wasm` | ROW_NUMBER, RANK, LEAD, LAG | ~300KB |
| `aggregate.wasm` | COUNT, SUM, AVG, quantile, etc. | ~600KB |

#### Option B: Monolithic Profiles (Current Approach)
Keep current profile-based builds:
- `minimal.wasm` - Core + basic functions
- `standard.wasm` - + aggregates + string/datetime
- `full.wasm` - Everything

**Recommendation:** Option A provides more granular control but requires significant build infrastructure changes. Start with Option B (current approach) and evolve.

### Caching Strategy

#### Three-Tier Cache

```
+-------------------+
|  In-Memory Cache  |  Hot modules (isolate lifetime)
|  (Map<string,     |  - Instant access
|   WebAssembly.    |  - Lost on cold start
|   Module>)        |
+-------------------+
         |
         v
+-------------------+
|  Workers KV       |  Warm modules (metadata + small binaries)
|                   |  - ~1-5ms latency
|                   |  - 25MB value limit
|                   |  - Good for module metadata
+-------------------+
         |
         v
+-------------------+
|  R2 Bucket        |  Cold modules (binary storage)
|                   |  - 10-50ms latency
|                   |  - Unlimited size
|                   |  - Store WASM binaries
+-------------------+
```

#### Cache Keys

```typescript
// KV: Module metadata
`module:${moduleName}:meta` -> {
  version: string;
  size: number;
  functions: string[];
  dependencies: string[];
  r2Key: string;
  hash: string;
}

// R2: WASM binaries
`wasm/${profile}/${moduleName}@${version}.wasm`
```

#### Cache Invalidation

- **Version-based:** Include module version in cache key
- **Hash-based:** Validate binary hash before use
- **TTL:** KV metadata expires after configurable period
- **Deploy-triggered:** Clear cache on new deployment

### Implementation Approach

#### Phase 1: Enhanced Extension Loader

Extend existing `ExtensionLoader` to support function-based module resolution:

```typescript
interface FunctionModuleLoader {
  // Detect required modules from SQL
  detectModules(sql: string): string[];

  // Check if module is loaded
  isModuleLoaded(moduleName: string): boolean;

  // Load module from cache hierarchy
  loadModule(moduleName: string): Promise<void>;

  // Get module status
  getModuleStatus(): ModuleStatus[];
}

class ModuleCache {
  private inMemory: Map<string, WebAssembly.Module>;
  private kv: KVNamespace;
  private r2: R2Bucket;

  async getModule(name: string): Promise<WebAssembly.Module | null> {
    // 1. Check in-memory
    if (this.inMemory.has(name)) {
      return this.inMemory.get(name)!;
    }

    // 2. Check KV for metadata + small modules
    const meta = await this.kv.get(`module:${name}:meta`, 'json');
    if (!meta) return null;

    // 3. Fetch from R2
    const wasmBinary = await this.r2.get(meta.r2Key);
    if (!wasmBinary) return null;

    // 4. Instantiate (NOT compile - it's pre-compiled!)
    const module = await WebAssembly.compile(await wasmBinary.arrayBuffer());

    // 5. Cache in memory
    this.inMemory.set(name, module);

    return module;
  }
}
```

#### Phase 2: Build System Changes

Create separate WASM builds for function groups:

```cmake
# Build math functions as SIDE_MODULE
add_library(chdb-math SHARED
  ${CMAKE_CURRENT_SOURCE_DIR}/abs.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/sqrt.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/sin.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/cos.cpp
  # ... more math functions
)
set_target_properties(chdb-math PROPERTIES
  LINK_FLAGS "-sSIDE_MODULE=2"
)
```

#### Phase 3: Query-Time Module Loading

```typescript
async function executeQuery(sql: string, env: Env): Promise<Response> {
  const loader = new FunctionModuleLoader(env);

  // 1. Analyze query
  const requiredModules = loader.detectModules(sql);

  // 2. Load missing modules
  for (const module of requiredModules) {
    if (!loader.isModuleLoaded(module)) {
      await loader.loadModule(module);
    }
  }

  // 3. Execute query with all functions available
  return executeWithModules(sql);
}
```

### Performance Considerations

#### Cold Start Impact

| Scenario | Estimated Latency |
|----------|------------------|
| Core module only | ~50-100ms |
| + 1 extension module | ~80-150ms |
| + 3 extension modules | ~150-250ms |
| Full monolithic | ~200-400ms |

#### Optimization Strategies

1. **Preload common modules** at Worker startup
2. **Predictive loading** based on usage patterns
3. **Module bundling** for common combinations
4. **Lazy instantiation** - parse but don't instantiate until needed

#### Memory Impact

Workers have 128MB limit:
- Core WASM instance: ~20-40MB
- Each extension: ~5-15MB
- Practical limit: ~3-5 loaded extensions simultaneously

### Challenges and Mitigations

| Challenge | Mitigation |
|-----------|------------|
| No true JIT compilation | Pre-compile all function groups at build time |
| Memory limits | Careful module design, unload unused modules |
| Cold start latency | Preload common modules, use memory snapshots |
| Function dependencies | Track and load dependency chains |
| Version coordination | Version all modules together in releases |
| Cache invalidation | Include version/hash in cache keys |

## Feasibility Assessment

### What IS Feasible

1. **Dynamic loading of pre-compiled WASM modules** from R2/Assets
2. **Query-based function detection** using existing `extension-auto-detect.ts`
3. **Multi-tier caching** with KV metadata + R2 binaries + in-memory
4. **Modular builds** using Emscripten SIDE_MODULE
5. **Lazy loading** of extension modules on first use

### What is NOT Feasible

1. **True JIT compilation** - Workers don't support runtime WASM compilation
2. **Per-function granularity** - Functions must be grouped into modules
3. **Source-level compilation** - Cannot compile C++ at runtime
4. **V8 code cache access** - Not exposed in Workers runtime

## Recommendations

### Short Term (Current Release)

1. Keep profile-based builds (minimal, standard, full)
2. Enhance extension loader to support R2-stored modules
3. Implement KV-based metadata caching
4. Use existing `extension-auto-detect.ts` for function detection

### Medium Term (Next Quarter)

1. Create function-group WASM modules (SIDE_MODULE builds)
2. Implement three-tier cache (memory -> KV -> R2)
3. Add query-time module loading
4. Build module dependency tracking

### Long Term (Future)

1. Explore memory snapshots (like Pyodide)
2. Consider V8 code cache if Cloudflare exposes it
3. Investigate WASI 0.3 async features for better loading
4. Build intelligent preloading based on usage analytics

## Conclusion

While true JIT compilation is not possible in Cloudflare Workers, we can achieve **similar user-facing behavior** through:

1. Pre-compiling function groups into separate WASM modules
2. Loading modules on-demand when queries require them
3. Caching loaded modules across the KV/R2/memory hierarchy

This approach provides:
- **Smaller initial load times** (only load what you need)
- **Reduced memory usage** (don't instantiate unused modules)
- **Flexible deployment** (update function modules independently)
- **Good developer experience** (queries "just work" with any function)

The key insight is that "JIT" in this context means **Just-In-Time Loading**, not Just-In-Time Compilation. The modules are pre-compiled but loaded dynamically based on query requirements.

## References

- [Cloudflare Workers WebAssembly Documentation](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)
- [How Python Workers Work](https://developers.cloudflare.com/workers/languages/python/how-python-workers-work/)
- [V8 WebAssembly Code Caching](https://v8.dev/blog/wasm-code-caching)
- [Emscripten Dynamic Linking](https://emscripten.org/docs/compiling/Dynamic-Linking.html)
- [WebAssembly on Cloudflare Workers (Blog)](https://blog.cloudflare.com/webassembly-on-cloudflare-workers/)
- [Python Workers Redux: WASM Snapshots](https://blog.cloudflare.com/python-workers-advancements/)
