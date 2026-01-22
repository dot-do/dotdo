/**
 * JIT (Just-In-Time) WASM Module Loader
 *
 * This module provides on-demand loading of WASM modules based on query requirements.
 * It implements a 3-tier caching strategy for optimal performance:
 *
 * 1. In-Memory Cache - Instant access, lost on cold start
 * 2. KV Cache - 1-5ms latency, 25MB value limit, good for metadata
 * 3. R2 Fallback - 10-50ms latency, unlimited size, stores WASM binaries
 *
 * Note: This is NOT true JIT compilation (which is not supported in Workers).
 * Instead, it's "Just-In-Time Loading" of pre-compiled WASM modules.
 *
 * @module jit-loader
 */

import { detectRequiredExtensions, parseExtensionFunctions, getExtensionForFunction } from './extension-auto-detect';

// ============================================================================
// Types
// ============================================================================

/**
 * R2Bucket interface (subset of Cloudflare R2Bucket)
 */
interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  head(key: string): Promise<{ size: number; etag?: string } | null>;
}

/**
 * R2Object interface (subset of Cloudflare R2Object)
 */
interface R2Object {
  readonly key: string;
  readonly size: number;
  readonly etag?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  body?: ReadableStream<Uint8Array>;
}

/**
 * KVNamespace interface (subset of Cloudflare KVNamespace)
 */
interface KVNamespace {
  get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<unknown>;
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  get(key: string, options: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Fetcher interface for Static Assets
 */
interface Fetcher {
  fetch(input: Request | string): Promise<Response>;
}

/**
 * Module metadata stored in KV cache
 */
export interface ModuleMetadata {
  /** Module name */
  name: string;
  /** Module version */
  version: string;
  /** Module size in bytes */
  size: number;
  /** Functions provided by this module */
  functions: string[];
  /** Dependencies on other modules */
  dependencies: string[];
  /** R2 key for the WASM binary */
  r2Key: string;
  /** SHA-256 hash of the WASM binary for validation */
  hash: string;
  /** Timestamp when metadata was last updated */
  updatedAt: number;
}

/**
 * Configuration options for JitLoader
 */
export interface JitLoaderConfig {
  /** R2 bucket for WASM storage */
  r2Bucket?: R2Bucket;
  /** KV namespace for metadata and small modules */
  kvNamespace?: KVNamespace;
  /** Static assets binding */
  assets?: Fetcher;
  /** Path prefix for R2 keys (default: 'wasm/') */
  r2Prefix?: string;
  /** Path prefix for static assets (default: '/extensions') */
  assetsPath?: string;
  /** TTL for KV cache entries in seconds (default: 3600) */
  kvTtl?: number;
  /** Enable verbose logging */
  debug?: boolean;
}

/**
 * Status of a loaded module
 */
export interface ModuleStatus {
  /** Module name */
  name: string;
  /** Whether the module is currently loaded */
  loaded: boolean;
  /** Size of the module in bytes */
  size?: number;
  /** When the module was loaded */
  loadedAt?: number;
  /** Source from which the module was loaded */
  source?: 'memory' | 'kv' | 'r2' | 'assets';
}

/**
 * Result of loading modules
 */
export interface LoadModulesResult {
  /** Modules that were successfully loaded */
  loaded: string[];
  /** Modules that were already cached */
  cached: string[];
  /** Modules that failed to load */
  failed: Array<{ name: string; error: string }>;
  /** Total time taken in milliseconds */
  totalTimeMs: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Number of modules in memory cache */
  memoryEntries: number;
  /** Total size of modules in memory cache */
  memorySize: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Hit rate percentage */
  hitRate: number;
}

// ============================================================================
// JitLoader Class
// ============================================================================

/**
 * JitLoader - Just-In-Time WASM Module Loader
 *
 * Loads WASM modules on demand based on query requirements using a 3-tier
 * caching strategy for optimal performance in Cloudflare Workers.
 *
 * @example
 * ```typescript
 * const loader = new JitLoader({
 *   r2Bucket: env.WASM_BUCKET,
 *   kvNamespace: env.WASM_KV,
 *   assets: env.ASSETS,
 * });
 *
 * // Analyze query and load required modules
 * const required = loader.analyzeQuery('SELECT h3ToGeo(cell) FROM data');
 * await loader.loadModules(required);
 *
 * // Check if module is loaded
 * if (loader.isModuleLoaded('ext-geo')) {
 *   const module = loader.getModule('ext-geo');
 * }
 * ```
 */
export class JitLoader {
  private config: JitLoaderConfig;

  // Tier 1: In-memory cache (fastest)
  private memoryCache: Map<string, WebAssembly.Module> = new Map();
  private memorySizes: Map<string, number> = new Map();
  private loadedAt: Map<string, number> = new Map();
  private loadSource: Map<string, 'memory' | 'kv' | 'r2' | 'assets'> = new Map();

  // Module metadata cache
  private metadataCache: Map<string, ModuleMetadata> = new Map();

  // Cache statistics
  private cacheHits = 0;
  private cacheMisses = 0;

  // Default configuration
  private static readonly DEFAULT_R2_PREFIX = 'wasm/';
  private static readonly DEFAULT_ASSETS_PATH = '/extensions';
  private static readonly DEFAULT_KV_TTL = 3600; // 1 hour

  constructor(config: JitLoaderConfig = {}) {
    this.config = {
      r2Prefix: JitLoader.DEFAULT_R2_PREFIX,
      assetsPath: JitLoader.DEFAULT_ASSETS_PATH,
      kvTtl: JitLoader.DEFAULT_KV_TTL,
      ...config,
    };
  }

  // ==========================================================================
  // Query Analysis
  // ==========================================================================

  /**
   * Analyze a SQL query to determine required WASM modules
   *
   * Uses the extension-auto-detect module to parse the query and identify
   * functions that require extension modules.
   *
   * @param sql - The SQL query to analyze
   * @returns Array of module names required for the query
   *
   * @example
   * ```typescript
   * const modules = loader.analyzeQuery('SELECT h3ToGeo(cell), sha256(data) FROM t');
   * // Returns: ['ext-geo', 'ext-crypto']
   * ```
   */
  analyzeQuery(sql: string): string[] {
    if (!sql || sql.trim().length === 0) {
      return [];
    }

    // Use the existing extension detection logic
    const requiredExtensions = detectRequiredExtensions(sql);

    this.log(`Analyzed query, required modules: [${requiredExtensions.join(', ')}]`);

    return requiredExtensions;
  }

  /**
   * Get the functions detected in a SQL query
   *
   * @param sql - The SQL query to analyze
   * @returns Array of function names found in the query
   */
  getQueryFunctions(sql: string): string[] {
    return parseExtensionFunctions(sql);
  }

  /**
   * Get the extension that provides a specific function
   *
   * @param functionName - Name of the function
   * @returns Extension name or null if it's a core function
   */
  getExtensionForFunction(functionName: string): string | null {
    return getExtensionForFunction(functionName);
  }

  // ==========================================================================
  // Module Loading
  // ==========================================================================

  /**
   * Load required WASM modules using the 3-tier cache hierarchy
   *
   * Loading order:
   * 1. Check in-memory cache
   * 2. Check KV cache (if available)
   * 3. Fetch from R2 bucket (if available)
   * 4. Fetch from static assets (if available)
   *
   * @param moduleNames - Array of module names to load
   * @returns Result object with loaded, cached, and failed modules
   *
   * @example
   * ```typescript
   * const result = await loader.loadModules(['ext-geo', 'ext-crypto']);
   * console.log(`Loaded: ${result.loaded.length}, Cached: ${result.cached.length}`);
   * ```
   */
  async loadModules(moduleNames: string[]): Promise<LoadModulesResult> {
    const startTime = performance.now();
    const result: LoadModulesResult = {
      loaded: [],
      cached: [],
      failed: [],
      totalTimeMs: 0,
    };

    // Filter out already loaded modules
    const modulesToLoad: string[] = [];
    for (const name of moduleNames) {
      const normalizedName = this.normalizeName(name);
      if (this.memoryCache.has(normalizedName)) {
        result.cached.push(normalizedName);
        this.cacheHits++;
      } else {
        modulesToLoad.push(normalizedName);
        this.cacheMisses++;
      }
    }

    // Load modules in parallel
    const loadPromises = modulesToLoad.map(async (name) => {
      try {
        await this.loadModule(name);
        result.loaded.push(name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.failed.push({ name, error: message });
        this.log(`Failed to load module '${name}': ${message}`);
      }
    });

    await Promise.all(loadPromises);

    result.totalTimeMs = performance.now() - startTime;
    this.log(`Loaded ${result.loaded.length} modules, ${result.cached.length} cached, ${result.failed.length} failed in ${result.totalTimeMs.toFixed(2)}ms`);

    return result;
  }

  /**
   * Load a single module from the cache hierarchy
   */
  private async loadModule(name: string): Promise<void> {
    const normalizedName = this.normalizeName(name);

    // Tier 1: Check memory cache
    if (this.memoryCache.has(normalizedName)) {
      this.log(`Module '${normalizedName}' found in memory cache`);
      return;
    }

    // Tier 2: Check KV cache
    if (this.config.kvNamespace) {
      const kvModule = await this.loadFromKV(normalizedName);
      if (kvModule) {
        this.memoryCache.set(normalizedName, kvModule.module);
        this.memorySizes.set(normalizedName, kvModule.size);
        this.loadedAt.set(normalizedName, Date.now());
        this.loadSource.set(normalizedName, 'kv');
        this.log(`Module '${normalizedName}' loaded from KV cache`);
        return;
      }
    }

    // Tier 3: Load from R2 bucket
    if (this.config.r2Bucket) {
      const r2Module = await this.loadFromR2(normalizedName);
      if (r2Module) {
        this.memoryCache.set(normalizedName, r2Module.module);
        this.memorySizes.set(normalizedName, r2Module.size);
        this.loadedAt.set(normalizedName, Date.now());
        this.loadSource.set(normalizedName, 'r2');

        // Cache in KV for future requests
        if (this.config.kvNamespace) {
          await this.cacheInKV(normalizedName, r2Module.binary).catch((e) => {
            this.log(`Warning: Failed to cache module '${normalizedName}' in KV: ${e}`);
          });
        }

        this.log(`Module '${normalizedName}' loaded from R2`);
        return;
      }
    }

    // Tier 4: Load from static assets
    if (this.config.assets) {
      const assetsModule = await this.loadFromAssets(normalizedName);
      if (assetsModule) {
        this.memoryCache.set(normalizedName, assetsModule.module);
        this.memorySizes.set(normalizedName, assetsModule.size);
        this.loadedAt.set(normalizedName, Date.now());
        this.loadSource.set(normalizedName, 'assets');
        this.log(`Module '${normalizedName}' loaded from static assets`);
        return;
      }
    }

    throw new Error(`Module '${normalizedName}' not found in any source (KV, R2, or Assets)`);
  }

  /**
   * Load module from KV cache
   */
  private async loadFromKV(name: string): Promise<{ module: WebAssembly.Module; size: number } | null> {
    if (!this.config.kvNamespace) return null;

    try {
      const kvKey = `module:${name}:wasm`;
      const buffer = await this.config.kvNamespace.get(kvKey, { type: 'arrayBuffer' });

      if (!buffer) return null;

      const module = await WebAssembly.compile(buffer);
      return { module, size: buffer.byteLength };
    } catch (error) {
      this.log(`KV load failed for '${name}': ${error}`);
      return null;
    }
  }

  /**
   * Load module from R2 bucket
   */
  private async loadFromR2(name: string): Promise<{ module: WebAssembly.Module; size: number; binary: ArrayBuffer } | null> {
    if (!this.config.r2Bucket) return null;

    try {
      const r2Key = `${this.config.r2Prefix}${name}.wasm`;
      const r2Object = await this.config.r2Bucket.get(r2Key);

      if (!r2Object) return null;

      const binary = await r2Object.arrayBuffer();
      const module = await WebAssembly.compile(binary);

      return { module, size: binary.byteLength, binary };
    } catch (error) {
      this.log(`R2 load failed for '${name}': ${error}`);
      return null;
    }
  }

  /**
   * Load module from static assets
   */
  private async loadFromAssets(name: string): Promise<{ module: WebAssembly.Module; size: number } | null> {
    if (!this.config.assets) return null;

    try {
      const assetPath = `${this.config.assetsPath}/${name}.wasm`;
      const response = await this.config.assets.fetch(
        new Request(`https://placeholder${assetPath}`)
      );

      if (!response.ok) return null;

      const binary = await response.arrayBuffer();
      const module = await WebAssembly.compile(binary);

      return { module, size: binary.byteLength };
    } catch (error) {
      this.log(`Assets load failed for '${name}': ${error}`);
      return null;
    }
  }

  /**
   * Cache a module binary in KV
   */
  private async cacheInKV(name: string, binary: ArrayBuffer): Promise<void> {
    if (!this.config.kvNamespace) return;

    const kvKey = `module:${name}:wasm`;
    await this.config.kvNamespace.put(kvKey, binary, {
      expirationTtl: this.config.kvTtl,
    });
  }

  // ==========================================================================
  // Module Status and Retrieval
  // ==========================================================================

  /**
   * Check if a module is currently loaded in memory
   *
   * @param name - Module name to check
   * @returns True if the module is loaded
   */
  isModuleLoaded(name: string): boolean {
    return this.memoryCache.has(this.normalizeName(name));
  }

  /**
   * Get a loaded module by name
   *
   * @param name - Module name to retrieve
   * @returns The WebAssembly.Module or null if not loaded
   */
  getModule(name: string): WebAssembly.Module | null {
    return this.memoryCache.get(this.normalizeName(name)) ?? null;
  }

  /**
   * Get the status of a specific module
   *
   * @param name - Module name
   * @returns Module status or null if not found
   */
  getModuleStatus(name: string): ModuleStatus | null {
    const normalizedName = this.normalizeName(name);
    const loaded = this.memoryCache.has(normalizedName);

    if (!loaded) {
      return { name: normalizedName, loaded: false };
    }

    return {
      name: normalizedName,
      loaded: true,
      size: this.memorySizes.get(normalizedName),
      loadedAt: this.loadedAt.get(normalizedName),
      source: this.loadSource.get(normalizedName),
    };
  }

  /**
   * Get status of all loaded modules
   *
   * @returns Array of module statuses
   */
  getAllModuleStatus(): ModuleStatus[] {
    const statuses: ModuleStatus[] = [];

    for (const name of this.memoryCache.keys()) {
      const status = this.getModuleStatus(name);
      if (status) {
        statuses.push(status);
      }
    }

    return statuses;
  }

  /**
   * List all loaded module names
   *
   * @returns Array of module names
   */
  listLoadedModules(): string[] {
    return Array.from(this.memoryCache.keys());
  }

  // ==========================================================================
  // Metadata Management
  // ==========================================================================

  /**
   * Get module metadata (from cache or KV)
   *
   * @param name - Module name
   * @returns Module metadata or null if not found
   */
  async getModuleMetadata(name: string): Promise<ModuleMetadata | null> {
    const normalizedName = this.normalizeName(name);

    // Check local metadata cache
    if (this.metadataCache.has(normalizedName)) {
      return this.metadataCache.get(normalizedName)!;
    }

    // Try KV if available
    if (this.config.kvNamespace) {
      try {
        const kvKey = `module:${normalizedName}:meta`;
        const metadata = await this.config.kvNamespace.get(kvKey, { type: 'json' }) as ModuleMetadata | null;

        if (metadata) {
          this.metadataCache.set(normalizedName, metadata);
          return metadata;
        }
      } catch {
        // Metadata not found in KV
      }
    }

    return null;
  }

  /**
   * Set module metadata
   *
   * @param name - Module name
   * @param metadata - Metadata to store
   */
  async setModuleMetadata(name: string, metadata: Omit<ModuleMetadata, 'name' | 'updatedAt'>): Promise<void> {
    const normalizedName = this.normalizeName(name);
    const fullMetadata: ModuleMetadata = {
      ...metadata,
      name: normalizedName,
      updatedAt: Date.now(),
    };

    // Update local cache
    this.metadataCache.set(normalizedName, fullMetadata);

    // Persist to KV if available
    if (this.config.kvNamespace) {
      const kvKey = `module:${normalizedName}:meta`;
      await this.config.kvNamespace.put(kvKey, JSON.stringify(fullMetadata), {
        expirationTtl: this.config.kvTtl,
      });
    }
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Get cache statistics
   *
   * @returns Cache statistics object
   */
  getCacheStats(): CacheStats {
    let totalSize = 0;
    for (const size of this.memorySizes.values()) {
      totalSize += size;
    }

    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0 ? (this.cacheHits / totalRequests) * 100 : 0;

    return {
      memoryEntries: this.memoryCache.size,
      memorySize: totalSize,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate,
    };
  }

  /**
   * Unload a specific module from memory cache
   *
   * @param name - Module name to unload
   * @returns True if the module was unloaded
   */
  unloadModule(name: string): boolean {
    const normalizedName = this.normalizeName(name);

    if (!this.memoryCache.has(normalizedName)) {
      return false;
    }

    this.memoryCache.delete(normalizedName);
    this.memorySizes.delete(normalizedName);
    this.loadedAt.delete(normalizedName);
    this.loadSource.delete(normalizedName);

    this.log(`Module '${normalizedName}' unloaded from memory`);
    return true;
  }

  /**
   * Clear all in-memory caches
   */
  clearMemoryCache(): void {
    this.memoryCache.clear();
    this.memorySizes.clear();
    this.loadedAt.clear();
    this.loadSource.clear();
    this.metadataCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;

    this.log('Memory cache cleared');
  }

  /**
   * Clear KV cache for a specific module
   *
   * @param name - Module name to clear from KV
   */
  async clearKVCache(name: string): Promise<void> {
    if (!this.config.kvNamespace) return;

    const normalizedName = this.normalizeName(name);
    const wasmKey = `module:${normalizedName}:wasm`;
    const metaKey = `module:${normalizedName}:meta`;

    await Promise.all([
      this.config.kvNamespace.delete(wasmKey),
      this.config.kvNamespace.delete(metaKey),
    ]);

    this.log(`KV cache cleared for module '${normalizedName}'`);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Normalize a module name
   */
  private normalizeName(name: string): string {
    // Remove .wasm extension if present
    let normalized = name.replace(/\.wasm$/, '');

    // Ensure ext- prefix for extension modules
    if (!normalized.startsWith('ext-') && !normalized.includes('/')) {
      // This might be a short name like 'geo' instead of 'ext-geo'
      // We keep it as-is to support both naming conventions
    }

    return normalized.toLowerCase();
  }

  /**
   * Log a debug message
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[JitLoader] ${message}`);
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a JitLoader instance with the given configuration
 *
 * @param config - Configuration options
 * @returns A new JitLoader instance
 */
export function createJitLoader(config: JitLoaderConfig = {}): JitLoader {
  return new JitLoader(config);
}

/**
 * Analyze a query and load required modules in one call
 *
 * @param loader - JitLoader instance
 * @param sql - SQL query to analyze and prepare
 * @returns Result of loading modules
 *
 * @example
 * ```typescript
 * const loader = createJitLoader({ r2Bucket: env.WASM_BUCKET });
 * const result = await prepareQuery(loader, 'SELECT h3ToGeo(cell) FROM data');
 * ```
 */
export async function prepareQuery(loader: JitLoader, sql: string): Promise<LoadModulesResult> {
  const requiredModules = loader.analyzeQuery(sql);
  return loader.loadModules(requiredModules);
}
