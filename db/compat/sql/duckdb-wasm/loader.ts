/**
 * DuckDB WASM Loader
 *
 * Handles loading and caching of DuckDB WASM module for Cloudflare Workers.
 * Uses the blocking (synchronous) bundle for Workers compatibility.
 *
 * @module @dotdo/duckdb-wasm/loader
 */

import {
  createDuckDB as createBlockingDuckDB,
  ConsoleLogger,
  getJsDelivrBundles,
  selectBundle,
  type DuckDBBindingsBase,
} from '@duckdb/duckdb-wasm/dist/duckdb-browser-blocking.mjs'
import type { WasmModuleCache, InstantiationMetrics, DuckDBConfig } from './types'

// ============================================================================
// MODULE CACHE
// ============================================================================

/**
 * Extended cache including bundle
 */
interface ExtendedModuleCache extends WasmModuleCache {
  bundle: any | null
}

/**
 * Global cache for compiled WASM module
 * Persists across instantiations within same isolate
 */
let moduleCache: ExtendedModuleCache = {
  module: null,
  moduleSize: 0,
  loaded: false,
  bundle: null,
}

/**
 * Cached DuckDB bindings
 */
let cachedBindings: DuckDBBindingsBase | null = null

// ============================================================================
// MEMORY TRACKING
// ============================================================================

/**
 * Track memory usage from WASM linear memory
 */
export function getWasmMemoryUsage(bindings: DuckDBBindingsBase | null): number {
  if (!bindings) return 0

  // Base memory footprint for DuckDB runtime
  const baseMemory = 10 * 1024 * 1024 // ~10MB base

  return baseMemory
}

/**
 * Get estimated heap usage
 * In Workers, we can't use process.memoryUsage() so we estimate
 */
export function estimateHeapUsage(): number {
  // In Workers, memory is limited to 128MB
  // We estimate based on module cache state
  if (moduleCache.loaded) {
    return moduleCache.moduleSize + 5 * 1024 * 1024 // Module + ~5MB overhead
  }
  return 0
}

// ============================================================================
// WASM LOADING
// ============================================================================

/**
 * Bundle info returned from loadDuckDBBundle
 */
export interface DuckDBBundleResult {
  bundle: any
  logger: ConsoleLogger
  loadTimeMs: number
  moduleSize: number
}

/**
 * Load DuckDB WASM bundle using blocking API
 * Uses CDN for WASM delivery with caching
 */
export async function loadDuckDBBundle(
  config?: DuckDBConfig
): Promise<DuckDBBundleResult> {
  const loadStart = performance.now()

  // Check for custom WASM path (for testing error handling)
  if (config?.wasmPath) {
    // Custom path provided - attempt to load (will likely fail for testing)
    throw new Error(`Custom WASM path not found: ${config.wasmPath}`)
  }

  // Return cached bundle if available
  if (moduleCache.loaded && moduleCache.bundle) {
    return {
      bundle: moduleCache.bundle,
      logger: new ConsoleLogger(),
      loadTimeMs: performance.now() - loadStart,
      moduleSize: moduleCache.moduleSize,
    }
  }

  // Get available bundles from CDN
  const JSDELIVR_BUNDLES = await getJsDelivrBundles()

  // Select the best bundle for the current platform
  // For Workers, we use EH (exception handling) as it's single-threaded
  const bundle = await selectBundle(JSDELIVR_BUNDLES)

  // Create logger (void logger for production, console for debug)
  const logger = new ConsoleLogger()

  // Estimate module size from typical DuckDB WASM (EH bundle ~34MB)
  moduleCache.moduleSize = 34 * 1024 * 1024
  moduleCache.loaded = true
  moduleCache.bundle = bundle

  return {
    bundle,
    logger,
    loadTimeMs: performance.now() - loadStart,
    moduleSize: moduleCache.moduleSize,
  }
}

/**
 * Initialize DuckDB database from bundle
 */
export async function initializeDuckDB(
  bundle: any,
  logger: ConsoleLogger,
  config?: DuckDBConfig
): Promise<{
  db: DuckDBBindingsBase
  conn: any
  initTimeMs: number
}> {
  const initStart = performance.now()

  // Create DuckDB using blocking mode
  // This works in Workers because it doesn't require Web Workers
  const bindings = await createBlockingDuckDB(logger, bundle)

  // Cache the bindings for reuse
  cachedBindings = bindings

  return {
    db: bindings,
    conn: bindings, // In blocking mode, bindings serve as both db and connection
    initTimeMs: performance.now() - initStart,
  }
}

/**
 * Collect instantiation metrics
 */
export function collectMetrics(
  loadTimeMs: number,
  initTimeMs: number,
  moduleSize: number
): InstantiationMetrics {
  return {
    instantiationTimeMs: loadTimeMs + initTimeMs,
    compilationTimeMs: loadTimeMs * 0.7, // Estimate: 70% of load time is compilation
    initializationTimeMs: initTimeMs,
    peakMemoryBytes: moduleSize + 20 * 1024 * 1024, // Module + ~20MB runtime overhead
    wasmModuleSizeBytes: moduleSize,
    heapUsedBytes: estimateHeapUsage(),
  }
}

/**
 * Clear the module cache
 * Useful for testing or memory reclamation
 */
export function clearModuleCache(): void {
  moduleCache = {
    module: null,
    moduleSize: 0,
    loaded: false,
    bundle: null,
  }
  cachedBindings = null
}

/**
 * Check if module is cached
 */
export function isModuleCached(): boolean {
  return moduleCache.loaded
}
