/**
 * Bundled WASM SQL Executor
 *
 * This module provides a SQL executor using the bundled executor.wasm module.
 * This is a thin wrapper around real ClickHouse WASM - NO JavaScript fallback.
 *
 * The executor.wasm is a ClickHouse expression evaluator compiled to WebAssembly.
 * If a SQL feature is not supported by the WASM module, it throws an error.
 */

// Import the WASM module as a static asset
import executorWasm from '../wasm/dist/executor.wasm';

import type { SqlExecutor } from './http-query-handler';
import type { RowData, ColumnMeta, QueryStatistics } from './types';

/**
 * Minimal runtime for the executor WASM module
 */
class ExecutorRuntime {
  private instance: WebAssembly.Instance | null = null;
  private memory: WebAssembly.Memory | null = null;
  private heapU8: Uint8Array | null = null;
  private heap32: Int32Array | null = null;

  async initialize(wasmModule: WebAssembly.Module): Promise<void> {
    // Create memory (initial 256 pages = 16MB, max 4096 pages = 256MB)
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
        a: () => { throw new Error('WASM abort'); },
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
        // strftime_l
        b: (s: number, maxsize: number, _format: number, _tm: number, _loc: number): number => {
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
    const ctors = this.instance.exports.h as (() => void) | undefined;
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
 * Parse a TabSeparated result into structured data
 */
function parseTabSeparatedResult(result: string, sql: string): { meta: ColumnMeta[]; data: RowData[]; rows: number } {
  const lines = result.split('\n').filter(line => line.length > 0);

  if (lines.length === 0) {
    return { meta: [], data: [], rows: 0 };
  }

  // Extract column names from the SQL query (basic extraction)
  const aliasMatches = sql.match(/\bAS\s+(\w+)/gi);
  const columnNames: string[] = [];

  if (aliasMatches) {
    for (const match of aliasMatches) {
      const name = match.replace(/^AS\s+/i, '');
      columnNames.push(name);
    }
  }

  // Parse rows
  const data: RowData[] = lines.map(line => {
    const values = line.split('\t');
    const row: RowData = {};

    values.forEach((val, i) => {
      const colName = columnNames[i] || `column${i}`;
      // Try to parse as number
      if (/^-?\d+$/.test(val)) {
        const num = parseInt(val, 10);
        row[colName] = num >= Number.MIN_SAFE_INTEGER && num <= Number.MAX_SAFE_INTEGER ? num : val;
      } else if (/^-?\d+\.\d+$/.test(val)) {
        row[colName] = parseFloat(val);
      } else if (val === '\\N' || val === 'NULL') {
        row[colName] = null;
      } else {
        row[colName] = val;
      }
    });

    return row;
  });

  // Generate meta from first row
  const meta = data.length > 0
    ? Object.keys(data[0]).map(name => ({
        name,
        type: typeof data[0][name] === 'number' ? 'UInt64' : 'String',
      }))
    : [];

  return { meta, data, rows: data.length };
}

/**
 * Create a SQL executor using the bundled WASM module
 *
 * This executor uses ONLY the real ClickHouse WASM module.
 * No fallbacks - if WASM doesn't support a feature, it throws an error.
 */
export async function createBundledExecutor(): Promise<SqlExecutor> {
  await initializeRuntime();

  return {
    async execute(sql: string): Promise<{ meta: ColumnMeta[]; data: RowData[]; rows: number; statistics?: QueryStatistics }> {
      const startTime = performance.now();

      // Execute via the real WASM executor - no fallback
      const response = runtime!.executeQuery(executorHandle!, sql, 'TabSeparated');

      if (!response.success) {
        throw new Error(response.error || 'Query execution failed');
      }

      const elapsed = (performance.now() - startTime) / 1000;

      // Parse the result into structured data
      const parsed = parseTabSeparatedResult(response.result || '', sql);

      return {
        ...parsed,
        statistics: {
          elapsed,
          rows_read: parsed.rows,
          bytes_read: (response.result || '').length,
        },
      };
    },
  };
}

/**
 * Check if the bundled executor is available
 */
export function isBundledExecutorAvailable(): boolean {
  return typeof executorWasm !== 'undefined';
}

/**
 * Get the version of the bundled executor
 */
export async function getBundledExecutorVersion(): Promise<string> {
  await initializeRuntime();
  return runtime!.getVersion();
}
