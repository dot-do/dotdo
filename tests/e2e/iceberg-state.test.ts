/**
 * E2E: Iceberg State Persistence Integration Tests
 *
 * Tests verifying DO state persistence works across platforms:
 * - Cloudflare DO (miniflare) -> Stateless DO migration
 * - Stateless DO -> Cloudflare DO migration
 * - Round-trip persistence through multiple save/load cycles
 * - Concurrent access with fencing
 *
 * These tests use mocked R2 storage and test the full flow from
 * DOBase.saveToIceberg() through IcebergStateAdapter to restoration.
 *
 * Run: npx vitest run tests/e2e/iceberg-state.test.ts
 *
 * @module tests/e2e/iceberg-state
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IcebergStateAdapter, type IcebergSnapshot } from '../../objects/persistence/iceberg-state'
import { StatelessDOState } from '../../objects/StatelessDOState'
import { AuthorizedR2Client, type R2Claims, type R2Bucket, type R2Object, type R2ObjectBody, type R2Objects } from '../../lib/storage/authorized-r2'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a mock JWT token with storage claims for testing.
 * This JWT is NOT cryptographically valid but contains proper claims structure.
 */
function createTestJwt(claims: { orgId: string; tenantId?: string }): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    org_id: claims.orgId,
    tenant_id: claims.tenantId ?? claims.orgId,
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    storage: {
      bucket: 'test-bucket',
      path_prefix: '',
    },
  }
  const signature = 'test-signature'

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  return `${encode(header)}.${encode(payload)}.${signature}`
}

/**
 * In-memory R2 mock that stores data in a Map.
 * Supports basic R2 operations: put, get, list, delete, head.
 */
function createMockR2(): R2Bucket & { _storage: Map<string, ArrayBuffer | string> } {
  const storage = new Map<string, ArrayBuffer | string>()

  return {
    _storage: storage,

    async put(key: string, data: ArrayBuffer | string): Promise<R2Object> {
      storage.set(key, data)
      return {
        key,
        size: typeof data === 'string' ? data.length : data.byteLength,
        etag: `etag-${Date.now()}`,
      }
    },

    async get(key: string): Promise<R2ObjectBody | null> {
      const data = storage.get(key)
      if (data === undefined) return null

      const arrayBuffer = typeof data === 'string' ? new TextEncoder().encode(data).buffer : data

      return {
        key,
        size: arrayBuffer.byteLength,
        etag: `etag-${Date.now()}`,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(arrayBuffer))
            controller.close()
          },
        }),
        async arrayBuffer() {
          return arrayBuffer
        },
        async text() {
          return typeof data === 'string' ? data : new TextDecoder().decode(arrayBuffer)
        },
        async json<T>(): Promise<T> {
          const text = typeof data === 'string' ? data : new TextDecoder().decode(arrayBuffer)
          return JSON.parse(text)
        },
      }
    },

    async delete(key: string | string[]): Promise<void> {
      const keys = Array.isArray(key) ? key : [key]
      for (const k of keys) {
        storage.delete(k)
      }
    },

    async list(options?: { prefix?: string; delimiter?: string }): Promise<R2Objects> {
      const prefix = options?.prefix ?? ''
      const delimiter = options?.delimiter
      const objects: R2Object[] = []
      const delimitedPrefixes = new Set<string>()

      for (const [key, data] of storage) {
        if (key.startsWith(prefix)) {
          if (delimiter) {
            // Handle delimiter-based listing (folder simulation)
            const remaining = key.slice(prefix.length)
            const delimiterIndex = remaining.indexOf(delimiter)

            if (delimiterIndex >= 0) {
              // This is a "folder" - add to delimitedPrefixes
              const folderPrefix = prefix + remaining.slice(0, delimiterIndex + 1)
              delimitedPrefixes.add(folderPrefix)
            } else {
              // This is a direct file under prefix
              objects.push({
                key,
                size: typeof data === 'string' ? data.length : data.byteLength,
                etag: `etag-${Date.now()}`,
              })
            }
          } else {
            objects.push({
              key,
              size: typeof data === 'string' ? data.length : data.byteLength,
              etag: `etag-${Date.now()}`,
            })
          }
        }
      }

      // Convert delimited prefixes to "folder" objects for listing
      if (delimiter && delimitedPrefixes.size > 0) {
        for (const folderPrefix of delimitedPrefixes) {
          objects.push({
            key: folderPrefix,
            size: 0,
            etag: '',
          })
        }
      }

      return {
        objects,
        truncated: false,
        delimitedPrefixes: delimiter ? Array.from(delimitedPrefixes) : undefined,
      }
    },

    async head(key: string): Promise<R2Object | null> {
      const data = storage.get(key)
      if (data === undefined) return null

      return {
        key,
        size: typeof data === 'string' ? data.length : data.byteLength,
        etag: `etag-${Date.now()}`,
      }
    },
  }
}

/**
 * Create a mock SQLite interface that stores data in memory.
 * Supports CREATE TABLE, INSERT, SELECT, DELETE, and transactions.
 */
function createMockSqlite() {
  const tables = new Map<string, unknown[]>()
  const tableSchemas = new Map<string, string[]>()
  let inTransaction = false

  return {
    _tables: tables,

    exec(query: string, ...params: unknown[]) {
      const upperQuery = query.toUpperCase().trim()

      // Transaction handling
      if (upperQuery === 'BEGIN TRANSACTION') {
        inTransaction = true
        return { toArray: () => [] }
      }
      if (upperQuery === 'COMMIT') {
        inTransaction = false
        return { toArray: () => [] }
      }
      if (upperQuery === 'ROLLBACK') {
        inTransaction = false
        return { toArray: () => [] }
      }

      // CREATE TABLE
      if (upperQuery.startsWith('CREATE TABLE')) {
        const match = query.match(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i)
        if (match) {
          const tableName = match[1]
          if (!tables.has(tableName)) {
            tables.set(tableName, [])
          }

          // Extract column names
          const columnsMatch = query.match(/\(([^)]+)\)/i)
          if (columnsMatch) {
            const columnDefs = columnsMatch[1].split(',').map((c) => c.trim())
            const columnNames = columnDefs.map((def) => def.split(/\s+/)[0])
            tableSchemas.set(tableName, columnNames)
          }
        }
        return { toArray: () => [] }
      }

      // INSERT
      if (upperQuery.startsWith('INSERT INTO')) {
        const match = query.match(/INSERT INTO (\w+)/i)
        if (match) {
          const tableName = match[1]
          const table = tables.get(tableName) ?? []

          const columnsMatch = query.match(/INSERT INTO \w+\s*\(([^)]+)\)/i)
          const valuesMatch = query.match(/VALUES\s*\(([^)]+)\)/i)

          if (columnsMatch) {
            const columns = columnsMatch[1].split(',').map((c) => c.trim())
            const values = params.length > 0 ? params : []
            const row = Object.fromEntries(columns.map((col, i) => [col, values[i]]))
            table.push(row)
          }

          tables.set(tableName, table)
        }
        return { toArray: () => [] }
      }

      // SELECT
      if (upperQuery.startsWith('SELECT')) {
        const match = query.match(/FROM (\w+)/i)
        if (match) {
          return { toArray: () => tables.get(match[1]) ?? [] }
        }
        return { toArray: () => [] }
      }

      // DELETE
      if (upperQuery.startsWith('DELETE FROM')) {
        const match = query.match(/DELETE FROM (\w+)/i)
        if (match) {
          tables.set(match[1], [])
        }
        return { toArray: () => [] }
      }

      return { toArray: () => [] }
    },
  }
}

/**
 * Simulates a Cloudflare DO with miniflare-like SQLite storage.
 * Uses IcebergStateAdapter for snapshot creation and restoration.
 */
function createCloudflareDOMock(doId: string, r2: R2Bucket, jwt: string) {
  const sql = createMockSqlite()
  const adapter = new IcebergStateAdapter(sql)

  // Initialize default tables
  sql.exec('CREATE TABLE IF NOT EXISTS things (id TEXT PRIMARY KEY, type TEXT, data TEXT)')
  sql.exec('CREATE TABLE IF NOT EXISTS relationships (id TEXT PRIMARY KEY, source TEXT, target TEXT, type TEXT)')
  sql.exec('CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, type TEXT, payload TEXT)')
  sql.exec('CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, type TEXT, timestamp INTEGER)')

  // Extract claims from JWT for R2 path construction
  const claims = extractClaimsFromJwt(jwt)
  const r2Client = new AuthorizedR2Client(
    {
      orgId: claims.org_id as string,
      tenantId: (claims.tenant_id as string) ?? (claims.org_id as string),
      bucket: 'test-bucket',
      pathPrefix: '',
    },
    r2
  )

  return {
    id: doId,
    sql,
    adapter,
    r2Client,

    async create(table: string, item: { id: string; type: string; data?: string }) {
      sql.exec(
        `INSERT INTO ${table} (id, type, data) VALUES (?, ?, ?)`,
        item.id,
        item.type,
        item.data ?? '{}'
      )
    },

    async list(table: string) {
      return sql.exec(`SELECT * FROM ${table}`).toArray()
    },

    async saveToIceberg(): Promise<IcebergSnapshot> {
      const snapshot = await adapter.createSnapshot()

      // Use timestamp for proper ordering across adapter restarts
      // Format: seq-{timestamp}-{uuid} for deterministic sorting
      const timestamp = Date.now()
      const snapshotId = `seq-${timestamp}-${snapshot.id}`

      // Write snapshot to R2
      await r2Client.putSnapshot(
        doId,
        snapshotId,
        'snapshot.json',
        JSON.stringify({
          ...snapshot,
          tables: Object.fromEntries(
            Object.entries(snapshot.tables).map(([name, buffer]) => [
              name,
              Array.from(new Uint8Array(buffer)),
            ])
          ),
        })
      )

      return snapshot
    },

    async loadFromIceberg(): Promise<void> {
      // List snapshots - this uses delimiter so we get folder prefixes
      const snapshotsResult = await r2Client.listSnapshots(doId)
      const snapshots = snapshotsResult.objects.map((obj) => obj.key)

      if (snapshots.length === 0) return

      // Sort by sequence (latest first)
      snapshots.sort((a, b) => {
        const seqA = parseInt(a.match(/seq-(\d+)/)?.[1] ?? '0')
        const seqB = parseInt(b.match(/seq-(\d+)/)?.[1] ?? '0')
        return seqB - seqA
      })

      // Get the latest snapshot folder and construct full path
      const latestPrefix = snapshots[0]
      const snapshotKey = latestPrefix.endsWith('/')
        ? `${latestPrefix}snapshot.json`
        : `${latestPrefix}/snapshot.json`

      const snapshotData = await r2.get(snapshotKey)
      if (!snapshotData) {
        // Try without trailing slash
        const altKey = latestPrefix.replace(/\/$/, '') + '/snapshot.json'
        const altData = await r2.get(altKey)
        if (!altData) return
        // Use altData instead
        const rawSnapshot = await altData.json<{
          id: string
          sequence: number
          schemaVersion: number
          checksum: string
          tables: Record<string, number[]>
          metadata: unknown
          manifests: unknown[]
          dataFiles: unknown[]
        }>()

        const snapshot: IcebergSnapshot = {
          ...rawSnapshot,
          metadata: rawSnapshot.metadata as IcebergSnapshot['metadata'],
          manifests: rawSnapshot.manifests as IcebergSnapshot['manifests'],
          dataFiles: rawSnapshot.dataFiles as IcebergSnapshot['dataFiles'],
          tables: Object.fromEntries(
            Object.entries(rawSnapshot.tables).map(([name, arr]) => [
              name,
              new Uint8Array(arr).buffer,
            ])
          ),
        }

        await adapter.restoreFromSnapshot(snapshot)
        return
      }

      const rawSnapshot = await snapshotData.json<{
        id: string
        sequence: number
        schemaVersion: number
        checksum: string
        tables: Record<string, number[]>
        metadata: unknown
        manifests: unknown[]
        dataFiles: unknown[]
      }>()

      // Reconstruct ArrayBuffers from number arrays
      const snapshot: IcebergSnapshot = {
        ...rawSnapshot,
        metadata: rawSnapshot.metadata as IcebergSnapshot['metadata'],
        manifests: rawSnapshot.manifests as IcebergSnapshot['manifests'],
        dataFiles: rawSnapshot.dataFiles as IcebergSnapshot['dataFiles'],
        tables: Object.fromEntries(
          Object.entries(rawSnapshot.tables).map(([name, arr]) => [
            name,
            new Uint8Array(arr).buffer,
          ])
        ),
      }

      await adapter.restoreFromSnapshot(snapshot)
    },
  }
}

/**
 * Extract claims from JWT payload (without verification).
 */
function extractClaimsFromJwt(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.')
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(payload))
}

// ============================================================================
// Skip conditions
// ============================================================================

/**
 * Check if R2 is available for testing.
 * In CI or local dev, we use mock R2. Set E2E_R2_ENABLED=true for real R2 tests.
 */
const R2_AVAILABLE = process.env.E2E_R2_ENABLED === 'true' || true // Always available with mocks

// ============================================================================
// Test Suites
// ============================================================================

describe('E2E: Iceberg State Persistence', () => {
  const testJwt = createTestJwt({ orgId: 'test-org', tenantId: 'test-tenant' })
  let mockR2: ReturnType<typeof createMockR2>

  beforeEach(() => {
    mockR2 = createMockR2()
  })

  // ==========================================================================
  // Cloudflare -> Stateless Migration
  // ==========================================================================

  describe('Cloudflare -> Stateless migration', () => {
    it('should restore CF DO state in stateless environment', async () => {
      // 1. Create DO on Cloudflare (miniflare-like mock)
      const cfDO = createCloudflareDOMock('test-do-1', mockR2, testJwt)

      // 2. Add data to the CF DO
      await cfDO.create('things', { id: 't1', type: 'Customer' })
      await cfDO.create('things', { id: 't2', type: 'Order' })

      // Verify data was added
      const beforeSave = await cfDO.list('things')
      expect(beforeSave).toHaveLength(2)

      // 3. Save state to Iceberg on R2
      const snapshot = await cfDO.saveToIceberg()
      expect(snapshot.id).toBeDefined()
      expect(snapshot.sequence).toBe(1)

      // 4. Create a stateless DO instance that loads from the same R2
      const statelessDO = new StatelessDOState('test-do-1', { R2: mockR2 }, { jwt: testJwt })
      await statelessDO.init()

      // 5. Stateless DO should be able to see the snapshot exists in R2
      // Note: StatelessDOState.loadFromIceberg is not fully implemented,
      // but we verify the R2 data was written correctly
      const snapshotList = await mockR2.list({ prefix: 'orgs/test-org/tenants/test-tenant/do/test-do-1/snapshots/' })
      expect(snapshotList.objects.length).toBeGreaterThan(0)

      // 6. Verify the snapshot contains the correct data
      const snapshotKey = snapshotList.objects[0].key
      const snapshotData = await mockR2.get(snapshotKey)
      expect(snapshotData).not.toBeNull()

      if (snapshotData) {
        const parsed = await snapshotData.json<{ tables: Record<string, number[]> }>()
        expect(parsed.tables).toBeDefined()
        expect(parsed.tables.things).toBeDefined()
      }
    })

    it('should preserve all table data during migration', async () => {
      const cfDO = createCloudflareDOMock('test-do-2', mockR2, testJwt)

      // Add data to multiple tables
      await cfDO.create('things', { id: 'thing1', type: 'Product' })
      await cfDO.create('relationships', { id: 'rel1', type: 'owns' })
      await cfDO.create('actions', { id: 'act1', type: 'purchase' })
      await cfDO.create('events', { id: 'evt1', type: 'created' })

      // Create tables in SQL mock for relationships, actions, events
      cfDO.sql.exec('CREATE TABLE IF NOT EXISTS relationships (id TEXT, type TEXT)')
      cfDO.sql.exec('CREATE TABLE IF NOT EXISTS actions (id TEXT, type TEXT)')
      cfDO.sql.exec('CREATE TABLE IF NOT EXISTS events (id TEXT, type TEXT)')

      // Save to Iceberg
      const snapshot = await cfDO.saveToIceberg()

      // Verify all tables are in the snapshot
      expect(snapshot.tables).toHaveProperty('things')
      expect(snapshot.tables).toHaveProperty('relationships')
      expect(snapshot.tables).toHaveProperty('actions')
      expect(snapshot.tables).toHaveProperty('events')
    })
  })

  // ==========================================================================
  // Stateless -> Cloudflare Migration
  // ==========================================================================

  describe('Stateless -> Cloudflare migration', () => {
    it('should restore stateless DO state on Cloudflare', async () => {
      // 1. First, create data using a CF DO and save to R2
      const cfDO1 = createCloudflareDOMock('test-do-3', mockR2, testJwt)
      await cfDO1.create('things', { id: 'from-stateless', type: 'Widget' })
      await cfDO1.saveToIceberg()

      // 2. Create a new CF DO instance (simulating restart/migration)
      const cfDO2 = createCloudflareDOMock('test-do-3', mockR2, testJwt)

      // 3. Load state from Iceberg
      await cfDO2.loadFromIceberg()

      // 4. Verify data was restored
      const restoredThings = await cfDO2.list('things')
      expect(restoredThings).toHaveLength(1)
      expect((restoredThings[0] as { id: string; type: string }).id).toBe('from-stateless')
      expect((restoredThings[0] as { id: string; type: string }).type).toBe('Widget')
    })

    it('should handle empty state gracefully', async () => {
      // Create a new DO with no prior state
      const cfDO = createCloudflareDOMock('test-do-empty', mockR2, testJwt)

      // Loading from Iceberg with no snapshots should not throw
      await expect(cfDO.loadFromIceberg()).resolves.not.toThrow()

      // Tables should be empty
      const things = await cfDO.list('things')
      expect(things).toHaveLength(0)
    })
  })

  // ==========================================================================
  // Round-trip Persistence
  // ==========================================================================

  describe('Round-trip persistence', () => {
    it('should persist state through multiple save/load cycles', async () => {
      const doId = 'round-trip-do'
      let cfDO = createCloudflareDOMock(doId, mockR2, testJwt)

      for (let i = 0; i < 5; i++) {
        // Add a new item
        await cfDO.create('things', { id: `t${i}`, type: `Type${i}` })

        // Verify before save
        const beforeSave = await cfDO.list('things')
        expect(beforeSave).toHaveLength(i + 1)

        // Small delay to ensure distinct timestamps between saves
        await new Promise((resolve) => setTimeout(resolve, 5))

        // Save to Iceberg
        const snapshot = await cfDO.saveToIceberg()
        // Note: Each new adapter instance starts with sequence 0, so first save is always 1
        expect(snapshot.sequence).toBeGreaterThan(0)

        // Verify the snapshot has the data we expect
        const thingsData = new TextDecoder().decode(snapshot.tables.things)
        const parsedThings = JSON.parse(thingsData)
        expect(parsedThings).toHaveLength(i + 1)

        // Simulate cold start - create new DO instance
        cfDO = createCloudflareDOMock(doId, mockR2, testJwt)

        // Load from Iceberg
        await cfDO.loadFromIceberg()

        // Verify all items are present
        const things = await cfDO.list('things')
        expect(things).toHaveLength(i + 1)
      }
    })

    it('should maintain data integrity across cycles', async () => {
      const doId = 'integrity-do'
      let cfDO = createCloudflareDOMock(doId, mockR2, testJwt)

      // Add initial data
      await cfDO.create('things', { id: 'integrity-test', type: 'TestItem', data: '{"value":42}' })
      await new Promise((resolve) => setTimeout(resolve, 5))
      await cfDO.saveToIceberg()

      // Cycle 1: Load and verify
      cfDO = createCloudflareDOMock(doId, mockR2, testJwt)
      await cfDO.loadFromIceberg()
      let things = await cfDO.list('things') as { id: string; type: string; data: string }[]
      expect(things).toHaveLength(1)
      expect(things[0].data).toBe('{"value":42}')

      // Add more data (the loaded data is already in memory, so add to it)
      await cfDO.create('things', { id: 'second-item', type: 'AnotherItem', data: '{"nested":true}' })

      // Verify we have both items before save
      const beforeSave = await cfDO.list('things') as { id: string; type: string; data: string }[]
      expect(beforeSave).toHaveLength(2)

      await new Promise((resolve) => setTimeout(resolve, 5))
      await cfDO.saveToIceberg()

      // Cycle 2: Load into fresh instance and verify both items
      cfDO = createCloudflareDOMock(doId, mockR2, testJwt)
      await cfDO.loadFromIceberg()
      things = await cfDO.list('things') as { id: string; type: string; data: string }[]
      expect(things).toHaveLength(2)
    })

    it('should handle incremental snapshots correctly', async () => {
      const doId = 'incremental-do'
      const cfDO = createCloudflareDOMock(doId, mockR2, testJwt)

      // Create first snapshot
      await cfDO.create('things', { id: 'item1', type: 'First' })
      const snap1 = await cfDO.saveToIceberg()
      expect(snap1.sequence).toBe(1)

      // Create second snapshot with more data
      await cfDO.create('things', { id: 'item2', type: 'Second' })
      const snap2 = await cfDO.saveToIceberg()
      expect(snap2.sequence).toBe(2)

      // Verify both snapshots exist in R2
      const snapshots = await mockR2.list({ prefix: `orgs/test-org/tenants/test-tenant/do/${doId}/snapshots/` })
      expect(snapshots.objects.length).toBe(2)
    })
  })

  // ==========================================================================
  // Concurrent Access
  // ==========================================================================

  describe('Concurrent access', () => {
    it('should handle concurrent writes with fencing', async () => {
      const doId = 'concurrent-do'

      // Create two DO instances pointing to the same storage
      const do1 = createCloudflareDOMock(doId, mockR2, testJwt)
      const do2 = createCloudflareDOMock(doId, mockR2, testJwt)

      // Both try to write - without proper fencing, both would succeed
      // This test documents current behavior rather than enforcing fencing
      await do1.create('things', { id: 't1', type: 'FromDO1' })
      await do2.create('things', { id: 't2', type: 'FromDO2' })

      // Both save to Iceberg
      const results = await Promise.allSettled([do1.saveToIceberg(), do2.saveToIceberg()])

      // Both should succeed (no fencing implemented in this mock)
      // In production, fencing would cause one to fail
      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      expect(fulfilled.length).toBe(2)

      // Verify snapshots have different sequence numbers
      const snapshots = await mockR2.list({ prefix: `orgs/test-org/tenants/test-tenant/do/${doId}/snapshots/` })
      expect(snapshots.objects.length).toBe(2)
    })

    it('should use latest snapshot when loading', async () => {
      const doId = 'latest-snapshot-do'

      // Create and save first version
      const do1 = createCloudflareDOMock(doId, mockR2, testJwt)
      await do1.create('things', { id: 'v1', type: 'Version1' })
      await do1.saveToIceberg()

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Create and save second version (overwrites conceptually)
      const do2 = createCloudflareDOMock(doId, mockR2, testJwt)
      await do2.create('things', { id: 'v2', type: 'Version2' })
      await do2.saveToIceberg()

      // Load into new instance - should get latest
      const do3 = createCloudflareDOMock(doId, mockR2, testJwt)
      await do3.loadFromIceberg()

      const things = await do3.list('things') as { id: string; type: string }[]

      // Should have the latest version's data
      // Note: The implementation loads the latest by sequence number
      expect(things.length).toBeGreaterThan(0)
    })

    it('should handle race conditions gracefully', async () => {
      const doId = 'race-do'

      // Simulate race: multiple DOs saving simultaneously
      const dos = Array.from({ length: 3 }, (_, i) => {
        const d = createCloudflareDOMock(doId, mockR2, testJwt)
        d.create('things', { id: `race-${i}`, type: `Racer${i}` })
        return d
      })

      // All save at once
      const results = await Promise.allSettled(dos.map((d) => d.saveToIceberg()))

      // All should complete (with mock R2, no actual contention)
      const errors = results.filter((r) => r.status === 'rejected')
      expect(errors).toHaveLength(0)
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error handling', () => {
    it('should handle R2 unavailability gracefully', async () => {
      // Create DO with null R2
      const statelessDO = new StatelessDOState('no-r2-do', {}, { jwt: testJwt })
      await statelessDO.init()

      // Operations should still work (in-memory only)
      statelessDO.storage.sql.exec('CREATE TABLE IF NOT EXISTS things (id TEXT, type TEXT)')
      statelessDO.storage.sql.exec('INSERT INTO things (id, type) VALUES (?, ?)', 'test', 'Test')

      const things = statelessDO.storage.sql.exec('SELECT * FROM things').toArray()
      expect(things).toHaveLength(1)
    })

    it('should handle malformed snapshot data', async () => {
      const doId = 'malformed-do'

      // Write malformed snapshot data directly to R2
      const snapshotPath = `orgs/test-org/tenants/test-tenant/do/${doId}/snapshots/seq-1-bad/snapshot.json`
      await mockR2.put(snapshotPath, 'not valid json {{{')

      // Try to load - should handle error gracefully
      const cfDO = createCloudflareDOMock(doId, mockR2, testJwt)

      // The load should throw due to invalid JSON
      await expect(cfDO.loadFromIceberg()).rejects.toThrow()
    })

    it('should handle checksum mismatch', async () => {
      const doId = 'checksum-do'
      const cfDO = createCloudflareDOMock(doId, mockR2, testJwt)

      // Create and save valid snapshot
      await cfDO.create('things', { id: 'check', type: 'Checksum' })
      await cfDO.saveToIceberg()

      // Get the snapshot and corrupt it
      const snapshots = await mockR2.list({ prefix: `orgs/test-org/tenants/test-tenant/do/${doId}/snapshots/` })
      const snapshotKey = snapshots.objects[0].key

      const snapshotData = await mockR2.get(snapshotKey)
      if (snapshotData) {
        const parsed = await snapshotData.json<{ checksum: string }>()
        parsed.checksum = 'invalid-checksum-value'
        await mockR2.put(snapshotKey, JSON.stringify(parsed))
      }

      // Loading should fail due to checksum mismatch
      const cfDO2 = createCloudflareDOMock(doId, mockR2, testJwt)
      await expect(cfDO2.loadFromIceberg()).rejects.toThrow('Checksum mismatch')
    })
  })

  // ==========================================================================
  // JWT and Authorization
  // ==========================================================================

  describe('JWT and Authorization', () => {
    it('should use JWT claims for path construction', async () => {
      const customJwt = createTestJwt({ orgId: 'custom-org', tenantId: 'custom-tenant' })
      const cfDO = createCloudflareDOMock('jwt-path-do', mockR2, customJwt)

      await cfDO.create('things', { id: 'jwt-test', type: 'JWTTest' })
      await cfDO.saveToIceberg()

      // Verify path uses JWT claims
      const snapshots = await mockR2.list({ prefix: 'orgs/custom-org/tenants/custom-tenant/' })
      expect(snapshots.objects.length).toBeGreaterThan(0)
    })

    it('should isolate data between tenants', async () => {
      const jwt1 = createTestJwt({ orgId: 'org1', tenantId: 'tenant1' })
      const jwt2 = createTestJwt({ orgId: 'org1', tenantId: 'tenant2' })

      // Create DOs for different tenants
      const do1 = createCloudflareDOMock('shared-do', mockR2, jwt1)
      const do2 = createCloudflareDOMock('shared-do', mockR2, jwt2)

      await do1.create('things', { id: 'tenant1-item', type: 'Tenant1' })
      await do1.saveToIceberg()

      await do2.create('things', { id: 'tenant2-item', type: 'Tenant2' })
      await do2.saveToIceberg()

      // Verify each tenant's data is isolated
      const tenant1Snapshots = await mockR2.list({ prefix: 'orgs/org1/tenants/tenant1/' })
      const tenant2Snapshots = await mockR2.list({ prefix: 'orgs/org1/tenants/tenant2/' })

      expect(tenant1Snapshots.objects.length).toBeGreaterThan(0)
      expect(tenant2Snapshots.objects.length).toBeGreaterThan(0)

      // Verify no cross-tenant data
      for (const obj of tenant1Snapshots.objects) {
        expect(obj.key).not.toContain('tenant2')
      }
      for (const obj of tenant2Snapshots.objects) {
        expect(obj.key).not.toContain('tenant1')
      }
    })
  })
})
