/**
 * WASM backend for @dotdo/chdb
 *
 * Uses @dotdo/chdb-wasm for running ClickHouse queries in WebAssembly.
 * Supports multiple profiles for different use cases:
 * - minimal: Smallest bundle, basic SQL operations
 * - standard: Balanced size and features (default)
 * - full: All ClickHouse features
 */

import type { ChdbClient, QueryOptions, QueryResult, Session } from '../types';
import { ChdbError, QueryError } from '../types';

/**
 * Configuration for the WASM backend
 */
export interface WasmConfig {
  /** WASM profile to use (default: 'standard') */
  profile?: 'minimal' | 'standard' | 'full';
  /** Maximum memory limit in bytes */
  memoryLimit?: number;
  /** Enable debug logging */
  logging?: boolean;
  /** Custom initialization options */
  initOptions?: Record<string, unknown>;
}

/**
 * WASM instance interface
 * Represents the chdb-wasm module API
 */
interface WasmInstance {
  query(sql: string, options?: { format?: string; params?: Record<string, unknown> }): Promise<string>;
  queryStream?(
    sql: string,
    options?: { format?: string; params?: Record<string, unknown> }
  ): AsyncIterable<string>;
  createSession?(options?: { dataPath?: string }): Promise<WasmSessionHandle>;
  dispose(): void;
  getMemoryUsage?(): number;
}

/**
 * WASM session handle
 */
interface WasmSessionHandle {
  id: string;
  query(sql: string, options?: { format?: string }): Promise<string>;
  queryStream?(sql: string, options?: { format?: string }): AsyncIterable<string>;
  close(): Promise<void>;
}

/**
 * Factory function type for creating chdb-wasm instances
 */
type CreateChdbFn = (options?: {
  memoryLimit?: number;
  logging?: boolean;
  initOptions?: Record<string, unknown>;
}) => Promise<WasmInstance>;

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Parse JSON result from chdb output
 */
function parseJsonResult<T>(output: string): QueryResult<T> {
  if (!output.trim()) {
    return {
      data: [],
      rowsRead: 0,
      bytesRead: 0,
      elapsed: 0,
    };
  }

  try {
    const parsed = JSON.parse(output);

    // chdb JSON format includes metadata
    if (parsed.data !== undefined) {
      return {
        data: parsed.data as T[],
        rowsRead: parsed.statistics?.rows_read || parsed.rows_read || 0,
        bytesRead: parsed.statistics?.bytes_read || parsed.bytes_read || 0,
        elapsed: parsed.statistics?.elapsed || parsed.elapsed || 0,
      };
    }

    // If it's just an array of results
    if (Array.isArray(parsed)) {
      return {
        data: parsed as T[],
        rowsRead: parsed.length,
        bytesRead: output.length,
        elapsed: 0,
      };
    }

    // Single object result
    return {
      data: [parsed as T],
      rowsRead: 1,
      bytesRead: output.length,
      elapsed: 0,
    };
  } catch (e) {
    throw new QueryError(`Failed to parse JSON result: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }
}

/**
 * Parse JSONEachRow format (newline-delimited JSON)
 */
function parseJsonEachRow<T>(output: string): T[] {
  if (!output.trim()) {
    return [];
  }

  const lines = output.trim().split('\n');
  const results: T[] = [];

  for (const line of lines) {
    if (line.trim()) {
      try {
        results.push(JSON.parse(line) as T);
      } catch {
        // Skip malformed lines
      }
    }
  }

  return results;
}

/**
 * Parse WASM error and convert to QueryError
 */
function parseWasmError(error: unknown): QueryError {
  if (error instanceof Error) {
    // Try to extract ClickHouse error code
    const codeMatch = error.message.match(/Code:\s*(\d+)/);
    const positionMatch = error.message.match(/position\s*(\d+)/i);

    return new QueryError(error.message, {
      code: codeMatch ? parseInt(codeMatch[1], 10) : undefined,
      position: positionMatch ? parseInt(positionMatch[1], 10) : undefined,
    });
  }

  return new QueryError(String(error));
}

/**
 * Create a WASM session implementation
 */
function createWasmSession(
  instance: WasmInstance,
  sessionHandle?: WasmSessionHandle
): Session {
  const sessionId = sessionHandle?.id || generateSessionId();

  // Track temp tables for in-memory session emulation
  const tempTables = new Set<string>();
  let closed = false;

  /**
   * Execute query through session
   */
  async function executeQuery(
    sql: string,
    options?: { format?: string }
  ): Promise<string> {
    if (closed) {
      throw new ChdbError('Session has been closed');
    }

    // If we have a native session handle, use it
    if (sessionHandle) {
      return sessionHandle.query(sql, options);
    }

    // Otherwise, track temp table operations for emulation
    const normalizedSql = sql.trim().toUpperCase();

    // Track CREATE TEMPORARY TABLE statements
    const createTempMatch = normalizedSql.match(/CREATE\s+TEMP(?:ORARY)?\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
    if (createTempMatch) {
      tempTables.add(createTempMatch[1].toLowerCase());
    }

    // Track DROP TABLE for temp tables
    const dropMatch = normalizedSql.match(/DROP\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/i);
    if (dropMatch && tempTables.has(dropMatch[1].toLowerCase())) {
      tempTables.delete(dropMatch[1].toLowerCase());
    }

    return instance.query(sql, options);
  }

  return {
    get id(): string {
      return sessionId;
    },

    async query<T = unknown>(sql: string, options?: QueryOptions): Promise<QueryResult<T>> {
      const format = options?.format || 'JSON';

      try {
        const result = await executeQuery(sql, { format });

        if (format === 'JSON') {
          return parseJsonResult<T>(result);
        }

        if (format === 'JSONEachRow') {
          const data = parseJsonEachRow<T>(result);
          return {
            data,
            rowsRead: data.length,
            bytesRead: result.length,
            elapsed: 0,
          };
        }

        // For other formats, return raw data
        return {
          data: [] as T[],
          rowsRead: 0,
          bytesRead: result.length,
          elapsed: 0,
          raw: result,
        };
      } catch (error) {
        throw parseWasmError(error);
      }
    },

    async *queryStream<T = unknown>(sql: string, options?: QueryOptions): AsyncIterable<T[]> {
      if (closed) {
        throw new ChdbError('Session has been closed');
      }

      const format = 'JSONEachRow';

      try {
        // Check if native session has streaming support
        if (sessionHandle?.queryStream) {
          for await (const chunk of sessionHandle.queryStream(sql, { format })) {
            const parsed = parseJsonEachRow<T>(chunk);
            if (parsed.length > 0) {
              yield parsed;
            }
          }
          return;
        }

        // Check if instance has streaming support
        if (instance.queryStream) {
          for await (const chunk of instance.queryStream(sql, { format })) {
            const parsed = parseJsonEachRow<T>(chunk);
            if (parsed.length > 0) {
              yield parsed;
            }
          }
          return;
        }

        // Fallback to batch execution
        const result = await executeQuery(sql, { format });
        const lines = result.trim().split('\n');
        const batchSize = 1000;

        for (let i = 0; i < lines.length; i += batchSize) {
          const batch = lines.slice(i, i + batchSize);
          const parsedBatch: T[] = [];

          for (const line of batch) {
            if (line.trim()) {
              try {
                parsedBatch.push(JSON.parse(line) as T);
              } catch {
                // Skip malformed lines
              }
            }
          }

          if (parsedBatch.length > 0) {
            yield parsedBatch;
          }
        }
      } catch (error) {
        throw parseWasmError(error);
      }
    },

    async close(): Promise<void> {
      if (closed) {
        return;
      }

      closed = true;

      // Close native session handle if available
      if (sessionHandle) {
        await sessionHandle.close();
        return;
      }

      // Clean up temp tables in emulated session
      for (const tableName of tempTables) {
        try {
          await instance.query(`DROP TABLE IF EXISTS ${tableName}`, { format: 'JSON' });
        } catch {
          // Ignore cleanup errors
        }
      }

      tempTables.clear();
    },
  };
}

/**
 * Create a WASM backend for chdb
 *
 * @param config - Configuration options for the WASM backend
 * @returns A ChdbClient implementation using WebAssembly
 *
 * @example
 * ```typescript
 * // Create with default settings
 * const client = await createWasmBackend();
 *
 * // Create with specific profile
 * const client = await createWasmBackend({
 *   profile: 'full',
 *   memoryLimit: 512 * 1024 * 1024, // 512MB
 *   logging: true,
 * });
 *
 * // Execute queries
 * const result = await client.query('SELECT 1 + 1 AS result');
 * console.log(result.data); // [{ result: 2 }]
 *
 * // Clean up
 * await client.close();
 * ```
 */
export async function createWasmBackend(config?: WasmConfig): Promise<ChdbClient> {
  // Determine which profile to load
  const profile = config?.profile || 'standard';

  // Dynamically import the appropriate WASM profile
  let createChdb: CreateChdbFn;

  try {
    // The import path varies based on profile
    // @dotdo/chdb-wasm exports different entry points per profile
    const wasmModule = await import(`@dotdo/chdb-wasm/${profile}`);
    createChdb = wasmModule.createChdb || wasmModule.default;

    if (typeof createChdb !== 'function') {
      throw new Error('Invalid WASM module: createChdb function not found');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot find module')) {
      throw new ChdbError(
        `Failed to load WASM profile '${profile}'. ` +
          `Make sure @dotdo/chdb-wasm is installed: npm install @dotdo/chdb-wasm`
      );
    }
    throw new ChdbError(
      `Failed to initialize WASM backend: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Create the WASM instance
  let instance: WasmInstance;

  try {
    instance = await createChdb({
      memoryLimit: config?.memoryLimit,
      logging: config?.logging,
      initOptions: config?.initOptions,
    });
  } catch (error) {
    throw new ChdbError(
      `Failed to create WASM instance: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Track if the client has been disposed
  let disposed = false;

  // Track active sessions for cleanup
  const activeSessions = new Set<Session>();

  return {
    /**
     * Execute a query and return parsed results
     */
    async query<T = unknown>(sql: string, options?: QueryOptions): Promise<QueryResult<T>> {
      if (disposed) {
        throw new ChdbError('Client has been disposed');
      }

      const format = options?.format || 'JSON';

      try {
        const result = await instance.query(sql, {
          format,
          params: options?.params,
        });

        if (format === 'JSON') {
          return parseJsonResult<T>(result);
        }

        if (format === 'JSONEachRow') {
          const data = parseJsonEachRow<T>(result);
          return {
            data,
            rowsRead: data.length,
            bytesRead: result.length,
            elapsed: 0,
          };
        }

        // For other formats, return raw data
        return {
          data: [] as T[],
          rowsRead: 0,
          bytesRead: result.length,
          elapsed: 0,
          raw: result,
        };
      } catch (error) {
        throw parseWasmError(error);
      }
    },

    /**
     * Execute a query and return raw response
     */
    async queryRaw(sql: string, options?: QueryOptions): Promise<string | ArrayBuffer> {
      if (disposed) {
        throw new ChdbError('Client has been disposed');
      }

      try {
        return await instance.query(sql, {
          format: options?.format,
          params: options?.params,
        });
      } catch (error) {
        throw parseWasmError(error);
      }
    },

    /**
     * Execute a query and return a stream of batched results
     */
    async *queryStream<T = unknown>(sql: string, options?: QueryOptions): AsyncIterable<T[]> {
      if (disposed) {
        throw new ChdbError('Client has been disposed');
      }

      const format = 'JSONEachRow';

      try {
        // Check if instance supports native streaming
        if (instance.queryStream) {
          for await (const chunk of instance.queryStream(sql, {
            format,
            params: options?.params,
          })) {
            const parsed = parseJsonEachRow<T>(chunk);
            if (parsed.length > 0) {
              yield parsed;
            }
          }
          return;
        }

        // Fallback: execute query and simulate streaming
        const result = await instance.query(sql, {
          format,
          params: options?.params,
        });

        const lines = result.trim().split('\n');
        const batchSize = 1000;

        for (let i = 0; i < lines.length; i += batchSize) {
          const batch = lines.slice(i, i + batchSize);
          const parsedBatch: T[] = [];

          for (const line of batch) {
            if (line.trim()) {
              try {
                parsedBatch.push(JSON.parse(line) as T);
              } catch {
                // Skip malformed lines
              }
            }
          }

          if (parsedBatch.length > 0) {
            yield parsedBatch;
          }
        }
      } catch (error) {
        throw parseWasmError(error);
      }
    },

    /**
     * Create a new session for executing multiple queries with shared state
     * WASM sessions support temporary tables and session-scoped settings
     */
    async createSession(): Promise<Session> {
      if (disposed) {
        throw new ChdbError('Client has been disposed');
      }

      let sessionHandle: WasmSessionHandle | undefined;

      // Check if instance supports native sessions
      if (instance.createSession) {
        try {
          sessionHandle = await instance.createSession();
        } catch (error) {
          // Fall back to emulated sessions if native creation fails
          if (config?.logging) {
            console.warn('Native session creation failed, using emulated session:', error);
          }
        }
      }

      const session = createWasmSession(instance, sessionHandle);
      activeSessions.add(session);

      // Wrap close to remove from tracking
      const originalClose = session.close.bind(session);
      session.close = async () => {
        activeSessions.delete(session);
        return originalClose();
      };

      return session;
    },

    /**
     * Close the client and clean up all resources
     */
    async close(): Promise<void> {
      if (disposed) {
        return;
      }

      disposed = true;

      // Close all active sessions
      const closePromises = Array.from(activeSessions).map((session) =>
        session.close().catch(() => {
          // Ignore session close errors during cleanup
        })
      );

      await Promise.all(closePromises);
      activeSessions.clear();

      // Dispose the WASM instance
      instance.dispose();
    },
  };
}

/**
 * Default export for convenience
 */
export default createWasmBackend;
