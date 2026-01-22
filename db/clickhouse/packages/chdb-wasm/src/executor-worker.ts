/**
 * Cloudflare Worker for the minimal SQL executor WASM module
 *
 * This worker provides a simple API to execute SQL expressions using
 * the 132KB executor.wasm module compiled from ClickHouse's expression evaluator.
 *
 * API:
 * - POST / with JSON body: {"query": "SELECT 1 + 2"}
 * - Returns: {"result": "3", "elapsed_ms": 1.5}
 */

// Import the WASM module as a static asset
import executorWasm from '../wasm/dist/executor.wasm';

/**
 * CORS headers for cross-origin requests
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// We'll inline the module factory since we can't easily import the JS glue in Workers
// Instead, we'll use WebAssembly.instantiate directly with a custom runtime

/**
 * Minimal runtime for the executor WASM module
 */
class ExecutorRuntime {
  private instance: WebAssembly.Instance | null = null;
  private memory: WebAssembly.Memory | null = null;
  private heapU8: Uint8Array | null = null;
  private heap32: Int32Array | null = null;

  async initialize(wasmModule: WebAssembly.Module): Promise<void> {
    // Create memory (initial 1 page = 64KB, max 256 pages = 16MB)
    this.memory = new WebAssembly.Memory({ initial: 256, maximum: 4096 });

    // Environment strings
    const envStrings = [
      'USER=web_user',
      'LOGNAME=web_user',
      'PATH=/',
      'PWD=/',
      'HOME=/home/web_user',
      'LANG=en_US.UTF-8',
    ];

    // Import object for the WASM module
    const imports: WebAssembly.Imports = {
      a: {
        // abort
        a: () => { throw new Error('abort'); },
        // emscripten_memcpy_js
        f: (dest: number, src: number, num: number) => {
          this.heapU8!.copyWithin(dest, src, src + num);
        },
        // emscripten_resize_heap
        e: (requestedSize: number): number => {
          try {
            const pages = Math.ceil((requestedSize - this.memory!.buffer.byteLength + 65535) / 65536);
            this.memory!.grow(pages);
            this.updateMemoryViews();
            return 1;
          } catch {
            return 0;
          }
        },
        // environ_get
        c: (environPtr: number, environBufPtr: number): number => {
          let bufOffset = 0;
          envStrings.forEach((str, i) => {
            this.heap32![environPtr / 4 + i] = environBufPtr + bufOffset;
            this.writeString(environBufPtr + bufOffset, str);
            bufOffset += str.length + 1;
          });
          return 0;
        },
        // environ_sizes_get
        d: (countPtr: number, bufSizePtr: number): number => {
          this.heap32![countPtr / 4] = envStrings.length;
          const bufSize = envStrings.reduce((acc, s) => acc + s.length + 1, 0);
          this.heap32![bufSizePtr / 4] = bufSize;
          return 0;
        },
        // strftime_l (format and tm params required by WASM interface but unused in simplified impl)
        b: (s: number, maxsize: number, _format: number, _tm: number, _loc: number): number => {
          // Simplified strftime implementation
          const date = new Date();
          const result = date.toISOString();
          this.writeString(s, result.substring(0, maxsize - 1));
          return Math.min(result.length, maxsize - 1);
        },
        // Memory
        g: this.memory,
      },
    };

    // Instantiate the module
    this.instance = await WebAssembly.instantiate(wasmModule, imports);

    // Get memory export and update views
    this.memory = this.instance.exports.g as WebAssembly.Memory;
    this.updateMemoryViews();

    // Call __wasm_call_ctors (exported as 'h')
    const ctors = this.instance.exports.h as () => void;
    if (ctors) {
      ctors();
    }
  }

  private updateMemoryViews(): void {
    this.heapU8 = new Uint8Array(this.memory!.buffer);
    this.heap32 = new Int32Array(this.memory!.buffer);
  }

  private writeString(ptr: number, str: string): void {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    this.heapU8!.set(bytes, ptr);
    this.heapU8![ptr + bytes.length] = 0; // null terminator
  }

  private readString(ptr: number): string {
    if (ptr === 0) return '';
    let end = ptr;
    while (this.heapU8![end] !== 0) end++;
    const decoder = new TextDecoder();
    return decoder.decode(this.heapU8!.subarray(ptr, end));
  }

  /**
   * Create an executor instance
   */
  createExecutor(): number {
    const fn = this.instance!.exports.i as () => number;
    return fn();
  }

  /**
   * Destroy an executor instance
   */
  destroyExecutor(executor: number): void {
    const fn = this.instance!.exports.j as (ptr: number) => void;
    fn(executor);
  }

  /**
   * Execute a query
   */
  executeQuery(executor: number, query: string, format: string = 'TabSeparated'): { success: boolean; result?: string; error?: string } {
    const malloc = this.instance!.exports.m as (size: number) => number;
    const free = this.instance!.exports.k as (ptr: number) => void;
    const execQuery = this.instance!.exports.l as (executor: number, query: number, format: number, flags: number) => number;
    const getResult = this.instance!.exports.n as (executor: number) => number;
    const getResultLen = this.instance!.exports.o as (executor: number) => number;
    const getError = this.instance!.exports.p as (executor: number) => number;

    // Allocate memory for query and format strings
    const queryBytes = new TextEncoder().encode(query);
    const formatBytes = new TextEncoder().encode(format);

    const queryPtr = malloc(queryBytes.length + 1);
    const formatPtr = malloc(formatBytes.length + 1);

    this.heapU8!.set(queryBytes, queryPtr);
    this.heapU8![queryPtr + queryBytes.length] = 0;
    this.heapU8!.set(formatBytes, formatPtr);
    this.heapU8![formatPtr + formatBytes.length] = 0;

    try {
      // Execute the query
      const success = execQuery(executor, queryPtr, formatPtr, 0);

      if (success === 0) {
        // Query succeeded
        const resultPtr = getResult(executor);
        const resultLen = getResultLen(executor);

        if (resultPtr && resultLen > 0) {
          const decoder = new TextDecoder();
          const result = decoder.decode(this.heapU8!.subarray(resultPtr, resultPtr + resultLen));
          return { success: true, result: result.trim() };
        }
        return { success: true, result: '' };
      } else {
        // Query failed
        const errorPtr = getError(executor);
        const error = errorPtr ? this.readString(errorPtr) : 'Unknown error';
        return { success: false, error };
      }
    } finally {
      free(queryPtr);
      free(formatPtr);
    }
  }

  /**
   * Get executor version
   */
  getVersion(): string {
    const versionFn = this.instance!.exports.r as () => number;
    const ptr = versionFn();
    return this.readString(ptr);
  }

  /**
   * Run self-test
   */
  runTest(): number {
    const testFn = this.instance!.exports.q as () => number;
    return testFn();
  }
}

// Global executor instance (lazy initialized)
let runtime: ExecutorRuntime | null = null;
let executorHandle: number | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the executor runtime
 */
async function initializeRuntime(): Promise<void> {
  if (runtime) return;

  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    runtime = new ExecutorRuntime();
    // executorWasm is already a WebAssembly.Module in Workers
    await runtime.initialize(executorWasm as unknown as WebAssembly.Module);
    executorHandle = runtime.createExecutor();
  })();

  await initPromise;
}

/**
 * Execute a SQL query
 */
async function executeQuery(query: string): Promise<{ result: string; elapsed_ms: number }> {
  await initializeRuntime();

  const start = performance.now();
  const response = runtime!.executeQuery(executorHandle!, query);
  const elapsed = performance.now() - start;

  if (!response.success) {
    throw new Error(response.error || 'Query execution failed');
  }

  return {
    result: response.result || '',
    elapsed_ms: Math.round(elapsed * 100) / 100,
  };
}

/**
 * Main request handler
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // Health check endpoint
    if (url.pathname === '/ping' || url.pathname === '/health') {
      return new Response('OK', {
        status: 200,
        headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS },
      });
    }

    // Version endpoint
    if (url.pathname === '/version') {
      try {
        await initializeRuntime();
        const version = runtime!.getVersion();
        return new Response(JSON.stringify({ version }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
    }

    // Test endpoint
    if (url.pathname === '/test') {
      try {
        await initializeRuntime();
        const result = runtime!.runTest();
        return new Response(JSON.stringify({ test_result: result }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
    }

    // Query endpoint (POST / or GET /?query=...)
    if (url.pathname === '/' || url.pathname === '/query') {
      let query: string | null = null;

      // GET with query parameter
      if (request.method === 'GET') {
        query = url.searchParams.get('query');
      }
      // POST with JSON body
      else if (request.method === 'POST') {
        try {
          const contentType = request.headers.get('content-type') || '';

          if (contentType.includes('application/json')) {
            const body = await request.json() as { query?: string };
            query = body.query || null;
          } else {
            // Plain text body
            query = await request.text();
          }
        } catch {
          return new Response(JSON.stringify({ error: 'Invalid request body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          });
        }
      } else {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }

      if (!query) {
        return new Response(JSON.stringify({
          error: 'Missing query parameter',
          usage: 'POST / with JSON body {"query": "SELECT 1 + 2"} or GET /?query=SELECT%201%2B2'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }

      try {
        const { result, elapsed_ms } = await executeQuery(query);
        return new Response(JSON.stringify({ result, elapsed_ms }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ error: message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
    }

    // 404 for unknown paths
    return new Response(JSON.stringify({
      error: 'Not found',
      endpoints: {
        'POST /': 'Execute SQL query (JSON body: {"query": "..."})',
        'GET /?query=...': 'Execute SQL query (URL parameter)',
        'GET /ping': 'Health check',
        'GET /version': 'Get executor version',
        'GET /test': 'Run self-test',
      }
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  },
};
