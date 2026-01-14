/**
 * Tiered Storage Types
 *
 * Type definitions for the tiered storage layer with DO SQLite hot tier
 * and R2 Iceberg cold tier.
 *
 * @module db/compat/sql/clickhouse/storage/types
 */

/**
 * R2 bucket interface for Iceberg storage
 */
export interface R2BucketLike {
  put(key: string, body: ArrayBuffer | string): Promise<unknown>
  get(key: string): Promise<R2ObjectLike | null>
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[]; truncated?: boolean }>
  delete(key: string): Promise<void>
}

export interface R2ObjectLike {
  key: string
  json(): Promise<unknown>
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * SQL storage interface matching CF SqlStorage
 */
export interface SqlStorageLike {
  exec(query: string, ...params: unknown[]): SqlStorageCursorLike
}

export interface SqlStorageCursorLike {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[][]
  readonly columnNames: string[]
  readonly rowsRead: number
  readonly rowsWritten: number
}

/**
 * Durable Object state interface
 */
export interface DurableObjectStateLike {
  storage: {
    sql: SqlStorageLike
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
    delete(key: string): Promise<boolean>
    list(options?: { prefix?: string }): Promise<Map<string, unknown>>
  }
  id: { toString(): string }
}

/**
 * Configuration for TieredStorage
 */
export interface TieredStorageConfig {
  /** Row count threshold to trigger flush (default: 10000) */
  flushThreshold?: number
  /** Time interval in ms to trigger flush (default: 300000 = 5 minutes) */
  flushInterval?: number
  /** Namespace for this storage instance */
  namespace?: string
  /** Enable auto-flush on threshold (default: true) */
  autoFlush?: boolean
}

/**
 * Query options for cross-tier queries
 */
export interface QueryOptions {
  /** Snapshot ID for time travel queries (cold tier only) */
  snapshotId?: string
  /** Columns to select */
  columns?: string[]
  /** Row limit */
  limit?: number
  /** Row offset */
  offset?: number
}

/**
 * Query result from tiered storage
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** Result rows */
  rows: T[]
  /** Source tier(s) */
  source: 'hot' | 'cold' | 'both'
  /** Query duration in ms */
  durationMs: number
  /** Row count */
  count: number
}

/**
 * Insert options
 */
export interface InsertOptions {
  /** Partition key for time-based partitioning */
  partitionKey?: string
  /** Skip auto-flush check (for batch operations) */
  skipFlushCheck?: boolean
}

/**
 * Row structure for the things table
 */
export interface ThingRow {
  id: string
  type: string
  data: string | Record<string, unknown>
  embedding?: ArrayBuffer | null
  created_at: number
  updated_at: number
}

/**
 * Flush result
 */
export interface FlushResult {
  /** Number of rows flushed */
  rowCount: number
  /** Flush duration in ms */
  durationMs: number
  /** Snapshot ID of the new Iceberg snapshot */
  snapshotId: string
  /** Data file path in R2 */
  dataFilePath: string
}

/**
 * Iceberg manifest structure for cold tier
 */
export interface IcebergManifest {
  'format-version': 2
  'table-uuid': string
  location: string
  'last-updated-ms': number
  'last-column-id': number
  'current-snapshot-id': string | null
  'parent-snapshot-id': string | null
  snapshots: SnapshotEntry[]
  schemas: SchemaEntry[]
  manifests: ManifestEntry[]
}

export interface SnapshotEntry {
  'snapshot-id': string
  'parent-snapshot-id': string | null
  'timestamp-ms': number
  'manifest-list': string
  summary: Record<string, string>
}

export interface SchemaEntry {
  'schema-id': number
  type: 'struct'
  fields: SchemaField[]
}

export interface SchemaField {
  id: number
  name: string
  required: boolean
  type: string
}

export interface ManifestEntry {
  'manifest-path': string
  'manifest-length': number
  'partition-spec-id': number
  content: 0 | 1
  'sequence-number': number
  'added-files-count': number
  'existing-files-count': number
  'deleted-files-count': number
  'added-rows-count': number
  table: string
  partition?: string
}

/**
 * Data file metadata for cold tier
 */
export interface DataFileMetadata {
  path: string
  rowCount: number
  fileSizeBytes: number
  partition: string
  createdAt: number
  snapshotId: string
}
