# Loading Large WASM Modules in Cloudflare Workers

This document provides a comprehensive analysis of strategies for deploying WASM modules (5-15MB) to Cloudflare Workers, given the platform's size limits and constraints.

## Table of Contents

1. [Size Limits and Constraints](#size-limits-and-constraints)
2. [Loading Strategies](#loading-strategies)
3. [Recommended Approach](#recommended-approach)
4. [Code Examples](#code-examples)
5. [Performance Considerations](#performance-considerations)
6. [Alternative Architectures](#alternative-architectures)
7. [References](#references)

---

## Size Limits and Constraints

### Bundle Size Limits

| Plan | Compressed Size | Uncompressed Size |
|------|-----------------|-------------------|
| **Free** | 3 MB | 64 MB |
| **Paid** ($5/month) | 10 MB | 64 MB |

**Key insight**: A 5-10MB uncompressed WASM typically compresses to 2-4MB with gzip, making it potentially deployable on the paid plan if under 10MB compressed.

### Memory Limits

- **128 MB per isolate** - This includes both JavaScript heap and WebAssembly memory allocations
- Memory is shared between JS and WASM, so large WASM modules reduce available JS heap

### Startup Time Limits

- **1 second maximum** for parsing and executing global scope
- Larger WASM modules directly impact startup time because there is more code to parse and compile
- V8 compiles WASM to native code before execution begins (this is the slow part)

### CPU Time Limits

| Plan | HTTP Requests | Cron Triggers |
|------|---------------|---------------|
| **Free** | 10 ms | 10 ms |
| **Paid** | 5 minutes (300,000 ms) | 15 minutes |

### WASM-Specific Constraints

1. **No `WebAssembly.instantiateStreaming()`** - Workers does not support streaming compilation
2. **No threading** - Web Workers API not available; single-threaded execution only
3. **No synchronous XHR** - Affects some WASM libraries (like DuckDB's filesystem)
4. **Pre-compiled modules only** - When you import `.wasm`, you get a `WebAssembly.Module` not raw bytes

---

## Loading Strategies

### Strategy 1: Direct Bundle (Recommended for < 10MB gzipped)

**How it works**: Bundle the WASM directly with your Worker using Wrangler's native WASM support.

**Pros**:
- Simplest approach
- No runtime fetching overhead
- WASM is pre-compiled before cold start

**Cons**:
- Limited to 10MB compressed (paid plan)
- Slower cold starts for larger modules

**When to use**: Your gzipped WASM is under 10MB

```toml
# wrangler.toml
name = "my-wasm-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# WASM files are automatically bundled
```

### Strategy 2: External Modules with Lazy Loading

**How it works**: Use Wrangler's `find_additional_modules` to upload WASM as separate modules that can be dynamically imported.

**Pros**:
- Preserves lazy loading boundaries
- Faster initial startup for requests that don't need WASM
- Still part of the deployment bundle

**Cons**:
- Still counts toward bundle size limit
- First use incurs compilation cost

```toml
# wrangler.toml
name = "my-wasm-worker"
main = "src/index.ts"
base_dir = "src"
find_additional_modules = true

[[rules]]
type = "CompiledWasm"
globs = ["**/*.wasm"]
fallthrough = false
```

### Strategy 3: R2 Storage + Runtime Fetch

**How it works**: Store WASM in R2, fetch and compile at runtime.

**Pros**:
- No bundle size limits
- Can store any size WASM
- Pay only for storage and requests

**Cons**:
- Runtime fetch latency on cold start
- Must compile WASM in request handler (async I/O restrictions in global scope)
- No pre-compilation benefits
- R2 fetch adds ~50-200ms latency

**Limitations**:
- Cannot use `WebAssembly.compileStreaming()` - must buffer entire response first
- 128MB memory limit still applies
- Compilation time for large WASM can be significant

### Strategy 4: Workers KV for WASM Storage

**How it works**: Store WASM binary in KV, fetch at runtime.

**Pros**:
- Global edge caching (faster than R2 for hot reads)
- Simple key-value API

**Cons**:
- 25 MB value size limit
- Eventually consistent (not ideal for versioned deployments)
- Same runtime compilation overhead as R2
- More expensive than R2 for large files

### Strategy 5: Static Assets

**How it works**: Serve WASM as a static asset, fetch from Worker.

**Pros**:
- Automatic CDN caching
- Separate from bundle size
- Can use `env.ASSETS.fetch()` to retrieve

**Cons**:
- Still need to compile at runtime
- Adds fetch overhead
- Less control over caching headers

### Strategy 6: Durable Objects for Caching

**How it works**: Cache compiled WASM module references in Durable Object memory.

**Pros**:
- In-memory caching (several MB) persists between requests
- SQLite storage for larger data
- Can pre-warm instances

**Cons**:
- Compiled `WebAssembly.Module` cannot be serialized/stored
- Only helps with in-memory caching within a single DO instance
- Adds complexity and cost

### Strategy 7: Cloudflare Containers (New in 2025)

**How it works**: Run WASM inside a Docker container instead of a Worker isolate.

**Pros**:
- No bundle size limits
- Up to 4GB RAM (with larger sizes planned)
- Full filesystem access
- Can run any language/runtime

**Cons**:
- 2-3 second cold start (vs ~50ms for Workers)
- Higher cost ($0.000004/ms CPU + memory)
- More operational complexity

---

## Recommended Approach

For a 5-10MB WASM module (chdb-wasm), the recommended strategy depends on compressed size:

### If Gzipped Size < 10MB: Direct Bundle

```bash
# Check compressed size
wrangler deploy --outdir bundled/ --dry-run
# Look for gzip size in output
```

This is the optimal path because:
1. WASM is pre-compiled before your code runs
2. No runtime fetch latency
3. Simpler deployment and versioning

### If Gzipped Size > 10MB: Hybrid Approach

Use a combination of:
1. **Small bootstrap Worker** (under size limit)
2. **R2 or Static Assets** for WASM storage
3. **Durable Objects** for in-memory caching

---

## Code Examples

### Example 1: Direct Bundle (Simple)

```typescript
// src/index.ts
import wasmModule from "./chdb.wasm";

// Instantiate in global scope (runs once at cold start)
const instance = await WebAssembly.instantiate(wasmModule, {
  env: {
    // Import functions if needed
  }
});

export default {
  async fetch(request: Request): Promise<Response> {
    // Use the pre-instantiated module
    const result = instance.exports.query("SELECT 1");
    return new Response(JSON.stringify(result));
  }
};
```

### Example 2: R2 Runtime Loading

```typescript
// src/index.ts
interface Env {
  WASM_BUCKET: R2Bucket;
}

let wasmInstance: WebAssembly.Instance | null = null;

async function getWasmInstance(env: Env): Promise<WebAssembly.Instance> {
  if (wasmInstance) {
    return wasmInstance;
  }

  // Fetch from R2
  const wasmObject = await env.WASM_BUCKET.get("chdb.wasm");
  if (!wasmObject) {
    throw new Error("WASM module not found in R2");
  }

  // Get as ArrayBuffer and compile
  const wasmBuffer = await wasmObject.arrayBuffer();
  const wasmModule = await WebAssembly.compile(wasmBuffer);
  wasmInstance = await WebAssembly.instantiate(wasmModule, {
    env: {}
  });

  return wasmInstance;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const instance = await getWasmInstance(env);
      const result = instance.exports.query("SELECT 1");
      return new Response(JSON.stringify(result));
    } catch (error) {
      return new Response(`Error: ${error}`, { status: 500 });
    }
  }
};
```

```toml
# wrangler.toml
name = "chdb-wasm-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[r2_buckets]]
binding = "WASM_BUCKET"
bucket_name = "wasm-modules"
```

### Example 3: Static Assets Loading

```typescript
// src/index.ts
interface Env {
  ASSETS: Fetcher;
}

let wasmInstance: WebAssembly.Instance | null = null;

async function getWasmInstance(env: Env): Promise<WebAssembly.Instance> {
  if (wasmInstance) {
    return wasmInstance;
  }

  // Fetch from static assets
  const wasmResponse = await env.ASSETS.fetch(
    new Request("https://dummy/chdb.wasm")
  );

  const wasmBuffer = await wasmResponse.arrayBuffer();
  const wasmModule = await WebAssembly.compile(wasmBuffer);
  wasmInstance = await WebAssembly.instantiate(wasmModule, {
    env: {}
  });

  return wasmInstance;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const instance = await getWasmInstance(env);
    // Use instance...
    return new Response("OK");
  }
};
```

```toml
# wrangler.toml
name = "chdb-wasm-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[assets]
directory = "./public"
binding = "ASSETS"
```

### Example 4: Durable Object with WASM Caching

```typescript
// src/index.ts
import wasmModule from "./chdb.wasm";

export class ChdbExecutor implements DurableObject {
  private instance: WebAssembly.Instance | null = null;

  constructor(private state: DurableObjectState, private env: Env) {}

  private async getInstance(): Promise<WebAssembly.Instance> {
    if (!this.instance) {
      this.instance = await WebAssembly.instantiate(wasmModule, {
        env: {}
      });
    }
    return this.instance;
  }

  async fetch(request: Request): Promise<Response> {
    const instance = await this.getInstance();
    // Instance stays in memory between requests to same DO
    const result = instance.exports.query("SELECT 1");
    return new Response(JSON.stringify(result));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.CHDB_EXECUTOR.idFromName("default");
    const stub = env.CHDB_EXECUTOR.get(id);
    return stub.fetch(request);
  }
};
```

### Example 5: Lazy Loading with Dynamic Import

```typescript
// src/index.ts
let wasmInstance: WebAssembly.Instance | null = null;

async function getWasmInstance(): Promise<WebAssembly.Instance> {
  if (wasmInstance) {
    return wasmInstance;
  }

  // Dynamic import - only loaded when needed
  const wasmModule = await import("./chdb.wasm");
  wasmInstance = await WebAssembly.instantiate(wasmModule.default, {
    env: {}
  });

  return wasmInstance;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Only load WASM for /query routes
    if (url.pathname.startsWith("/query")) {
      const instance = await getWasmInstance();
      const result = instance.exports.query("SELECT 1");
      return new Response(JSON.stringify(result));
    }

    // Other routes don't incur WASM loading cost
    return new Response("Hello!");
  }
};
```

---

## Performance Considerations

### Cold Start Times

| Approach | Cold Start | Notes |
|----------|------------|-------|
| Direct Bundle (1MB) | ~50ms | Pre-compiled |
| Direct Bundle (5MB) | ~200-400ms | Larger compile time |
| Direct Bundle (10MB) | ~400-800ms | Near startup limit |
| R2 Fetch + Compile | ~500-1500ms | Network + compile |
| Containers | ~2000-3000ms | Full container startup |

### Optimization Tips

1. **Use `wasm-opt`** to reduce WASM binary size:
   ```bash
   wasm-opt -Oz input.wasm -o output.wasm
   ```

2. **Strip debug info**:
   ```bash
   wasm-strip input.wasm
   ```

3. **Use TinyGo instead of Go** for much smaller binaries

4. **Consider Rust with `#![no_std]`** to avoid bundling the standard library

5. **Feature-gate your WASM** - remove unused functionality at compile time

### Memory Management

```typescript
// Track WASM memory usage
function getWasmMemoryUsage(instance: WebAssembly.Instance): number {
  const memory = instance.exports.memory as WebAssembly.Memory;
  return memory.buffer.byteLength;
}

// Log before hitting 128MB limit
const usage = getWasmMemoryUsage(instance);
if (usage > 100 * 1024 * 1024) {
  console.warn(`WASM memory at ${usage / 1024 / 1024}MB - approaching limit`);
}
```

---

## Alternative Architectures

### Client-Side WASM + Workers for Data

For use cases like DuckDB or chdb, consider:

1. **Worker serves as API gateway** - handles auth, routing, caching
2. **WASM runs in browser** - no size limits, user's CPU/memory
3. **R2 stores data files** - Parquet, etc.

```typescript
// Worker provides data access, client runs WASM
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Serve WASM to client
    if (url.pathname === "/chdb.wasm") {
      return env.ASSETS.fetch(request);
    }

    // Proxy data from R2
    if (url.pathname.startsWith("/data/")) {
      const key = url.pathname.slice(6);
      const object = await env.DATA_BUCKET.get(key);
      return new Response(object?.body);
    }

    return new Response("Not found", { status: 404 });
  }
};
```

### Cloudflare Containers (2025+)

For truly large WASM or complex runtimes:

```toml
# wrangler.toml
name = "chdb-container"
main = "src/index.ts"

[[containers]]
class_name = "ChdbContainer"
image = "./Dockerfile"
max_instances = 10
```

```dockerfile
# Dockerfile
FROM debian:bookworm-slim
COPY chdb.wasm /app/
COPY server /app/
EXPOSE 8080
CMD ["/app/server"]
```

---

## References

### Cloudflare Documentation
- [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [WebAssembly in Workers](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)
- [Wrangler Bundling](https://developers.cloudflare.com/workers/wrangler/bundling/)
- [Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Containers](https://developers.cloudflare.com/containers/)

### Community Examples
- [DuckDB WASM + Cloudflare Discussion](https://github.com/duckdb/duckdb-wasm/discussions/430)
- [SQLite WASM for Workers](https://github.com/adrianlyjak/cloudflare-worker-sqlite-wasm)
- [wasm-vips on Workers](https://github.com/kleisauke/wasm-vips/issues/2)

### Blog Posts
- [WebAssembly on Cloudflare Workers](https://blog.cloudflare.com/webassembly-on-cloudflare-workers/)
- [Zero-latency SQLite in Durable Objects](https://blog.cloudflare.com/sqlite-in-durable-objects/)
- [Cloudflare Containers Coming 2025](https://blog.cloudflare.com/cloudflare-containers-coming-2025/)

---

## Summary

| WASM Size (gzipped) | Recommended Strategy |
|---------------------|---------------------|
| < 3 MB | Direct bundle (free plan) |
| 3-10 MB | Direct bundle (paid plan) |
| 10-25 MB | R2/KV + runtime loading |
| > 25 MB | Containers or client-side |

For chdb-wasm specifically:
1. First, measure actual gzipped size after optimization
2. If under 10MB gzipped, use direct bundling on paid plan
3. If over 10MB, consider R2 loading or Cloudflare Containers
4. For best user experience, consider client-side WASM with Worker as API gateway
