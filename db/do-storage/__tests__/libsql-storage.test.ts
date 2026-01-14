/**
 * LibSQLStorage Test Suite (TDD)
 *
 * RED phase: All tests should fail initially.
 * These tests verify the DurableObjectStorage-compatible API backed by libSQL.
 *
 * @see dotdo-hstgj libSQL DO Storage Adapter (TDD)
 * @see dotdo-kselw RED: libSQL Storage get/put/delete tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LibSQLStorage, StorageLimitError, DEFAULT_STORAGE_LIMITS } from '../libsql-storage'

// Mock R2 bucket for Iceberg integration tests
function createMockR2(): R2BucketLike {
  const store = new Map<string, ArrayBuffer | string>()

  return {
    async put(key: string, body: ArrayBuffer | string): Promise<unknown> {
      store.set(key, body)
      return {}
    },
    async get(key: string): Promise<R2ObjectLike | null> {
      const data = store.get(key)
      if (!data) return null
      return {
        key,
        async json() {
          if (typeof data === 'string') return JSON.parse(data)
          return JSON.parse(new TextDecoder().decode(data))
        },
        async arrayBuffer() {
          if (typeof data === 'string') return new TextEncoder().encode(data).buffer
          return data
        },
      }
    },
    async list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }> {
      const objects: { key: string }[] = []
      for (const key of store.keys()) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          objects.push({ key })
        }
      }
      return { objects }
    },
    async delete(key: string): Promise<void> {
      store.delete(key)
    },
  }
}

interface R2BucketLike {
  put(key: string, body: ArrayBuffer | string): Promise<unknown>
  get(key: string): Promise<R2ObjectLike | null>
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>
  delete(key: string): Promise<void>
}

interface R2ObjectLike {
  key: string
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
}

describe('LibSQLStorage', () => {
  let storage: LibSQLStorage
  const doId = 'test-do-123'

  beforeEach(() => {
    storage = new LibSQLStorage({
      doId,
      tursoUrl: ':memory:', // In-memory for unit tests
    })
  })

  // ============================================================================
  // GET TESTS
  // ============================================================================

  describe('get', () => {
    it('returns undefined for non-existent key', async () => {
      const result = await storage.get('missing')
      expect(result).toBeUndefined()
    })

    it('returns stored value for existing key', async () => {
      await storage.put('key', { foo: 'bar' })
      const result = await storage.get('key')
      expect(result).toEqual({ foo: 'bar' })
    })

    it('handles complex nested objects', async () => {
      const complex = { a: { b: { c: [1, 2, 3] } } }
      await storage.put('complex', complex)
      expect(await storage.get('complex')).toEqual(complex)
    })

    it('handles primitive string values', async () => {
      await storage.put('str', 'hello world')
      expect(await storage.get('str')).toBe('hello world')
    })

    it('handles primitive number values', async () => {
      await storage.put('num', 42)
      expect(await storage.get('num')).toBe(42)
    })

    it('handles boolean values', async () => {
      await storage.put('bool', true)
      expect(await storage.get('bool')).toBe(true)
    })

    it('handles null values', async () => {
      await storage.put('null', null)
      expect(await storage.get('null')).toBeNull()
    })

    it('handles array values', async () => {
      const arr = [1, 'two', { three: 3 }]
      await storage.put('arr', arr)
      expect(await storage.get('arr')).toEqual(arr)
    })

    it('supports batch get with array of keys', async () => {
      await storage.put('a', 1)
      await storage.put('b', 2)
      await storage.put('c', 3)

      const result = await storage.get(['a', 'b', 'c'])
      expect(result).toBeInstanceOf(Map)
      expect(result.get('a')).toBe(1)
      expect(result.get('b')).toBe(2)
      expect(result.get('c')).toBe(3)
    })

    it('batch get excludes missing keys from Map', async () => {
      await storage.put('exists', 'value')

      const result = await storage.get(['exists', 'missing'])
      expect(result).toBeInstanceOf(Map)
      expect(result.get('exists')).toBe('value')
      expect(result.has('missing')).toBe(false)
    })
  })

  // ============================================================================
  // PUT TESTS
  // ============================================================================

  describe('put', () => {
    it('stores string values', async () => {
      await storage.put('key', 'value')
      expect(await storage.get('key')).toBe('value')
    })

    it('stores number values', async () => {
      await storage.put('key', 12345)
      expect(await storage.get('key')).toBe(12345)
    })

    it('stores object values', async () => {
      const obj = { name: 'test', value: 123 }
      await storage.put('key', obj)
      expect(await storage.get('key')).toEqual(obj)
    })

    it('stores array values', async () => {
      const arr = [1, 2, 3, 4, 5]
      await storage.put('key', arr)
      expect(await storage.get('key')).toEqual(arr)
    })

    it('overwrites existing values', async () => {
      await storage.put('key', 'first')
      await storage.put('key', 'second')
      expect(await storage.get('key')).toBe('second')
    })

    it('handles Date objects', async () => {
      const date = new Date('2026-01-13T12:00:00Z')
      await storage.put('date', date)
      const result = await storage.get<Date>('date')
      // KV stores keep Date objects as-is (same as CF DO storage)
      expect(result).toEqual(date)
    })

    it('handles Uint8Array (binary data)', async () => {
      const binary = new Uint8Array([1, 2, 3, 4, 5])
      await storage.put('binary', binary)
      const result = await storage.get<Uint8Array>('binary')
      expect(new Uint8Array(result as ArrayBuffer)).toEqual(binary)
    })

    it('supports batch put with object', async () => {
      await storage.put({ a: 1, b: 2, c: 3 })
      expect(await storage.get('a')).toBe(1)
      expect(await storage.get('b')).toBe(2)
      expect(await storage.get('c')).toBe(3)
    })
  })

  // ============================================================================
  // DELETE TESTS
  // ============================================================================

  describe('delete', () => {
    it('returns true when key existed', async () => {
      await storage.put('key', 'value')
      const result = await storage.delete('key')
      expect(result).toBe(true)
    })

    it('returns false when key did not exist', async () => {
      const result = await storage.delete('nonexistent')
      expect(result).toBe(false)
    })

    it('removes the key from storage', async () => {
      await storage.put('key', 'value')
      await storage.delete('key')
      expect(await storage.get('key')).toBeUndefined()
    })

    it('supports batch delete with array of keys', async () => {
      await storage.put('a', 1)
      await storage.put('b', 2)
      await storage.put('c', 3)

      const deleted = await storage.delete(['a', 'b'])
      expect(deleted).toBe(2)
      expect(await storage.get('a')).toBeUndefined()
      expect(await storage.get('b')).toBeUndefined()
      expect(await storage.get('c')).toBe(3)
    })
  })

  // ============================================================================
  // DELETE ALL TESTS
  // ============================================================================

  describe('deleteAll', () => {
    it('removes all keys from storage', async () => {
      await storage.put('a', 1)
      await storage.put('b', 2)
      await storage.put('c', 3)

      await storage.deleteAll()

      expect(await storage.get('a')).toBeUndefined()
      expect(await storage.get('b')).toBeUndefined()
      expect(await storage.get('c')).toBeUndefined()
    })

    it('is safe to call on empty storage', async () => {
      await expect(storage.deleteAll()).resolves.not.toThrow()
    })
  })

  // ============================================================================
  // LIST TESTS
  // ============================================================================

  describe('list', () => {
    beforeEach(async () => {
      await storage.put('users:1', { name: 'Alice' })
      await storage.put('users:2', { name: 'Bob' })
      await storage.put('orders:100', { total: 50 })
      await storage.put('orders:101', { total: 75 })
      await storage.put('settings', { theme: 'dark' })
    })

    it('returns all entries without options', async () => {
      const result = await storage.list()
      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(5)
    })

    it('filters by prefix', async () => {
      const result = await storage.list({ prefix: 'users:' })
      expect(result.size).toBe(2)
      expect(result.has('users:1')).toBe(true)
      expect(result.has('users:2')).toBe(true)
      expect(result.has('orders:100')).toBe(false)
    })

    it('respects limit option', async () => {
      const result = await storage.list({ limit: 2 })
      expect(result.size).toBe(2)
    })

    it('supports start option (inclusive)', async () => {
      const result = await storage.list({ start: 'orders:101' })
      // Should include orders:101 and all keys lexicographically after
      expect(result.has('orders:101')).toBe(true)
    })

    it('supports startAfter option (exclusive)', async () => {
      const result = await storage.list({ startAfter: 'orders:100' })
      expect(result.has('orders:100')).toBe(false)
      expect(result.has('orders:101')).toBe(true)
    })

    it('supports end option (exclusive)', async () => {
      const result = await storage.list({ end: 'orders:101' })
      expect(result.has('orders:100')).toBe(true)
      expect(result.has('orders:101')).toBe(false)
    })

    it('supports reverse option', async () => {
      const normalResult = await storage.list({ prefix: 'users:', limit: 1 })
      const reverseResult = await storage.list({
        prefix: 'users:',
        limit: 1,
        reverse: true,
      })

      const normalFirst = [...normalResult.keys()][0]
      const reverseFirst = [...reverseResult.keys()][0]

      expect(normalFirst).not.toBe(reverseFirst)
    })

    it('returns empty Map for no matches', async () => {
      const result = await storage.list({ prefix: 'nonexistent:' })
      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(0)
    })
  })

  // ============================================================================
  // SQL API TESTS
  // ============================================================================

  describe('sql', () => {
    it('has sql property', () => {
      expect(storage.sql).toBeDefined()
    })

    describe('exec', () => {
      it('creates tables', () => {
        const result = storage.sql.exec(
          'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)'
        )
        expect(result).toBeDefined()
      })

      it('inserts data', () => {
        storage.sql.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
        storage.sql.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')")

        const result = storage.sql.exec('SELECT * FROM users')
        const rows = result.toArray()
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ id: 1, name: 'Alice' })
      })

      it('supports parameterized queries', () => {
        storage.sql.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
        storage.sql.exec('INSERT INTO users (id, name) VALUES (?, ?)', 1, 'Bob')

        const result = storage.sql.exec('SELECT * FROM users WHERE id = ?', 1)
        const rows = result.toArray()
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ name: 'Bob' })
      })

      it('updates data', () => {
        storage.sql.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
        storage.sql.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')")
        storage.sql.exec("UPDATE users SET name = 'Alice Updated' WHERE id = 1")

        const result = storage.sql.exec('SELECT name FROM users WHERE id = 1')
        expect(result.toArray()[0]).toMatchObject({ name: 'Alice Updated' })
      })

      it('deletes data', () => {
        storage.sql.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
        storage.sql.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')")
        storage.sql.exec("INSERT INTO users (id, name) VALUES (2, 'Bob')")
        storage.sql.exec('DELETE FROM users WHERE id = 1')

        const result = storage.sql.exec('SELECT * FROM users')
        expect(result.toArray()).toHaveLength(1)
      })
    })

    describe('cursor methods', () => {
      beforeEach(() => {
        storage.sql.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)')
        storage.sql.exec("INSERT INTO items (id, value) VALUES (1, 'a'), (2, 'b'), (3, 'c')")
      })

      it('toArray returns all rows', () => {
        const result = storage.sql.exec('SELECT * FROM items')
        const rows = result.toArray()
        expect(rows).toHaveLength(3)
      })

      it('one returns first row', () => {
        const result = storage.sql.exec('SELECT * FROM items ORDER BY id')
        const row = result.one()
        expect(row).toMatchObject({ id: 1, value: 'a' })
      })

      it('raw returns rows as arrays', () => {
        const result = storage.sql.exec('SELECT id, value FROM items ORDER BY id LIMIT 1')
        const raw = result.raw()
        expect(raw).toEqual([[1, 'a']])
      })

      it('columnNames returns column names', () => {
        const result = storage.sql.exec('SELECT id, value FROM items')
        expect(result.columnNames).toEqual(['id', 'value'])
      })

      it('rowsRead tracks rows accessed', () => {
        const result = storage.sql.exec('SELECT * FROM items')
        result.toArray() // Consume the cursor
        expect(result.rowsRead).toBe(3)
      })

      it('rowsWritten tracks rows modified', () => {
        const result = storage.sql.exec('INSERT INTO items (id, value) VALUES (4, "d")')
        expect(result.rowsWritten).toBe(1)
      })
    })
  })

  // ============================================================================
  // TRANSACTION TESTS
  // ============================================================================

  describe('transaction', () => {
    it('commits changes on success', async () => {
      await storage.transaction(async (txn) => {
        await txn.put('key1', 'value1')
        await txn.put('key2', 'value2')
      })

      expect(await storage.get('key1')).toBe('value1')
      expect(await storage.get('key2')).toBe('value2')
    })

    it('rolls back changes on error', async () => {
      await storage.put('existing', 'original')

      await expect(
        storage.transaction(async (txn) => {
          await txn.put('existing', 'modified')
          await txn.put('new', 'value')
          throw new Error('Intentional error')
        })
      ).rejects.toThrow('Intentional error')

      expect(await storage.get('existing')).toBe('original')
      expect(await storage.get('new')).toBeUndefined()
    })

    it('supports nested operations', async () => {
      await storage.transaction(async (txn) => {
        await txn.put('counter', 0)

        for (let i = 1; i <= 5; i++) {
          const current = (await txn.get<number>('counter')) ?? 0
          await txn.put('counter', current + 1)
        }
      })

      expect(await storage.get('counter')).toBe(5)
    })

    it('returns value from transaction callback', async () => {
      const result = await storage.transaction(async (txn) => {
        await txn.put('key', 'value')
        return 'transaction result'
      })

      expect(result).toBe('transaction result')
    })

    it('transaction provides get/put/delete/list', async () => {
      await storage.put('pre-existing', 'value')

      await storage.transaction(async (txn) => {
        // get
        expect(await txn.get('pre-existing')).toBe('value')

        // put
        await txn.put('new-key', 'new-value')
        expect(await txn.get('new-key')).toBe('new-value')

        // delete
        const deleted = await txn.delete('pre-existing')
        expect(deleted).toBe(true)
        expect(await txn.get('pre-existing')).toBeUndefined()

        // list
        const list = await txn.list()
        expect(list.has('new-key')).toBe(true)
        expect(list.has('pre-existing')).toBe(false)
      })
    })

    it('isolates concurrent transactions', async () => {
      await storage.put('counter', 0)

      // Start two concurrent transactions
      const txn1Promise = storage.transaction(async (txn) => {
        const val = await txn.get<number>('counter')
        await new Promise((r) => setTimeout(r, 10)) // Simulate work
        await txn.put('counter', (val ?? 0) + 1)
      })

      const txn2Promise = storage.transaction(async (txn) => {
        const val = await txn.get<number>('counter')
        await txn.put('counter', (val ?? 0) + 1)
      })

      await Promise.all([txn1Promise, txn2Promise])

      // Should be 2 if properly serialized, could be 1 if not isolated
      const final = await storage.get<number>('counter')
      expect(final).toBe(2)
    })
  })

  // ============================================================================
  // ICEBERG CHECKPOINT/RESTORE TESTS
  // ============================================================================

  describe('checkpoint', () => {
    let storageWithR2: LibSQLStorage
    let mockR2: R2BucketLike

    beforeEach(() => {
      mockR2 = createMockR2()
      storageWithR2 = new LibSQLStorage({
        doId,
        tursoUrl: ':memory:',
        r2Bucket: mockR2,
      })
    })

    it('creates an Iceberg snapshot', async () => {
      await storageWithR2.put('key1', 'value1')
      await storageWithR2.put('key2', { nested: 'object' })

      const snapshotId = await storageWithR2.checkpoint()

      expect(snapshotId).toBeDefined()
      expect(typeof snapshotId).toBe('string')
      expect(snapshotId.length).toBeGreaterThan(0)
    })

    it('returns unique snapshot IDs', async () => {
      await storageWithR2.put('key', 'value')

      const snapshot1 = await storageWithR2.checkpoint()
      await storageWithR2.put('key', 'updated')
      const snapshot2 = await storageWithR2.checkpoint()

      expect(snapshot1).not.toBe(snapshot2)
    })

    it('includes SQL tables in checkpoint', async () => {
      storageWithR2.sql.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      storageWithR2.sql.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')")
      storageWithR2.sql.exec("INSERT INTO users (id, name) VALUES (2, 'Bob')")

      const snapshotId = await storageWithR2.checkpoint()

      // Verify snapshot was created (implementation detail check)
      const manifest = await mockR2.get(`do/${doId}/metadata/${snapshotId}.json`)
      expect(manifest).not.toBeNull()
    })

    it('throws if R2 not configured', async () => {
      await storage.put('key', 'value')
      await expect(storage.checkpoint()).rejects.toThrow('R2 bucket not configured')
    })
  })

  describe('restore', () => {
    let storageWithR2: LibSQLStorage
    let mockR2: R2BucketLike

    beforeEach(() => {
      mockR2 = createMockR2()
      storageWithR2 = new LibSQLStorage({
        doId,
        tursoUrl: ':memory:',
        r2Bucket: mockR2,
      })
    })

    it('restores KV data from snapshot', async () => {
      // Create initial state
      await storageWithR2.put('key1', 'value1')
      await storageWithR2.put('key2', 'value2')

      const snapshotId = await storageWithR2.checkpoint()

      // Modify state
      await storageWithR2.put('key1', 'modified')
      await storageWithR2.delete('key2')
      await storageWithR2.put('key3', 'new')

      // Restore
      await storageWithR2.restore(snapshotId)

      expect(await storageWithR2.get('key1')).toBe('value1')
      expect(await storageWithR2.get('key2')).toBe('value2')
      expect(await storageWithR2.get('key3')).toBeUndefined()
    })

    it('restores SQL tables from snapshot', async () => {
      // Create table and insert data
      storageWithR2.sql.exec('CREATE TABLE counters (id TEXT PRIMARY KEY, value INTEGER)')
      storageWithR2.sql.exec("INSERT INTO counters (id, value) VALUES ('hits', 100)")

      const snapshotId = await storageWithR2.checkpoint()

      // Modify
      storageWithR2.sql.exec("UPDATE counters SET value = 999 WHERE id = 'hits'")
      storageWithR2.sql.exec("INSERT INTO counters (id, value) VALUES ('misses', 50)")

      // Restore
      await storageWithR2.restore(snapshotId)

      const result = storageWithR2.sql.exec('SELECT * FROM counters')
      const rows = result.toArray()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: 'hits', value: 100 })
    })

    it('throws for non-existent snapshot', async () => {
      await expect(storageWithR2.restore('non-existent-snapshot-id')).rejects.toThrow(
        'Snapshot not found'
      )
    })

    it('throws if R2 not configured', async () => {
      await expect(storage.restore('any-id')).rejects.toThrow('R2 bucket not configured')
    })
  })

  // ============================================================================
  // LIBSQL SPECIFIC TESTS
  // ============================================================================

  describe('libSQL specific features', () => {
    it('supports JSON storage with json() function', () => {
      storage.sql.exec('CREATE TABLE settings (id TEXT PRIMARY KEY, data TEXT)')
      storage.sql.exec(
        "INSERT INTO settings (id, data) VALUES ('config', ?)",
        JSON.stringify({ theme: 'dark', notifications: true })
      )

      const result = storage.sql.exec('SELECT id, data FROM settings')
      const row = result.one() as { id: string; data: string }
      expect(JSON.parse(row.data)).toEqual({ theme: 'dark', notifications: true })
    })

    it('handles concurrent access safely', async () => {
      // Create a counter table
      storage.sql.exec('CREATE TABLE counter (id TEXT PRIMARY KEY, value INTEGER)')
      storage.sql.exec("INSERT INTO counter (id, value) VALUES ('main', 0)")

      // Simulate concurrent increments
      const increments = Array.from({ length: 10 }, async () => {
        await storage.transaction(async (txn) => {
          const result = txn.sql.exec("SELECT value FROM counter WHERE id = 'main'")
          const current = (result.one() as { value: number }).value
          txn.sql.exec("UPDATE counter SET value = ? WHERE id = 'main'", current + 1)
        })
      })

      await Promise.all(increments)

      const result = storage.sql.exec("SELECT value FROM counter WHERE id = 'main'")
      expect((result.one() as { value: number }).value).toBe(10)
    })
  })

  // ============================================================================
  // CF DO COMPATIBILITY TESTS
  // ============================================================================

  describe('CF DO Storage API compatibility', () => {
    it('matches DurableObjectStorage interface', () => {
      // Verify required methods exist
      expect(typeof storage.get).toBe('function')
      expect(typeof storage.put).toBe('function')
      expect(typeof storage.delete).toBe('function')
      expect(typeof storage.deleteAll).toBe('function')
      expect(typeof storage.list).toBe('function')
      expect(typeof storage.transaction).toBe('function')
      expect(storage.sql).toBeDefined()
      expect(typeof storage.sql.exec).toBe('function')
    })

    it('get signature matches CF DO', async () => {
      // Single key
      await storage.put('key', 'value')
      const single = await storage.get('key')
      expect(single).toBe('value')

      // Multiple keys (batch)
      await storage.put('a', 1)
      await storage.put('b', 2)
      const batch = await storage.get(['a', 'b'])
      expect(batch).toBeInstanceOf(Map)
      expect(batch.get('a')).toBe(1)
    })

    it('put signature matches CF DO', async () => {
      // Single key-value
      await storage.put('single', 'value')

      // Object (batch)
      await storage.put({ batch1: 'a', batch2: 'b' })

      expect(await storage.get('single')).toBe('value')
      expect(await storage.get('batch1')).toBe('a')
      expect(await storage.get('batch2')).toBe('b')
    })

    it('delete signature matches CF DO', async () => {
      await storage.put('a', 1)
      await storage.put('b', 2)
      await storage.put('c', 3)

      // Single key returns boolean
      const singleResult = await storage.delete('a')
      expect(typeof singleResult).toBe('boolean')

      // Array returns number
      const batchResult = await storage.delete(['b', 'c'])
      expect(typeof batchResult).toBe('number')
    })

    it('list options match CF DO', async () => {
      await storage.put('key1', 1)
      await storage.put('key2', 2)
      await storage.put('key3', 3)

      // All options should be supported
      const result = await storage.list({
        start: 'key1',
        startAfter: undefined,
        end: 'key4',
        prefix: 'key',
        reverse: false,
        limit: 10,
      })

      expect(result).toBeInstanceOf(Map)
    })
  })

  // ============================================================================
  // STORAGE LIMITS TESTS
  // ============================================================================

  describe('storage limits', () => {
    describe('key size limits', () => {
      it('allows keys within size limit', async () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxKeySize: 100 },
        })

        const validKey = 'a'.repeat(50)
        await expect(storage.put(validKey, 'value')).resolves.not.toThrow()
      })

      it('throws for keys exceeding size limit', async () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxKeySize: 10 },
        })

        const oversizedKey = 'a'.repeat(20)
        await expect(storage.put(oversizedKey, 'value')).rejects.toThrow(StorageLimitError)
      })

      it('includes limit details in error', async () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxKeySize: 10 },
        })

        try {
          await storage.put('a'.repeat(20), 'value')
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(StorageLimitError)
          const limitError = error as StorageLimitError
          expect(limitError.limitType).toBe('key_size')
          expect(limitError.actualSize).toBe(20)
          expect(limitError.maxSize).toBe(10)
        }
      })

      it('respects enforceStrict=false for key size', async () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxKeySize: 10, enforceStrict: false },
        })

        const oversizedKey = 'a'.repeat(20)
        await expect(storage.put(oversizedKey, 'value')).resolves.not.toThrow()
      })
    })

    describe('value size limits', () => {
      it('allows values within size limit', async () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxValueSize: 1000 },
        })

        await expect(storage.put('key', 'x'.repeat(500))).resolves.not.toThrow()
      })

      it('throws for values exceeding size limit', async () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxValueSize: 100 },
        })

        const oversizedValue = 'x'.repeat(200)
        await expect(storage.put('key', oversizedValue)).rejects.toThrow(StorageLimitError)
      })

      it('validates object value sizes', async () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxValueSize: 50 },
        })

        const largeObject = { data: 'x'.repeat(100) }
        await expect(storage.put('key', largeObject)).rejects.toThrow(StorageLimitError)
      })
    })

    describe('batch size limits', () => {
      it('allows batch operations within limit', async () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxBatchKeys: 10 },
        })

        const entries: Record<string, number> = {}
        for (let i = 0; i < 5; i++) {
          entries[`key${i}`] = i
        }

        await expect(storage.put(entries)).resolves.not.toThrow()
      })

      it('throws for batch operations exceeding limit', async () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxBatchKeys: 5 },
        })

        const entries: Record<string, number> = {}
        for (let i = 0; i < 10; i++) {
          entries[`key${i}`] = i
        }

        await expect(storage.put(entries)).rejects.toThrow(StorageLimitError)
      })

      it('validates batch delete size', async () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxBatchKeys: 3 },
        })

        // First add some keys
        for (let i = 0; i < 5; i++) {
          await storage.put(`key${i}`, i)
        }

        // Try to delete more than batch limit
        const keysToDelete = ['key0', 'key1', 'key2', 'key3', 'key4']
        await expect(storage.delete(keysToDelete)).rejects.toThrow(StorageLimitError)
      })
    })

    describe('total storage limits', () => {
      it('allows storage within total limit', async () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxTotalStorage: 1000 },
        })

        await expect(storage.put('key1', 'small value')).resolves.not.toThrow()
        await expect(storage.put('key2', 'another small value')).resolves.not.toThrow()
      })

      it('throws when total storage would exceed limit', async () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxTotalStorage: 100, maxValueSize: 200 },
        })

        // First put should succeed
        await storage.put('key1', 'x'.repeat(50))

        // Second put should exceed total
        await expect(storage.put('key2', 'x'.repeat(60))).rejects.toThrow(StorageLimitError)
      })

      it('reclaims space on delete', async () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxTotalStorage: 100, maxValueSize: 200 },
        })

        await storage.put('key1', 'x'.repeat(50))
        await storage.delete('key1')

        // Now we should have space again
        await expect(storage.put('key2', 'x'.repeat(50))).resolves.not.toThrow()
      })

      it('resets storage on deleteAll', async () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxTotalStorage: 100, maxValueSize: 200 },
        })

        await storage.put('key1', 'x'.repeat(50))
        await storage.deleteAll()

        const stats = await storage.getStats()
        expect(stats.kvBytes).toBe(0)
      })
    })

    describe('default limits', () => {
      it('uses default limits when not specified', () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
        })

        expect(storage.limits).toEqual(DEFAULT_STORAGE_LIMITS)
      })

      it('merges custom limits with defaults', () => {
        const storage = new LibSQLStorage({
          doId: 'test',
          tursoUrl: ':memory:',
          limits: { maxKeySize: 500 },
        })

        expect(storage.limits.maxKeySize).toBe(500)
        expect(storage.limits.maxValueSize).toBe(DEFAULT_STORAGE_LIMITS.maxValueSize)
      })
    })
  })

  // ============================================================================
  // ALARM TESTS
  // ============================================================================

  describe('alarm', () => {
    describe('getAlarm', () => {
      it('returns null when no alarm is set', async () => {
        const alarm = await storage.getAlarm()
        expect(alarm).toBeNull()
      })

      it('returns the scheduled alarm time', async () => {
        const futureTime = new Date(Date.now() + 60000)
        await storage.setAlarm(futureTime)

        const alarm = await storage.getAlarm()
        expect(alarm).toEqual(futureTime)
      })
    })

    describe('setAlarm', () => {
      it('accepts Date object', async () => {
        const futureTime = new Date(Date.now() + 60000)
        await storage.setAlarm(futureTime)

        expect(await storage.getAlarm()).toEqual(futureTime)
      })

      it('accepts timestamp number', async () => {
        const futureTimestamp = Date.now() + 60000
        await storage.setAlarm(futureTimestamp)

        const alarm = await storage.getAlarm()
        expect(alarm?.getTime()).toBe(futureTimestamp)
      })

      it('throws for past time by default', async () => {
        const pastTime = new Date(Date.now() - 60000)
        await expect(storage.setAlarm(pastTime)).rejects.toThrow('Alarm time must be in the future')
      })

      it('allows past time with allowPast option', async () => {
        const pastTime = new Date(Date.now() - 60000)
        await expect(storage.setAlarm(pastTime, { allowPast: true })).resolves.not.toThrow()
      })

      it('overwrites existing alarm', async () => {
        const time1 = new Date(Date.now() + 60000)
        const time2 = new Date(Date.now() + 120000)

        await storage.setAlarm(time1)
        await storage.setAlarm(time2)

        expect(await storage.getAlarm()).toEqual(time2)
      })
    })

    describe('deleteAlarm', () => {
      it('clears the scheduled alarm', async () => {
        await storage.setAlarm(new Date(Date.now() + 60000))
        await storage.deleteAlarm()

        expect(await storage.getAlarm()).toBeNull()
      })

      it('is safe to call when no alarm is set', async () => {
        await expect(storage.deleteAlarm()).resolves.not.toThrow()
      })
    })

    describe('alarm handler', () => {
      it('fires alarm when time is reached', async () => {
        const handler = vi.fn().mockResolvedValue(undefined)
        storage.registerAlarmHandler(handler)

        // Set alarm in past with allowPast
        await storage.setAlarm(new Date(Date.now() - 1000), { allowPast: true })

        const fired = await storage.checkAndFireAlarm()
        expect(fired).toBe(true)
        expect(handler).toHaveBeenCalledOnce()
      })

      it('does not fire alarm before time', async () => {
        const handler = vi.fn()
        storage.registerAlarmHandler(handler)

        await storage.setAlarm(new Date(Date.now() + 60000))

        const fired = await storage.checkAndFireAlarm()
        expect(fired).toBe(false)
        expect(handler).not.toHaveBeenCalled()
      })

      it('clears alarm after firing', async () => {
        const handler = vi.fn().mockResolvedValue(undefined)
        storage.registerAlarmHandler(handler)

        await storage.setAlarm(new Date(Date.now() - 1000), { allowPast: true })
        await storage.checkAndFireAlarm()

        expect(await storage.getAlarm()).toBeNull()
      })

      it('re-schedules alarm if handler throws', async () => {
        const error = new Error('Handler failed')
        const handler = vi.fn().mockRejectedValue(error)
        storage.registerAlarmHandler(handler)

        const alarmTime = new Date(Date.now() - 1000)
        await storage.setAlarm(alarmTime, { allowPast: true })

        await expect(storage.checkAndFireAlarm()).rejects.toThrow('Handler failed')
        expect(await storage.getAlarm()).toEqual(alarmTime)
      })

      it('returns false when no handler is registered', async () => {
        await storage.setAlarm(new Date(Date.now() - 1000), { allowPast: true })

        const fired = await storage.checkAndFireAlarm()
        expect(fired).toBe(false)
      })
    })
  })

  // ============================================================================
  // STORAGE STATS TESTS
  // ============================================================================

  describe('storage stats', () => {
    it('returns initial stats for empty storage', async () => {
      const stats = await storage.getStats()

      expect(stats.keyCount).toBe(0)
      expect(stats.kvBytes).toBe(0)
      expect(stats.tableCount).toBe(0)
      expect(stats.sqlBytes).toBe(0)
      expect(stats.totalBytes).toBe(0)
      expect(stats.usagePercent).toBe(0)
    })

    it('tracks KV key count', async () => {
      await storage.put('key1', 'value1')
      await storage.put('key2', 'value2')
      await storage.put('key3', 'value3')

      const stats = await storage.getStats()
      expect(stats.keyCount).toBe(3)
    })

    it('tracks KV bytes', async () => {
      await storage.put('key', 'test value')

      const stats = await storage.getStats()
      expect(stats.kvBytes).toBeGreaterThan(0)
    })

    it('tracks SQL table count', async () => {
      storage.sql.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      storage.sql.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, total REAL)')

      const stats = await storage.getStats()
      expect(stats.tableCount).toBe(2)
    })

    it('tracks SQL bytes', async () => {
      storage.sql.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      storage.sql.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')")
      storage.sql.exec("INSERT INTO users (id, name) VALUES (2, 'Bob')")

      const stats = await storage.getStats()
      expect(stats.sqlBytes).toBeGreaterThan(0)
    })

    it('calculates total bytes', async () => {
      await storage.put('key', 'value')
      storage.sql.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)')
      storage.sql.exec('INSERT INTO test (id) VALUES (1)')

      const stats = await storage.getStats()
      expect(stats.totalBytes).toBe(stats.kvBytes + stats.sqlBytes)
    })

    it('includes storage limits in stats', async () => {
      const customStorage = new LibSQLStorage({
        doId: 'test',
        tursoUrl: ':memory:',
        limits: { maxTotalStorage: 500 },
      })

      const stats = await customStorage.getStats()
      expect(stats.limits.maxTotalStorage).toBe(500)
    })

    it('calculates usage percent', async () => {
      const customStorage = new LibSQLStorage({
        doId: 'test',
        tursoUrl: ':memory:',
        limits: { maxTotalStorage: 1000 },
      })

      await customStorage.put('key', 'x'.repeat(100)) // ~100 bytes

      const stats = await customStorage.getStats()
      expect(stats.usagePercent).toBeGreaterThan(0)
      expect(stats.usagePercent).toBeLessThan(100)
    })

    it('updates stats after delete', async () => {
      await storage.put('key', 'value')
      const beforeStats = await storage.getStats()

      await storage.delete('key')
      const afterStats = await storage.getStats()

      expect(afterStats.keyCount).toBeLessThan(beforeStats.keyCount)
      expect(afterStats.kvBytes).toBeLessThan(beforeStats.kvBytes)
    })

    it('updates stats after deleteAll', async () => {
      await storage.put('key1', 'value1')
      await storage.put('key2', 'value2')

      await storage.deleteAll()
      const stats = await storage.getStats()

      expect(stats.keyCount).toBe(0)
      expect(stats.kvBytes).toBe(0)
    })
  })

  // ============================================================================
  // ADDITIONAL API TESTS
  // ============================================================================

  describe('additional API', () => {
    it('exposes doId property', () => {
      const customStorage = new LibSQLStorage({
        doId: 'my-custom-do-id',
        tursoUrl: ':memory:',
      })

      expect(customStorage.doId).toBe('my-custom-do-id')
    })

    it('sync is a no-op for in-memory storage', async () => {
      await storage.put('key', 'value')
      await expect(storage.sync()).resolves.not.toThrow()
      expect(await storage.get('key')).toBe('value')
    })
  })
})
