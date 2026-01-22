/**
 * chdb WASM - ClickHouse embedded database
 *
 * This module provides the TypeScript interface to the chdb WASM module,
 * which is ClickHouse compiled to WebAssembly.
 */

import type {
  ChdbInstance,
  ChdbConfig,
  QueryOptions,
  MemoryStats,
} from './types';
import { ChdbError, DisposedError } from './types';

/**
 * Type definition for the chdb WASM module.
 * These are the functions exported from the Emscripten-compiled WASM.
 */
interface ChdbWasmModule {
  // Memory management
  _malloc(size: number): number;
  _free(ptr: number): void;

  // Core chdb functions
  _chdb_query(sql: number, format: number): number;
  _chdb_query_v2(sql: number, format: number, flags: number): number;
  _chdb_create(): number;
  _chdb_destroy(handle: number): void;
  _chdb_get_version(): number;
  _chdb_get_memory_stats(handle: number): number;
  _chdb_clear_cache(handle: number): void;
  _chdb_embedded_server_initialized(): number;

  // WASM-specific functions
  _chdb_wasm_init(): number;
  _chdb_wasm_shutdown(): void;
  _chdb_wasm_query(sql: number, format: number): number;
  _chdb_wasm_result_free(result: number): void;
  _chdb_wasm_result_buffer(result: number): number;
  _chdb_wasm_result_length(result: number): number;
  _chdb_wasm_result_error(result: number): number;

  // Emscripten runtime methods
  ccall(name: string, returnType: string, argTypes: string[], args: unknown[]): unknown;
  cwrap(name: string, returnType: string, argTypes: string[]): (...args: unknown[]) => unknown;
  UTF8ToString(ptr: number, maxLength?: number): string;
  stringToUTF8(str: string, outPtr: number, maxBytes: number): void;
  lengthBytesUTF8(str: string): number;
  getValue(ptr: number, type: string): number;
  setValue(ptr: number, value: number, type: string): void;

  // Module state
  ready: Promise<ChdbWasmModule>;
  HEAPU8: Uint8Array;
}

// Global module instance (singleton)
let wasmModule: ChdbWasmModule | null = null;
let modulePromise: Promise<ChdbWasmModule> | null = null;

/**
 * Load the chdb WASM module.
 *
 * @param wasmPath - Optional path to the WASM file
 * @returns Promise resolving to the loaded module
 */
async function loadChdbModule(wasmPath?: string): Promise<ChdbWasmModule> {
  if (wasmModule) {
    return wasmModule;
  }

  if (modulePromise) {
    return modulePromise;
  }

  modulePromise = (async () => {
    // Dynamic import of the chdb module
    // In production, this would come from a bundled path or CDN
    type CreateChdbFn = (config?: Record<string, unknown>) => Promise<ChdbWasmModule>;
    // @ts-expect-error - Dynamic import of Emscripten-generated module
    const chdbModule = await import('../build-wasm/dist/chdb.js')
      .catch(() => {
        throw new Error(
          'Failed to load chdb WASM module. ' +
          'Make sure the build is complete: npm run build:wasm'
        );
      });

    const createChDB = (chdbModule.default || chdbModule) as CreateChdbFn;

    // Initialize the module with optional path override
    const moduleConfig: Record<string, unknown> = {};
    if (wasmPath) {
      moduleConfig.locateFile = (path: string) => {
        if (path.endsWith('.wasm')) {
          return wasmPath;
        }
        return path;
      };
    }

    wasmModule = await createChDB(moduleConfig);

    // Initialize the WASM environment
    const initResult = wasmModule!._chdb_wasm_init();
    if (initResult !== 0) {
      throw new Error(`Failed to initialize chdb WASM: error code ${initResult}`);
    }

    return wasmModule!;
  })();

  return modulePromise;
}

/**
 * Execute a query using the chdb WASM module.
 */
function executeQuery(
  module: ChdbWasmModule,
  sql: string,
  format: string
): string {
  // Allocate memory for SQL string
  const sqlLen = module.lengthBytesUTF8(sql) + 1;
  const sqlPtr = module._malloc(sqlLen);
  module.stringToUTF8(sql, sqlPtr, sqlLen);

  // Allocate memory for format string
  const formatLen = module.lengthBytesUTF8(format) + 1;
  const formatPtr = module._malloc(formatLen);
  module.stringToUTF8(format, formatPtr, formatLen);

  try {
    // Execute query
    const resultPtr = module._chdb_wasm_query(sqlPtr, formatPtr);

    if (resultPtr === 0) {
      throw new ChdbError('Query returned null result');
    }

    // Check for errors
    const errorPtr = module._chdb_wasm_result_error(resultPtr);
    if (errorPtr !== 0) {
      const errorMsg = module.UTF8ToString(errorPtr);
      module._chdb_wasm_result_free(resultPtr);
      throw new ChdbError(errorMsg, undefined, sql);
    }

    // Get result buffer
    const bufferPtr = module._chdb_wasm_result_buffer(resultPtr);
    const bufferLen = module._chdb_wasm_result_length(resultPtr);

    // Copy result to JavaScript string
    const result = module.UTF8ToString(bufferPtr, bufferLen);

    // Free result
    module._chdb_wasm_result_free(resultPtr);

    return result;
  } finally {
    // Free input strings
    module._free(sqlPtr);
    module._free(formatPtr);
  }
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: Required<Omit<ChdbConfig, 'wasmPath' | 'assets'>> = {
  memoryLimit: 128 * 1024 * 1024, // 128MB (matches WASM build)
  logging: false,
  settings: {},
  profile: 'standard',
};

/**
 * Create a new chdb instance.
 *
 * @param config - Optional configuration options.
 * @returns A promise that resolves to a ChdbInstance.
 *
 * @example
 * ```typescript
 * const chdb = await createChdb();
 * const result = await chdb.query('SELECT 1 + 1 as result', { format: 'JSON' });
 * console.log(result);
 * ```
 */
export async function createChdb(config?: ChdbConfig): Promise<ChdbInstance> {
  const resolvedConfig = { ...DEFAULT_CONFIG, ...config };

  // Load the WASM module
  const module = await loadChdbModule(config?.wasmPath);
  let isDisposed = false;

  /**
   * Ensure the instance has not been disposed.
   */
  function ensureNotDisposed(): void {
    if (isDisposed) {
      throw new DisposedError();
    }
  }

  const instance: ChdbInstance = {
    async query(sql: string, options?: QueryOptions): Promise<string> {
      ensureNotDisposed();
      const format = options?.format ?? 'JSON';

      try {
        return executeQuery(module, sql, format);
      } catch (error) {
        if (error instanceof ChdbError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new ChdbError(`Query execution failed: ${message}`, undefined, sql);
      }
    },

    async *queryStream(sql: string, options?: QueryOptions): AsyncIterable<string> {
      ensureNotDisposed();

      // For streaming, we use JSONEachRow format and yield line by line
      const format = options?.format ?? 'JSONEachRow';
      const result = await instance.query(sql, { ...options, format });

      // Split by newlines and yield each row
      const lines = result.split('\n').filter(line => line.trim());
      for (const line of lines) {
        ensureNotDisposed();
        yield line;
      }
    },

    getMemoryStats(): MemoryStats {
      ensureNotDisposed();
      // TODO: Implement proper memory stats from chdb
      return {
        used: module.HEAPU8.length,
        peak: module.HEAPU8.length,
        limit: resolvedConfig.memoryLimit,
      };
    },

    clearCache(): void {
      ensureNotDisposed();
      // TODO: Call _chdb_clear_cache when we have a handle
    },

    dispose(): void {
      if (isDisposed) return;
      isDisposed = true;
      // Note: We don't call _chdb_wasm_shutdown() because the module
      // is shared across instances. Shutdown happens on page unload.
    },

    get disposed(): boolean {
      return isDisposed;
    },
  };

  return instance;
}

/**
 * Get the chdb version string.
 */
export async function getChdbVersion(): Promise<string> {
  const module = await loadChdbModule();
  const versionPtr = module._chdb_get_version();
  return module.UTF8ToString(versionPtr);
}

export { ChdbError, DisposedError } from './types';
