/**
 * chDB WASM Backend for Cloudflare Workers
 *
 * This module provides a backend for executing ClickHouse SQL queries
 * using the chDB WASM binary loaded from R2 storage.
 *
 * Key considerations:
 * - Cloudflare Workers have 128MB memory limit
 * - WASM must be loaded from R2 since it's too large for bundling
 * - Single-threaded execution model
 * - Results are returned in ClickHouse JSON format
 *
 * ## WASM Loading Strategy
 *
 * This module uses StreamingWasmLoader for optimized WASM loading from R2:
 * - Streaming compilation when available (WebAssembly.compileStreaming)
 * - Fallback to standard ArrayBuffer compilation
 * - Module caching to avoid redundant loads
 * - Progress tracking and timeout support
 */

import type { SqlExecutor, R2Bucket } from './http-query-handler';
import type { RowData, ParsedValue } from './types';
import { StreamingWasmLoader, type WasmLoaderEnv, type WasmLoadResult } from './wasm/streaming-loader';
import { createLogger } from './utils/logger';

// Create logger for the chdb backend module
const log = createLogger('chdb-backend');

/**
 * Environment interface for the chdb backend
 */
export interface ChdbBackendEnv {
  WASM_BUCKET: R2Bucket;
}

// Global streaming loader instance (reused for caching benefits)
let streamingLoader: StreamingWasmLoader | null = null;

/**
 * Default WASM key in R2 bucket
 */
const DEFAULT_WASM_KEY = 'clickhouse.wasm';

/**
 * Result structure from chdb query execution
 */
export interface ChdbQueryResult {
  meta: Array<{ name: string; type: string }>;
  data: RowData[];
  rows: number;
  statistics?: {
    elapsed: number;
    rows_read: number;
    bytes_read: number;
  };
}

/**
 * WebAssembly imports required by the chdb module
 * These provide runtime support for the Emscripten-compiled WASM
 */
interface WasmImports {
  env: {
    memory: WebAssembly.Memory;
    // Memory allocation
    emscripten_notify_memory_growth: (index: number) => void;
    // Process/threading stubs (not supported in Workers)
    abort: () => never;
    _abort_js: () => never;
    _emscripten_get_now: () => number;
    _emscripten_memcpy_js: (dest: number, src: number, len: number) => void;
    // Filesystem stubs (in-memory only)
    fd_write: (fd: number, iovs: number, iovsLen: number, nwritten: number) => number;
    fd_read: (fd: number, iovs: number, iovsLen: number, nread: number) => number;
    fd_close: (fd: number) => number;
    fd_seek: (fd: number, offsetLow: number, offsetHigh: number, whence: number, newOffset: number) => number;
    // Environment
    environ_get: (environ: number, environBuf: number) => number;
    environ_sizes_get: (penviron_count: number, penviron_buf_size: number) => number;
    // Clock (required for timing)
    clock_time_get: (clockId: number, precision: bigint, time: number) => number;
    // Exit
    proc_exit: (code: number) => never;
    // Random (for query IDs, etc.)
    random_get: (buf: number, bufLen: number) => number;
  };
  wasi_snapshot_preview1: {
    fd_write: (fd: number, iovs: number, iovsLen: number, nwritten: number) => number;
    fd_read: (fd: number, iovs: number, iovsLen: number, nread: number) => number;
    fd_close: (fd: number) => number;
    fd_seek: (fd: number, offsetLow: number, offsetHigh: number, whence: number, newOffset: number) => number;
    fd_fdstat_get: (fd: number, stat: number) => number;
    fd_prestat_get: (fd: number, prestat: number) => number;
    fd_prestat_dir_name: (fd: number, path: number, pathLen: number) => number;
    environ_get: (environ: number, environBuf: number) => number;
    environ_sizes_get: (penvironCount: number, penvironBufSize: number) => number;
    clock_time_get: (clockId: number, precision: bigint, time: number) => number;
    proc_exit: (code: number) => never;
    random_get: (buf: number, bufLen: number) => number;
    path_open: (fd: number, dirflags: number, path: number, pathLen: number, oflags: number, fsRightsBase: bigint, fsRightsInheriting: bigint, fdflags: number, openedFd: number) => number;
    path_filestat_get: (fd: number, flags: number, path: number, pathLen: number, filestat: number) => number;
    args_get: (argv: number, argvBuf: number) => number;
    args_sizes_get: (pargc: number, pargvBufSize: number) => number;
  };
}

/**
 * WebAssembly exports from the chdb module
 */
interface WasmExports {
  // Memory
  memory: WebAssembly.Memory;

  // Memory allocation (may use different naming conventions)
  malloc?: (size: number) => number;
  free?: (ptr: number) => void;
  _malloc?: (size: number) => number;
  _free?: (ptr: number) => void;

  // chdb API functions (with and without underscore prefix)
  chdb_connect?: (argc: number, argv: number) => number;
  _chdb_connect?: (argc: number, argv: number) => number;
  chdb_query?: (conn: number, query: number, format: number) => number;
  _chdb_query?: (conn: number, query: number, format: number) => number;
  chdb_query_cmdline?: (argc: number, argv: number) => number;
  _chdb_query_cmdline?: (argc: number, argv: number) => number;
  chdb_result_buffer?: (result: number) => number;
  _chdb_result_buffer?: (result: number) => number;
  chdb_result_length?: (result: number) => number;
  _chdb_result_length?: (result: number) => number;
  chdb_result_error?: (result: number) => number;
  _chdb_result_error?: (result: number) => number;
  chdb_result_elapsed?: (result: number) => number;
  _chdb_result_elapsed?: (result: number) => number;
  chdb_result_rows_read?: (result: number) => number;
  _chdb_result_rows_read?: (result: number) => number;
  chdb_result_bytes_read?: (result: number) => number;
  _chdb_result_bytes_read?: (result: number) => number;
  chdb_destroy_query_result?: (result: number) => void;
  _chdb_destroy_query_result?: (result: number) => void;
  chdb_close_conn?: (conn: number) => void;
  _chdb_close_conn?: (conn: number) => void;

  // Initialization functions
  _initialize?: () => void;
  __wasm_call_ctors?: () => void;

  // Legacy/alternative API
  query_stable_v2?: (argc: number, argv: number) => number;
  _query_stable_v2?: (argc: number, argv: number) => number;
  free_result_v2?: (result: number) => void;
  _free_result_v2?: (result: number) => void;
}

/**
 * Loaded chdb WASM instance
 */
interface ChdbWasmInstance {
  instance: WebAssembly.Instance;
  exports: WasmExports;
  memory: WebAssembly.Memory;
  encoder: TextEncoder;
  decoder: TextDecoder;
  heapU8: Uint8Array;
  heapView: DataView;
  connectionHandle: number | null;
}

// Global singleton for the loaded WASM module
let wasmInstance: ChdbWasmInstance | null = null;
let loadingPromise: Promise<ChdbWasmInstance> | null = null;

/**
 * Create WASM imports object with all required runtime support
 */
function createWasmImports(memory: WebAssembly.Memory): WasmImports {
  let heapU8 = new Uint8Array(memory.buffer);
  let heapView = new DataView(memory.buffer);

  // Helper to update heap references after memory growth
  const updateHeap = () => {
    heapU8 = new Uint8Array(memory.buffer);
    heapView = new DataView(memory.buffer);
  };

  // WASI error codes
  const WASI_ERRNO_SUCCESS = 0;
  const WASI_ERRNO_BADF = 8;
  const WASI_ERRNO_NOSYS = 52;
  // const WASI_ERRNO_INVAL = 28; // Reserved for future use

  const wasiEnv = {
    fd_write: (_fd: number, iovs: number, iovsLen: number, nwritten: number): number => {
      updateHeap();
      let written = 0;
      for (let i = 0; i < iovsLen; i++) {
        // iov structure: [ptr (4 bytes), len (4 bytes)]
        // We only need len since we're discarding stdout/stderr in production
        const len = heapView.getUint32(iovs + i * 8 + 4, true);
        written += len;
      }
      heapView.setUint32(nwritten, written, true);
      return WASI_ERRNO_SUCCESS;
    },

    fd_read: (_fd: number, _iovs: number, _iovsLen: number, nread: number): number => {
      updateHeap();
      // No stdin in Workers
      heapView.setUint32(nread, 0, true);
      return WASI_ERRNO_SUCCESS;
    },

    fd_close: (_fd: number): number => {
      return WASI_ERRNO_SUCCESS;
    },

    fd_seek: (_fd: number, _offsetLow: number, _offsetHigh: number, _whence: number, newOffset: number): number => {
      updateHeap();
      heapView.setBigUint64(newOffset, BigInt(0), true);
      return WASI_ERRNO_NOSYS;
    },

    fd_fdstat_get: (fd: number, stat: number): number => {
      updateHeap();
      // Return basic file descriptor stats
      if (fd < 3) {
        // stdin/stdout/stderr - character device
        heapView.setUint8(stat, fd === 0 ? 0 : 1); // filetype: 0=unknown, 1=block, 2=char, etc.
        heapView.setUint16(stat + 2, 0, true); // flags
        heapView.setBigUint64(stat + 8, BigInt(0), true); // rights_base
        heapView.setBigUint64(stat + 16, BigInt(0), true); // rights_inheriting
        return WASI_ERRNO_SUCCESS;
      }
      return WASI_ERRNO_BADF;
    },

    fd_prestat_get: (_fd: number, _prestat: number): number => {
      return WASI_ERRNO_BADF;
    },

    fd_prestat_dir_name: (_fd: number, _path: number, _pathLen: number): number => {
      return WASI_ERRNO_BADF;
    },

    environ_get: (_environ: number, _environBuf: number): number => {
      return WASI_ERRNO_SUCCESS;
    },

    environ_sizes_get: (penvironCount: number, penvironBufSize: number): number => {
      updateHeap();
      heapView.setUint32(penvironCount, 0, true);
      heapView.setUint32(penvironBufSize, 0, true);
      return WASI_ERRNO_SUCCESS;
    },

    clock_time_get: (_clockId: number, _precision: bigint, time: number): number => {
      updateHeap();
      const now = BigInt(Math.floor(performance.now() * 1_000_000)); // nanoseconds
      heapView.setBigUint64(time, now, true);
      return WASI_ERRNO_SUCCESS;
    },

    proc_exit: (code: number): never => {
      throw new Error(`Process exited with code ${code}`);
    },

    random_get: (buf: number, bufLen: number): number => {
      updateHeap();
      const randomBytes = new Uint8Array(bufLen);
      crypto.getRandomValues(randomBytes);
      heapU8.set(randomBytes, buf);
      return WASI_ERRNO_SUCCESS;
    },

    path_open: (..._args: unknown[]): number => {
      return WASI_ERRNO_NOSYS;
    },

    path_filestat_get: (..._args: unknown[]): number => {
      return WASI_ERRNO_NOSYS;
    },

    args_get: (_argv: number, _argvBuf: number): number => {
      return WASI_ERRNO_SUCCESS;
    },

    args_sizes_get: (pargc: number, pargvBufSize: number): number => {
      updateHeap();
      heapView.setUint32(pargc, 0, true);
      heapView.setUint32(pargvBufSize, 0, true);
      return WASI_ERRNO_SUCCESS;
    },
  };

  return {
    env: {
      memory,
      emscripten_notify_memory_growth: (_index: number) => {
        updateHeap();
      },
      abort: () => {
        throw new Error('WASM abort called');
      },
      _abort_js: () => {
        throw new Error('WASM abort called');
      },
      _emscripten_get_now: () => performance.now(),
      _emscripten_memcpy_js: (dest: number, src: number, len: number) => {
        updateHeap();
        heapU8.copyWithin(dest, src, src + len);
      },
      fd_write: wasiEnv.fd_write,
      fd_read: wasiEnv.fd_read,
      fd_close: wasiEnv.fd_close,
      fd_seek: wasiEnv.fd_seek,
      environ_get: wasiEnv.environ_get,
      environ_sizes_get: wasiEnv.environ_sizes_get,
      clock_time_get: wasiEnv.clock_time_get,
      proc_exit: wasiEnv.proc_exit,
      random_get: wasiEnv.random_get,
    },
    wasi_snapshot_preview1: wasiEnv,
  };
}

/**
 * Load the chdb WASM binary from R2 and instantiate it
 *
 * Uses StreamingWasmLoader for optimized loading with:
 * - Streaming compilation when available
 * - Module caching
 * - Progress tracking (logged)
 * - Timeout support
 */
async function loadWasmFromR2(env: ChdbBackendEnv): Promise<ChdbWasmInstance> {
  // Initialize streaming loader if not already done
  if (!streamingLoader) {
    const loaderEnv: WasmLoaderEnv = {
      WASM_BUCKET: env.WASM_BUCKET,
    };
    streamingLoader = new StreamingWasmLoader(loaderEnv);
  }

  // Load WASM using streaming loader
  log.debug('Loading chDB WASM from R2 using streaming loader...');
  let loadResult: WasmLoadResult;

  try {
    loadResult = await streamingLoader.loadFromR2({
      key: DEFAULT_WASM_KEY,
      useStreaming: true,
      timeout: 60000, // 60 second timeout for large WASM files
      onProgress: (loaded, total) => {
        const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
        log.debug(`WASM loading progress: ${percent}% (${loaded}/${total} bytes)`);
      },
    });

    log.debug('WASM loaded successfully', {
      strategy: loadResult.strategy,
      bytesLoaded: loadResult.bytesLoaded,
      fetchTimeMs: Math.round(loadResult.fetchTimeMs),
      compileTimeMs: Math.round(loadResult.compileTimeMs),
      totalTimeMs: Math.round(loadResult.totalTimeMs),
    });
  } catch (loadError) {
    log.error('Failed to load WASM from R2', {
      error: loadError instanceof Error ? loadError.message : String(loadError),
    });
    throw new Error(`Failed to load WASM from R2: ${loadError instanceof Error ? loadError.message : String(loadError)}`);
  }

  // Create memory with initial and maximum sizes
  // Cloudflare Workers have 128MB limit, but WASM memory is separate
  // Start with 256 pages (16MB), allow growth to 2048 pages (128MB)
  const memory = new WebAssembly.Memory({
    initial: 256,  // 16MB initial
    maximum: 2048, // 128MB max (Workers limit)
  });

  // Create imports
  const imports = createWasmImports(memory);

  // Instantiate the pre-compiled module
  let instance: WebAssembly.Instance;
  try {
    // WebAssembly.instantiate with a Module returns just the instance
    instance = await WebAssembly.instantiate(loadResult.module, imports as unknown as WebAssembly.Imports);
  } catch (instantiateError) {
    log.error('Failed to instantiate WASM module', {
      error: instantiateError instanceof Error ? instantiateError.message : String(instantiateError),
    });
    throw new Error(`Failed to instantiate WASM: ${instantiateError instanceof Error ? instantiateError.message : String(instantiateError)}`);
  }

  const exports = instance.exports as unknown as WasmExports;

  // Use the module's memory if it exports one, otherwise use our imported memory
  const wasmMemory = (exports.memory || memory) as WebAssembly.Memory;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const chdbInstance: ChdbWasmInstance = {
    instance,
    exports,
    memory: wasmMemory,
    encoder,
    decoder,
    heapU8: new Uint8Array(wasmMemory.buffer),
    heapView: new DataView(wasmMemory.buffer),
    connectionHandle: null,
  };

  // Call initialization functions if present
  if (exports._initialize) {
    exports._initialize();
  } else if (exports.__wasm_call_ctors) {
    exports.__wasm_call_ctors();
  }

  log.debug('chDB WASM instance created successfully');
  return chdbInstance;
}

/**
 * Get or create the WASM instance (singleton pattern)
 */
export async function getWasmInstance(env: ChdbBackendEnv): Promise<ChdbWasmInstance> {
  if (wasmInstance) {
    return wasmInstance;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = loadWasmFromR2(env).then(instance => {
    wasmInstance = instance;
    return instance;
  }).catch(error => {
    loadingPromise = null;
    throw error;
  });

  return loadingPromise;
}

/**
 * Update heap references after potential memory growth
 */
function updateHeapRefs(inst: ChdbWasmInstance): void {
  inst.heapU8 = new Uint8Array(inst.memory.buffer);
  inst.heapView = new DataView(inst.memory.buffer);
}

/**
 * Allocate memory and write a string to it
 */
function allocateString(inst: ChdbWasmInstance, str: string): number {
  updateHeapRefs(inst);

  const bytes = inst.encoder.encode(str);
  const malloc = inst.exports.malloc || inst.exports._malloc;
  if (!malloc) {
    throw new Error('malloc function not found in WASM exports');
  }

  // Allocate space for string + null terminator
  const ptr = malloc(bytes.length + 1);
  if (ptr === 0) {
    throw new Error('Failed to allocate memory for string');
  }

  updateHeapRefs(inst);

  // Copy string bytes
  inst.heapU8.set(bytes, ptr);
  // Null terminate
  inst.heapU8[ptr + bytes.length] = 0;

  return ptr;
}

/**
 * Free allocated memory
 */
function freeMemory(inst: ChdbWasmInstance, ptr: number): void {
  const free = inst.exports.free || inst.exports._free;
  if (free && ptr !== 0) {
    free(ptr);
  }
}

/**
 * Read a null-terminated string from memory
 */
function readString(inst: ChdbWasmInstance, ptr: number, maxLen = 10000): string {
  if (ptr === 0) return '';

  updateHeapRefs(inst);

  let end = ptr;
  while (end < ptr + maxLen && inst.heapU8[end] !== 0) {
    end++;
  }

  return inst.decoder.decode(inst.heapU8.slice(ptr, end));
}

/**
 * Execute a query using the command-line interface style API
 * This is the simplest way to execute queries without maintaining a connection
 */
async function executeQueryCmdline(
  inst: ChdbWasmInstance,
  sql: string,
  format: string
): Promise<ChdbQueryResult> {
  const queryStable = inst.exports.query_stable_v2 || inst.exports._query_stable_v2;
  const freeResult = inst.exports.free_result_v2 || inst.exports._free_result_v2;

  if (!queryStable) {
    throw new Error('query_stable_v2 function not found in WASM exports');
  }

  // Build command-line arguments: ["clickhouse", "--query=...", "--format=..."]
  const args = [
    'clickhouse',
    `--query=${sql}`,
    `--format=${format}`,
    '--output-format=' + format,
  ];

  const malloc = inst.exports.malloc || inst.exports._malloc;
  if (!malloc) {
    throw new Error('malloc function not found in WASM exports');
  }

  // Allocate argv array
  const argvPtrs: number[] = [];
  for (const arg of args) {
    argvPtrs.push(allocateString(inst, arg));
  }

  // Create argv pointer array
  const argvPtr = malloc((args.length + 1) * 4); // 4 bytes per pointer + null terminator
  updateHeapRefs(inst);

  for (let i = 0; i < argvPtrs.length; i++) {
    inst.heapView.setUint32(argvPtr + i * 4, argvPtrs[i], true);
  }
  inst.heapView.setUint32(argvPtr + argvPtrs.length * 4, 0, true); // null terminator

  let resultPtr: number = 0;
  try {
    // Execute query
    resultPtr = queryStable(args.length, argvPtr);

    if (resultPtr === 0) {
      throw new Error('Query returned null result');
    }

    updateHeapRefs(inst);

    // Read result structure (local_result_v2):
    // char* buf;        // offset 0
    // size_t len;       // offset 8
    // void* _vec;       // offset 16
    // double elapsed;   // offset 24
    // uint64_t rows_read; // offset 32
    // uint64_t bytes_read; // offset 40
    // char* error_message; // offset 48

    const bufPtr = inst.heapView.getUint32(resultPtr, true);
    const bufLen = inst.heapView.getUint32(resultPtr + 8, true);
    const elapsed = inst.heapView.getFloat64(resultPtr + 24, true);
    const rowsRead = Number(inst.heapView.getBigUint64(resultPtr + 32, true));
    const bytesRead = Number(inst.heapView.getBigUint64(resultPtr + 40, true));
    const errorPtr = inst.heapView.getUint32(resultPtr + 48, true);

    // Check for error
    if (errorPtr !== 0) {
      const errorMsg = readString(inst, errorPtr);
      throw new Error(errorMsg);
    }

    // Read result data
    const resultData = inst.decoder.decode(inst.heapU8.slice(bufPtr, bufPtr + bufLen));

    // Parse JSON result if format is JSON
    if (format === 'JSON' || format === 'JSONCompact') {
      try {
        const parsed = JSON.parse(resultData);
        return {
          meta: parsed.meta || [],
          data: parsed.data || [],
          rows: parsed.rows || 0,
          statistics: {
            elapsed,
            rows_read: rowsRead,
            bytes_read: bytesRead,
          },
        };
      } catch {
        // If not valid JSON, return as raw string wrapped in structure
        return parseNonJsonResult(resultData, elapsed, rowsRead, bytesRead);
      }
    }

    // For non-JSON formats, parse the output
    return parseNonJsonResult(resultData, elapsed, rowsRead, bytesRead);
  } finally {
    // Clean up
    if (freeResult && resultPtr !== 0) {
      freeResult(resultPtr);
    }
    freeMemory(inst, argvPtr);
    for (const ptr of argvPtrs) {
      freeMemory(inst, ptr);
    }
  }
}

/**
 * Execute a query using the connection-based API
 */
async function executeQueryWithConnection(
  inst: ChdbWasmInstance,
  sql: string,
  format: string
): Promise<ChdbQueryResult> {
  const connect = inst.exports.chdb_connect || inst.exports._chdb_connect;
  const query = inst.exports.chdb_query || inst.exports._chdb_query;
  const resultBuffer = inst.exports.chdb_result_buffer || inst.exports._chdb_result_buffer;
  const resultLength = inst.exports.chdb_result_length || inst.exports._chdb_result_length;
  const resultError = inst.exports.chdb_result_error || inst.exports._chdb_result_error;
  const resultElapsed = inst.exports.chdb_result_elapsed || inst.exports._chdb_result_elapsed;
  const resultRowsRead = inst.exports.chdb_result_rows_read || inst.exports._chdb_result_rows_read;
  const resultBytesRead = inst.exports.chdb_result_bytes_read || inst.exports._chdb_result_bytes_read;
  const destroyResult = inst.exports.chdb_destroy_query_result || inst.exports._chdb_destroy_query_result;

  if (!query || !resultBuffer || !resultLength) {
    // Fall back to cmdline API
    return executeQueryCmdline(inst, sql, format);
  }

  // Create connection if needed
  if (!inst.connectionHandle && connect) {
    const malloc = inst.exports.malloc || inst.exports._malloc;
    if (malloc) {
      const argvPtr = malloc(2 * 4);
      const progNamePtr = allocateString(inst, 'clickhouse');
      updateHeapRefs(inst);
      inst.heapView.setUint32(argvPtr, progNamePtr, true);
      inst.heapView.setUint32(argvPtr + 4, 0, true);

      const connPtr = connect(1, argvPtr);
      if (connPtr !== 0) {
        // The connect function returns chdb_connection* which is a pointer to the actual connection
        inst.connectionHandle = inst.heapView.getUint32(connPtr, true);
      }

      freeMemory(inst, progNamePtr);
      freeMemory(inst, argvPtr);
    }
  }

  if (!inst.connectionHandle) {
    // Fall back to cmdline API if connection failed
    return executeQueryCmdline(inst, sql, format);
  }

  const sqlPtr = allocateString(inst, sql);
  const formatPtr = allocateString(inst, format);
  let resultPtr: number = 0;

  try {
    resultPtr = query(inst.connectionHandle, sqlPtr, formatPtr);

    if (resultPtr === 0) {
      throw new Error('Query returned null result');
    }

    updateHeapRefs(inst);

    // Check for error
    if (resultError) {
      const errorPtr = resultError(resultPtr);
      if (errorPtr !== 0) {
        const errorMsg = readString(inst, errorPtr);
        throw new Error(errorMsg);
      }
    }

    // Get result data
    const bufPtr = resultBuffer(resultPtr);
    const bufLen = resultLength(resultPtr);
    const elapsed = resultElapsed ? resultElapsed(resultPtr) : 0;
    const rowsRead = resultRowsRead ? Number(resultRowsRead(resultPtr)) : 0;
    const bytesRead = resultBytesRead ? Number(resultBytesRead(resultPtr)) : 0;

    const resultData = inst.decoder.decode(inst.heapU8.slice(bufPtr, bufPtr + bufLen));

    // Parse JSON result if format is JSON
    if (format === 'JSON' || format === 'JSONCompact') {
      try {
        const parsed = JSON.parse(resultData);
        return {
          meta: parsed.meta || [],
          data: parsed.data || [],
          rows: parsed.rows || 0,
          statistics: {
            elapsed,
            rows_read: rowsRead,
            bytes_read: bytesRead,
          },
        };
      } catch {
        return parseNonJsonResult(resultData, elapsed, rowsRead, bytesRead);
      }
    }

    return parseNonJsonResult(resultData, elapsed, rowsRead, bytesRead);
  } finally {
    freeMemory(inst, sqlPtr);
    freeMemory(inst, formatPtr);
    if (destroyResult && resultPtr !== 0) {
      destroyResult(resultPtr);
    }
  }
}

/**
 * Parse non-JSON format results into our standard format
 */
function parseNonJsonResult(
  data: string,
  elapsed: number,
  rowsRead: number,
  bytesRead: number
): ChdbQueryResult {
  // For TabSeparated format, parse into rows
  const lines = data.trim().split('\n').filter(line => line.length > 0);

  if (lines.length === 0) {
    return {
      meta: [],
      data: [],
      rows: 0,
      statistics: { elapsed, rows_read: rowsRead, bytes_read: bytesRead },
    };
  }

  // Assume first line is data (no header in TabSeparated by default)
  const rows = lines.map(line => {
    const values = line.split('\t');
    const row: RowData = {};
    values.forEach((val, i) => {
      row[`column${i}`] = parseValue(val);
    });
    return row;
  });

  // Generate meta based on first row
  const meta = rows.length > 0
    ? Object.keys(rows[0]).map(name => ({
      name,
      type: typeof rows[0][name] === 'number' ? 'UInt64' : 'String',
    }))
    : [];

  return {
    meta,
    data: rows,
    rows: rows.length,
    statistics: { elapsed, rows_read: rowsRead, bytes_read: bytesRead },
  };
}

/**
 * Parse a string value to its appropriate type
 */
function parseValue(val: string): ParsedValue {
  // Check for NULL
  if (val === '\\N' || val === 'NULL') {
    return null;
  }

  // Try to parse as number
  if (/^-?\d+$/.test(val)) {
    const num = parseInt(val, 10);
    if (num >= Number.MIN_SAFE_INTEGER && num <= Number.MAX_SAFE_INTEGER) {
      return num;
    }
    return val; // Return as string if too large
  }

  if (/^-?\d+\.\d+$/.test(val)) {
    return parseFloat(val);
  }

  return val;
}

/**
 * Create a SQL executor backed by the chdb WASM module
 */
export async function createChdbExecutor(env: ChdbBackendEnv): Promise<SqlExecutor> {
  const inst = await getWasmInstance(env);

  return {
    async execute(sql: string): Promise<ChdbQueryResult> {
      // Always request JSON format for consistent parsing
      try {
        return await executeQueryWithConnection(inst, sql, 'JSON');
      } catch (error) {
        // If connection-based API fails, try cmdline
        try {
          return await executeQueryCmdline(inst, sql, 'JSON');
        } catch (cmdlineError) {
          // Re-throw the original error if both fail
          throw error;
        }
      }
    },
  };
}

/**
 * Check if the WASM module is loaded
 */
export function isWasmLoaded(): boolean {
  return wasmInstance !== null;
}

/**
 * Get available WASM exports (for debugging)
 */
export function getWasmExports(): string[] {
  if (!wasmInstance) {
    return [];
  }
  return Object.keys(wasmInstance.exports);
}

/**
 * Get streaming loader cache statistics
 */
export function getStreamingLoaderCacheStats(): { entries: number; keys: string[] } | null {
  if (!streamingLoader) {
    return null;
  }
  return streamingLoader.getCacheStats();
}

/**
 * Clear the streaming loader cache
 * Useful for forcing a fresh load of WASM modules
 */
export function clearStreamingLoaderCache(): void {
  if (streamingLoader) {
    streamingLoader.clearCache();
    log.debug('Streaming loader cache cleared');
  }
}

/**
 * Reset the chDB backend completely
 * This clears both the WASM instance and the streaming loader cache
 */
export function resetChdbBackend(): void {
  wasmInstance = null;
  loadingPromise = null;
  if (streamingLoader) {
    streamingLoader.clearCache();
    streamingLoader = null;
  }
  log.debug('chDB backend reset');
}
