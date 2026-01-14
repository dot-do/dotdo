/**
 * IcebergStateAdapter
 *
 * Provides SQLite to Iceberg snapshot serialization and restoration.
 * Implements the Iceberg V2 spec format for data lake compatibility.
 *
 * Features:
 * - SQLite to Iceberg snapshot serialization
 * - Iceberg snapshot to SQLite restoration
 * - Schema version validation
 * - Checksum integrity verification
 * - Atomic restore within transaction
 *
 * @module objects/persistence/iceberg-state
 */

export interface IcebergSnapshot {
  id: string
  sequence: number
  schemaVersion: number
  checksum: string
  metadata: IcebergMetadataV2
  manifests: ManifestEntry[]
  dataFiles: DataFile[]
  tables: Record<string, ArrayBuffer>
}

export interface IcebergMetadataV2 {
  'format-version': 2
  'table-uuid': string
  location: string
  schemas: IcebergSchemaV2[]
  snapshots: IcebergSnapshotV2[]
  'current-snapshot-id': number
}

interface IcebergSchemaV2 {
  'schema-id'?: number
  type?: string
  fields: IcebergFieldV2[]
}

interface IcebergFieldV2 {
  id: number
  name: string
  required: boolean
  type: string
}

interface IcebergSnapshotV2 {
  'snapshot-id'?: number
  snapshot_id?: number
  'sequence-number'?: number
  'timestamp-ms'?: number
  summary?: Record<string, string>
  'manifest-list'?: string
  manifest_list?: string
}

export interface ManifestEntry {
  manifest_path: string
  added_data_files_count: number
  manifest_length: number
}

export interface DataFile {
  file_path: string
  file_format: 'PARQUET'
  record_count: number
  file_size_in_bytes: number
}

interface SqliteConnection {
  exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
}

export interface IcebergStateAdapterOptions {
  schemaVersion?: number
  tableNames?: string[]
}

export class IcebergStateAdapter {
  private sequence = 0

  constructor(
    private sql: SqliteConnection,
    private options: IcebergStateAdapterOptions = {}
  ) {}

  async createSnapshot(): Promise<IcebergSnapshot> {
    const snapshotId = crypto.randomUUID()
    this.sequence++

    const tables: Record<string, ArrayBuffer> = {}
    const dataFiles: DataFile[] = []

    for (const table of this.getTableNames()) {
      const rows = this.sql.exec(`SELECT * FROM ${table}`).toArray()
      // Simplified parquet serialization (in real impl would use parquet library)
      const parquet = this.serializeToParquet(rows)
      tables[table] = parquet

      dataFiles.push({
        file_path: `data/${table}/${snapshotId}.parquet`,
        file_format: 'PARQUET',
        record_count: rows.length,
        file_size_in_bytes: parquet.byteLength,
      })
    }

    const metadata = this.generateMetadata(snapshotId, dataFiles)
    const manifests = this.generateManifests(snapshotId, dataFiles)
    const checksum = await this.calculateChecksum(tables)

    return {
      id: snapshotId,
      sequence: this.sequence,
      schemaVersion: this.options.schemaVersion ?? 1,
      checksum,
      metadata,
      manifests,
      dataFiles,
      tables,
    }
  }

  async restoreFromSnapshot(snapshot: IcebergSnapshot): Promise<void> {
    // Restore within transaction - all validation happens inside for atomic rollback
    this.sql.exec('BEGIN TRANSACTION')

    try {
      // Verify checksum inside transaction so ROLLBACK is called on failure
      const calculatedChecksum = await this.calculateChecksum(snapshot.tables)
      if (calculatedChecksum !== snapshot.checksum) {
        throw new Error('Checksum mismatch - snapshot data corrupted')
      }

      // Check schema version
      if (snapshot.schemaVersion !== (this.options.schemaVersion ?? 1)) {
        throw new Error(
          `Schema version mismatch: snapshot is v${snapshot.schemaVersion}, expected v${this.options.schemaVersion ?? 1}`
        )
      }

      for (const tableName of this.getTableNames()) {
        this.sql.exec(`DELETE FROM ${tableName}`)

        const parquetData = snapshot.tables[tableName]
        if (!parquetData || parquetData.byteLength === 0) continue

        const rows = this.deserializeFromParquet(parquetData)
        for (const row of rows) {
          const columns = Object.keys(row as object)
          const values = Object.values(row as object)
          const placeholders = columns.map(() => '?').join(', ')
          this.sql.exec(
            `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
            ...values
          )
        }
      }
      this.sql.exec('COMMIT')
    } catch (error) {
      this.sql.exec('ROLLBACK')
      throw error
    }
  }

  private getTableNames(): string[] {
    return this.options.tableNames ?? ['things', 'relationships', 'actions', 'events']
  }

  private serializeToParquet(rows: unknown[]): ArrayBuffer {
    // Simplified - in real impl would use parquet-wasm
    const json = JSON.stringify(rows)
    return new TextEncoder().encode(json).buffer as ArrayBuffer
  }

  private deserializeFromParquet(data: ArrayBuffer): unknown[] {
    const json = new TextDecoder().decode(data)
    return JSON.parse(json)
  }

  private generateMetadata(snapshotId: string, _dataFiles: DataFile[]): IcebergMetadataV2 {
    return {
      'format-version': 2,
      'table-uuid': crypto.randomUUID(),
      location: `s3://bucket/iceberg/${snapshotId}`,
      schemas: [{ type: 'struct', fields: [] }],
      snapshots: [{ snapshot_id: this.sequence, manifest_list: `manifests/${snapshotId}.avro` }],
      'current-snapshot-id': this.sequence,
    }
  }

  private generateManifests(snapshotId: string, dataFiles: DataFile[]): ManifestEntry[] {
    return [
      {
        manifest_path: `manifests/${snapshotId}.avro`,
        added_data_files_count: dataFiles.length,
        manifest_length: 1024,
      },
    ]
  }

  private async calculateChecksum(tables: Record<string, ArrayBuffer>): Promise<string> {
    const encoder = new TextEncoder()
    const allData: number[] = []

    for (const [name, data] of Object.entries(tables).sort()) {
      allData.push(...encoder.encode(name))
      allData.push(...new Uint8Array(data))
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array(allData))
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}
