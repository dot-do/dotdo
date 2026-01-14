/**
 * ESM Dynamic Loader for Sandbox
 *
 * Provides secure dynamic import of ESM bundles within the sandbox environment.
 * Features:
 * - Dynamic import() wrapper for esm.sh bundles
 * - Export extraction (default and named)
 * - Module caching for performance
 * - Error handling with meaningful messages
 * - Import map support
 *
 * @module lib/sandbox/esm-loader
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for ESM dynamic import
 */
export interface EsmImportOptions {
  /** Import map for module resolution */
  importMap?: ImportMap
  /** Timeout for import in milliseconds (default: 30000) */
  timeout?: number
  /** Whether to cache the module (default: true) */
  cache?: boolean
  /** Custom base URL for relative imports */
  baseUrl?: string
}

/**
 * Import map structure
 */
export interface ImportMap {
  /** Module specifier imports */
  imports?: Record<string, string>
  /** Scoped imports */
  scopes?: Record<string, Record<string, string>>
}

/**
 * Resolved ESM module with exports
 */
export interface EsmModule<T = unknown> {
  /** Default export */
  default?: T
  /** All named exports */
  exports: Record<string, unknown>
  /** Module URL */
  url: string
  /** Whether this was loaded from cache */
  cached: boolean
}

/**
 * Module cache entry
 */
interface CacheEntry {
  module: EsmModule
  timestamp: number
  url: string
}

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Error during ESM import
 */
export class EsmImportError extends Error {
  code: string
  url?: string

  constructor(message: string, code: string, url?: string) {
    super(message)
    this.name = 'EsmImportError'
    this.code = code
    this.url = url
  }
}

/**
 * Module not found error
 */
export class ModuleNotFoundError extends EsmImportError {
  constructor(specifier: string) {
    super(`Module not found: ${specifier}`, 'MODULE_NOT_FOUND')
  }
}

/**
 * Import timeout error
 */
export class ImportTimeoutError extends EsmImportError {
  constructor(url: string, timeout: number) {
    super(`Import timed out after ${timeout}ms: ${url}`, 'IMPORT_TIMEOUT', url)
  }
}

/**
 * Invalid module error
 */
export class InvalidModuleError extends EsmImportError {
  constructor(url: string, reason: string) {
    super(`Invalid module at ${url}: ${reason}`, 'INVALID_MODULE', url)
  }
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_TIMEOUT = 30000
const DEFAULT_BASE_URL = 'https://esm.sh'

// ============================================================================
// MODULE CACHE
// ============================================================================

/**
 * LRU-style module cache with TTL
 */
export class EsmModuleCache {
  private cache = new Map<string, CacheEntry>()
  private maxSize: number
  private ttl: number

  constructor(options?: { maxSize?: number; ttl?: number }) {
    this.maxSize = options?.maxSize ?? 100
    this.ttl = options?.ttl ?? 60 * 60 * 1000 // 1 hour default
  }

  /**
   * Get a cached module
   */
  get(url: string): EsmModule | undefined {
    const entry = this.cache.get(url)
    if (!entry) return undefined

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(url)
      return undefined
    }

    // Move to end for LRU
    this.cache.delete(url)
    this.cache.set(url, entry)

    return { ...entry.module, cached: true }
  }

  /**
   * Set a cached module
   */
  set(url: string, module: EsmModule): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value
      if (oldest) this.cache.delete(oldest)
    }

    this.cache.set(url, {
      module: { ...module, cached: false },
      timestamp: Date.now(),
      url,
    })
  }

  /**
   * Check if a module is cached
   */
  has(url: string): boolean {
    return this.get(url) !== undefined
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size
  }
}

// Global cache instance
const moduleCache = new EsmModuleCache()

// ============================================================================
// URL RESOLUTION
// ============================================================================

/**
 * Resolve a module specifier to a URL using import map
 */
export function resolveModuleSpecifier(
  specifier: string,
  options?: EsmImportOptions
): string {
  const importMap = options?.importMap
  const baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL

  // Check import map first
  if (importMap?.imports) {
    // Direct match
    if (importMap.imports[specifier]) {
      return importMap.imports[specifier]
    }

    // Prefix match (for package subpaths)
    for (const [key, value] of Object.entries(importMap.imports)) {
      if (key.endsWith('/') && specifier.startsWith(key)) {
        return value + specifier.slice(key.length)
      }
    }
  }

  // If it's already a URL, return as-is
  if (specifier.startsWith('http://') || specifier.startsWith('https://')) {
    return specifier
  }

  // Handle bare specifiers via esm.sh
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return `${baseUrl}/${specifier}`
  }

  // Relative URLs need a base
  if (options?.baseUrl) {
    return new URL(specifier, options.baseUrl).href
  }

  // Can't resolve relative URL without base
  throw new EsmImportError(
    `Cannot resolve relative specifier "${specifier}" without baseUrl`,
    'INVALID_SPECIFIER'
  )
}

// ============================================================================
// EXPORT EXTRACTION
// ============================================================================

/**
 * Extract all exports from a module object
 */
export function extractExports(module: Record<string, unknown>): {
  default?: unknown
  exports: Record<string, unknown>
} {
  const exports: Record<string, unknown> = {}
  let defaultExport: unknown

  for (const [key, value] of Object.entries(module)) {
    if (key === 'default') {
      defaultExport = value
    } else if (key !== '__esModule') {
      exports[key] = value
    }
  }

  return {
    default: defaultExport,
    exports,
  }
}

// ============================================================================
// DYNAMIC IMPORT
// ============================================================================

/**
 * Dynamically import an ESM module
 *
 * @param specifier - Module specifier (package name, URL, or relative path)
 * @param options - Import options
 * @returns Resolved module with exports
 *
 * @example
 * ```typescript
 * // Import from esm.sh
 * const lodash = await importEsm('lodash-es')
 * console.log(lodash.default) // lodash object
 *
 * // Import with import map
 * const result = await importEsm('my-alias', {
 *   importMap: {
 *     imports: { 'my-alias': 'https://esm.sh/lodash-es' }
 *   }
 * })
 *
 * // Import specific version
 * const zod = await importEsm('zod@3.22.0')
 * ```
 */
export async function importEsm<T = unknown>(
  specifier: string,
  options?: EsmImportOptions
): Promise<EsmModule<T>> {
  if (!specifier || specifier.trim() === '') {
    throw new EsmImportError('Module specifier cannot be empty', 'INVALID_SPECIFIER')
  }

  const url = resolveModuleSpecifier(specifier, options)
  const useCache = options?.cache !== false

  // Check cache first
  if (useCache) {
    const cached = moduleCache.get(url)
    if (cached) {
      return cached as EsmModule<T>
    }
  }

  const timeout = options?.timeout ?? DEFAULT_TIMEOUT

  // Create abort controller for timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, timeout)

  try {
    // Use dynamic import
    // Note: In Workers runtime, this will work for esm.sh URLs
    // For sandbox execution, we need to fetch and evaluate
    const module = await Promise.race([
      dynamicImport(url),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new ImportTimeoutError(url, timeout))
        })
      }),
    ])

    clearTimeout(timeoutId)

    // Extract exports
    const { default: defaultExport, exports } = extractExports(
      module as Record<string, unknown>
    )

    const result: EsmModule<T> = {
      default: defaultExport as T,
      exports,
      url,
      cached: false,
    }

    // Cache the result
    if (useCache) {
      moduleCache.set(url, result)
    }

    return result
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof EsmImportError) {
      throw error
    }

    if (error instanceof Error) {
      // Check for common error patterns
      if (error.message.includes('404') || error.message.includes('not found')) {
        throw new ModuleNotFoundError(specifier)
      }

      if (error.message.includes('timeout') || error.name === 'AbortError') {
        throw new ImportTimeoutError(url, timeout)
      }

      throw new EsmImportError(
        `Failed to import module: ${error.message}`,
        'IMPORT_FAILED',
        url
      )
    }

    throw new EsmImportError(
      `Failed to import module: ${String(error)}`,
      'IMPORT_FAILED',
      url
    )
  }
}

/**
 * Internal dynamic import wrapper
 * Can be overridden for testing or custom environments
 */
async function dynamicImport(url: string): Promise<unknown> {
  // In a real Workers environment, we can use dynamic import
  // For sandbox, we need to fetch and evaluate the module
  try {
    // Try native dynamic import first
    return await import(/* @vite-ignore */ url)
  } catch {
    // Fall back to fetch + evaluate for URLs
    return await fetchAndEvaluate(url)
  }
}

/**
 * Fetch and evaluate an ESM module
 * Used when native dynamic import isn't available
 */
async function fetchAndEvaluate(url: string): Promise<unknown> {
  const response = await fetch(url)

  if (!response.ok) {
    if (response.status === 404) {
      throw new ModuleNotFoundError(url)
    }
    throw new EsmImportError(
      `Failed to fetch module: ${response.status} ${response.statusText}`,
      'FETCH_FAILED',
      url
    )
  }

  const code = await response.text()

  // Create a blob URL for the module
  const blob = new Blob([code], { type: 'application/javascript' })
  const blobUrl = URL.createObjectURL(blob)

  try {
    const module = await import(/* @vite-ignore */ blobUrl)
    return module
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

// ============================================================================
// BATCH IMPORT
// ============================================================================

/**
 * Import multiple modules in parallel
 *
 * @param specifiers - Array of module specifiers
 * @param options - Import options (shared across all imports)
 * @returns Map of specifier to module
 *
 * @example
 * ```typescript
 * const modules = await importEsmBatch(['lodash-es', 'zod', 'nanoid'])
 * console.log(modules.get('lodash-es')?.default)
 * ```
 */
export async function importEsmBatch(
  specifiers: string[],
  options?: EsmImportOptions
): Promise<Map<string, EsmModule>> {
  const results = new Map<string, EsmModule>()

  const imports = await Promise.allSettled(
    specifiers.map(async (specifier) => {
      const module = await importEsm(specifier, options)
      return { specifier, module }
    })
  )

  for (const result of imports) {
    if (result.status === 'fulfilled') {
      results.set(result.value.specifier, result.value.module)
    }
    // Silently skip failed imports - caller can check for missing keys
  }

  return results
}

// ============================================================================
// PRELOAD
// ============================================================================

/**
 * Preload modules into cache without returning them
 *
 * @param specifiers - Array of module specifiers to preload
 * @param options - Import options
 */
export async function preloadEsm(
  specifiers: string[],
  options?: EsmImportOptions
): Promise<void> {
  await importEsmBatch(specifiers, options)
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

/**
 * Clear the ESM module cache
 */
export function clearEsmCache(): void {
  moduleCache.clear()
}

/**
 * Get the ESM module cache size
 */
export function getEsmCacheSize(): number {
  return moduleCache.size()
}

/**
 * Create a new isolated cache instance
 */
export function createEsmCache(options?: {
  maxSize?: number
  ttl?: number
}): EsmModuleCache {
  return new EsmModuleCache(options)
}

// ============================================================================
// RE-EXPORT HANDLING
// ============================================================================

/**
 * Get a specific export from a module
 *
 * @param module - ESM module
 * @param exportName - Name of the export (or 'default')
 * @returns The export value
 *
 * @example
 * ```typescript
 * const lodash = await importEsm('lodash-es')
 * const debounce = getExport(lodash, 'debounce')
 * ```
 */
export function getExport<T = unknown>(
  module: EsmModule,
  exportName: string
): T | undefined {
  if (exportName === 'default') {
    return module.default as T
  }
  return module.exports[exportName] as T
}

/**
 * Get all export names from a module
 */
export function getExportNames(module: EsmModule): string[] {
  const names = Object.keys(module.exports)
  if (module.default !== undefined) {
    names.unshift('default')
  }
  return names
}

/**
 * Check if a module has a specific export
 */
export function hasExport(module: EsmModule, exportName: string): boolean {
  if (exportName === 'default') {
    return module.default !== undefined
  }
  return exportName in module.exports
}
