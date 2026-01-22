/**
 * WASM Backend Implementation
 *
 * Provides a ClickHouse backend running entirely in WebAssembly.
 * This enables ClickHouse queries in browsers and Node.js without
 * requiring a server connection.
 */

import {
  BaseBackend,
  BackendCapabilities,
  QueryOptions,
  WASM_CAPABILITIES,
} from './base';
import { ClickHouseError, TimeoutError } from '../types';

/**
 * Configuration options for the WASM backend
 */
export interface WasmBackendConfig {
  /** Memory/feature profile: minimal, standard, or full */
  profile?: 'minimal' | 'standard' | 'full';
  /** Maximum memory in bytes (default: 256MB) */
  memoryLimit?: number;
  /** Path to WASM module (for custom builds) */
  wasmPath?: string;
  /** Initial database to use */
  database?: string;
}

/**
 * Memory limits for different profiles
 */
const PROFILE_MEMORY_LIMITS: Record<string, number> = {
  minimal: 64 * 1024 * 1024,    // 64MB
  standard: 256 * 1024 * 1024,  // 256MB
  full: 512 * 1024 * 1024,      // 512MB
};

/**
 * Engines available per profile
 */
const PROFILE_ENGINES: Record<string, string[]> = {
  minimal: ['Memory', 'Null'],
  standard: ['Memory', 'Log', 'TinyLog', 'Null', 'Set'],
  full: ['Memory', 'Log', 'TinyLog', 'StripeLog', 'Null', 'Set', 'Join'],
};

/**
 * Interface for the WASM module instance
 * This will be provided by @dotdo/clickhouse-wasm package
 */
interface WasmInstance {
  query(sql: string, format?: string): Promise<string>;
  execute(sql: string): Promise<void>;
  init(config?: { database?: string }): Promise<void>;
  dispose(): void;
}

/**
 * WASM Backend implementation
 */
export class WasmBackend extends BaseBackend {
  readonly name = 'wasm' as const;
  readonly capabilities: BackendCapabilities;

  private config: WasmBackendConfig;
  private instance: WasmInstance | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(config: WasmBackendConfig = {}) {
    super();
    this.config = config;

    const profile = config.profile ?? 'standard';
    const memoryLimit = config.memoryLimit ?? PROFILE_MEMORY_LIMITS[profile];
    const engines = PROFILE_ENGINES[profile] ?? PROFILE_ENGINES.standard;

    this.capabilities = {
      ...WASM_CAPABILITIES,
      maxMemory: memoryLimit,
      engines,
    };
  }

  /**
   * Initialize the WASM instance
   */
  private async ensureInitialized(): Promise<WasmInstance> {
    if (this.instance) {
      return this.instance;
    }

    if (this.initPromise) {
      await this.initPromise;
      return this.instance!;
    }

    this.initPromise = this.initialize();
    await this.initPromise;
    return this.instance!;
  }

  /**
   * Initialize the WASM module
   */
  private async initialize(): Promise<void> {
    try {
      // Attempt to dynamically import the WASM module
      // This will be provided by @dotdo/clickhouse-wasm package
      let wasmModule: { createInstance: (config?: WasmBackendConfig) => Promise<WasmInstance> };

      try {
        // Try to import the WASM package
        wasmModule = await import('@anthropic/clickhouse-wasm');
      } catch {
        // If the package isn't available, throw a helpful error
        throw new ClickHouseError(
          'WASM backend requires @anthropic/clickhouse-wasm package. ' +
          'Install it with: npm install @anthropic/clickhouse-wasm'
        );
      }

      // Create the WASM instance
      this.instance = await wasmModule.createInstance(this.config);

      // Initialize with database if specified
      if (this.config.database) {
        await this.instance.init({ database: this.config.database });
      }
    } catch (error) {
      this.initPromise = null;
      if (error instanceof ClickHouseError) {
        throw error;
      }
      throw new ClickHouseError(
        `Failed to initialize WASM backend: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Execute a query and return parsed results
   */
  async query<T>(sql: string, options?: QueryOptions): Promise<T[]> {
    const instance = await this.ensureInitialized();

    const { controller, cleanup } = this.createTimeoutController(
      options?.timeout,
      options?.signal
    );

    try {
      // Check if aborted before starting
      if (controller.signal.aborted) {
        throw new TimeoutError('Query aborted');
      }

      const format = options?.format ?? 'JSONEachRow';
      const raw = await instance.query(sql, format);

      // Check if aborted after query
      if (controller.signal.aborted) {
        throw new TimeoutError('Query aborted');
      }

      return this.parseJsonEachRow<T>(raw);
    } finally {
      cleanup();
    }
  }

  /**
   * Execute a query and return raw response
   */
  async queryRaw(sql: string, options?: QueryOptions): Promise<string> {
    const instance = await this.ensureInitialized();

    const { controller, cleanup } = this.createTimeoutController(
      options?.timeout,
      options?.signal
    );

    try {
      if (controller.signal.aborted) {
        throw new TimeoutError('Query aborted');
      }

      const format = options?.format ?? 'TabSeparated';
      return await instance.query(sql, format);
    } finally {
      cleanup();
    }
  }

  /**
   * Execute a query and return a stream of batched results
   * Note: WASM backend doesn't support true streaming, so we simulate it
   */
  async *queryStream<T>(sql: string, options?: QueryOptions): AsyncIterable<T[]> {
    const instance = await this.ensureInitialized();

    const { controller, cleanup } = this.createTimeoutController(
      options?.timeout,
      options?.signal
    );

    try {
      if (controller.signal.aborted) {
        throw new TimeoutError('Query aborted');
      }

      // WASM doesn't support true streaming, so we fetch all and batch
      const raw = await instance.query(sql, 'JSONEachRow');
      const allResults = this.parseJsonEachRow<T>(raw);

      const batchSize = options?.batchSize ?? 1000;

      // Yield results in batches
      for (let i = 0; i < allResults.length; i += batchSize) {
        if (controller.signal.aborted) {
          throw new TimeoutError('Query aborted');
        }
        yield allResults.slice(i, i + batchSize);
      }
    } finally {
      cleanup();
    }
  }

  /**
   * Check if the WASM backend is available
   */
  async ping(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      const result = await this.query<{ result: number }>('SELECT 1 AS result');
      return result.length === 1 && result[0].result === 1;
    } catch {
      return false;
    }
  }

  /**
   * Clean up WASM resources
   */
  dispose(): void {
    if (this.instance) {
      this.instance.dispose();
      this.instance = null;
    }
    this.initPromise = null;
  }
}

/**
 * Create a new WASM backend instance
 */
export function createWasmBackend(config?: WasmBackendConfig): WasmBackend {
  return new WasmBackend(config);
}

/**
 * Check if WASM is supported in the current environment
 */
export function isWasmSupported(): boolean {
  return typeof WebAssembly !== 'undefined' &&
         typeof WebAssembly.instantiate === 'function';
}
