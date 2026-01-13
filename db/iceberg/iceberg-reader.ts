/**
 * Iceberg Time Travel and State Restoration
 *
 * Provides time travel and disaster recovery capabilities for Durable Objects
 * using Iceberg snapshots stored in R2. This enables lakehouse-style historical
 * queries and point-in-time recovery.
 *
 * ## Time Travel in Lakehouse Architecture
 *
 * Iceberg maintains a history of table states through immutable snapshots. Each
 * snapshot references a specific set of data files, enabling:
 *
 * - **Point-in-Time Queries**: Query data as it existed at any historical snapshot
 * - **Disaster Recovery**: Restore to a previous known-good state
 * - **Audit Trail**: Track changes over time for compliance
 * - **Rollback**: Undo changes by restoring a previous snapshot
 *
 * ## Snapshot Lifecycle
 *
 * ```
 * Snapshot History
 * ┌─────────────────────────────────────────────────────────┐
 * │ S1 ──> S2 ──> S3 ──> S4 (current)                       │
 * │  │      │      │      │                                 │
 * │  v      v      v      v                                 │
 * │ D1     D2     D3     D4  (data files)                   │
 * └─────────────────────────────────────────────────────────┘
 *
 * - Each snapshot (S1-S4) points to data files
 * - Old snapshots remain accessible for time travel
 * - Garbage collection removes unreferenced data files
 * ```
 *
 * ## Features
 *
 * | Method | Purpose |
 * |--------|---------|
 * | `restore(snapshotId)` | Restore DO state from a specific snapshot |
 * | `listSnapshots()` | List all available snapshots with timestamps |
 * | `getSnapshotAt(timestamp)` | Find snapshot for point-in-time query |
 *
 * @example Time Travel Query
 * ```typescript
 * const restorer = new IcebergRestorer(bucket, doId, db, parquetAdapter)
 *
 * // List available snapshots
 * const snapshots = await restorer.listSnapshots()
 * // => [{ id: 'snap-4', timestamp: '2024-01-15T10:00:00Z' }, ...]
 *
 * // Get snapshot at specific time (24 hours ago)
 * const snapshot = await restorer.getSnapshotAt(Date.now() - 86400000)
 * ```
 *
 * @example Disaster Recovery
 * ```typescript
 * // Restore to a known-good state
 * const snapshots = await restorer.listSnapshots()
 * const lastGoodSnapshot = snapshots.find(s => s.timestamp < disasterTime)
 *
 * await restorer.restore(lastGoodSnapshot.id)
 * console.log('DO restored to pre-disaster state')
 * ```
 *
 * @see https://iceberg.apache.org/docs/latest/spark-queries/#time-travel - Time travel
 * @see https://iceberg.apache.org/spec/#snapshots - Snapshot specification
 * @module db/iceberg/iceberg-reader
 */

import type { R2Bucket } from '@cloudflare/workers-types'

// =============================================================================
// Types
// =============================================================================

/**
 * SQL client interface for database operations
 */
export interface SqlClient {
  execute(query: string | { sql: string; args?: unknown[] }): Promise<{ rows: unknown[] }>
  batch?(statements: Array<{ sql: string; args?: unknown[] }>): Promise<unknown[]>
}

/**
 * Parquet adapter interface for reading Parquet files
 */
export interface ParquetAdapter {
  read(buffer: ArrayBuffer): Promise<Record<string, unknown>[]>
}

/**
 * Snapshot info returned by listSnapshots
 */
export interface SnapshotInfo {
  id: string
  timestamp: Date
  parentId: string | null
}

/**
 * Iceberg manifest structure stored in R2
 */
interface IcebergManifest {
  'format-version': 2
  'table-uuid': string
  location: string
  'last-updated-ms': number
  'current-snapshot-id': string | null
  'parent-snapshot-id': string | null
  snapshot_id: string
  timestamp_ms: number
  parent_snapshot_id: string | null
  snapshots: SnapshotEntry[]
  manifests: ManifestEntry[]
}

interface SnapshotEntry {
  snapshot_id: string
  parent_snapshot_id: string | null
  timestamp_ms: number
  manifest_list: string
  summary: Record<string, string>
}

interface ManifestEntry {
  table: string
  schema: string
  data_file: string
  row_count: number
}

// =============================================================================
// IcebergRestorer Class
// =============================================================================

/**
 * IcebergRestorer - Restores DO state from Iceberg snapshots
 *
 * @example
 * ```typescript
 * const restorer = new IcebergRestorer(bucket, doId, db, parquetAdapter)
 *
 * // List available snapshots
 * const snapshots = await restorer.listSnapshots()
 *
 * // Get snapshot at specific time
 * const snapshot = await restorer.getSnapshotAt(Date.now() - 86400000)
 *
 * // Restore to that snapshot
 * await restorer.restore(snapshot.id)
 * ```
 */
export class IcebergRestorer {
  private readonly bucket: R2Bucket
  private readonly doId: string
  private readonly db: SqlClient
  private readonly parquetAdapter: ParquetAdapter

  constructor(
    bucket: R2Bucket,
    doId: string,
    db: SqlClient,
    parquetAdapter: ParquetAdapter
  ) {
    this.bucket = bucket
    this.doId = doId
    this.db = db
    this.parquetAdapter = parquetAdapter
  }

  /**
   * Restore DO state from an Iceberg snapshot
   *
   * This method:
   * 1. Loads the manifest from R2
   * 2. Drops all existing user tables
   * 3. Creates tables from manifest schema
   * 4. Loads data from Parquet files
   *
   * @param snapshotId - The snapshot ID to restore from
   * @throws Error if snapshot not found or restore fails
   */
  async restore(snapshotId: string): Promise<void> {
    // 1. Get manifest from R2
    const manifestKey = `do/${this.doId}/metadata/${snapshotId}.json`
    const manifestObj = await this.bucket.get(manifestKey)

    if (!manifestObj) {
      throw new Error('Snapshot not found')
    }

    const manifest: IcebergManifest = await manifestObj.json()

    // 2. Clear existing tables
    await this.clearExistingTables()

    // 3. Restore each table from manifest
    for (const entry of manifest.manifests) {
      // Create table structure
      await this.db.execute(entry.schema)

      // Load data from Parquet
      const parquetObj = await this.bucket.get(entry.data_file)
      if (!parquetObj) {
        throw new Error(`Parquet file not found: ${entry.data_file}`)
      }

      const buffer = await parquetObj.arrayBuffer()
      const rows = await this.parquetAdapter.read(buffer)

      // Insert rows
      for (const row of rows) {
        const columns = Object.keys(row)
        const values = Object.values(row)
        const placeholders = columns.map(() => '?').join(',')

        await this.db.execute({
          sql: `INSERT INTO ${entry.table} (${columns.join(',')}) VALUES (${placeholders})`,
          args: values,
        })
      }
    }
  }

  /**
   * List all available snapshots for this DO
   *
   * @returns Array of snapshot info sorted by timestamp descending (most recent first)
   */
  async listSnapshots(): Promise<SnapshotInfo[]> {
    const prefix = `do/${this.doId}/metadata/`
    const list = await this.bucket.list({ prefix })

    const snapshots: SnapshotInfo[] = []

    for (const obj of list.objects) {
      // Skip non-JSON files and special files like current.json
      if (!obj.key.endsWith('.json')) continue
      if (obj.key.includes('current')) continue

      try {
        const manifestObj = await this.bucket.get(obj.key)
        if (!manifestObj) continue

        const manifest: IcebergManifest = await manifestObj.json()

        snapshots.push({
          id: manifest.snapshot_id,
          timestamp: new Date(manifest.timestamp_ms),
          parentId: manifest.parent_snapshot_id,
        })
      } catch {
        // Skip corrupt manifests
        continue
      }
    }

    // Sort by timestamp descending (most recent first)
    return snapshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }

  /**
   * Get the snapshot that was current at a specific point in time
   *
   * @param timestamp - Unix timestamp in milliseconds
   * @returns The snapshot that was current at that time, or null if none exists
   */
  async getSnapshotAt(timestamp: number): Promise<SnapshotInfo | null> {
    const snapshots = await this.listSnapshots()

    // Find the most recent snapshot that is <= timestamp
    // Snapshots are already sorted descending by timestamp
    const snapshot = snapshots.find((s) => s.timestamp.getTime() <= timestamp)

    return snapshot ?? null
  }

  /**
   * Clear all existing user tables from the database
   */
  private async clearExistingTables(): Promise<void> {
    // Get list of existing tables
    const result = await this.db.execute(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `)

    // Drop each table
    for (const row of result.rows as Array<{ name: string }>) {
      await this.db.execute(`DROP TABLE IF EXISTS ${row.name}`)
    }
  }
}
