/**
 * IcebergSnapshotWriter - Stub for TDD RED Phase
 *
 * This is a stub file that provides the interface for the IcebergSnapshotWriter.
 * The implementation is intentionally incomplete - all methods throw NotImplementedError.
 *
 * RED PHASE: Tests import this class and fail because methods are not implemented.
 * GREEN PHASE: Replace these stubs with actual implementation.
 *
 * @module db/iceberg/snapshot-writer
 */

/**
 * Error thrown when a method is not yet implemented
 */
class NotImplementedError extends Error {
  constructor(method: string) {
    super(`Method ${method} is not implemented yet (RED TDD phase)`)
    this.name = 'NotImplementedError'
  }
}

/**
 * R2 bucket interface (simplified for typing)
 */
interface R2BucketLike {
  put(key: string, body: ArrayBuffer | string): Promise<unknown>
  get(key: string): Promise<unknown | null>
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[]; truncated: boolean }>
  delete(key: string): Promise<void>
}

/**
 * SQL storage interface (simplified for typing)
 */
interface SqlStorageLike {
  exec(query: string, ...params: unknown[]): { toArray(): unknown[]; raw?(): unknown[] }
}

/**
 * IcebergSnapshotWriter - Creates Iceberg snapshots from libSQL state
 *
 * Features to implement:
 * - snapshot(): Create Iceberg snapshot with Parquet data files
 * - Valid Iceberg manifest format (v2)
 * - Multiple table support
 * - Schema preservation
 * - Parent snapshot tracking for time-travel
 *
 * @example
 * ```typescript
 * const writer = new IcebergSnapshotWriter(bucket, sqlStorage, 'do-123')
 * const snapshotId = await writer.snapshot()
 * // Snapshot now available at: do/do-123/metadata/{snapshotId}.json
 * ```
 */
export class IcebergSnapshotWriter {
  private _bucket: R2BucketLike
  private _sql: SqlStorageLike
  private _doId: string
  private _lastSnapshotId: string | null = null

  constructor(bucket: R2BucketLike, sqlStorage: SqlStorageLike, doId: string) {
    this._bucket = bucket
    this._sql = sqlStorage
    this._doId = doId
  }

  /**
   * Create an Iceberg snapshot of current libSQL state
   *
   * This method should:
   * 1. Query sqlite_master for all user tables
   * 2. Export each table to Parquet format
   * 3. Create Iceberg manifest with table metadata
   * 4. Track parent snapshot for history chain
   * 5. Write manifest to R2 bucket
   *
   * @returns Snapshot ID (UUID string)
   * @throws NotImplementedError - RED phase stub
   */
  async snapshot(): Promise<string> {
    throw new NotImplementedError('snapshot')
  }
}
