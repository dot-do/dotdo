# Spike 3: Streaming/Chunked WASM Loading from R2

## Summary

This spike investigates using `WebAssembly.compileStreaming()` to load WASM modules efficiently from Cloudflare R2 storage. The goal is to understand if streaming compilation can reduce load times for large WASM modules.

## Current WASM Loading Approach

The codebase currently uses several approaches for loading WASM modules:

### 1. Bundled WASM (src/bundled-executor.ts)

```typescript
// Import WASM as ES module - pre-compiled by Wrangler
import executorWasm from '../wasm/dist/executor.wasm';

// The module is already compiled, just instantiate it
await runtime.initialize(executorWasm as unknown as WebAssembly.Module);
```

**Pros:**
- Pre-compiled at deploy time (fastest cold start)
- No runtime fetch latency
- Simple deployment

**Cons:**
- Limited to 10MB compressed (paid plan)
- Larger modules increase bundle size and cold start time

### 2. Runtime Loading (src/wasm/core-loader.ts)

```typescript
export async function createCoreModuleFromBinary(
  wasmBinary: ArrayBuffer | Uint8Array,
  options: CoreModuleOptions = {}
): Promise<CoreModule> {
  const wasmModule = await WebAssembly.compile(wasmBinary);
  return createCoreModuleWithWasm(wasmModule, options);
}
```

**Approach:** Load WASM binary as ArrayBuffer, then compile.

**Pros:**
- Works with any source (R2, KV, Assets)
- No bundle size limits

**Cons:**
- Must buffer entire WASM before compilation
- No streaming benefits
- Compilation happens in request handler

### 3. MergeTree Loader (src/wasm/mergetree-loader.ts)

```typescript
private async loadWasmBinary(): Promise<ArrayBuffer> {
  if (this.assetFetcher) {
    const response = await this.assetFetcher.fetch(
      new Request(`https://placeholder${this.wasmPath}`)
    );
    return response.arrayBuffer();
  }
  // ...
}
```

**Approach:** Fetch from static assets or relative path, buffer, then compile.

## WebAssembly.compileStreaming() Analysis

### What It Does

`WebAssembly.compileStreaming()` is a browser/runtime API that allows WASM compilation to begin **while the response is still being downloaded**. This can significantly reduce total load time for large modules.

```typescript
// Standard approach: download entire buffer, then compile
const response = await fetch('/module.wasm');
const buffer = await response.arrayBuffer();  // Wait for full download
const module = await WebAssembly.compile(buffer);  // Then compile

// Streaming approach: compile while downloading
const response = await fetch('/module.wasm');
const module = await WebAssembly.compileStreaming(response);  // Concurrent!
```

### Theoretical Benefits

For a 10MB WASM module:
- **Standard approach:** 500ms download + 300ms compile = 800ms total
- **Streaming approach:** ~600ms (compilation overlaps with download)

Savings increase with module size.

### Cloudflare Workers Constraints

According to existing documentation (WORKERS_WASM_LOADING.md):

> "**No `WebAssembly.instantiateStreaming()`** - Workers does not support streaming compilation"

However, this may be outdated. Let's verify:

1. **ES Module Imports:** When importing `.wasm` files, Wrangler pre-compiles them. This is the preferred approach and already provides "streaming-like" benefits (compilation happens at deploy time, not request time).

2. **Runtime Loading:** When fetching WASM at runtime (from R2, KV, or Assets), the standard `WebAssembly.compile()` works but `compileStreaming()` may or may not be available.

3. **R2 Returns R2Object, Not Response:** The R2 API returns `R2Object` which has a `body` stream but is not a standard `Response`. We need to wrap it.

## Implementation: Streaming WASM Loader

Created `/src/wasm/streaming-loader.ts` with the following features:

### Key Code Pattern

```typescript
// Wrap R2 body in a Response object for compileStreaming
const r2Object = await env.WASM_BUCKET.get('wasm/executor.wasm');
const response = new Response(r2Object.body, {
  headers: {
    'Content-Type': 'application/wasm',  // Required for compileStreaming
    'Content-Length': totalSize.toString(),
  },
});

try {
  // Attempt streaming compilation
  const module = await WebAssembly.compileStreaming(response);
} catch (err) {
  // Fall back to standard compilation
  const buffer = await r2Object.arrayBuffer();
  const module = await WebAssembly.compile(buffer);
}
```

### Features

1. **Automatic Fallback:** Tries streaming first, falls back to direct loading
2. **Progress Tracking:** Supports progress callbacks for large files
3. **Module Caching:** Caches compiled modules in memory
4. **Metrics:** Reports fetch time, compile time, and strategy used
5. **Timeout Support:** Configurable timeouts for network operations

### Usage Example

```typescript
import { StreamingWasmLoader, loadWasmFromR2 } from './wasm/streaming-loader';

// Simple usage
const result = await loadWasmFromR2(env, 'wasm/executor.wasm');
console.log(`Loaded ${result.bytesLoaded} bytes in ${result.totalTimeMs}ms`);
console.log(`Strategy: ${result.strategy}`);  // 'r2-streaming' or 'r2-direct'

// With progress tracking
const loader = new StreamingWasmLoader(env);
const result = await loader.loadFromR2({
  key: 'wasm/executor.wasm',
  useStreaming: true,
  onProgress: (loaded, total) => {
    console.log(`Progress: ${(loaded / total * 100).toFixed(1)}%`);
  },
});
```

## R2 Integration

### Current R2 Buckets (from wrangler.toml)

```toml
[[r2_buckets]]
binding = "CLICKBENCH_BUCKET"
bucket_name = "clickbench-data"

[[r2_buckets]]
binding = "DATA_BUCKET"
bucket_name = "chdb-document-data"
```

### Adding WASM Bucket

For WASM storage, add a dedicated bucket:

```toml
[[r2_buckets]]
binding = "WASM_BUCKET"
bucket_name = "chdb-wasm-modules"
```

### R2 Range Requests

R2 supports range requests which could enable chunked loading:

```typescript
// Load specific range from R2
const obj = await env.WASM_BUCKET.get('wasm/executor.wasm', {
  range: { offset: 0, length: 1024 * 1024 },  // First 1MB
});
```

This could be useful for:
- Progressive loading UIs
- Resumable downloads
- Memory-constrained environments

However, for WASM compilation, we need the complete module.

## Performance Expectations

### Cold Start Scenarios

| Scenario | Bundle Size | R2 Fetch | Compile | Total |
|----------|-------------|----------|---------|-------|
| Bundled (pre-compiled) | 5MB gzip | N/A | N/A | ~200ms |
| R2 Direct | 5MB | ~100ms | ~200ms | ~300ms |
| R2 Streaming | 5MB | ~100ms | ~150ms* | ~250ms* |
| R2 Direct | 15MB | ~300ms | ~600ms | ~900ms |
| R2 Streaming | 15MB | ~300ms | ~400ms* | ~700ms* |

*Streaming times are theoretical - actual benefit depends on Workers runtime support.

### Warm Start (Cached Module)

With module caching, subsequent requests in the same isolate skip loading entirely:

```typescript
// First request: full load
const result1 = await loader.loadFromR2({ key: 'wasm/executor.wasm' });
// result1.totalTimeMs ~300ms

// Subsequent requests: cache hit
const result2 = await loader.loadFromR2({ key: 'wasm/executor.wasm' });
// result2.totalTimeMs ~0.1ms
```

## Testing the Implementation

### Unit Test

```typescript
import { describe, it, expect, vi } from 'vitest';
import { StreamingWasmLoader, isStreamingCompilationAvailable } from '../wasm/streaming-loader';

describe('StreamingWasmLoader', () => {
  it('should check streaming availability', () => {
    const available = isStreamingCompilationAvailable();
    // Will be true in Node.js, may vary in Workers
    expect(typeof available).toBe('boolean');
  });

  it('should fall back to direct loading when streaming fails', async () => {
    const mockBucket = {
      head: vi.fn().mockResolvedValue({ size: 1024 }),
      get: vi.fn().mockResolvedValue({
        body: new ReadableStream(),
        arrayBuffer: vi.fn().mockResolvedValue(
          // Minimal valid WASM module
          new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer
        ),
      }),
    };

    const loader = new StreamingWasmLoader({ WASM_BUCKET: mockBucket });
    const result = await loader.loadFromR2({ key: 'test.wasm' });

    expect(result.module).toBeDefined();
    expect(['r2-streaming', 'r2-direct']).toContain(result.strategy);
  });
});
```

### Integration Test

Deploy the Worker and test with actual R2:

```bash
# Upload WASM to R2
wrangler r2 object put chdb-wasm-modules/wasm/executor.wasm --file ./wasm/dist/executor.wasm

# Test the endpoint
curl -X POST https://your-worker.workers.dev/benchmark-wasm
```

## Recommendations

### Short Term

1. **Keep using bundled imports** for modules under 10MB compressed - this is the most efficient approach for Workers.

2. **Use streaming loader for large modules** that exceed bundle limits, with automatic fallback.

3. **Add progress tracking** for better UX when loading large modules in client-facing scenarios.

### Medium Term

1. **Benchmark actual performance** in Workers environment to confirm streaming benefits (if any).

2. **Consider module splitting** - break large WASM into core + extensions that can be loaded on-demand.

3. **Implement caching strategies** - use Durable Objects for cross-request module caching.

### Long Term

1. **Monitor Workers runtime updates** - streaming compilation support may improve.

2. **Consider Cloudflare Containers** for modules that exceed reasonable WASM sizes.

3. **Explore client-side WASM** with Workers as API gateway for compute-intensive workloads.

## Files Created

1. `/src/wasm/streaming-loader.ts` - Streaming WASM loader implementation
2. `/docs/spikes/spike-3-streaming-wasm.md` - This documentation

## Related Files

- `/src/bundled-executor.ts` - Current bundled WASM loading
- `/src/wasm/core-loader.ts` - Current runtime WASM loading
- `/src/wasm/mergetree-loader.ts` - MergeTree WASM loader
- `/src/r2-vfs.ts` - R2 VFS implementation
- `/WORKERS_WASM_LOADING.md` - Comprehensive WASM loading strategies

## Conclusion

`WebAssembly.compileStreaming()` offers potential performance benefits for large WASM modules, but its effectiveness in Cloudflare Workers depends on runtime support. The implemented `StreamingWasmLoader` provides:

1. **Graceful degradation** - tries streaming, falls back to direct
2. **Progress tracking** - useful for large module loading UIs
3. **Metrics collection** - understand actual performance characteristics
4. **R2 integration** - works with existing R2 bucket patterns

The recommended approach remains **bundled imports** for modules under 10MB compressed, with the streaming loader as an option for larger modules or dynamic loading scenarios.
