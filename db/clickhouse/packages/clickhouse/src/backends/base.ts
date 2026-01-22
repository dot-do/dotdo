/**
 * Base backend interface and abstract class for ClickHouse backends
 *
 * Provides a unified abstraction that works across:
 * - WASM: In-browser/Node.js WebAssembly-based ClickHouse
 * - Sandbox: Local ClickHouse binary in a sandboxed environment
 * - ClickHouse: Remote ClickHouse server via HTTP
 */

import type { QueryOptions as BaseQueryOptions } from '../types';

/**
 * Extended query options for backends
 */
export interface QueryOptions extends BaseQueryOptions {
  /** Query timeout in milliseconds */
  timeout?: number;
  /** Batch size for streaming queries */
  batchSize?: number;
}

/**
 * Capabilities supported by a backend
 */
export interface BackendCapabilities {
  /** Whether the backend supports streaming responses */
  streaming: boolean;
  /** Whether the backend supports session management */
  sessions: boolean;
  /** Whether the backend supports INSERT operations */
  insert: boolean;
  /** Maximum memory available in bytes (0 = unlimited) */
  maxMemory: number;
  /** List of supported table engines */
  engines: string[];
}

/**
 * Backend type discriminator
 */
export type BackendName = 'wasm' | 'sandbox' | 'clickhouse';

/**
 * Backend interface defining the contract for all backend implementations
 */
export interface Backend {
  /** The backend type identifier */
  readonly name: BackendName;

  /** Capabilities supported by this backend */
  readonly capabilities: BackendCapabilities;

  /**
   * Execute a query and return parsed results
   * @param sql - SQL query to execute
   * @param options - Query options
   * @returns Array of result rows
   */
  query<T>(sql: string, options?: QueryOptions): Promise<T[]>;

  /**
   * Execute a query and return raw response
   * @param sql - SQL query to execute
   * @param options - Query options
   * @returns Raw response as string
   */
  queryRaw(sql: string, options?: QueryOptions): Promise<string>;

  /**
   * Execute a query and return a stream of batched results
   * @param sql - SQL query to execute
   * @param options - Query options
   * @returns Async iterable of result batches
   */
  queryStream<T>(sql: string, options?: QueryOptions): AsyncIterable<T[]>;

  /**
   * Check if the backend is available and responsive
   * @returns True if the backend is ready
   */
  ping?(): Promise<boolean>;

  /**
   * Clean up resources used by the backend
   */
  dispose?(): void;
}

/**
 * Abstract base class for backend implementations
 * Provides common functionality and enforces the Backend interface
 */
export abstract class BaseBackend implements Backend {
  abstract readonly name: BackendName;
  abstract readonly capabilities: BackendCapabilities;

  /**
   * Execute a query and return parsed results
   */
  abstract query<T>(sql: string, options?: QueryOptions): Promise<T[]>;

  /**
   * Execute a query and return raw response
   */
  abstract queryRaw(sql: string, options?: QueryOptions): Promise<string>;

  /**
   * Execute a query and return a stream of batched results
   */
  abstract queryStream<T>(sql: string, options?: QueryOptions): AsyncIterable<T[]>;

  /**
   * Check if the backend is available
   * Default implementation tries a simple query
   */
  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up resources
   * Subclasses should override if they need cleanup
   */
  dispose(): void {
    // Default: no cleanup needed
  }

  /**
   * Parse JSON response into typed results
   * @param raw - Raw JSON string response
   * @returns Parsed data array
   */
  protected parseJsonResponse<T>(raw: string): T[] {
    if (!raw || raw.trim() === '') {
      return [];
    }

    try {
      // Try to parse as ClickHouse JSON format (with data array)
      const json = JSON.parse(raw);
      if (json.data && Array.isArray(json.data)) {
        return json.data as T[];
      }
      // If it's already an array, return it
      if (Array.isArray(json)) {
        return json as T[];
      }
      // Single object result
      return [json as T];
    } catch {
      // Try JSONEachRow format (newline-delimited JSON)
      const lines = raw.trim().split('\n').filter(line => line.length > 0);
      return lines.map(line => JSON.parse(line) as T);
    }
  }

  /**
   * Parse JSONEachRow format response
   * @param raw - Raw JSONEachRow string response
   * @returns Parsed data array
   */
  protected parseJsonEachRow<T>(raw: string): T[] {
    if (!raw || raw.trim() === '') {
      return [];
    }

    const lines = raw.trim().split('\n').filter(line => line.length > 0);
    return lines.map(line => JSON.parse(line) as T);
  }

  /**
   * Create an AbortController with timeout
   * @param timeout - Timeout in milliseconds
   * @param existingSignal - Optional existing AbortSignal to chain
   * @returns AbortController and cleanup function
   */
  protected createTimeoutController(
    timeout?: number,
    existingSignal?: AbortSignal
  ): { controller: AbortController; cleanup: () => void } {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (timeout && timeout > 0) {
      timeoutId = setTimeout(() => controller.abort(), timeout);
    }

    // Chain with existing signal if provided
    if (existingSignal) {
      if (existingSignal.aborted) {
        controller.abort();
      } else {
        existingSignal.addEventListener('abort', () => controller.abort());
      }
    }

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };

    return { controller, cleanup };
  }
}

/**
 * Default capabilities for backends that don't specify their own
 */
export const DEFAULT_CAPABILITIES: BackendCapabilities = {
  streaming: false,
  sessions: false,
  insert: false,
  maxMemory: 0,
  engines: ['Memory'],
};

/**
 * Full capabilities for a complete ClickHouse server
 */
export const FULL_CAPABILITIES: BackendCapabilities = {
  streaming: true,
  sessions: true,
  insert: true,
  maxMemory: 0, // Unlimited
  engines: [
    'MergeTree',
    'ReplacingMergeTree',
    'SummingMergeTree',
    'AggregatingMergeTree',
    'CollapsingMergeTree',
    'VersionedCollapsingMergeTree',
    'Memory',
    'Log',
    'TinyLog',
    'StripeLog',
    'Distributed',
    'Buffer',
    'Null',
    'Set',
    'Join',
    'URL',
    'View',
    'MaterializedView',
    'Dictionary',
    'Merge',
    'File',
    'S3',
    'HDFS',
    'Kafka',
    'RabbitMQ',
  ],
};

/**
 * Limited capabilities for WASM backend
 */
export const WASM_CAPABILITIES: BackendCapabilities = {
  streaming: false,
  sessions: false,
  insert: true,
  maxMemory: 256 * 1024 * 1024, // 256MB default
  engines: ['Memory', 'Log', 'TinyLog', 'StripeLog', 'Null', 'Set', 'Join'],
};

/**
 * Sandbox backend capabilities (full ClickHouse but resource limited)
 */
export const SANDBOX_CAPABILITIES: BackendCapabilities = {
  streaming: true,
  sessions: true,
  insert: true,
  maxMemory: 1024 * 1024 * 1024, // 1GB default
  engines: [
    'MergeTree',
    'ReplacingMergeTree',
    'SummingMergeTree',
    'AggregatingMergeTree',
    'CollapsingMergeTree',
    'Memory',
    'Log',
    'TinyLog',
    'StripeLog',
    'Null',
    'Set',
    'Join',
    'File',
  ],
};
