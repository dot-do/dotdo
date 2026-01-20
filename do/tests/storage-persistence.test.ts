/**
 * Storage Persistence Tests - Data Survives DO Restart
 *
 * RED PHASE TDD: These tests SHOULD FAIL initially.
 *
 * Tests verify that Durable Object storage persists data across restarts:
 * 1. Data written in request 1 is readable in request 2
 * 2. SQLite tables persist across DO restarts
 * 3. SQLite data persists across DO restarts
 * 4. Storage.put data persists across restarts
 * 5. Alarms scheduled persist across restarts
 * 6. Transactional writes persist atomically
 * 7. Partial transaction rollback doesn't persist
 * 8. Large data (> 128KB) persists correctly
 * 9. Binary data persists without corruption
 * 10. Unicode data persists correctly
 *
 * Uses Miniflare to simulate DO restarts by disposing and recreating instances.
 *
 * @module do/tests/storage-persistence.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Miniflare } from 'miniflare'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface StorageValue {
  key: string
  value: unknown
}

interface SQLiteRow {
  id: number
  key: string
  value: string
  created_at: number
}

interface AlarmStatus {
  scheduled: boolean
  scheduledTime: number | null
  firedCount: number
}

// ============================================================================
// TEST DO IMPLEMENTATION FOR PERSISTENCE TESTING
// ============================================================================

/**
 * Persistence Test DO script for Miniflare
 * Implements storage, SQLite, alarms with persistence-focused operations
 */
const PERSISTENCE_DO_SCRIPT = `
export class PersistenceDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.sql = state.storage.sql
    this.env = env
    this.instanceId = crypto.randomUUID()

    // Initialize SQLite tables
    this.state.blockConcurrencyWhile(async () => {
      this.sql.exec(\`
        CREATE TABLE IF NOT EXISTS items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          value TEXT,
          created_at INTEGER DEFAULT (unixepoch())
        )
      \`)
      this.sql.exec(\`
        CREATE TABLE IF NOT EXISTS binary_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          data BLOB,
          size INTEGER,
          checksum TEXT
        )
      \`)
      this.sql.exec(\`
        CREATE TABLE IF NOT EXISTS unicode_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          text TEXT,
          encoding TEXT DEFAULT 'utf-8'
        )
      \`)
      this.sql.exec(\`
        CREATE TABLE IF NOT EXISTS transaction_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tx_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          created_at INTEGER DEFAULT (unixepoch())
        )
      \`)
    })
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      // ==== INSTANCE IDENTITY ====
      if (path === '/instance-id') {
        return Response.json({ instanceId: this.instanceId })
      }

      // ==== STORAGE OPERATIONS ====
      if (path === '/storage/get' && method === 'GET') {
        const key = url.searchParams.get('key')
        const value = await this.storage.get(key)
        return Response.json({ key, value: value ?? null })
      }

      if (path === '/storage/put' && method === 'POST') {
        const { key, value } = await request.json()
        await this.storage.put(key, value)
        return Response.json({ success: true, key, value })
      }

      if (path === '/storage/put-binary' && method === 'POST') {
        const { key } = Object.fromEntries(url.searchParams)
        const buffer = await request.arrayBuffer()
        await this.storage.put(key, new Uint8Array(buffer))
        return Response.json({ success: true, key, size: buffer.byteLength })
      }

      if (path === '/storage/get-binary' && method === 'GET') {
        const key = url.searchParams.get('key')
        const data = await this.storage.get(key)
        if (data instanceof Uint8Array) {
          return new Response(data, {
            headers: { 'Content-Type': 'application/octet-stream' }
          })
        }
        return Response.json({ error: 'Not found or not binary' }, { status: 404 })
      }

      if (path === '/storage/delete' && method === 'DELETE') {
        const key = url.searchParams.get('key')
        const deleted = await this.storage.delete(key)
        return Response.json({ deleted })
      }

      if (path === '/storage/list' && method === 'GET') {
        const prefix = url.searchParams.get('prefix') || ''
        const entries = await this.storage.list({ prefix })
        return Response.json({ entries: Object.fromEntries(entries) })
      }

      // ==== LARGE DATA OPERATIONS ====
      if (path === '/storage/put-large' && method === 'POST') {
        const { key, sizeKB } = await request.json()
        // Generate large data (sizeKB kilobytes of 'x' characters)
        const largeData = 'x'.repeat(sizeKB * 1024)
        await this.storage.put(key, largeData)
        return Response.json({ success: true, key, size: largeData.length })
      }

      if (path === '/storage/get-large' && method === 'GET') {
        const key = url.searchParams.get('key')
        const value = await this.storage.get(key)
        return Response.json({
          key,
          size: typeof value === 'string' ? value.length : 0,
          exists: value !== undefined
        })
      }

      // ==== SQLITE OPERATIONS ====
      if (path === '/sql/insert' && method === 'POST') {
        const { key, value } = await request.json()
        const result = this.sql.exec(
          'INSERT INTO items (key, value) VALUES (?, ?) RETURNING id',
          key, value
        )
        const row = result.toArray()[0]
        return Response.json({ success: true, id: row.id })
      }

      if (path === '/sql/get' && method === 'GET') {
        const key = url.searchParams.get('key')
        const result = this.sql.exec('SELECT * FROM items WHERE key = ?', key)
        const rows = result.toArray()
        return Response.json({ row: rows[0] || null })
      }

      if (path === '/sql/list' && method === 'GET') {
        const result = this.sql.exec('SELECT * FROM items ORDER BY id')
        return Response.json({ rows: result.toArray() })
      }

      if (path === '/sql/count' && method === 'GET') {
        const result = this.sql.exec('SELECT COUNT(*) as count FROM items')
        return Response.json({ count: result.toArray()[0].count })
      }

      if (path === '/sql/tables' && method === 'GET') {
        const result = this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        return Response.json({ tables: result.toArray().map(r => r.name) })
      }

      // ==== UNICODE DATA ====
      if (path === '/sql/unicode/insert' && method === 'POST') {
        const { key, text } = await request.json()
        this.sql.exec(
          'INSERT INTO unicode_data (key, text) VALUES (?, ?)',
          key, text
        )
        return Response.json({ success: true, key, length: text.length })
      }

      if (path === '/sql/unicode/get' && method === 'GET') {
        const key = url.searchParams.get('key')
        const result = this.sql.exec('SELECT * FROM unicode_data WHERE key = ?', key)
        const rows = result.toArray()
        return Response.json({ row: rows[0] || null })
      }

      // ==== BINARY DATA IN SQLITE ====
      if (path === '/sql/binary/insert' && method === 'POST') {
        const { key } = Object.fromEntries(url.searchParams)
        const buffer = await request.arrayBuffer()
        const data = new Uint8Array(buffer)
        // Compute simple checksum
        let checksum = 0
        for (let i = 0; i < data.length; i++) {
          checksum = (checksum + data[i]) & 0xFFFFFFFF
        }
        this.sql.exec(
          'INSERT INTO binary_data (key, data, size, checksum) VALUES (?, ?, ?, ?)',
          key, data, data.length, checksum.toString(16)
        )
        return Response.json({ success: true, key, size: data.length, checksum: checksum.toString(16) })
      }

      if (path === '/sql/binary/get' && method === 'GET') {
        const key = url.searchParams.get('key')
        const result = this.sql.exec('SELECT * FROM binary_data WHERE key = ?', key)
        const rows = result.toArray()
        if (rows.length === 0) {
          return Response.json({ error: 'Not found' }, { status: 404 })
        }
        return Response.json({
          key: rows[0].key,
          size: rows[0].size,
          checksum: rows[0].checksum,
          dataLength: rows[0].data ? rows[0].data.length : 0
        })
      }

      // ==== TRANSACTION OPERATIONS ====
      if (path === '/sql/transaction' && method === 'POST') {
        const { operations, txId } = await request.json()
        const results = []

        await this.state.blockConcurrencyWhile(async () => {
          // Log transaction start
          this.sql.exec(
            'INSERT INTO transaction_log (tx_id, operation, status) VALUES (?, ?, ?)',
            txId, 'START', 'started'
          )

          for (const op of operations) {
            if (op.type === 'insert') {
              const result = this.sql.exec(
                'INSERT INTO items (key, value) VALUES (?, ?) RETURNING id',
                op.key, op.value
              )
              results.push({ id: result.toArray()[0].id })

              // Log each operation
              this.sql.exec(
                'INSERT INTO transaction_log (tx_id, operation, status) VALUES (?, ?, ?)',
                txId, \`insert:\${op.key}\`, 'completed'
              )
            }
          }

          // Log transaction complete
          this.sql.exec(
            'INSERT INTO transaction_log (tx_id, operation, status) VALUES (?, ?, ?)',
            txId, 'COMMIT', 'committed'
          )
        })

        return Response.json({ success: true, txId, results })
      }

      if (path === '/sql/transaction/failing' && method === 'POST') {
        const { operations, txId, failAtIndex } = await request.json()
        const results = []

        try {
          await this.state.blockConcurrencyWhile(async () => {
            // Log transaction start
            this.sql.exec(
              'INSERT INTO transaction_log (tx_id, operation, status) VALUES (?, ?, ?)',
              txId, 'START', 'started'
            )

            for (let i = 0; i < operations.length; i++) {
              if (i === failAtIndex) {
                // Simulate failure - this should cause partial rollback
                throw new Error('Simulated transaction failure')
              }

              const op = operations[i]
              if (op.type === 'insert') {
                const result = this.sql.exec(
                  'INSERT INTO items (key, value) VALUES (?, ?) RETURNING id',
                  op.key, op.value
                )
                results.push({ id: result.toArray()[0].id })
              }
            }

            // Log transaction complete
            this.sql.exec(
              'INSERT INTO transaction_log (tx_id, operation, status) VALUES (?, ?, ?)',
              txId, 'COMMIT', 'committed'
            )
          })

          return Response.json({ success: true, txId, results })
        } catch (error) {
          // Log transaction rollback
          this.sql.exec(
            'INSERT INTO transaction_log (tx_id, operation, status) VALUES (?, ?, ?)',
            txId, 'ROLLBACK', 'rolled_back'
          )
          return Response.json({ success: false, error: error.message, txId }, { status: 500 })
        }
      }

      if (path === '/sql/transaction/log' && method === 'GET') {
        const txId = url.searchParams.get('txId')
        let result
        if (txId) {
          result = this.sql.exec(
            'SELECT * FROM transaction_log WHERE tx_id = ? ORDER BY id',
            txId
          )
        } else {
          result = this.sql.exec('SELECT * FROM transaction_log ORDER BY id')
        }
        return Response.json({ logs: result.toArray() })
      }

      // ==== ALARM OPERATIONS ====
      if (path === '/alarm/schedule' && method === 'POST') {
        const { delayMs, alarmId } = await request.json()
        const scheduledTime = Date.now() + delayMs
        await this.state.storage.setAlarm(scheduledTime)
        await this.storage.put('alarm:scheduled', { alarmId, scheduledTime })
        return Response.json({ scheduled: true, alarmId, scheduledTime })
      }

      if (path === '/alarm/status' && method === 'GET') {
        const currentAlarm = await this.state.storage.getAlarm()
        const scheduled = await this.storage.get('alarm:scheduled')
        const firedLog = await this.storage.get('alarm:fired') || []
        return Response.json({
          hasScheduledAlarm: !!currentAlarm,
          scheduledAlarmTime: currentAlarm || null,
          alarmMetadata: scheduled || null,
          firedAlarms: firedLog
        })
      }

      if (path === '/alarm/cancel' && method === 'POST') {
        await this.state.storage.deleteAlarm()
        await this.storage.delete('alarm:scheduled')
        return Response.json({ cancelled: true })
      }

      // ==== HEALTH CHECK ====
      if (path === '/' || path === '/health') {
        return Response.json({
          status: 'ok',
          id: this.state.id.toString(),
          instanceId: this.instanceId,
          timestamp: Date.now()
        })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      return Response.json({ error: error.message, stack: error.stack }, { status: 500 })
    }
  }

  async alarm() {
    const firedLog = await this.storage.get('alarm:fired') || []
    firedLog.push({
      firedAt: Date.now(),
      instanceId: this.instanceId
    })
    await this.storage.put('alarm:fired', firedLog)
    await this.storage.delete('alarm:scheduled')
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const doName = url.searchParams.get('name') || 'default'
    const id = env.PERSISTENCE_DO.idFromName(doName)
    const stub = env.PERSISTENCE_DO.get(id)
    return stub.fetch(request)
  }
}
`

// ============================================================================
// TEST HELPERS
// ============================================================================

let tempDir: string

function createTempDir(): string {
  const dir = path.join(os.tmpdir(), `do-persistence-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

function getMiniflareConfig(persistDir: string) {
  return {
    modules: true,
    script: PERSISTENCE_DO_SCRIPT,
    durableObjects: {
      PERSISTENCE_DO: {
        className: 'PersistenceDO',
        // Enable SQLite for this DO class - required for state.storage.sql
        // Note: the option is useSQLite (capital SQL), not useSqlite
        useSQLite: true,
      },
    },
    // Enable persistence to a directory - this is critical for restart tests
    durableObjectsPersist: persistDir,
  }
}

async function getPersistenceDOStub(mf: Miniflare, name: string = 'default') {
  const ns = await mf.getDurableObjectNamespace('PERSISTENCE_DO')
  const id = ns.idFromName(name)
  return ns.get(id)
}

function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// TEST SUITES - STORAGE PERSISTENCE ACROSS RESTARTS
// ============================================================================

describe('Storage Persistence Tests - Data Survives DO Restart', () => {

  // ==========================================================================
  // 1. DATA WRITTEN IN REQUEST 1 IS READABLE IN REQUEST 2
  // ==========================================================================

  describe('1. Data written in request 1 is readable in request 2', () => {
    let persistDir: string
    let mf: Miniflare

    beforeEach(async () => {
      persistDir = createTempDir()
      mf = new Miniflare(getMiniflareConfig(persistDir))
    })

    afterEach(async () => {
      await mf.dispose()
      cleanupTempDir(persistDir)
    })

    it('should persist simple string data between requests', async () => {
      const doName = generateTestId()
      const stub = await getPersistenceDOStub(mf, doName)

      // Request 1: Write data
      const writeResponse = await stub.fetch('http://fake/storage/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'test-key', value: 'test-value' }),
      })
      expect(writeResponse.status).toBe(200)

      // Request 2: Read data (same stub, same Miniflare instance)
      const readResponse = await stub.fetch('http://fake/storage/get?key=test-key')
      const readJson = await readResponse.json() as StorageValue

      expect(readJson.value).toBe('test-value')
    })

    it('should persist complex object data between requests', async () => {
      const doName = generateTestId()
      const stub = await getPersistenceDOStub(mf, doName)

      const complexData = {
        nested: { deep: { value: 42 } },
        array: [1, 2, 3],
        string: 'hello',
        boolean: true,
        nullValue: null,
      }

      // Request 1: Write data
      await stub.fetch('http://fake/storage/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'complex-key', value: complexData }),
      })

      // Request 2: Read data
      const readResponse = await stub.fetch('http://fake/storage/get?key=complex-key')
      const readJson = await readResponse.json() as { value: typeof complexData }

      expect(readJson.value).toEqual(complexData)
    })

    it('should persist multiple key-value pairs', async () => {
      const doName = generateTestId()
      const stub = await getPersistenceDOStub(mf, doName)

      // Request 1: Write multiple keys
      for (let i = 0; i < 10; i++) {
        await stub.fetch('http://fake/storage/put', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: `multi-${i}`, value: `value-${i}` }),
        })
      }

      // Request 2: Read all keys
      const listResponse = await stub.fetch('http://fake/storage/list?prefix=multi-')
      const listJson = await listResponse.json() as { entries: Record<string, string> }

      expect(Object.keys(listJson.entries)).toHaveLength(10)
      for (let i = 0; i < 10; i++) {
        expect(listJson.entries[`multi-${i}`]).toBe(`value-${i}`)
      }
    })
  })

  // ==========================================================================
  // 2. SQLITE TABLES PERSIST ACROSS DO RESTARTS
  // ==========================================================================

  describe('2. SQLite tables persist across DO restarts', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should recreate SQLite tables after DO restart', async () => {
      const doName = generateTestId()

      // First Miniflare instance - create and use tables
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        // Verify tables exist
        const tablesResponse = await stub1.fetch('http://fake/sql/tables')
        const tablesJson = await tablesResponse.json() as { tables: string[] }

        expect(tablesJson.tables).toContain('items')
        expect(tablesJson.tables).toContain('binary_data')
        expect(tablesJson.tables).toContain('unicode_data')
        expect(tablesJson.tables).toContain('transaction_log')
      } finally {
        await mf1.dispose()
      }

      // Second Miniflare instance - simulate restart
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        // Tables should still exist after restart
        const tablesResponse = await stub2.fetch('http://fake/sql/tables')
        const tablesJson = await tablesResponse.json() as { tables: string[] }

        expect(tablesJson.tables).toContain('items')
        expect(tablesJson.tables).toContain('binary_data')
        expect(tablesJson.tables).toContain('unicode_data')
        expect(tablesJson.tables).toContain('transaction_log')
      } finally {
        await mf2.dispose()
      }
    })

    it('should get a new instance ID after restart but same DO ID', async () => {
      const doName = generateTestId()

      // First instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let instanceId1: string
      let doId1: string

      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)
        const healthResponse = await stub1.fetch('http://fake/health')
        const healthJson = await healthResponse.json() as { id: string; instanceId: string }
        instanceId1 = healthJson.instanceId
        doId1 = healthJson.id
      } finally {
        await mf1.dispose()
      }

      // Second instance - simulate restart
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)
        const healthResponse = await stub2.fetch('http://fake/health')
        const healthJson = await healthResponse.json() as { id: string; instanceId: string }

        // DO ID should be the same (same name)
        expect(healthJson.id).toBe(doId1)
        // Instance ID should be different (new JS instance)
        expect(healthJson.instanceId).not.toBe(instanceId1)
      } finally {
        await mf2.dispose()
      }
    })
  })

  // ==========================================================================
  // 3. SQLITE DATA PERSISTS ACROSS DO RESTARTS
  // ==========================================================================

  describe('3. SQLite data persists across DO restarts', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should persist SQLite row data across restarts', async () => {
      const doName = generateTestId()

      // First instance - insert data
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/sql/insert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'persist-test', value: 'persisted-value' }),
        })

        // Verify it was inserted
        const getResponse = await stub1.fetch('http://fake/sql/get?key=persist-test')
        const getJson = await getResponse.json() as { row: SQLiteRow }
        expect(getJson.row.value).toBe('persisted-value')
      } finally {
        await mf1.dispose()
      }

      // Second instance - read data after restart
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const getResponse = await stub2.fetch('http://fake/sql/get?key=persist-test')
        const getJson = await getResponse.json() as { row: SQLiteRow }

        expect(getJson.row).not.toBeNull()
        expect(getJson.row.key).toBe('persist-test')
        expect(getJson.row.value).toBe('persisted-value')
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist multiple SQLite rows across restarts', async () => {
      const doName = generateTestId()

      // First instance - insert multiple rows
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        for (let i = 0; i < 5; i++) {
          await stub1.fetch('http://fake/sql/insert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: `row-${i}`, value: `value-${i}` }),
          })
        }

        const countResponse = await stub1.fetch('http://fake/sql/count')
        const countJson = await countResponse.json() as { count: number }
        expect(countJson.count).toBe(5)
      } finally {
        await mf1.dispose()
      }

      // Second instance - verify all rows
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const countResponse = await stub2.fetch('http://fake/sql/count')
        const countJson = await countResponse.json() as { count: number }
        expect(countJson.count).toBe(5)

        const listResponse = await stub2.fetch('http://fake/sql/list')
        const listJson = await listResponse.json() as { rows: SQLiteRow[] }
        expect(listJson.rows).toHaveLength(5)
      } finally {
        await mf2.dispose()
      }
    })

    it('should preserve auto-increment IDs across restarts', async () => {
      const doName = generateTestId()

      // First instance - insert some rows
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let lastId: number
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        for (let i = 0; i < 3; i++) {
          const response = await stub1.fetch('http://fake/sql/insert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: `auto-${i}`, value: `value-${i}` }),
          })
          const json = await response.json() as { id: number }
          lastId = json.id
        }
      } finally {
        await mf1.dispose()
      }

      // Second instance - new inserts should continue from last ID
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/sql/insert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'auto-new', value: 'new-value' }),
        })
        const json = await response.json() as { id: number }

        // New ID should be greater than last ID from previous instance
        expect(json.id).toBeGreaterThan(lastId!)
      } finally {
        await mf2.dispose()
      }
    })
  })

  // ==========================================================================
  // 4. STORAGE.PUT DATA PERSISTS ACROSS RESTARTS
  // ==========================================================================

  describe('4. Storage.put data persists across restarts', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should persist storage.put data across restarts', async () => {
      const doName = generateTestId()

      // First instance - write data
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/storage/put', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'kv-persist', value: { foo: 'bar', num: 123 } }),
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance - read data
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/storage/get?key=kv-persist')
        const json = await response.json() as { value: { foo: string; num: number } }

        expect(json.value).toEqual({ foo: 'bar', num: 123 })
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist array data across restarts', async () => {
      const doName = generateTestId()

      const arrayData = [1, 'two', { three: 3 }, [4, 5], null, true]

      // First instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/storage/put', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'array-key', value: arrayData }),
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/storage/get?key=array-key')
        const json = await response.json() as { value: typeof arrayData }

        expect(json.value).toEqual(arrayData)
      } finally {
        await mf2.dispose()
      }
    })

    it('should handle storage deletion and verify it persists', async () => {
      const doName = generateTestId()

      // First instance - write then delete
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/storage/put', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'to-delete', value: 'will-be-deleted' }),
        })

        await stub1.fetch('http://fake/storage/delete?key=to-delete', { method: 'DELETE' })
      } finally {
        await mf1.dispose()
      }

      // Second instance - verify deleted
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/storage/get?key=to-delete')
        const json = await response.json() as { value: unknown }

        expect(json.value).toBeNull()
      } finally {
        await mf2.dispose()
      }
    })
  })

  // ==========================================================================
  // 5. ALARMS SCHEDULED PERSIST ACROSS RESTARTS
  // ==========================================================================

  describe('5. Alarms scheduled persist across restarts', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should persist scheduled alarm across restart', async () => {
      const doName = generateTestId()
      const alarmId = `alarm-${generateTestId()}`

      // First instance - schedule an alarm
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let scheduledTime: number
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        const scheduleResponse = await stub1.fetch('http://fake/alarm/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delayMs: 60000, alarmId }), // 1 minute in the future
        })
        const scheduleJson = await scheduleResponse.json() as { scheduledTime: number }
        scheduledTime = scheduleJson.scheduledTime

        // Verify alarm is scheduled
        const statusResponse = await stub1.fetch('http://fake/alarm/status')
        const statusJson = await statusResponse.json() as AlarmStatus & { alarmMetadata: { alarmId: string } }
        expect(statusJson.hasScheduledAlarm).toBe(true)
        expect(statusJson.alarmMetadata.alarmId).toBe(alarmId)
      } finally {
        await mf1.dispose()
      }

      // Second instance - alarm should still be scheduled
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const statusResponse = await stub2.fetch('http://fake/alarm/status')
        const statusJson = await statusResponse.json() as AlarmStatus & {
          hasScheduledAlarm: boolean
          scheduledAlarmTime: number
          alarmMetadata: { alarmId: string; scheduledTime: number }
        }

        // The alarm should still be scheduled after restart
        expect(statusJson.hasScheduledAlarm).toBe(true)
        expect(statusJson.alarmMetadata.alarmId).toBe(alarmId)
        expect(statusJson.alarmMetadata.scheduledTime).toBe(scheduledTime!)
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist alarm metadata across restart even if alarm is cancelled', async () => {
      const doName = generateTestId()
      const alarmId = `alarm-${generateTestId()}`

      // First instance - schedule then cancel
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/alarm/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delayMs: 60000, alarmId }),
        })

        await stub1.fetch('http://fake/alarm/cancel', { method: 'POST' })
      } finally {
        await mf1.dispose()
      }

      // Second instance - alarm should be cancelled
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const statusResponse = await stub2.fetch('http://fake/alarm/status')
        const statusJson = await statusResponse.json() as AlarmStatus & { hasScheduledAlarm: boolean }

        expect(statusJson.hasScheduledAlarm).toBe(false)
      } finally {
        await mf2.dispose()
      }
    })
  })

  // ==========================================================================
  // 6. TRANSACTIONAL WRITES PERSIST ATOMICALLY
  // ==========================================================================

  describe('6. Transactional writes persist atomically', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should persist all items from a transaction atomically', async () => {
      const doName = generateTestId()
      const txId = `tx-${generateTestId()}`

      // First instance - execute transaction
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        const response = await stub1.fetch('http://fake/sql/transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txId,
            operations: [
              { type: 'insert', key: 'tx-item-1', value: 'value-1' },
              { type: 'insert', key: 'tx-item-2', value: 'value-2' },
              { type: 'insert', key: 'tx-item-3', value: 'value-3' },
            ],
          }),
        })

        expect(response.status).toBe(200)
      } finally {
        await mf1.dispose()
      }

      // Second instance - all items should be there
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        // Check each item exists
        for (let i = 1; i <= 3; i++) {
          const response = await stub2.fetch(`http://fake/sql/get?key=tx-item-${i}`)
          const json = await response.json() as { row: SQLiteRow }
          expect(json.row).not.toBeNull()
          expect(json.row.value).toBe(`value-${i}`)
        }

        // Check transaction log
        const logResponse = await stub2.fetch(`http://fake/sql/transaction/log?txId=${txId}`)
        const logJson = await logResponse.json() as { logs: { operation: string; status: string }[] }

        expect(logJson.logs.some(l => l.operation === 'START')).toBe(true)
        expect(logJson.logs.some(l => l.operation === 'COMMIT')).toBe(true)
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist transaction log across restarts', async () => {
      const doName = generateTestId()
      const txId = `tx-${generateTestId()}`

      // First instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/sql/transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txId,
            operations: [
              { type: 'insert', key: 'log-item', value: 'logged' },
            ],
          }),
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance - transaction log should be available
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const logResponse = await stub2.fetch(`http://fake/sql/transaction/log?txId=${txId}`)
        const logJson = await logResponse.json() as { logs: { tx_id: string; operation: string }[] }

        expect(logJson.logs.length).toBeGreaterThan(0)
        expect(logJson.logs.every(l => l.tx_id === txId)).toBe(true)
      } finally {
        await mf2.dispose()
      }
    })
  })

  // ==========================================================================
  // 7. PARTIAL TRANSACTION ROLLBACK DOESN'T PERSIST
  // ==========================================================================

  describe('7. Partial transaction rollback does not persist', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should not persist data from failed transactions', async () => {
      const doName = generateTestId()
      const txId = `tx-fail-${generateTestId()}`

      // First instance - execute failing transaction
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        const response = await stub1.fetch('http://fake/sql/transaction/failing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txId,
            failAtIndex: 2, // Fail after inserting first 2 items
            operations: [
              { type: 'insert', key: 'rollback-1', value: 'should-not-persist' },
              { type: 'insert', key: 'rollback-2', value: 'should-not-persist' },
              { type: 'insert', key: 'rollback-3', value: 'will-never-run' },
            ],
          }),
        })

        expect(response.status).toBe(500)
      } finally {
        await mf1.dispose()
      }

      // Second instance - no items from failed transaction should exist
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        // None of the items should exist due to rollback
        for (let i = 1; i <= 3; i++) {
          const response = await stub2.fetch(`http://fake/sql/get?key=rollback-${i}`)
          const json = await response.json() as { row: SQLiteRow | null }
          expect(json.row).toBeNull()
        }

        // Transaction log should show rollback
        const logResponse = await stub2.fetch(`http://fake/sql/transaction/log?txId=${txId}`)
        const logJson = await logResponse.json() as { logs: { operation: string; status: string }[] }

        // Should have START and ROLLBACK, but not COMMIT
        expect(logJson.logs.some(l => l.operation === 'START')).toBe(true)
        expect(logJson.logs.some(l => l.operation === 'ROLLBACK')).toBe(true)
        expect(logJson.logs.some(l => l.operation === 'COMMIT')).toBe(false)
      } finally {
        await mf2.dispose()
      }
    })

    it('should isolate failed transaction from successful ones', async () => {
      const doName = generateTestId()
      const successTxId = `tx-success-${generateTestId()}`
      const failTxId = `tx-fail-${generateTestId()}`

      // First instance - one successful, one failed transaction
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        // Successful transaction first
        await stub1.fetch('http://fake/sql/transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txId: successTxId,
            operations: [
              { type: 'insert', key: 'success-item', value: 'persisted' },
            ],
          }),
        })

        // Failed transaction
        await stub1.fetch('http://fake/sql/transaction/failing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txId: failTxId,
            failAtIndex: 0,
            operations: [
              { type: 'insert', key: 'fail-item', value: 'not-persisted' },
            ],
          }),
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance - only successful transaction data should exist
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const successResponse = await stub2.fetch('http://fake/sql/get?key=success-item')
        const successJson = await successResponse.json() as { row: SQLiteRow }
        expect(successJson.row).not.toBeNull()
        expect(successJson.row.value).toBe('persisted')

        const failResponse = await stub2.fetch('http://fake/sql/get?key=fail-item')
        const failJson = await failResponse.json() as { row: SQLiteRow | null }
        expect(failJson.row).toBeNull()
      } finally {
        await mf2.dispose()
      }
    })
  })

  // ==========================================================================
  // 8. LARGE DATA (> 128KB) PERSISTS CORRECTLY
  // ==========================================================================

  describe('8. Large data (> 128KB) persists correctly', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should persist 128KB of data', async () => {
      const doName = generateTestId()
      const sizeKB = 128

      // First instance - write large data
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        const response = await stub1.fetch('http://fake/storage/put-large', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'large-128kb', sizeKB }),
        })
        const json = await response.json() as { size: number }
        expect(json.size).toBe(sizeKB * 1024)
      } finally {
        await mf1.dispose()
      }

      // Second instance - read large data
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/storage/get-large?key=large-128kb')
        const json = await response.json() as { size: number; exists: boolean }

        expect(json.exists).toBe(true)
        expect(json.size).toBe(sizeKB * 1024)
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist 256KB of data', async () => {
      const doName = generateTestId()
      const sizeKB = 256

      // First instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/storage/put-large', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'large-256kb', sizeKB }),
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/storage/get-large?key=large-256kb')
        const json = await response.json() as { size: number; exists: boolean }

        expect(json.exists).toBe(true)
        expect(json.size).toBe(sizeKB * 1024)
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist 1MB of data', async () => {
      const doName = generateTestId()
      const sizeKB = 1024 // 1MB

      // First instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/storage/put-large', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'large-1mb', sizeKB }),
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/storage/get-large?key=large-1mb')
        const json = await response.json() as { size: number; exists: boolean }

        expect(json.exists).toBe(true)
        expect(json.size).toBe(sizeKB * 1024)
      } finally {
        await mf2.dispose()
      }
    })
  })

  // ==========================================================================
  // 9. BINARY DATA PERSISTS WITHOUT CORRUPTION
  // ==========================================================================

  describe('9. Binary data persists without corruption', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should persist binary data in storage without corruption', async () => {
      const doName = generateTestId()

      // Create test binary data with various byte values
      const binaryData = new Uint8Array(256)
      for (let i = 0; i < 256; i++) {
        binaryData[i] = i
      }

      // First instance - write binary data
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        const response = await stub1.fetch('http://fake/storage/put-binary?key=binary-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: binaryData,
        })
        const json = await response.json() as { size: number }
        expect(json.size).toBe(256)
      } finally {
        await mf1.dispose()
      }

      // Second instance - read and verify binary data
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/storage/get-binary?key=binary-test')
        expect(response.status).toBe(200)

        const buffer = await response.arrayBuffer()
        const retrievedData = new Uint8Array(buffer)

        expect(retrievedData.length).toBe(256)
        // Verify each byte
        for (let i = 0; i < 256; i++) {
          expect(retrievedData[i]).toBe(i)
        }
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist binary data in SQLite without corruption', async () => {
      const doName = generateTestId()

      // Create random binary data
      const binaryData = new Uint8Array(1024)
      let expectedChecksum = 0
      for (let i = 0; i < 1024; i++) {
        binaryData[i] = Math.floor(Math.random() * 256)
        expectedChecksum = (expectedChecksum + binaryData[i]) & 0xFFFFFFFF
      }

      // First instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      let storedChecksum: string
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        const response = await stub1.fetch('http://fake/sql/binary/insert?key=sql-binary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: binaryData,
        })
        const json = await response.json() as { checksum: string }
        storedChecksum = json.checksum
      } finally {
        await mf1.dispose()
      }

      // Second instance - verify checksum
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/sql/binary/get?key=sql-binary')
        const json = await response.json() as { size: number; checksum: string; dataLength: number }

        expect(json.size).toBe(1024)
        expect(json.dataLength).toBe(1024)
        expect(json.checksum).toBe(storedChecksum!)
      } finally {
        await mf2.dispose()
      }
    })

    it('should preserve null bytes in binary data', async () => {
      const doName = generateTestId()

      // Binary data with null bytes
      const binaryData = new Uint8Array([0, 0, 255, 0, 127, 0, 0, 1, 0])

      // First instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/storage/put-binary?key=null-bytes', {
          method: 'POST',
          body: binaryData,
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/storage/get-binary?key=null-bytes')
        const buffer = await response.arrayBuffer()
        const retrieved = new Uint8Array(buffer)

        expect(retrieved).toEqual(binaryData)
      } finally {
        await mf2.dispose()
      }
    })
  })

  // ==========================================================================
  // 10. UNICODE DATA PERSISTS CORRECTLY
  // ==========================================================================

  describe('10. Unicode data persists correctly', () => {
    let persistDir: string

    beforeEach(() => {
      persistDir = createTempDir()
    })

    afterEach(() => {
      cleanupTempDir(persistDir)
    })

    it('should persist basic Unicode characters', async () => {
      const doName = generateTestId()
      const unicodeText = 'Hello, World! \u00e9\u00e8\u00ea \u00fc\u00f6\u00e4'

      // First instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/storage/put', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'unicode-basic', value: unicodeText }),
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/storage/get?key=unicode-basic')
        const json = await response.json() as { value: string }

        expect(json.value).toBe(unicodeText)
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist emojis', async () => {
      const doName = generateTestId()
      const emojiText = '\uD83D\uDE00\uD83D\uDE0D\uD83D\uDE80\uD83C\uDF89\uD83C\uDF1F\uD83D\uDC4D\u2764\uFE0F\uD83D\uDD25'

      // First instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/storage/put', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'unicode-emoji', value: emojiText }),
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/storage/get?key=unicode-emoji')
        const json = await response.json() as { value: string }

        expect(json.value).toBe(emojiText)
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist CJK characters', async () => {
      const doName = generateTestId()
      const cjkText = '\u4E2D\u6587 \u65E5\u672C\u8A9E \uD55C\uAD6D\uC5B4'

      // First instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/sql/unicode/insert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'unicode-cjk', text: cjkText }),
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/sql/unicode/get?key=unicode-cjk')
        const json = await response.json() as { row: { text: string } }

        expect(json.row.text).toBe(cjkText)
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist RTL scripts (Arabic, Hebrew)', async () => {
      const doName = generateTestId()
      const rtlText = '\u0645\u0631\u062D\u0628\u0627 \u05E9\u05DC\u05D5\u05DD'

      // First instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/sql/unicode/insert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'unicode-rtl', text: rtlText }),
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/sql/unicode/get?key=unicode-rtl')
        const json = await response.json() as { row: { text: string } }

        expect(json.row.text).toBe(rtlText)
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist mixed Unicode from multiple scripts', async () => {
      const doName = generateTestId()
      const mixedText = 'Hello \u4E16\u754C \uD83C\uDF0D \u041F\u0440\u0438\u0432\u0435\u0442 \u0645\u0631\u062D\u0628\u0627'

      // First instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/storage/put', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'unicode-mixed', value: mixedText }),
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/storage/get?key=unicode-mixed')
        const json = await response.json() as { value: string }

        expect(json.value).toBe(mixedText)
      } finally {
        await mf2.dispose()
      }
    })

    it('should persist surrogate pairs correctly', async () => {
      const doName = generateTestId()
      // Characters outside BMP require surrogate pairs
      const surrogatePairText = '\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66' // Family emoji (composed)

      // First instance
      let mf1 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub1 = await getPersistenceDOStub(mf1, doName)

        await stub1.fetch('http://fake/storage/put', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'unicode-surrogate', value: surrogatePairText }),
        })
      } finally {
        await mf1.dispose()
      }

      // Second instance
      let mf2 = new Miniflare(getMiniflareConfig(persistDir))
      try {
        const stub2 = await getPersistenceDOStub(mf2, doName)

        const response = await stub2.fetch('http://fake/storage/get?key=unicode-surrogate')
        const json = await response.json() as { value: string }

        expect(json.value).toBe(surrogatePairText)
        expect(json.value.length).toBe(surrogatePairText.length)
      } finally {
        await mf2.dispose()
      }
    })
  })
})
