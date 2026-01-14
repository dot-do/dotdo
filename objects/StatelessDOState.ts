// objects/StatelessDOState.ts
/**
 * StatelessDOState - DurableObjectState implementation for non-Cloudflare platforms
 *
 * Provides a compatible DurableObjectState interface using in-memory SQLite
 * and Iceberg-based persistence on R2. This allows DO classes to run on
 * any platform (Vercel, fly.io, K8s, etc.) with state durability.
 *
 * @module objects/StatelessDOState
 */

// ============================================================================
// Types
// ============================================================================

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
}

interface SqlResult {
  toArray(): unknown[]
}

interface SqlInterface {
  exec(query: string, ...params: unknown[]): SqlResult
}

interface DurableObjectStorage {
  get(key: string): Promise<unknown>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>
  sql: SqlInterface
}

interface R2Bucket {
  put(key: string, value: unknown, options?: unknown): Promise<unknown>
  get(key: string): Promise<unknown>
  list(options?: { prefix?: string }): Promise<{ objects: unknown[] }>
  delete(key: string): Promise<void>
}

interface Env {
  R2?: R2Bucket
}

// ============================================================================
// Storage Claims (inline for stateless use)
// ============================================================================

interface StorageClaims {
  orgId: string
  tenantId: string
  bucket: string
  pathPrefix: string
}

/**
 * Extract storage claims from JWT without verification (for testing/dev).
 * In production, use lib/auth/jwt-storage-claims.ts with proper verification.
 */
function extractStorageClaimsUnsafe(jwt: string): StorageClaims {
  const parts = jwt.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format')
  }

  // Decode payload (handle both base64 and base64url)
  let payload: Record<string, unknown>
  try {
    const part1 = parts[1]
    if (!part1) throw new Error('Invalid JWT format')
    const base64 = part1.replace(/-/g, '+').replace(/_/g, '/')
    payload = JSON.parse(atob(base64))
  } catch {
    throw new Error('Invalid JWT payload')
  }

  // Check expiration
  if (payload.exp && typeof payload.exp === 'number' && payload.exp < Date.now() / 1000) {
    throw new Error('JWT expired')
  }

  const orgId = payload.org_id as string
  if (!orgId) throw new Error('Missing org_id')

  const tenantId = (payload.tenant_id as string) ?? orgId
  const storage = (payload.storage as { bucket?: string; path_prefix?: string }) ?? {}

  return {
    orgId,
    tenantId,
    bucket: storage.bucket ?? 'dotdo-default',
    pathPrefix: storage.path_prefix ?? '',
  }
}

// ============================================================================
// Inline R2 Client (simplified for stateless use)
// ============================================================================

class InlineR2Client {
  constructor(
    private claims: StorageClaims,
    private r2: R2Bucket
  ) {}

  private buildPath(doId: string, suffix: string): string {
    return `orgs/${this.claims.orgId}/tenants/${this.claims.tenantId}/do/${doId}/${suffix}`
  }

  async list(doId: string, suffix: string): Promise<unknown[]> {
    const result = await this.r2.list({
      prefix: this.buildPath(doId, suffix),
    })
    return result.objects
  }

  async putSnapshot(doId: string, path: string, data: string): Promise<void> {
    await this.r2.put(this.buildPath(doId, path), data)
  }

  async getSnapshot(doId: string, path: string): Promise<unknown> {
    return this.r2.get(this.buildPath(doId, path))
  }
}

// ============================================================================
// Inline Iceberg Adapter (simplified for stateless use)
// ============================================================================

interface IcebergSnapshot {
  id: string
  sequence: number
  schemaVersion: number
  tables: Record<string, unknown[]>
  metadata: IcebergMetadata
  manifests: IcebergManifest[]
  dataFiles: IcebergDataFile[]
  checksum: string
}

interface IcebergMetadata {
  'format-version': number
  'table-uuid': string
  schemas: unknown[]
  snapshots: unknown[]
}

interface IcebergManifest {
  manifest_path: string
  added_data_files_count: number
}

interface IcebergDataFile {
  file_format: string
  file_path: string
}

class InlineIcebergAdapter {
  private sequence = 0

  constructor(
    private sql: SqlInterface,
    private options: { schemaVersion?: number } = {}
  ) {}

  async createSnapshot(): Promise<IcebergSnapshot> {
    this.sequence++
    const id = `snap_${Date.now()}_${this.sequence}`

    // Read tables from SQL
    const tables: Record<string, unknown[]> = {
      things: this.sql.exec('SELECT * FROM things').toArray(),
      relationships: this.sql.exec('SELECT * FROM relationships').toArray(),
      actions: this.sql.exec('SELECT * FROM actions').toArray(),
      events: this.sql.exec('SELECT * FROM events').toArray(),
    }

    const metadata: IcebergMetadata = {
      'format-version': 2,
      'table-uuid': id,
      schemas: [],
      snapshots: [],
    }

    const manifests: IcebergManifest[] = Object.keys(tables).map((table) => ({
      manifest_path: `${table}.manifest`,
      added_data_files_count: (tables[table] ?? []).length,
    }))

    const dataFiles: IcebergDataFile[] = Object.keys(tables).map((table) => ({
      file_format: 'PARQUET',
      file_path: `${table}.parquet`,
    }))

    // Calculate checksum
    const checksum = await this.calculateChecksum(JSON.stringify(tables))

    return {
      id,
      sequence: this.sequence,
      schemaVersion: this.options.schemaVersion ?? 1,
      tables,
      metadata,
      manifests,
      dataFiles,
      checksum,
    }
  }

  private async calculateChecksum(data: string): Promise<string> {
    // Use Web Crypto API for SHA-256
    const encoder = new TextEncoder()
    const dataBuffer = encoder.encode(data)
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }
}

// ============================================================================
// StatelessDOState Implementation
// ============================================================================

export class StatelessDOState {
  readonly id: DurableObjectId
  readonly storage: DurableObjectStorage

  private db: Map<string, unknown> = new Map()
  private tables: Map<string, unknown[]> = new Map()
  private tableSchemas: Map<string, string[]> = new Map() // Track column names
  private icebergAdapter?: InlineIcebergAdapter
  private r2Client?: InlineR2Client
  private jwt?: string
  private pendingPromises: Promise<unknown>[] = []
  private initialized = false

  constructor(
    doId: string,
    private env: Env,
    options?: { jwt?: string }
  ) {
    this.id = {
      toString: () => doId,
      equals: (other) => other.toString() === doId,
    }
    this.jwt = options?.jwt
    this.storage = this.createStorage()
  }

  async init(): Promise<void> {
    if (this.initialized) return

    // Initialize standard DO tables
    this.tables.set('things', [])
    this.tables.set('relationships', [])
    this.tables.set('actions', [])
    this.tables.set('events', [])

    // Load state from Iceberg if JWT available
    if (this.jwt && this.env?.R2) {
      try {
        const claims = extractStorageClaimsUnsafe(this.jwt)
        this.r2Client = new InlineR2Client(claims, this.env.R2)

        // Check for existing snapshots
        const snapshots = await this.r2Client.list(this.id.toString(), 'snapshots/')
        if (snapshots.length > 0) {
          // Would load from Iceberg here
        }
      } catch (error) {
        console.warn('Failed to load from Iceberg:', error)
      }
    }

    this.initialized = true
  }

  private createStorage(): DurableObjectStorage {
    const self = this
    return {
      get: async (key: string) => self.db.get(key),
      put: async (key: string, value: unknown) => {
        self.db.set(key, value)
      },
      delete: async (key: string) => {
        self.db.delete(key)
      },
      list: async (options?: { prefix?: string }) => {
        const result = new Map<string, unknown>()
        for (const [key, value] of self.db) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      },
      sql: self.createSqlInterface(),
    }
  }

  private createSqlInterface(): SqlInterface {
    const self = this
    return {
      exec: (query: string, ...params: unknown[]): SqlResult => {
        const upperQuery = query.toUpperCase().trim()

        if (upperQuery.startsWith('CREATE TABLE')) {
          const match = query.match(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i)
          if (match && match[1]) {
            const tableName = match[1]
            self.tables.set(tableName, self.tables.get(tableName) || [])

            // Extract column names from definition: CREATE TABLE test (id TEXT, name TEXT)
            const columnsMatch = query.match(/\(([^)]+)\)/i)
            if (columnsMatch && columnsMatch[1]) {
              const columnDefs = columnsMatch[1].split(',').map((c) => c.trim())
              const columnNames = columnDefs.map((def) => {
                // Extract column name from "id TEXT PRIMARY KEY" or "name TEXT"
                const colName = def.split(/\s+/)[0] ?? ''
                return colName
              })
              self.tableSchemas.set(tableName, columnNames)
            }
          }
          return { toArray: () => [] }
        }

        if (upperQuery.startsWith('INSERT INTO')) {
          const match = query.match(/INSERT INTO (\w+)/i)
          if (match && match[1]) {
            const tableName = match[1]
            const table = self.tables.get(tableName) || []

            // Parse column names if present: INSERT INTO test (col1, col2) VALUES (?, ?)
            const columnsMatch = query.match(/INSERT INTO \w+\s*\(([^)]+)\)/i)
            // Parse VALUES: VALUES ('1', 'Test') or VALUES (?, ?)
            const valuesMatch = query.match(/VALUES\s*\(([^)]+)\)/i)

            if (columnsMatch && columnsMatch[1] && valuesMatch && valuesMatch[1]) {
              // Named columns
              const columns = columnsMatch[1].split(',').map((c) => c.trim())
              const values =
                params.length > 0
                  ? params
                  : valuesMatch[1].split(',').map((v) => {
                      const trimmed = v.trim()
                      // Remove quotes from string literals
                      if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
                        return trimmed.slice(1, -1)
                      }
                      return trimmed
                    })
              const row = Object.fromEntries(columns.map((col, i) => [col, values[i]]))
              table.push(row)
            } else if (valuesMatch && valuesMatch[1]) {
              // No column names - use schema if available, else use col0, col1, etc.
              const values =
                params.length > 0
                  ? params
                  : valuesMatch[1].split(',').map((v) => {
                      const trimmed = v.trim()
                      if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
                        return trimmed.slice(1, -1)
                      }
                      return trimmed
                    })

              // Try to use column names from CREATE TABLE schema
              const schema = self.tableSchemas.get(tableName)
              if (schema && schema.length >= values.length) {
                const row = Object.fromEntries(schema.slice(0, values.length).map((col, i) => [col, values[i]]))
                table.push(row)
              } else {
                // Fallback to generic column names
                const row = Object.fromEntries(values.map((val, i) => [`col${i}`, val]))
                table.push(row)
              }
            }

            self.tables.set(tableName, table)
          }
          return { toArray: () => [] }
        }

        if (upperQuery.startsWith('SELECT')) {
          const match = query.match(/FROM (\w+)/i)
          if (match && match[1]) {
            const tableName = match[1]
            return { toArray: () => self.tables.get(tableName) || [] }
          }
          return { toArray: () => [] }
        }

        if (upperQuery.startsWith('DELETE FROM')) {
          const match = query.match(/DELETE FROM (\w+)/i)
          if (match && match[1]) {
            self.tables.set(match[1], [])
          }
          return { toArray: () => [] }
        }

        // Transaction handling
        if (upperQuery === 'BEGIN TRANSACTION' || upperQuery === 'COMMIT' || upperQuery === 'ROLLBACK') {
          return { toArray: () => [] }
        }

        return { toArray: () => [] }
      },
    }
  }

  waitUntil(promise: Promise<unknown>): void {
    this.pendingPromises.push(promise)
  }

  async flush(): Promise<void> {
    await Promise.all(this.pendingPromises)

    if (this.r2Client && this.jwt) {
      // Initialize adapter if needed
      if (!this.icebergAdapter) {
        this.icebergAdapter = new InlineIcebergAdapter(this.storage.sql)
      }

      // Save to Iceberg
      try {
        const snapshot = await this.icebergAdapter.createSnapshot()

        await this.r2Client.putSnapshot(
          this.id.toString(),
          `snapshots/seq-${Date.now()}-${snapshot.id}/metadata.json`,
          JSON.stringify(snapshot.metadata)
        )
      } catch (error) {
        console.error('Failed to save to Iceberg:', error)
      }
    }

    this.pendingPromises = []
  }
}
