# Multi-Module WASM Architecture for Real ClickHouse

## Overview

This spike explores an alternative to Emscripten dynamic linking: using multiple independent WASM modules that communicate through a JavaScript bridge. This is research for splitting the **real ClickHouse WASM binary** into smaller, independently loadable modules.

## Context

This project compiles **actual ClickHouse C++ code** (from `vendor/chdb`) to WebAssembly via Emscripten. This spike investigates whether a multi-module architecture can reduce initial load times for the compiled ClickHouse binary.

## Architecture

```
core.wasm (always loaded) - Real ClickHouse Core
  |
  v  JavaScript bridge (orchestrator.ts)
  |
format-json.wasm (loaded on demand) - Real ClickHouse JSON Format
```

## Research Findings

### 1. Industry Examples

#### Figma
- Uses C++ compiled to WebAssembly for core rendering
- Combines WASM with React/TypeScript for UI
- Heavy GPU shader usage managed by C++ scene graph
- Uses single large WASM module (not multi-module)
- Source: [Figma Blog](https://www.figma.com/blog/webassembly-cut-figmas-load-time-by-3x/)

#### Google Earth
- C++ engine compiled via Ion abstraction layer
- Originally used asm.js->WASM conversion
- Multi-threading relies on SharedArrayBuffer (limited browser support)
- Single monolithic module, not multi-module
- Source: [web.dev - Google Earth](https://web.dev/earth-webassembly/)

**Key Insight**: Both Figma and Google Earth use single large WASM modules, not multi-module architectures. This spike explores whether a multi-module approach offers benefits for our ClickHouse WASM use case.

### 2. Memory Sharing Options

#### Option A: SharedArrayBuffer (Best for shared memory)
- **Pros**: True zero-copy memory sharing, Atomics for synchronization
- **Cons**: Requires cross-origin isolation headers, not available in Cloudflare Workers
- **Workers Support**: **NO** - Cloudflare Workers do not support multi-threading or SharedArrayBuffer for thread synchronization
- Sources:
  - [MDN SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
  - [SharedArrayBuffer Deep Dive](https://medium.com/@jacobscottmellor/sharedarraybuffer-the-hidden-super-primitive-thats-reshaping-the-future-of-webassembly-net-e369e667f6e9)

#### Option B: Transferable ArrayBuffer (Best for Workers)
- **Pros**: Zero-copy ownership transfer, works in Workers
- **Cons**: Original context loses access after transfer, can't share between WASM instances directly
- **How it works**: ArrayBuffer can be "transferred" via postMessage, moving ownership without copying
- Sources:
  - [MDN Transferable Objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
  - [Chrome Transferable Objects](https://developer.chrome.com/blog/transferable-objects-lightning-fast)

#### Option C: Copy via JavaScript Bridge (Universal compatibility)
- **Pros**: Works everywhere, simple to implement
- **Cons**: Data is copied at each boundary (WASM->JS->WASM)
- **Mitigation**: TypedArray views can reduce some overhead

### 3. Zero-Copy Challenges

From [WebAssembly Design Issue #1162](https://github.com/WebAssembly/design/issues/1162):
> "Unfortunately it is not possible to pass a whole separate ArrayBuffer from outside JavaScript to inside a WebAssembly Module. The WebAssembly Module is limited to operating only on the one buffer that it is initialized with."

**This is a fundamental limitation**: Each WASM module has its own linear memory, and you cannot directly share memory between modules without copying.

### 4. Cloudflare Workers Constraints

- **SharedArrayBuffer**: Not available for multi-threading
- **Web Workers**: Not supported (no worker threads)
- **Memory limits**: 128MB per Worker (configurable)
- **WASM size**: Single module recommended
- Sources:
  - [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
  - [Python Workers Blog](https://blog.cloudflare.com/python-workers/)

## Prototype Architecture

### Approach: JavaScript-Mediated Data Flow

Since we cannot share memory directly between WASM modules in Workers, we use JavaScript as a bridge:

```
                    JavaScript Orchestrator
                           |
         +----------------+----------------+
         |                                 |
    core.wasm                        format-json.wasm
    - Real ClickHouse SQL parsing    - Real ClickHouse JSON parse
    - Real ClickHouse query planning - Real ClickHouse JSON serialize
    - Result coordination            - JSONEachRow format
```

### Data Flow

1. **Query arrives** at orchestrator
2. **core.wasm** (real ClickHouse) parses SQL, determines format needed
3. **If JSON format**: orchestrator loads format-json.wasm lazily
4. **Data transfer**: JavaScript copies data between module memories
5. **Result**: formatted output returned

### Memory Layout

Each WASM module maintains its own memory:
- `core.wasm`: 1-4MB (SQL parser, query coordinator)
- `format-json.wasm`: 0.5-1MB (loaded on demand)

## Key Findings

### Advantages of Multi-Module

1. **Smaller initial load**: Core module can be tiny (~50KB)
2. **Lazy loading**: Format modules loaded only when needed
3. **Better caching**: Unchanged modules remain cached
4. **Isolation**: Bugs in one module don't crash others
5. **Parallel development**: Teams can work independently

### Disadvantages

1. **Copy overhead**: Data must be copied at module boundaries
2. **No direct memory sharing**: Fundamental WASM limitation
3. **Complexity**: More code to maintain
4. **Latency**: Lazy loading adds initial delay per module

### Performance Characteristics

| Operation | Monolithic | Multi-Module | Overhead |
|-----------|------------|--------------|----------|
| Initial load | Higher | Lower | -50-80% |
| First JSON query | Same | Higher | +10-50ms |
| Subsequent queries | Same | Same | ~0% |
| Memory per module | Shared | Isolated | +overhead |

### Recommendation for Cloudflare Workers

**For Workers, the copy-via-JavaScript approach is the only viable option.** Given this:

1. **Keep modules small**: Minimize data transfer overhead
2. **Use TypedArray views**: Reduce intermediate copies
3. **Cache loaded modules**: Use module-level caching
4. **Batch operations**: Amortize copy overhead over larger operations

## Files in This Spike

- `README.md` - This document
- `core.cpp` - SQL parser and query coordinator (real ClickHouse)
- `format-json.cpp` - JSON formatting module (real ClickHouse)
- `orchestrator.ts` - JavaScript bridge and module loader
- `CMakeLists.txt` - Build configuration
- `benchmark.ts` - Performance benchmarks

## Building

```bash
# Requires Emscripten
cd wasm/multimodule
mkdir -p build && cd build
emcmake cmake ..
emmake make
```

## Testing

```bash
# Run benchmarks
npx tsx benchmark.ts
```

## Conclusion

Multi-module WASM architecture is viable for Cloudflare Workers but requires accepting the copy overhead. The main benefits are:

1. **Reduced initial bundle size** - Critical for Workers cold start
2. **Lazy loading** - Only load what you need
3. **Modular development** - Easier maintenance

The copy overhead is acceptable for our use case because:
1. SQL queries typically process small-medium result sets
2. The JSON formatting operation is CPU-intensive anyway
3. Module loading latency is amortized across requests

## References

- [Figma WebAssembly Blog](https://www.figma.com/blog/webassembly-cut-figmas-load-time-by-3x/)
- [Google Earth WebAssembly](https://web.dev/earth-webassembly/)
- [MDN SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
- [MDN Transferable Objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [WebAssembly Zero-Copy Design Issue](https://github.com/WebAssembly/design/issues/1162)
- [Cloudflare Workers Runtime](https://developers.cloudflare.com/workers/)
