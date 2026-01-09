/**
 * @dotdo/duckdb-worker
 *
 * DuckDB WASM optimized for Cloudflare Workers runtime.
 * Provides SQL analytics capabilities within V8 isolates.
 *
 * @example
 * ```typescript
 * import { createDuckDB } from '@dotdo/duckdb-worker'
 *
 * const db = await createDuckDB()
 * const result = await db.query('SELECT 1 + 1 as answer')
 * console.log(result.rows[0].answer) // 2
 * await db.close()
 * ```
 */

export type {
  DuckDBConfig,
  DuckDBInstance,
  QueryResult,
  ColumnInfo,
  InstantiationResult,
} from './types.js'

export {
  FileBufferRegistry,
  registerFileBuffer,
  dropFile,
  getFileBuffer,
  hasFile,
  listFiles,
  getFileSize,
  clearAllFiles,
  getTotalMemoryUsage,
} from './runtime.js'

export {
  loadDuckDBModule,
  createInstanceFromModule,
  clearModuleCache,
  isModuleCached,
  createDuckDB as createDuckDBFromBindings,
} from './bindings.js'

export type { LoadDuckDBOptions } from './bindings.js'

import type { DuckDBConfig, DuckDBInstance, InstantiationResult } from './types.js'
import type { LoadDuckDBOptions } from './bindings.js'
import {
  loadDuckDBModule,
  createInstanceFromModule,
  clearModuleCache,
  isModuleCached,
} from './bindings.js'

/**
 * Cached module instance for reuse
 */
let cachedModule: Awaited<ReturnType<typeof loadDuckDBModule>> | null = null

/**
 * Create a new DuckDB instance
 *
 * @param config - Optional configuration for the DuckDB instance
 * @param loadOptions - Optional WASM loading options (binary, module, or loader)
 * @returns Promise resolving to a DuckDB instance
 *
 * @example
 * ```typescript
 * // Basic usage (dynamically imports WASM loader)
 * const db = await createDuckDB()
 * const result = await db.query('SELECT 1 + 1 as answer')
 * console.log(result.rows[0].answer) // 2
 * await db.close()
 *
 * // With pre-loaded WASM binary
 * const wasmBuffer = await fetch('/duckdb-worker.wasm').then(r => r.arrayBuffer())
 * const db = await createDuckDB({}, { wasmBinary: wasmBuffer })
 *
 * // With Workers WASM module binding
 * const db = await createDuckDB({}, { wasmModule: env.DUCKDB_WASM })
 * ```
 */
export async function createDuckDB(
  config?: DuckDBConfig,
  loadOptions?: ArrayBuffer | LoadDuckDBOptions
): Promise<DuckDBInstance> {
  // Load or reuse module
  if (!cachedModule) {
    cachedModule = await loadDuckDBModule(loadOptions)
  }

  // Create instance from module
  return createInstanceFromModule(cachedModule, config)
}

/**
 * Instantiate the DuckDB WASM module
 *
 * Call this during initialization to pre-load the WASM binary.
 * The module will be cached for subsequent createDuckDB calls.
 *
 * @param loadOptions - Optional WASM loading options (binary, module, or loader)
 * @returns Promise resolving to instantiation result
 *
 * @example
 * ```typescript
 * // Pre-load during worker initialization
 * const result = await instantiateDuckDB()
 * if (!result.success) {
 *   console.error('Failed to load DuckDB:', result.error)
 * }
 *
 * // With Workers WASM module binding
 * const result = await instantiateDuckDB({ wasmModule: env.DUCKDB_WASM })
 * ```
 */
export async function instantiateDuckDB(
  loadOptions?: ArrayBuffer | LoadDuckDBOptions
): Promise<InstantiationResult> {
  const startTime = performance.now()

  try {
    cachedModule = await loadDuckDBModule(loadOptions)

    return {
      success: true,
      instantiationTimeMs: performance.now() - startTime,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during instantiation',
      instantiationTimeMs: performance.now() - startTime,
    }
  }
}

/**
 * Clear the cached WASM module
 *
 * Useful for testing or when you need to reinitialize with different configuration.
 */
export function clearCache(): void {
  clearModuleCache()
  cachedModule = null
}

/**
 * Check if the WASM module has been cached
 *
 * @returns true if the module is cached and ready
 */
export function isCached(): boolean {
  return isModuleCached() && cachedModule !== null
}
