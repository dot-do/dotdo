/**
 * Dynamic Query Executor Module
 *
 * This module provides a query executor that automatically detects and loads
 * required WASM extensions based on SQL query analysis. Extensions are loaded
 * dynamically as SIDE_MODULEs that share memory with the core MAIN_MODULE.
 *
 * Features:
 * - Automatic extension detection from SQL
 * - Parallel loading of multiple extensions
 * - Extension caching to avoid redundant loads
 * - Error handling for missing extensions
 * - Query execution with loaded extensions
 */

import { ExtensionLoader, type LoadedExtension, type ExtensionMemoryStats } from '../extension-loader';
import { detectRequiredExtensions } from '../extension-auto-detect';

/**
 * Query result returned by the executor
 */
export interface QueryResult {
  /** Query result data rows */
  data: unknown[];
  /** Column metadata */
  meta: Array<{ name: string; type: string }>;
  /** Number of rows returned */
  rows: number;
  /** Query statistics */
  statistics: {
    elapsed: number;
    rows_read: number;
    bytes_read: number;
  };
  /** Extensions used for this query */
  extensions: {
    required: string[];
    loaded: string[];
    loadTime: number;
  };
}

/**
 * Options for query execution
 */
export interface QueryOptions {
  /** Output format (JSON, CSV, TSV, etc.) */
  format?: string;
  /** Maximum rows to return */
  limit?: number;
  /** Query timeout in milliseconds */
  timeout?: number;
  /** Skip extension auto-loading */
  skipExtensionLoad?: boolean;
}

/**
 * Extension load result
 */
export interface ExtensionLoadResult {
  name: string;
  success: boolean;
  error?: string;
  loadTime: number;
}

/**
 * Core module interface for SQL execution
 */
export interface CoreModule {
  /**
   * Execute a SQL query
   * @param sql - SQL query string
   * @param format - Output format
   * @returns Query result as string
   */
  execute(sql: string, format?: string): Promise<string>;

  /**
   * Check if the core module is initialized
   */
  isInitialized(): boolean;
}

/**
 * DynamicQueryExecutor - Executes SQL queries with automatic extension loading
 *
 * Usage:
 * ```typescript
 * const executor = new DynamicQueryExecutor(coreModule, extensionLoader);
 *
 * // Query with automatic extension loading
 * const result = await executor.execute('SELECT h3ToGeo(0x8928308280fffff) AS geo');
 * // ext-geo is automatically loaded before execution
 *
 * // Check loaded extensions
 * console.log(executor.getLoadedExtensions()); // ['ext-geo']
 * ```
 */
export class DynamicQueryExecutor {
  private coreModule: CoreModule;
  private loader: ExtensionLoader;
  private executionCount: number = 0;
  private totalExtensionLoadTime: number = 0;
  private loadedExtensionsCache: Set<string> = new Set();

  /**
   * Create a new DynamicQueryExecutor
   * @param coreModule - The core WASM module for SQL execution
   * @param loader - Extension loader for loading SIDE_MODULEs
   */
  constructor(coreModule: CoreModule, loader: ExtensionLoader) {
    this.coreModule = coreModule;
    this.loader = loader;
  }

  /**
   * Execute a SQL query with automatic extension loading
   *
   * The executor will:
   * 1. Parse the SQL to detect required extensions
   * 2. Load any missing extensions in parallel
   * 3. Execute the query against the core module
   * 4. Return the result with extension metadata
   *
   * @param sql - SQL query to execute
   * @param options - Execution options
   * @returns Query result
   */
  async execute(sql: string, options: QueryOptions = {}): Promise<QueryResult> {
    const startTime = performance.now();
    let extensionLoadTime = 0;

    // 1. Detect required extensions from SQL
    const requiredExtensions = options.skipExtensionLoad
      ? []
      : detectRequiredExtensions(sql);

    // 2. Load missing extensions in parallel
    if (requiredExtensions.length > 0) {
      const loadStartTime = performance.now();
      const loadResults = await this.loadExtensions(requiredExtensions);
      extensionLoadTime = performance.now() - loadStartTime;
      this.totalExtensionLoadTime += extensionLoadTime;

      // Check for load failures
      const failures = loadResults.filter(r => !r.success);
      if (failures.length > 0) {
        const errorMessages = failures
          .map(f => `${f.name}: ${f.error}`)
          .join('; ');
        throw new Error(`Failed to load required extensions: ${errorMessages}`);
      }

      // Update cache
      for (const result of loadResults) {
        if (result.success) {
          this.loadedExtensionsCache.add(result.name);
        }
      }
    }

    // 3. Execute query via real WASM
    const queryStartTime = performance.now();

    if (!this.coreModule.isInitialized()) {
      throw new Error('Core WASM module not initialized. Cannot execute query.');
    }

    const resultString = await this.coreModule.execute(sql, options.format || 'JSON');

    const _queryTime = performance.now() - queryStartTime;
    void _queryTime; // Reserved for detailed query timing metrics
    const totalTime = performance.now() - startTime;

    // 4. Parse and return result
    this.executionCount++;

    try {
      const parsed = JSON.parse(resultString) as {
        data?: unknown[];
        meta?: Array<{ name: string; type: string }>;
        rows?: number;
        statistics?: { elapsed?: number; rows_read?: number; bytes_read?: number };
      };

      return {
        data: parsed.data || [],
        meta: parsed.meta || [],
        rows: parsed.rows || (parsed.data?.length ?? 0),
        statistics: {
          elapsed: totalTime / 1000,
          rows_read: parsed.statistics?.rows_read || 0,
          bytes_read: parsed.statistics?.bytes_read || 0,
        },
        extensions: {
          required: requiredExtensions,
          loaded: Array.from(this.loadedExtensionsCache),
          loadTime: extensionLoadTime,
        },
      };
    } catch {
      // If JSON parsing fails, return a minimal result
      return {
        data: [{ result: resultString }],
        meta: [{ name: 'result', type: 'String' }],
        rows: 1,
        statistics: {
          elapsed: totalTime / 1000,
          rows_read: 1,
          bytes_read: resultString.length,
        },
        extensions: {
          required: requiredExtensions,
          loaded: Array.from(this.loadedExtensionsCache),
          loadTime: extensionLoadTime,
        },
      };
    }
  }

  /**
   * Load multiple extensions in parallel
   * @param extensionNames - Names of extensions to load
   * @returns Array of load results
   */
  async loadExtensions(extensionNames: string[]): Promise<ExtensionLoadResult[]> {
    const loadPromises = extensionNames.map(async (name): Promise<ExtensionLoadResult> => {
      // Skip if already loaded
      if (this.loader.isLoaded(name)) {
        return {
          name,
          success: true,
          loadTime: 0,
        };
      }

      const startTime = performance.now();

      try {
        await this.loader.load(name);
        return {
          name,
          success: true,
          loadTime: performance.now() - startTime,
        };
      } catch (error) {
        return {
          name,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          loadTime: performance.now() - startTime,
        };
      }
    });

    return Promise.all(loadPromises);
  }

  /**
   * Preload specific extensions without executing a query
   * Useful for warming up extensions that will be needed soon
   *
   * @param extensionNames - Names of extensions to preload
   * @returns Array of load results
   */
  async preloadExtensions(extensionNames: string[]): Promise<ExtensionLoadResult[]> {
    return this.loadExtensions(extensionNames);
  }

  /**
   * Get list of currently loaded extensions
   */
  getLoadedExtensions(): string[] {
    return this.loader.listLoaded();
  }

  /**
   * Get a specific loaded extension
   * @param name - Extension name
   * @returns Loaded extension or undefined
   */
  getExtension(name: string): LoadedExtension | undefined {
    return this.loader.getRegistry().get(name);
  }

  /**
   * Check if an extension is loaded
   * @param name - Extension name
   */
  isExtensionLoaded(name: string): boolean {
    return this.loader.isLoaded(name);
  }

  /**
   * Get memory statistics for loaded extensions
   */
  getMemoryStats(): ExtensionMemoryStats {
    return this.loader.getMemoryStats();
  }

  /**
   * Get execution statistics
   */
  getExecutionStats(): {
    executionCount: number;
    totalExtensionLoadTime: number;
    loadedExtensionCount: number;
  } {
    return {
      executionCount: this.executionCount,
      totalExtensionLoadTime: this.totalExtensionLoadTime,
      loadedExtensionCount: this.loadedExtensionsCache.size,
    };
  }

  /**
   * Unload a specific extension
   * @param name - Extension name to unload
   */
  async unloadExtension(name: string): Promise<void> {
    await this.loader.unload(name);
    this.loadedExtensionsCache.delete(name);
  }

  /**
   * Unload all extensions and reset state
   */
  async reset(): Promise<void> {
    await this.loader.unloadAll();
    this.loadedExtensionsCache.clear();
    this.executionCount = 0;
    this.totalExtensionLoadTime = 0;
  }

}
