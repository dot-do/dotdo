/**
 * Unified ClickHouse Client API
 *
 * Provides a single interface for connecting to ClickHouse via multiple backends:
 * - wasm: In-browser/Node.js WebAssembly-based ClickHouse
 * - sandbox: Local ClickHouse binary in a sandboxed environment
 * - clickhouse: Remote ClickHouse server via HTTP
 * - auto: Automatically detect and use the best available backend
 */

import type {
  ClickHouseClient,
  ClickHouseConfig,
  QueryOptions,
  InsertOptions,
  QueryResult,
} from './types';
import { ConnectionError, ClickHouseError } from './types';

/**
 * Available backend types
 */
export type Backend = 'wasm' | 'sandbox' | 'clickhouse' | 'auto';

/**
 * Options for creating a ClickHouse client
 */
export interface CreateClientOptions {
  /** Backend to use. 'auto' will detect the best available backend */
  backend?: Backend;
  /** Priority order for backend selection when using 'auto' */
  backends?: Backend[];

  /** WASM backend configuration */
  wasm?: {
    /** Memory/feature profile */
    profile?: 'minimal' | 'standard' | 'full';
    /** Maximum memory in bytes */
    memoryLimit?: number;
  };

  /** Sandbox backend configuration */
  sandbox?: {
    /** Path to ClickHouse binary */
    binary?: string;
    /** Execution timeout in milliseconds */
    timeout?: number;
  };

  /** Remote ClickHouse server configuration */
  clickhouse?: {
    /** Server host URL */
    host: string;
    /** Authentication username */
    username?: string;
    /** Authentication password */
    password?: string;
    /** Default database */
    database?: string;
  };

  /** Common ClickHouse settings applied to all queries */
  settings?: Record<string, string | number | boolean>;
}

/**
 * Backend availability check result
 */
interface BackendAvailability {
  wasm: boolean;
  sandbox: boolean;
  clickhouse: boolean;
}

/**
 * Check if running in a browser environment
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Check if running in Node.js environment
 */
function isNode(): boolean {
  return typeof process !== 'undefined' &&
         process.versions != null &&
         process.versions.node != null;
}

/**
 * Check availability of each backend
 */
async function checkBackendAvailability(options?: CreateClientOptions): Promise<BackendAvailability> {
  const availability: BackendAvailability = {
    wasm: false,
    sandbox: false,
    clickhouse: false,
  };

  // WASM is available in both browser and Node.js with WebAssembly support
  availability.wasm = typeof WebAssembly !== 'undefined';

  // Sandbox is only available in Node.js
  if (isNode()) {
    availability.sandbox = true;
  }

  // ClickHouse server is available if host is configured
  if (options?.clickhouse?.host) {
    try {
      const pingUrl = new URL('/ping', options.clickhouse.host);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(pingUrl.toString(), {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      availability.clickhouse = response.ok;
    } catch {
      availability.clickhouse = false;
    }
  }

  return availability;
}

/**
 * Select the best available backend based on options and environment
 */
async function selectBackend(options?: CreateClientOptions): Promise<Exclude<Backend, 'auto'>> {
  // If a specific backend is requested (not 'auto'), use it
  if (options?.backend && options.backend !== 'auto') {
    return options.backend;
  }

  const availability = await checkBackendAvailability(options);

  // Use custom priority order if provided
  const priorities = options?.backends ?? ['clickhouse', 'sandbox', 'wasm'];

  for (const backend of priorities) {
    if (backend === 'auto') continue;

    switch (backend) {
      case 'clickhouse':
        if (availability.clickhouse) return 'clickhouse';
        break;
      case 'sandbox':
        if (availability.sandbox) return 'sandbox';
        break;
      case 'wasm':
        if (availability.wasm) return 'wasm';
        break;
    }
  }

  // Fallback logic: prefer based on environment
  if (availability.clickhouse) return 'clickhouse';
  if (isNode() && availability.sandbox) return 'sandbox';
  if (availability.wasm) return 'wasm';

  throw new ConnectionError(
    'No available backend found. Please configure a ClickHouse server, ' +
    'ensure WASM support, or run in a Node.js environment for sandbox support.'
  );
}

/**
 * Create a WASM-based ClickHouse client
 */
async function createWasmClient(options?: CreateClientOptions): Promise<ClickHouseClient> {
  const profile = options?.wasm?.profile ?? 'standard';
  const memoryLimit = options?.wasm?.memoryLimit;
  const settings = options?.settings ?? {};

  // Dynamic import of WASM module (to be implemented)
  // For now, we throw an error indicating it's not yet available
  // In production, this would import from @dotdo/clickhouse-wasm

  // Placeholder implementation
  const client: ClickHouseClient = {
    backend: 'wasm',

    async query<T = unknown>(sql: string, queryOptions?: QueryOptions): Promise<QueryResult<T>> {
      throw new ClickHouseError(
        'WASM backend not yet implemented. Please use "clickhouse" or "sandbox" backend.'
      );
    },

    async queryRaw(sql: string, queryOptions?: QueryOptions): Promise<string | ArrayBuffer> {
      throw new ClickHouseError(
        'WASM backend not yet implemented. Please use "clickhouse" or "sandbox" backend.'
      );
    },

    async *queryStream<T = unknown>(sql: string, queryOptions?: QueryOptions): AsyncIterable<T[]> {
      throw new ClickHouseError(
        'WASM backend not yet implemented. Please use "clickhouse" or "sandbox" backend.'
      );
    },

    async insert<T extends Record<string, unknown>>(
      table: string,
      data: T[],
      insertOptions?: InsertOptions
    ): Promise<void> {
      throw new ClickHouseError(
        'WASM backend not yet implemented. Please use "clickhouse" or "sandbox" backend.'
      );
    },

    async ping(): Promise<boolean> {
      return false;
    },

    async close(): Promise<void> {
      // No cleanup needed for placeholder
    },
  };

  return client;
}

/**
 * Create a sandbox-based ClickHouse client (local binary)
 */
async function createSandboxClient(options?: CreateClientOptions): Promise<ClickHouseClient> {
  const binary = options?.sandbox?.binary ?? 'clickhouse';
  const timeout = options?.sandbox?.timeout ?? 30000;
  const settings = options?.settings ?? {};

  // Placeholder implementation
  // In production, this would spawn a local ClickHouse process
  const client: ClickHouseClient = {
    backend: 'sandbox',

    async query<T = unknown>(sql: string, queryOptions?: QueryOptions): Promise<QueryResult<T>> {
      throw new ClickHouseError(
        'Sandbox backend not yet implemented. Please use "clickhouse" backend.'
      );
    },

    async queryRaw(sql: string, queryOptions?: QueryOptions): Promise<string | ArrayBuffer> {
      throw new ClickHouseError(
        'Sandbox backend not yet implemented. Please use "clickhouse" backend.'
      );
    },

    async *queryStream<T = unknown>(sql: string, queryOptions?: QueryOptions): AsyncIterable<T[]> {
      throw new ClickHouseError(
        'Sandbox backend not yet implemented. Please use "clickhouse" backend.'
      );
    },

    async insert<T extends Record<string, unknown>>(
      table: string,
      data: T[],
      insertOptions?: InsertOptions
    ): Promise<void> {
      throw new ClickHouseError(
        'Sandbox backend not yet implemented. Please use "clickhouse" backend.'
      );
    },

    async ping(): Promise<boolean> {
      return false;
    },

    async close(): Promise<void> {
      // No cleanup needed for placeholder
    },
  };

  return client;
}

/**
 * Create a remote ClickHouse server client
 */
async function createClickHouseClient(options?: CreateClientOptions): Promise<ClickHouseClient> {
  const config = options?.clickhouse;

  if (!config?.host) {
    throw new ConnectionError('ClickHouse host is required for clickhouse backend');
  }

  const host = config.host.replace(/\/$/, ''); // Remove trailing slash
  const username = config.username ?? 'default';
  const password = config.password ?? '';
  const database = config.database ?? 'default';
  const globalSettings = options?.settings ?? {};

  /**
   * Build authentication header
   */
  function getAuthHeader(): string {
    const credentials = btoa(`${username}:${password}`);
    return `Basic ${credentials}`;
  }

  /**
   * Build query URL with parameters
   */
  function buildQueryUrl(settings?: Record<string, string | number | boolean>): URL {
    const url = new URL('/', host);
    url.searchParams.set('database', database);

    // Apply global settings
    for (const [key, value] of Object.entries(globalSettings)) {
      url.searchParams.set(key, String(value));
    }

    // Apply query-specific settings
    if (settings) {
      for (const [key, value] of Object.entries(settings)) {
        url.searchParams.set(key, String(value));
      }
    }

    return url;
  }

  /**
   * Execute a query against the server
   */
  async function executeQuery(
    sql: string,
    queryOptions?: QueryOptions
  ): Promise<Response> {
    const url = buildQueryUrl(queryOptions?.settings);

    // Set format
    const format = queryOptions?.format ?? 'JSON';
    url.searchParams.set('default_format', format);

    // Add query parameters if provided
    if (queryOptions?.params) {
      for (const [key, value] of Object.entries(queryOptions.params)) {
        url.searchParams.set(`param_${key}`, String(value));
      }
    }

    const headers: Record<string, string> = {
      'Authorization': getAuthHeader(),
      'Content-Type': 'text/plain',
    };

    const fetchOptions: RequestInit = {
      method: 'POST',
      headers,
      body: sql,
    };

    if (queryOptions?.signal) {
      fetchOptions.signal = queryOptions.signal;
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new ClickHouseError(`Query failed: ${errorText}`);
    }

    return response;
  }

  const client: ClickHouseClient = {
    backend: 'clickhouse',

    async query<T = unknown>(sql: string, queryOptions?: QueryOptions): Promise<QueryResult<T>> {
      const format = queryOptions?.format ?? 'JSON';
      const response = await executeQuery(sql, { ...queryOptions, format });

      if (format === 'JSON') {
        const json = await response.json() as {
          data: T[];
          rows: number;
          rows_before_limit_at_least?: number;
          statistics?: {
            elapsed: number;
            rows_read: number;
            bytes_read: number;
          };
        };

        return {
          data: json.data,
          rowsRead: json.statistics?.rows_read ?? json.rows ?? 0,
          bytesRead: json.statistics?.bytes_read ?? 0,
          elapsed: json.statistics?.elapsed ?? 0,
        };
      } else if (format === 'JSONEachRow') {
        const text = await response.text();
        const lines = text.trim().split('\n').filter(line => line.length > 0);
        const data = lines.map(line => JSON.parse(line) as T);

        return {
          data,
          rowsRead: data.length,
          bytesRead: text.length,
          elapsed: 0,
        };
      } else {
        // For other formats, return raw data
        const raw = await response.text();
        return {
          data: [] as T[],
          rowsRead: 0,
          bytesRead: raw.length,
          elapsed: 0,
          raw,
        };
      }
    },

    async queryRaw(sql: string, queryOptions?: QueryOptions): Promise<string | ArrayBuffer> {
      const response = await executeQuery(sql, queryOptions);

      const format = queryOptions?.format ?? 'JSON';
      if (format === 'Parquet' || format === 'Arrow' || format === 'Native') {
        return response.arrayBuffer();
      }

      return response.text();
    },

    async *queryStream<T = unknown>(sql: string, queryOptions?: QueryOptions): AsyncIterable<T[]> {
      const format = queryOptions?.format ?? 'JSONEachRow';
      const response = await executeQuery(sql, { ...queryOptions, format });

      if (!response.body) {
        throw new ClickHouseError('Streaming not supported: response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const batchSize = 1000;

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            // Process remaining buffer
            if (buffer.trim().length > 0) {
              const lines = buffer.trim().split('\n').filter(line => line.length > 0);
              if (lines.length > 0) {
                yield lines.map(line => JSON.parse(line) as T);
              }
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');

          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() ?? '';

          // Yield complete lines in batches
          const completeLines = lines.filter(line => line.trim().length > 0);
          for (let i = 0; i < completeLines.length; i += batchSize) {
            const batch = completeLines.slice(i, i + batchSize);
            yield batch.map(line => JSON.parse(line) as T);
          }
        }
      } finally {
        reader.releaseLock();
      }
    },

    async insert<T extends Record<string, unknown>>(
      table: string,
      data: T[],
      insertOptions?: InsertOptions
    ): Promise<void> {
      if (data.length === 0) return;

      const format = insertOptions?.format ?? 'JSONEachRow';
      const url = buildQueryUrl(insertOptions?.settings);
      url.searchParams.set('query', `INSERT INTO ${table} FORMAT ${format}`);

      let body: string;
      if (format === 'JSONEachRow') {
        body = data.map(row => JSON.stringify(row)).join('\n');
      } else if (format === 'CSV') {
        const keys = Object.keys(data[0]);
        const rows = data.map(row => keys.map(k => String(row[k])).join(','));
        body = rows.join('\n');
      } else if (format === 'TSV') {
        const keys = Object.keys(data[0]);
        const rows = data.map(row => keys.map(k => String(row[k])).join('\t'));
        body = rows.join('\n');
      } else {
        body = data.map(row => JSON.stringify(row)).join('\n');
      }

      const headers: Record<string, string> = {
        'Authorization': getAuthHeader(),
        'Content-Type': 'text/plain',
      };

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ClickHouseError(`Insert failed: ${errorText}`);
      }
    },

    async ping(): Promise<boolean> {
      try {
        const url = new URL('/ping', host);
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Authorization': getAuthHeader(),
          },
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    async close(): Promise<void> {
      // HTTP client doesn't need explicit cleanup
    },
  };

  return client;
}

/**
 * Create a unified ClickHouse client
 *
 * @example
 * ```typescript
 * // Auto-detect best backend
 * const client = await createClient();
 *
 * // Use specific backend
 * const wasmClient = await createClient({ backend: 'wasm' });
 *
 * // Connect to remote server
 * const remoteClient = await createClient({
 *   backend: 'clickhouse',
 *   clickhouse: {
 *     host: 'http://localhost:8123',
 *     username: 'default',
 *     password: 'secret',
 *     database: 'my_database'
 *   }
 * });
 *
 * // Query with the client
 * const result = await client.query<{ name: string }>('SELECT name FROM users');
 * console.log(result.data);
 *
 * // Stream large results
 * for await (const batch of client.queryStream('SELECT * FROM big_table')) {
 *   console.log(`Received ${batch.length} rows`);
 * }
 *
 * // Insert data
 * await client.insert('users', [
 *   { name: 'Alice', age: 30 },
 *   { name: 'Bob', age: 25 }
 * ]);
 *
 * // Clean up
 * await client.close();
 * ```
 */
export async function createClient(options?: CreateClientOptions): Promise<ClickHouseClient> {
  const backend = await selectBackend(options);

  switch (backend) {
    case 'wasm':
      return createWasmClient(options);
    case 'sandbox':
      return createSandboxClient(options);
    case 'clickhouse':
      return createClickHouseClient(options);
    default:
      throw new ClickHouseError(`Unknown backend: ${backend}`);
  }
}

/**
 * Convenience export for backend availability checking
 */
export { checkBackendAvailability };

/**
 * Re-export types for convenience
 */
export type {
  ClickHouseClient,
  ClickHouseConfig,
  QueryOptions,
  InsertOptions,
  QueryResult,
} from './types';
