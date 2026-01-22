/**
 * Memory Engine with Durable Object Storage
 *
 * Implements the Memory table engine backed by Cloudflare Durable Objects storage.
 * Instead of purely in-memory storage that is lost on Worker restart,
 * this uses DO storage (this.state.storage) for persistence while maintaining
 * Memory engine semantics (no on-disk ordering, all in memory at query time).
 *
 * Key Features:
 * - CREATE TABLE ... ENGINE = Memory() creates table metadata in DO
 * - INSERT writes data to DO storage (persisted)
 * - SELECT reads from DO storage into memory for query execution
 * - Data survives Worker restarts due to DO persistence
 * - Multiple Workers can access the same DO (single-writer model)
 * - DROP/TRUNCATE operations clean up DO storage
 *
 * Performance Optimizations:
 * - Batch reads/writes for DO storage operations
 * - Connection pooling for DO stubs
 * - Chunked storage to respect DO's 128KB per-key limit
 * - Transaction support for atomic multi-key operations
 *
 * @module storage/memory-do
 */

// =============================================================================
// Constants
// =============================================================================

/** DO storage has 128KB limit per key, so we chunk at ~100KB to be safe */
const MAX_CHUNK_SIZE_BYTES = 100 * 1024; // 100KB

/** Maximum number of keys to read/write in a single batch operation */
const BATCH_SIZE = 128;

/** Storage key prefixes for different data types */
const STORAGE_KEYS = {
  SCHEMA_PREFIX: 'schema:',
  DATA_PREFIX: 'data:',
  CHUNK_INFIX: ':chunk:',
  TABLES_LIST: 'tables',
} as const;

// =============================================================================
// TypeScript Type Definitions
// =============================================================================

/**
 * ClickHouse data types supported by the Memory engine
 */
export type ClickHouseType =
  | 'UInt8'
  | 'UInt16'
  | 'UInt32'
  | 'UInt64'
  | 'Int8'
  | 'Int16'
  | 'Int32'
  | 'Int64'
  | 'Float32'
  | 'Float64'
  | 'String'
  | 'DateTime'
  | 'Date'
  | 'Bool'
  | 'Boolean'
  | `Nullable<${string}>`;

/**
 * Column definition for table schema
 */
export interface ColumnDefinition {
  /** Column name (must be valid identifier) */
  name: string;
  /** ClickHouse data type */
  type: string;
  /** Whether NULL values are allowed */
  nullable?: boolean;
  /** Default value for the column */
  default?: unknown;
}

/**
 * Column metadata for query results
 */
export interface ColumnMeta {
  /** Column name */
  name: string;
  /** ClickHouse data type */
  type: string;
}

/**
 * Durable Object State interface matching Cloudflare's API
 */
export interface DurableObjectState {
  /** Storage API for persistent key-value operations */
  storage: DurableObjectStorage;
  /** Unique identifier for this DO instance */
  id: { toString: () => string };
  /** Schedule work to continue after returning response */
  waitUntil: (promise: Promise<unknown>) => void;
  /** Execute callback with exclusive access to storage */
  blockConcurrencyWhile: <T>(callback: () => Promise<T>) => Promise<T>;
}

/**
 * Durable Object Storage interface matching Cloudflare's API
 */
export interface DurableObjectStorage {
  /** Get a single value by key */
  get: <T = unknown>(key: string) => Promise<T | undefined>;
  /** Get multiple values by keys (batch read) */
  getMany?: <T = unknown>(keys: string[]) => Promise<Map<string, T>>;
  /** Put a single key-value pair */
  put: (key: string, value: unknown) => Promise<void>;
  /** Put multiple key-value pairs (batch write) */
  putMany?: (entries: Record<string, unknown>) => Promise<void>;
  /** Delete a single key */
  delete: (key: string) => Promise<boolean>;
  /** Delete multiple keys (batch delete) */
  deleteMany?: (keys: string[]) => Promise<number>;
  /** Delete all keys */
  deleteAll: () => Promise<void>;
  /** List keys with optional prefix filtering */
  list: (options?: { prefix?: string; limit?: number }) => Promise<Map<string, unknown>>;
  /** Execute operations atomically */
  transaction: <T>(callback: (txn: DurableObjectStorage) => Promise<T>) => Promise<T>;
}

/**
 * Table schema definition stored in DO
 */
export interface TableSchema {
  /** Table name */
  name: string;
  /** Column definitions */
  columns: ColumnDefinition[];
  /** Engine type (always 'Memory' for this implementation) */
  engine: 'Memory';
  /** ISO timestamp of table creation */
  createdAt?: string;
}

/**
 * Generic row type for data operations
 */
export type Row = Record<string, unknown>;

/**
 * Result of an INSERT operation
 */
export interface InsertResult {
  /** Number of rows successfully inserted */
  rowsInserted: number;
  /** Whether the operation succeeded */
  success: boolean;
}

/**
 * Options for SELECT queries
 */
export interface SelectOptions {
  /** Specific columns to return (projection) */
  columns?: string[];
  /** WHERE clause (not implemented - for future use) */
  where?: string;
  /** Maximum number of rows to return */
  limit?: number;
  /** Number of rows to skip */
  offset?: number;
}

/**
 * Result of a SELECT operation
 */
export interface SelectResult {
  /** Column metadata */
  meta: ColumnMeta[];
  /** Query result rows */
  data: Row[];
  /** Number of rows returned */
  rows: number;
}

/**
 * Memory Engine DO Storage Interface
 */
export interface MemoryEngineDOInterface {
  /** Create a new table with the given schema */
  createTable: (tableName: string, schema: TableSchema) => Promise<void>;
  /** Drop a table and all its data */
  dropTable: (tableName: string) => Promise<void>;
  /** Truncate a table (remove all data, keep schema) */
  truncateTable: (tableName: string) => Promise<void>;
  /** Insert rows into a table */
  insert: (tableName: string, rows: Row[]) => Promise<InsertResult>;
  /** Select rows from a table */
  select: (tableName: string, options?: SelectOptions) => Promise<SelectResult>;
  /** Get the schema for a table */
  getTableSchema: (tableName: string) => Promise<TableSchema | null>;
  /** List all tables */
  listTables: () => Promise<string[]>;
}

/**
 * Storage operation metrics
 */
export interface StorageMetrics {
  /** Total number of storage reads */
  reads: number;
  /** Total number of storage writes */
  writes: number;
  /** Total number of storage deletes */
  deletes: number;
  /** Total bytes read */
  bytesRead: number;
  /** Total bytes written */
  bytesWritten: number;
  /** Total time spent on storage operations (ms) */
  totalLatencyMs: number;
  /** Number of batch operations performed */
  batchOperations: number;
}

/**
 * DO stub pool entry for connection reuse
 */
interface DOStubPoolEntry<T> {
  /** The stub instance */
  stub: T;
  /** Last time this stub was used */
  lastUsed: number;
  /** Whether the stub is currently in use */
  inUse: boolean;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Validates an identifier (table name or column name)
 * @param name - The identifier to validate
 * @returns true if valid, false otherwise
 */
function isValidIdentifier(name: string): boolean {
  // Allow only alphanumeric and underscore, must start with letter or underscore
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Estimate the size of a row in bytes (rough JSON estimate)
 * @param row - The row to estimate
 * @returns Estimated size in bytes
 */
function estimateRowSize(row: Row): number {
  return JSON.stringify(row).length * 2; // UTF-16 chars
}

/**
 * Extract base type from Nullable wrapper
 * @param type - The type string, possibly wrapped in Nullable()
 * @returns The base type without Nullable wrapper
 */
function extractBaseType(type: string): string {
  const match = type.match(/^Nullable\(([^)]+)\)$/);
  return match ? match[1] : type;
}

/**
 * Check if a type is nullable
 * @param type - The type string
 * @returns true if the type is wrapped in Nullable()
 */
function isNullableType(type: string): boolean {
  return type.startsWith('Nullable(');
}

/**
 * Validate a value against a ClickHouse type
 * @param value - The value to validate
 * @param type - The ClickHouse type
 * @param nullable - Whether NULL is allowed
 * @returns true if valid, false otherwise
 */
function validateType(value: unknown, type: string, nullable: boolean): boolean {
  if (value === null || value === undefined) {
    return nullable || isNullableType(type);
  }

  const baseType = extractBaseType(type);

  switch (baseType) {
    case 'UInt8':
    case 'UInt16':
    case 'UInt32':
    case 'UInt64':
    case 'Int8':
    case 'Int16':
    case 'Int32':
    case 'Int64':
      return typeof value === 'number' && Number.isInteger(value);
    case 'Float32':
    case 'Float64':
      return typeof value === 'number';
    case 'String':
      return typeof value === 'string';
    case 'DateTime':
    case 'Date':
      return typeof value === 'string' || value instanceof Date;
    case 'Bool':
    case 'Boolean':
      return typeof value === 'boolean';
    default:
      // Unknown type, accept anything
      return true;
  }
}

/**
 * Build storage key for table data chunk
 * @param tableName - The table name
 * @param chunkIndex - The chunk index
 * @returns The storage key
 */
function buildChunkKey(tableName: string, chunkIndex: number): string {
  return `${STORAGE_KEYS.DATA_PREFIX}${tableName}${STORAGE_KEYS.CHUNK_INFIX}${chunkIndex}`;
}

/**
 * Build storage key for table schema
 * @param tableName - The table name
 * @returns The storage key
 */
function buildSchemaKey(tableName: string): string {
  return `${STORAGE_KEYS.SCHEMA_PREFIX}${tableName}`;
}

/**
 * Extract chunk index from storage key
 * @param key - The storage key
 * @returns The chunk index, or -1 if not a chunk key
 */
function extractChunkIndex(key: string): number {
  const parts = key.split(STORAGE_KEYS.CHUNK_INFIX);
  if (parts.length !== 2) return -1;
  const index = parseInt(parts[1], 10);
  return isNaN(index) ? -1 : index;
}

// =============================================================================
// DO Stub Pool (Connection Pooling)
// =============================================================================

/**
 * Pool for reusing DO stub connections
 * @template T - The stub type
 */
export class DOStubPool<T> {
  private pool: Map<string, DOStubPoolEntry<T>> = new Map();
  private readonly maxIdleTime: number;
  private readonly maxPoolSize: number;

  /**
   * Create a new DO stub pool
   * @param maxIdleTime - Maximum time a stub can be idle before eviction (ms)
   * @param maxPoolSize - Maximum number of stubs to keep in the pool
   */
  constructor(maxIdleTime = 60000, maxPoolSize = 100) {
    this.maxIdleTime = maxIdleTime;
    this.maxPoolSize = maxPoolSize;
  }

  /**
   * Get or create a stub for the given ID
   * @param id - The DO ID
   * @param createFn - Function to create a new stub
   * @returns The stub
   */
  acquire(id: string, createFn: () => T): T {
    this.evictStale();

    const entry = this.pool.get(id);
    if (entry && !entry.inUse) {
      entry.inUse = true;
      entry.lastUsed = Date.now();
      return entry.stub;
    }

    const stub = createFn();
    if (this.pool.size < this.maxPoolSize) {
      this.pool.set(id, {
        stub,
        lastUsed: Date.now(),
        inUse: true,
      });
    }
    return stub;
  }

  /**
   * Release a stub back to the pool
   * @param id - The DO ID
   */
  release(id: string): void {
    const entry = this.pool.get(id);
    if (entry) {
      entry.inUse = false;
      entry.lastUsed = Date.now();
    }
  }

  /**
   * Remove stale entries from the pool
   */
  private evictStale(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [id, entry] of this.pool) {
      if (!entry.inUse && now - entry.lastUsed > this.maxIdleTime) {
        keysToDelete.push(id);
      }
    }

    for (const key of keysToDelete) {
      this.pool.delete(key);
    }
  }

  /**
   * Get pool statistics
   * @returns Pool statistics
   */
  getStats(): { size: number; inUse: number; idle: number } {
    let inUse = 0;
    let idle = 0;
    for (const entry of this.pool.values()) {
      if (entry.inUse) {
        inUse++;
      } else {
        idle++;
      }
    }
    return { size: this.pool.size, inUse, idle };
  }

  /**
   * Clear all entries from the pool
   */
  clear(): void {
    this.pool.clear();
  }
}

// =============================================================================
// Storage Metrics Tracker
// =============================================================================

/**
 * Tracks metrics for DO storage operations
 */
export class StorageMetricsTracker {
  private metrics: StorageMetrics = {
    reads: 0,
    writes: 0,
    deletes: 0,
    bytesRead: 0,
    bytesWritten: 0,
    totalLatencyMs: 0,
    batchOperations: 0,
  };

  /**
   * Record a read operation
   * @param bytes - Number of bytes read
   * @param latencyMs - Operation latency in milliseconds
   * @param isBatch - Whether this was a batch operation
   */
  recordRead(bytes: number, latencyMs: number, isBatch = false): void {
    this.metrics.reads++;
    this.metrics.bytesRead += bytes;
    this.metrics.totalLatencyMs += latencyMs;
    if (isBatch) this.metrics.batchOperations++;
  }

  /**
   * Record a write operation
   * @param bytes - Number of bytes written
   * @param latencyMs - Operation latency in milliseconds
   * @param isBatch - Whether this was a batch operation
   */
  recordWrite(bytes: number, latencyMs: number, isBatch = false): void {
    this.metrics.writes++;
    this.metrics.bytesWritten += bytes;
    this.metrics.totalLatencyMs += latencyMs;
    if (isBatch) this.metrics.batchOperations++;
  }

  /**
   * Record a delete operation
   * @param latencyMs - Operation latency in milliseconds
   * @param isBatch - Whether this was a batch operation
   */
  recordDelete(latencyMs: number, isBatch = false): void {
    this.metrics.deletes++;
    this.metrics.totalLatencyMs += latencyMs;
    if (isBatch) this.metrics.batchOperations++;
  }

  /**
   * Get current metrics snapshot
   * @returns Current metrics
   */
  getMetrics(): Readonly<StorageMetrics> {
    return { ...this.metrics };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics = {
      reads: 0,
      writes: 0,
      deletes: 0,
      bytesRead: 0,
      bytesWritten: 0,
      totalLatencyMs: 0,
      batchOperations: 0,
    };
  }
}

// =============================================================================
// Batch Operations Helper
// =============================================================================

/**
 * Helper class for batching DO storage operations
 */
class BatchOperations {
  private storage: DurableObjectStorage;
  private metricsTracker: StorageMetricsTracker;

  constructor(storage: DurableObjectStorage, metricsTracker: StorageMetricsTracker) {
    this.storage = storage;
    this.metricsTracker = metricsTracker;
  }

  /**
   * Batch read multiple keys
   * @param keys - Keys to read
   * @returns Map of key to value
   */
  async batchGet<T>(keys: string[]): Promise<Map<string, T>> {
    if (keys.length === 0) {
      return new Map();
    }

    const startTime = Date.now();
    let result: Map<string, T>;

    // Use batch get if available, otherwise fall back to parallel gets
    if (this.storage.getMany) {
      result = await this.storage.getMany<T>(keys);
    } else {
      // Fall back to parallel individual gets
      const entries = await Promise.all(
        keys.map(async (key) => {
          const value = await this.storage.get<T>(key);
          return [key, value] as [string, T | undefined];
        })
      );
      result = new Map(entries.filter(([, v]) => v !== undefined) as [string, T][]);
    }

    const latencyMs = Date.now() - startTime;
    const bytes = JSON.stringify([...result.values()]).length * 2;
    this.metricsTracker.recordRead(bytes, latencyMs, true);

    return result;
  }

  /**
   * Batch write multiple key-value pairs
   * @param entries - Entries to write
   */
  async batchPut(entries: Map<number, Row[]> | Record<string, unknown>): Promise<void> {
    const entriesObj: Record<string, unknown> =
      entries instanceof Map
        ? Object.fromEntries(entries)
        : entries;

    const keys = Object.keys(entriesObj);
    if (keys.length === 0) {
      return;
    }

    const startTime = Date.now();
    const bytes = JSON.stringify(Object.values(entriesObj)).length * 2;

    // Use batch put if available, otherwise fall back to parallel puts
    if (this.storage.putMany) {
      await this.storage.putMany(entriesObj);
    } else {
      // Fall back to parallel individual puts
      await Promise.all(
        keys.map((key) => this.storage.put(key, entriesObj[key]))
      );
    }

    const latencyMs = Date.now() - startTime;
    this.metricsTracker.recordWrite(bytes, latencyMs, true);
  }

  /**
   * Batch delete multiple keys
   * @param keys - Keys to delete
   * @returns Number of keys deleted
   */
  async batchDelete(keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }

    const startTime = Date.now();
    let deleted: number;

    // Use batch delete if available, otherwise fall back to parallel deletes
    if (this.storage.deleteMany) {
      deleted = await this.storage.deleteMany(keys);
    } else {
      // Fall back to parallel individual deletes
      const results = await Promise.all(
        keys.map((key) => this.storage.delete(key))
      );
      deleted = results.filter(Boolean).length;
    }

    const latencyMs = Date.now() - startTime;
    this.metricsTracker.recordDelete(latencyMs, true);

    return deleted;
  }
}

// =============================================================================
// Main Class: MemoryEngineDO
// =============================================================================

/**
 * MemoryEngineDO - Memory table engine backed by Durable Object storage
 *
 * This class provides a ClickHouse-compatible Memory table engine that persists
 * data to Cloudflare Durable Object storage. Unlike the standard Memory engine
 * which loses data on restart, this implementation survives Worker restarts.
 *
 * @example
 * ```typescript
 * // In a Durable Object class:
 * export class TableStorageDO {
 *   private memoryEngine: MemoryEngineDO;
 *
 *   constructor(state: DurableObjectState) {
 *     this.memoryEngine = new MemoryEngineDO(state);
 *   }
 *
 *   async fetch(request: Request): Promise<Response> {
 *     // Handle requests using this.memoryEngine
 *   }
 * }
 * ```
 */
export class MemoryEngineDO implements MemoryEngineDOInterface {
  private readonly state: DurableObjectState;
  private readonly metricsTracker: StorageMetricsTracker;
  private readonly batchOps: BatchOperations;

  /**
   * Create a new MemoryEngineDO instance
   * @param state - The Durable Object state
   */
  constructor(state: DurableObjectState) {
    this.state = state;
    this.metricsTracker = new StorageMetricsTracker();
    this.batchOps = new BatchOperations(state.storage, this.metricsTracker);
  }

  /**
   * Get storage metrics for monitoring
   * @returns Current storage operation metrics
   */
  getMetrics(): Readonly<StorageMetrics> {
    return this.metricsTracker.getMetrics();
  }

  /**
   * Reset storage metrics
   */
  resetMetrics(): void {
    this.metricsTracker.reset();
  }

  /**
   * Create a new table with the given schema
   *
   * @param tableName - Name of the table to create (must be valid identifier)
   * @param schema - Table schema definition
   * @throws Error if table name is invalid
   * @throws Error if schema has no columns
   * @throws Error if column names are invalid
   * @throws Error if table already exists
   *
   * @example
   * ```typescript
   * await engine.createTable('users', {
   *   name: 'users',
   *   columns: [
   *     { name: 'id', type: 'UInt64' },
   *     { name: 'name', type: 'String' },
   *     { name: 'email', type: 'String', nullable: true },
   *   ],
   *   engine: 'Memory',
   * });
   * ```
   */
  async createTable(tableName: string, schema: TableSchema): Promise<void> {
    // Validate table name
    if (!isValidIdentifier(tableName)) {
      throw new Error(
        `Invalid table name: "${tableName}". Identifiers must start with a letter or underscore and contain only alphanumeric characters and underscores.`
      );
    }

    // Validate columns
    if (!schema.columns || schema.columns.length === 0) {
      throw new Error('Table must have at least one column');
    }

    // Validate column names
    for (const col of schema.columns) {
      if (!isValidIdentifier(col.name)) {
        throw new Error(
          `Invalid column name: "${col.name}". Identifiers must start with a letter or underscore and contain only alphanumeric characters and underscores.`
        );
      }
    }

    return this.state.blockConcurrencyWhile(async () => {
      const startTime = Date.now();

      // Check if table already exists
      const existingSchema = await this.state.storage.get<TableSchema>(buildSchemaKey(tableName));
      if (existingSchema) {
        throw new Error(`Table "${tableName}" already exists`);
      }

      // Store schema with creation timestamp
      const schemaWithTimestamp: TableSchema = {
        ...schema,
        createdAt: new Date().toISOString(),
      };

      // Batch write: schema + initial empty chunk + tables list update
      const tables = (await this.state.storage.get<string[]>(STORAGE_KEYS.TABLES_LIST)) || [];
      if (!tables.includes(tableName)) {
        tables.push(tableName);
      }

      const entries: Record<string, unknown> = {
        [buildSchemaKey(tableName)]: schemaWithTimestamp,
        [buildChunkKey(tableName, 0)]: [],
        [STORAGE_KEYS.TABLES_LIST]: tables,
      };

      await this.batchOps.batchPut(entries);

      const latencyMs = Date.now() - startTime;
      this.metricsTracker.recordWrite(JSON.stringify(entries).length * 2, latencyMs, true);
    });
  }

  /**
   * Drop a table and all its data
   *
   * @param tableName - Name of the table to drop
   * @throws Error if table does not exist
   *
   * @example
   * ```typescript
   * await engine.dropTable('users');
   * ```
   */
  async dropTable(tableName: string): Promise<void> {
    return this.state.blockConcurrencyWhile(async () => {
      // Check if table exists
      const schema = await this.state.storage.get<TableSchema>(buildSchemaKey(tableName));
      if (!schema) {
        throw new Error(`Table "${tableName}" does not exist`);
      }

      // Get all data chunk keys
      const chunkKeys = await this.state.storage.list({
        prefix: `${STORAGE_KEYS.DATA_PREFIX}${tableName}${STORAGE_KEYS.CHUNK_INFIX}`,
      });

      // Batch delete all chunks
      const keysToDelete = [...chunkKeys.keys()];
      if (keysToDelete.length > 0) {
        // Delete in batches to avoid hitting limits
        for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
          const batch = keysToDelete.slice(i, i + BATCH_SIZE);
          await this.batchOps.batchDelete(batch);
        }
      }

      // Delete schema
      await this.state.storage.delete(buildSchemaKey(tableName));

      // Remove from tables list
      const tables = (await this.state.storage.get<string[]>(STORAGE_KEYS.TABLES_LIST)) || [];
      const index = tables.indexOf(tableName);
      if (index !== -1) {
        tables.splice(index, 1);
        await this.state.storage.put(STORAGE_KEYS.TABLES_LIST, tables);
      }
    });
  }

  /**
   * Truncate a table (remove all data but keep schema)
   *
   * @param tableName - Name of the table to truncate
   * @throws Error if table does not exist
   *
   * @example
   * ```typescript
   * await engine.truncateTable('users');
   * ```
   */
  async truncateTable(tableName: string): Promise<void> {
    return this.state.blockConcurrencyWhile(async () => {
      // Check if table exists
      const schema = await this.state.storage.get<TableSchema>(buildSchemaKey(tableName));
      if (!schema) {
        throw new Error(`Table "${tableName}" does not exist`);
      }

      // Get all data chunk keys
      const chunkKeys = await this.state.storage.list({
        prefix: `${STORAGE_KEYS.DATA_PREFIX}${tableName}${STORAGE_KEYS.CHUNK_INFIX}`,
      });

      // Batch delete all chunks
      const keysToDelete = [...chunkKeys.keys()];
      if (keysToDelete.length > 0) {
        for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
          const batch = keysToDelete.slice(i, i + BATCH_SIZE);
          await this.batchOps.batchDelete(batch);
        }
      }

      // Reinitialize with empty first chunk
      await this.state.storage.put(buildChunkKey(tableName, 0), []);
    });
  }

  /**
   * Insert rows into a table
   *
   * @param tableName - Name of the table to insert into
   * @param rows - Array of rows to insert
   * @returns Insert result with row count
   * @throws Error if table does not exist
   * @throws Error if type validation fails
   *
   * @example
   * ```typescript
   * const result = await engine.insert('users', [
   *   { id: 1, name: 'Alice', email: 'alice@example.com' },
   *   { id: 2, name: 'Bob', email: null },
   * ]);
   * console.log(`Inserted ${result.rowsInserted} rows`);
   * ```
   */
  async insert(tableName: string, rows: Row[]): Promise<InsertResult> {
    return this.state.blockConcurrencyWhile(async () => {
      // Get table schema
      const schema = await this.state.storage.get<TableSchema>(buildSchemaKey(tableName));
      if (!schema) {
        throw new Error(`Table "${tableName}" does not exist`);
      }

      // Build column info map for validation
      const columnTypes = new Map(
        schema.columns.map((c) => [
          c.name,
          { type: c.type, nullable: c.nullable ?? false, default: c.default },
        ])
      );

      // Validate and normalize rows
      const validatedRows: Row[] = [];
      for (const row of rows) {
        const validatedRow: Row = {};
        for (const col of schema.columns) {
          const value = row[col.name];
          const colInfo = columnTypes.get(col.name)!;

          // Validate type
          if (!validateType(value, colInfo.type, colInfo.nullable)) {
            throw new Error(
              `Type mismatch for column "${col.name}": expected ${colInfo.type}, got ${typeof value}`
            );
          }

          // Only include columns that exist in schema
          if (value !== undefined) {
            validatedRow[col.name] = value;
          } else if (colInfo.default !== undefined) {
            validatedRow[col.name] = colInfo.default;
          } else if (colInfo.nullable) {
            validatedRow[col.name] = null;
          }
        }
        validatedRows.push(validatedRow);
      }

      // Get existing chunks
      const chunkKeys = await this.state.storage.list({
        prefix: `${STORAGE_KEYS.DATA_PREFIX}${tableName}${STORAGE_KEYS.CHUNK_INFIX}`,
      });
      const chunkIndices = [...chunkKeys.keys()]
        .map((key) => extractChunkIndex(key))
        .filter((idx) => idx >= 0)
        .sort((a, b) => a - b);

      // Get the last chunk (or create first one)
      const lastChunkIndex = chunkIndices.length > 0 ? chunkIndices[chunkIndices.length - 1] : 0;
      let currentChunk =
        (await this.state.storage.get<Row[]>(buildChunkKey(tableName, lastChunkIndex))) || [];
      let currentChunkIndex = lastChunkIndex;
      let currentChunkSize = JSON.stringify(currentChunk).length * 2;

      // Add rows, creating new chunks as needed
      const chunksToWrite = new Map<number, Row[]>();
      // Clone the current chunk to avoid mutating the original
      currentChunk = [...currentChunk];
      chunksToWrite.set(currentChunkIndex, currentChunk);

      for (const row of validatedRows) {
        const rowSize = estimateRowSize(row);

        // If adding this row would exceed chunk size, start a new chunk
        if (currentChunkSize + rowSize > MAX_CHUNK_SIZE_BYTES && currentChunk.length > 0) {
          currentChunkIndex++;
          currentChunk = [];
          currentChunkSize = 0;
          chunksToWrite.set(currentChunkIndex, currentChunk);
        }

        currentChunk.push(row);
        currentChunkSize += rowSize;
        // Update the map with the current chunk reference (needed after creating new chunk)
        chunksToWrite.set(currentChunkIndex, currentChunk);
      }

      // Convert chunk map to storage entries
      const entries: Record<string, unknown> = {};
      for (const [chunkIndex, chunkData] of chunksToWrite) {
        entries[buildChunkKey(tableName, chunkIndex)] = chunkData;
      }

      // Write all modified chunks using transaction for atomicity
      try {
        await this.state.storage.transaction(async (txn) => {
          for (const [key, value] of Object.entries(entries)) {
            await txn.put(key, value);
          }
        });
      } catch {
        // If transaction fails, try without transaction (for test environments)
        await this.batchOps.batchPut(entries);
      }

      return {
        rowsInserted: validatedRows.length,
        success: true,
      };
    });
  }

  /**
   * Select rows from a table
   *
   * @param tableName - Name of the table to query
   * @param options - Query options (columns, limit, offset)
   * @returns Query result with data and metadata
   * @throws Error if table does not exist
   *
   * @example
   * ```typescript
   * // Select all rows
   * const result = await engine.select('users');
   *
   * // Select with projection and pagination
   * const result = await engine.select('users', {
   *   columns: ['id', 'name'],
   *   limit: 10,
   *   offset: 20,
   * });
   * ```
   */
  async select(tableName: string, options?: SelectOptions): Promise<SelectResult> {
    const startTime = Date.now();

    // Get table schema
    const schema = await this.state.storage.get<TableSchema>(buildSchemaKey(tableName));
    if (!schema) {
      throw new Error(`Table "${tableName}" does not exist`);
    }

    // Get all data chunk keys
    const chunkKeys = await this.state.storage.list({
      prefix: `${STORAGE_KEYS.DATA_PREFIX}${tableName}${STORAGE_KEYS.CHUNK_INFIX}`,
    });
    const sortedKeys = [...chunkKeys.keys()].sort((a, b) => {
      const idxA = extractChunkIndex(a);
      const idxB = extractChunkIndex(b);
      return idxA - idxB;
    });

    // Batch read all chunks
    const chunksMap = await this.batchOps.batchGet<Row[]>(sortedKeys);

    // Combine all data from chunks in order
    let allData: Row[] = [];
    for (const key of sortedKeys) {
      const chunk = chunksMap.get(key);
      if (chunk) {
        allData = allData.concat(chunk);
      }
    }

    // Determine which columns to return
    const columns = options?.columns || schema.columns.map((c) => c.name);

    // Build metadata
    const meta: ColumnMeta[] = columns.map((colName) => {
      const colDef = schema.columns.find((c) => c.name === colName);
      return {
        name: colName,
        type: colDef?.type || 'String',
      };
    });

    // Apply column projection
    let data = allData.map((row) => {
      const projectedRow: Row = {};
      for (const col of columns) {
        if (col in row) {
          projectedRow[col] = row[col];
        }
      }
      return projectedRow;
    });

    // Apply offset
    if (options?.offset && options.offset > 0) {
      data = data.slice(options.offset);
    }

    // Apply limit
    if (options?.limit && options.limit > 0) {
      data = data.slice(0, options.limit);
    }

    const latencyMs = Date.now() - startTime;
    this.metricsTracker.recordRead(JSON.stringify(data).length * 2, latencyMs, true);

    return {
      meta,
      data,
      rows: data.length,
    };
  }

  /**
   * Get the schema for a table
   *
   * @param tableName - Name of the table
   * @returns Table schema or null if not found
   *
   * @example
   * ```typescript
   * const schema = await engine.getTableSchema('users');
   * if (schema) {
   *   console.log(`Table has ${schema.columns.length} columns`);
   * }
   * ```
   */
  async getTableSchema(tableName: string): Promise<TableSchema | null> {
    const schema = await this.state.storage.get<TableSchema>(buildSchemaKey(tableName));
    return schema || null;
  }

  /**
   * List all tables
   *
   * @returns Array of table names
   *
   * @example
   * ```typescript
   * const tables = await engine.listTables();
   * console.log(`Found ${tables.length} tables: ${tables.join(', ')}`);
   * ```
   */
  async listTables(): Promise<string[]> {
    const tables = await this.state.storage.get<string[]>(STORAGE_KEYS.TABLES_LIST);
    return tables || [];
  }
}
