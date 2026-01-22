/**
 * Streaming WASM Loader for R2 Storage
 *
 * This module provides optimized WASM loading from Cloudflare R2 storage
 * using WebAssembly.compileStreaming() where supported.
 *
 * ## Background
 *
 * WebAssembly.compileStreaming() allows compilation to begin while the
 * response is still being downloaded, offering potential performance benefits
 * for large WASM modules.
 *
 * ## Cloudflare Workers Limitations
 *
 * As of 2025, Cloudflare Workers has specific constraints:
 * - Workers do NOT support WebAssembly.instantiateStreaming() in the traditional sense
 * - WASM modules imported via ES imports are pre-compiled by Wrangler
 * - R2.get() returns an R2Object, not a standard Response
 *
 * ## Implementation Strategy
 *
 * This loader implements multiple strategies:
 * 1. **R2 Direct Loading**: Fetch from R2 and compile (standard approach)
 * 2. **Response Wrapping**: Wrap R2 body as Response for streaming compilation
 * 3. **Static Assets**: Use ASSETS binding for pre-deployed WASM
 * 4. **Chunked Loading**: Load WASM in parts for progress tracking
 *
 * @module wasm/streaming-loader
 */

// Type augmentation for WebAssembly APIs that may not be in default types
// These are standard Web APIs available in browsers and most runtimes
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace WebAssembly {
    function compile(bytes: BufferSource): Promise<Module>;
    function compileStreaming(source: Response | Promise<Response>): Promise<Module>;
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * R2Object interface (subset of Cloudflare R2Object)
 */
interface R2Object {
  readonly key: string;
  readonly size: number;
  readonly etag?: string;
  readonly httpEtag?: string;
  readonly uploaded?: Date;
  readonly body?: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
}

/**
 * R2Bucket interface (subset of Cloudflare R2Bucket)
 */
interface R2Bucket {
  get(key: string, options?: { range?: { offset?: number; length?: number } }): Promise<R2Object | null>;
  head(key: string): Promise<{ size: number; etag?: string } | null>;
}

/**
 * Fetcher interface for Static Assets
 */
interface Fetcher {
  fetch(input: Request | string): Promise<Response>;
}

/**
 * Environment bindings for WASM loading
 */
export interface WasmLoaderEnv {
  /** R2 bucket for WASM storage */
  WASM_BUCKET?: R2Bucket;
  /** Static assets binding */
  ASSETS?: Fetcher;
}

/**
 * Options for loading WASM modules
 */
export interface WasmLoadOptions {
  /** Key/path in R2 bucket or assets */
  key: string;
  /** Use streaming compilation if available */
  useStreaming?: boolean;
  /** Progress callback for chunked loading */
  onProgress?: (loaded: number, total: number) => void;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Result of WASM loading with metrics
 */
export interface WasmLoadResult {
  /** Compiled WebAssembly module */
  module: WebAssembly.Module;
  /** Total bytes loaded */
  bytesLoaded: number;
  /** Time to fetch (ms) */
  fetchTimeMs: number;
  /** Time to compile (ms) */
  compileTimeMs: number;
  /** Total load time (ms) */
  totalTimeMs: number;
  /** Loading strategy used */
  strategy: 'r2-direct' | 'r2-streaming' | 'assets' | 'bundled';
}

// ============================================================================
// Streaming WASM Loader
// ============================================================================

/**
 * StreamingWasmLoader provides optimized WASM loading from R2 or Static Assets
 *
 * @example
 * ```typescript
 * const loader = new StreamingWasmLoader(env);
 *
 * // Load from R2
 * const result = await loader.loadFromR2({
 *   key: 'wasm/executor.wasm',
 *   useStreaming: true,
 *   onProgress: (loaded, total) => console.log(`${loaded}/${total} bytes`)
 * });
 *
 * // Use the compiled module
 * const instance = await WebAssembly.instantiate(result.module, imports);
 * ```
 */
export class StreamingWasmLoader {
  private env: WasmLoaderEnv;
  private moduleCache = new Map<string, WebAssembly.Module>();

  constructor(env: WasmLoaderEnv) {
    this.env = env;
  }

  /**
   * Load WASM module from R2 bucket
   *
   * Attempts streaming compilation if supported, falls back to
   * standard ArrayBuffer compilation otherwise.
   */
  async loadFromR2(options: WasmLoadOptions): Promise<WasmLoadResult> {
    const { key, useStreaming = true, onProgress, timeout = 30000 } = options;
    const startTime = performance.now();

    if (!this.env.WASM_BUCKET) {
      throw new Error('R2 bucket not configured (WASM_BUCKET binding missing)');
    }

    // Check cache first
    const cached = this.moduleCache.get(key);
    if (cached) {
      return {
        module: cached,
        bytesLoaded: 0,
        fetchTimeMs: 0,
        compileTimeMs: 0,
        totalTimeMs: performance.now() - startTime,
        strategy: 'r2-direct',
      };
    }

    // Get file metadata for size
    const head = await this.env.WASM_BUCKET.head(key);
    if (!head) {
      throw new Error(`WASM file not found in R2: ${key}`);
    }
    const totalSize = head.size;

    // Try streaming approach
    if (useStreaming) {
      try {
        const result = await this.loadWithStreaming(key, totalSize, onProgress, timeout);
        this.moduleCache.set(key, result.module);
        return result;
      } catch (streamingError) {
        // Streaming not supported or failed, fall back to direct loading
        console.warn(
          '[StreamingWasmLoader] Streaming compilation not available:',
          streamingError
        );
      }
    }

    // Fall back to direct ArrayBuffer loading
    const result = await this.loadDirect(key, totalSize, onProgress, timeout);
    this.moduleCache.set(key, result.module);
    return result;
  }

  /**
   * Load WASM module from static assets
   */
  async loadFromAssets(options: WasmLoadOptions): Promise<WasmLoadResult> {
    const { key, useStreaming = true, onProgress, timeout = 30000 } = options;
    const startTime = performance.now();

    if (!this.env.ASSETS) {
      throw new Error('Assets binding not configured (ASSETS binding missing)');
    }

    // Check cache first
    const cached = this.moduleCache.get(`assets:${key}`);
    if (cached) {
      return {
        module: cached,
        bytesLoaded: 0,
        fetchTimeMs: 0,
        compileTimeMs: 0,
        totalTimeMs: performance.now() - startTime,
        strategy: 'assets',
      };
    }

    const fetchStart = performance.now();

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // Fetch from static assets
      const response = await this.env.ASSETS.fetch(
        new Request(`https://placeholder${key.startsWith('/') ? key : '/' + key}`, {
          signal: controller.signal,
        })
      );

      if (!response.ok) {
        throw new Error(`Failed to load WASM from assets: ${response.status} ${response.statusText}`);
      }

      const fetchTime = performance.now() - fetchStart;

      // Try streaming compilation
      if (useStreaming && response.body) {
        try {
          const compileStart = performance.now();
          const module = await WebAssembly.compileStreaming(response);
          const compileTime = performance.now() - compileStart;

          const result: WasmLoadResult = {
            module,
            bytesLoaded: parseInt(response.headers.get('content-length') || '0', 10),
            fetchTimeMs: fetchTime,
            compileTimeMs: compileTime,
            totalTimeMs: performance.now() - startTime,
            strategy: 'assets',
          };

          this.moduleCache.set(`assets:${key}`, module);
          return result;
        } catch {
          // Streaming failed, fall back to ArrayBuffer
        }
      }

      // Fall back to ArrayBuffer compilation
      const compileStart = performance.now();
      const buffer = await response.arrayBuffer();
      const bytesLoaded = buffer.byteLength;

      if (onProgress) {
        onProgress(bytesLoaded, bytesLoaded);
      }

      const module = await WebAssembly.compile(buffer);
      const compileTime = performance.now() - compileStart;

      const result: WasmLoadResult = {
        module,
        bytesLoaded,
        fetchTimeMs: fetchTime,
        compileTimeMs: compileTime,
        totalTimeMs: performance.now() - startTime,
        strategy: 'assets',
      };

      this.moduleCache.set(`assets:${key}`, module);
      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Attempt streaming compilation from R2
   *
   * This creates a Response wrapper around the R2 body stream and
   * attempts WebAssembly.compileStreaming(). This may not be supported
   * in all Workers environments.
   */
  private async loadWithStreaming(
    key: string,
    totalSize: number,
    onProgress?: (loaded: number, total: number) => void,
    timeout = 30000
  ): Promise<WasmLoadResult> {
    const startTime = performance.now();
    const fetchStart = performance.now();

    // Get the R2 object with body stream
    const r2Object = await this.env.WASM_BUCKET!.get(key);
    if (!r2Object || !r2Object.body) {
      throw new Error(`WASM file not found or has no body: ${key}`);
    }

    const fetchTime = performance.now() - fetchStart;

    // Wrap R2 body in a Response object for compileStreaming
    // Note: This requires proper Content-Type header for compileStreaming
    const response = new Response(r2Object.body, {
      headers: {
        'Content-Type': 'application/wasm',
        'Content-Length': totalSize.toString(),
      },
    });

    // Track progress using a TransformStream if callback provided
    let bytesLoaded = 0;
    if (onProgress) {
      const progressStream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytesLoaded += chunk.byteLength;
          onProgress(bytesLoaded, totalSize);
          controller.enqueue(chunk);
        },
      });

      const trackedBody = r2Object.body.pipeThrough(progressStream);
      const trackedResponse = new Response(trackedBody, {
        headers: {
          'Content-Type': 'application/wasm',
          'Content-Length': totalSize.toString(),
        },
      });

      const compileStart = performance.now();
      const module = await Promise.race([
        WebAssembly.compileStreaming(trackedResponse),
        this.timeoutPromise<WebAssembly.Module>(timeout, 'Streaming compilation timeout'),
      ]);
      const compileTime = performance.now() - compileStart;

      return {
        module,
        bytesLoaded,
        fetchTimeMs: fetchTime,
        compileTimeMs: compileTime,
        totalTimeMs: performance.now() - startTime,
        strategy: 'r2-streaming',
      };
    }

    // No progress tracking - direct streaming compile
    const compileStart = performance.now();
    const module = await Promise.race([
      WebAssembly.compileStreaming(response),
      this.timeoutPromise<WebAssembly.Module>(timeout, 'Streaming compilation timeout'),
    ]);
    const compileTime = performance.now() - compileStart;

    return {
      module,
      bytesLoaded: totalSize,
      fetchTimeMs: fetchTime,
      compileTimeMs: compileTime,
      totalTimeMs: performance.now() - startTime,
      strategy: 'r2-streaming',
    };
  }

  /**
   * Direct ArrayBuffer loading (fallback when streaming not available)
   */
  private async loadDirect(
    key: string,
    totalSize: number,
    onProgress?: (loaded: number, total: number) => void,
    timeout = 30000
  ): Promise<WasmLoadResult> {
    const startTime = performance.now();
    const fetchStart = performance.now();

    const r2Object = await this.env.WASM_BUCKET!.get(key);
    if (!r2Object) {
      throw new Error(`WASM file not found: ${key}`);
    }

    // For direct loading, we can optionally do chunked reading for progress
    let buffer: ArrayBuffer;
    if (onProgress && r2Object.body) {
      buffer = await this.readWithProgress(r2Object.body, totalSize, onProgress);
    } else {
      buffer = await Promise.race([
        r2Object.arrayBuffer(),
        this.timeoutPromise<ArrayBuffer>(timeout, 'R2 fetch timeout'),
      ]);
    }

    const fetchTime = performance.now() - fetchStart;
    const bytesLoaded = buffer.byteLength;

    if (onProgress) {
      onProgress(bytesLoaded, totalSize);
    }

    // Compile the WASM
    const compileStart = performance.now();
    const module = await WebAssembly.compile(buffer);
    const compileTime = performance.now() - compileStart;

    return {
      module,
      bytesLoaded,
      fetchTimeMs: fetchTime,
      compileTimeMs: compileTime,
      totalTimeMs: performance.now() - startTime,
      strategy: 'r2-direct',
    };
  }

  /**
   * Read stream with progress tracking
   */
  private async readWithProgress(
    stream: ReadableStream<Uint8Array>,
    totalSize: number,
    onProgress: (loaded: number, total: number) => void
  ): Promise<ArrayBuffer> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        loaded += value.byteLength;
        onProgress(loaded, totalSize);
      }
    } finally {
      reader.releaseLock();
    }

    // Concatenate chunks
    const result = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return result.buffer;
  }

  /**
   * Create a timeout promise
   */
  private timeoutPromise<T>(ms: number, message: string): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  /**
   * Clear the module cache
   */
  clearCache(): void {
    this.moduleCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { entries: number; keys: string[] } {
    return {
      entries: this.moduleCache.size,
      keys: Array.from(this.moduleCache.keys()),
    };
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Load WASM from R2 with streaming compilation
 *
 * @example
 * ```typescript
 * const module = await loadWasmFromR2(env, 'wasm/executor.wasm');
 * const instance = await WebAssembly.instantiate(module, imports);
 * ```
 */
export async function loadWasmFromR2(
  env: WasmLoaderEnv,
  key: string,
  options?: Partial<WasmLoadOptions>
): Promise<WasmLoadResult> {
  const loader = new StreamingWasmLoader(env);
  return loader.loadFromR2({ key, ...options });
}

/**
 * Load WASM from Static Assets with streaming compilation
 *
 * @example
 * ```typescript
 * const module = await loadWasmFromAssets(env, '/wasm/executor.wasm');
 * const instance = await WebAssembly.instantiate(module, imports);
 * ```
 */
export async function loadWasmFromAssets(
  env: WasmLoaderEnv,
  key: string,
  options?: Partial<WasmLoadOptions>
): Promise<WasmLoadResult> {
  const loader = new StreamingWasmLoader(env);
  return loader.loadFromAssets({ key, ...options });
}

/**
 * Check if WebAssembly.compileStreaming is available
 *
 * Note: Even if available, it may not work with all Response types
 * in Cloudflare Workers (e.g., R2 wrapped responses).
 */
export function isStreamingCompilationAvailable(): boolean {
  return typeof WebAssembly.compileStreaming === 'function';
}

/**
 * Benchmark WASM loading performance
 *
 * @example
 * ```typescript
 * const benchmark = await benchmarkWasmLoading(env, 'wasm/executor.wasm', 5);
 * console.log(`Average load time: ${benchmark.averageTotalMs}ms`);
 * ```
 */
export async function benchmarkWasmLoading(
  env: WasmLoaderEnv,
  key: string,
  iterations = 3
): Promise<{
  iterations: number;
  results: WasmLoadResult[];
  averageFetchMs: number;
  averageCompileMs: number;
  averageTotalMs: number;
  minTotalMs: number;
  maxTotalMs: number;
}> {
  const loader = new StreamingWasmLoader(env);
  const results: WasmLoadResult[] = [];

  for (let i = 0; i < iterations; i++) {
    // Clear cache to get fresh loads
    loader.clearCache();
    const result = await loader.loadFromR2({ key });
    results.push(result);
  }

  const fetchTimes = results.map((r) => r.fetchTimeMs);
  const compileTimes = results.map((r) => r.compileTimeMs);
  const totalTimes = results.map((r) => r.totalTimeMs);

  return {
    iterations,
    results,
    averageFetchMs: fetchTimes.reduce((a, b) => a + b, 0) / iterations,
    averageCompileMs: compileTimes.reduce((a, b) => a + b, 0) / iterations,
    averageTotalMs: totalTimes.reduce((a, b) => a + b, 0) / iterations,
    minTotalMs: Math.min(...totalTimes),
    maxTotalMs: Math.max(...totalTimes),
  };
}
