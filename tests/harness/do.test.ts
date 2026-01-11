/**
 * MockDurableObject Factory Tests
 *
 * Tests for the DO testing utilities including:
 * - Mock storage operations
 * - Mock SQL storage
 * - Mock environment bindings
 * - DO instantiation
 * - Operation tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createMockDO,
  createMockId,
  createMockStorage,
  createMockState,
  createMockEnv,
  createMockDONamespace,
  createMockAI,
  createMockR2,
  createMockKV,
  createMockPipeline,
  createMockRequest,
  expectStorageOperation,
  expectSqlQuery,
  type MockDurableObjectState,
  type MockEnv,
} from '../do'

// ============================================================================
// SIMPLE TEST DO CLASS
// ============================================================================

/**
 * Simple test DO class for testing the factory
 */
class TestDO {
  static readonly $type = 'TestDO'

  protected ctx: MockDurableObjectState
  protected env: MockEnv

  constructor(ctx: MockDurableObjectState, env: MockEnv) {
    this.ctx = ctx
    this.env = env
  }

  async getValue(key: string): Promise<unknown> {
    return this.ctx.storage.get(key)
  }

  async setValue(key: string, value: unknown): Promise<void> {
    await this.ctx.storage.put(key, value)
  }

  async deleteValue(key: string): Promise<boolean> {
    return this.ctx.storage.delete(key) as Promise<boolean>
  }

  async listValues(prefix?: string): Promise<Map<string, unknown>> {
    return this.ctx.storage.list({ prefix })
  }

  async runSql(query: string, ...params: unknown[]): Promise<unknown[]> {
    return this.ctx.storage.sql.exec(query, ...params).toArray()
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' })
    }

    if (url.pathname === '/value') {
      const key = url.searchParams.get('key')
      if (!key) {
        return Response.json({ error: 'Missing key' }, { status: 400 })
      }
      const value = await this.getValue(key)
      return Response.json({ value })
    }

    return new Response('Not Found', { status: 404 })
  }

  getId(): string {
    return this.ctx.id.toString()
  }
}

/**
 * Extended test DO with more features
 */
class ExtendedTestDO extends TestDO {
  static override readonly $type = 'ExtendedTestDO'

  async callAI(prompt: string): Promise<unknown> {
    if (!this.env.AI) {
      throw new Error('AI not configured')
    }
    return this.env.AI.run('test-model', { prompt })
  }

  async storeInR2(key: string, value: unknown): Promise<void> {
    if (!this.env.R2) {
      throw new Error('R2 not configured')
    }
    await this.env.R2.put(key, value)
  }

  async sendToPipeline(data: unknown): Promise<void> {
    if (!this.env.PIPELINE) {
      throw new Error('PIPELINE not configured')
    }
    await this.env.PIPELINE.send(data)
  }
}

// ============================================================================
// TESTS: MOCK ID
// ============================================================================

describe('createMockId', () => {
  it('creates an ID with toString()', () => {
    const id = createMockId('test-id-123')
    expect(id.toString()).toBe('test-id-123')
  })

  it('creates random ID when not provided', () => {
    const id1 = createMockId()
    const id2 = createMockId()
    expect(id1.toString()).not.toBe(id2.toString())
    expect(id1.toString().length).toBeGreaterThan(0)
  })

  it('includes optional name', () => {
    const id = createMockId('id-123', 'my-name')
    expect(id.name).toBe('my-name')
  })

  it('equals() compares IDs correctly', () => {
    const id1 = createMockId('same-id')
    const id2 = createMockId('same-id')
    const id3 = createMockId('different-id')

    expect(id1.equals(id2)).toBe(true)
    expect(id1.equals(id3)).toBe(false)
  })
})

// ============================================================================
// TESTS: MOCK STORAGE
// ============================================================================

describe('createMockStorage', () => {
  describe('Basic Operations', () => {
    it('get/put works for simple values', async () => {
      const storage = createMockStorage()

      await storage.put('key1', 'value1')
      const result = await storage.get('key1')

      expect(result).toBe('value1')
    })

    it('get returns undefined for missing keys', async () => {
      const storage = createMockStorage()
      const result = await storage.get('nonexistent')
      expect(result).toBeUndefined()
    })

    it('put overwrites existing values', async () => {
      const storage = createMockStorage()

      await storage.put('key', 'value1')
      await storage.put('key', 'value2')
      const result = await storage.get('key')

      expect(result).toBe('value2')
    })

    it('delete removes values', async () => {
      const storage = createMockStorage()

      await storage.put('key', 'value')
      const deleted = await storage.delete('key')
      const result = await storage.get('key')

      expect(deleted).toBe(true)
      expect(result).toBeUndefined()
    })

    it('delete returns false for missing keys', async () => {
      const storage = createMockStorage()
      const deleted = await storage.delete('nonexistent')
      expect(deleted).toBe(false)
    })

    it('deleteAll clears all data', async () => {
      const storage = createMockStorage()

      await storage.put('key1', 'value1')
      await storage.put('key2', 'value2')
      await storage.deleteAll()

      expect(await storage.get('key1')).toBeUndefined()
      expect(await storage.get('key2')).toBeUndefined()
    })
  })

  describe('Batch Operations', () => {
    it('get with array returns Map', async () => {
      const storage = createMockStorage()

      await storage.put('key1', 'value1')
      await storage.put('key2', 'value2')

      const result = await storage.get(['key1', 'key2', 'key3'])

      expect(result).toBeInstanceOf(Map)
      expect((result as Map<string, string>).get('key1')).toBe('value1')
      expect((result as Map<string, string>).get('key2')).toBe('value2')
      expect((result as Map<string, string>).has('key3')).toBe(false)
    })

    it('put with object stores multiple values', async () => {
      const storage = createMockStorage()

      await storage.put({ key1: 'value1', key2: 'value2' })

      expect(await storage.get('key1')).toBe('value1')
      expect(await storage.get('key2')).toBe('value2')
    })

    it('delete with array returns count', async () => {
      const storage = createMockStorage()

      await storage.put('key1', 'value1')
      await storage.put('key2', 'value2')

      const count = await storage.delete(['key1', 'key2', 'key3'])

      expect(count).toBe(2)
    })
  })

  describe('List Operations', () => {
    it('list returns all values', async () => {
      const storage = createMockStorage()

      await storage.put('a', 1)
      await storage.put('b', 2)
      await storage.put('c', 3)

      const result = await storage.list()

      expect(result.size).toBe(3)
      expect(result.get('a')).toBe(1)
    })

    it('list with prefix filters correctly', async () => {
      const storage = createMockStorage()

      await storage.put('user:1', { name: 'Alice' })
      await storage.put('user:2', { name: 'Bob' })
      await storage.put('item:1', { name: 'Widget' })

      const result = await storage.list({ prefix: 'user:' })

      expect(result.size).toBe(2)
      expect(result.has('user:1')).toBe(true)
      expect(result.has('user:2')).toBe(true)
      expect(result.has('item:1')).toBe(false)
    })

    it('list with limit restricts count', async () => {
      const storage = createMockStorage()

      await storage.put('a', 1)
      await storage.put('b', 2)
      await storage.put('c', 3)

      const result = await storage.list({ limit: 2 })

      expect(result.size).toBe(2)
    })

    it('list with start filters correctly', async () => {
      const storage = createMockStorage()

      await storage.put('a', 1)
      await storage.put('b', 2)
      await storage.put('c', 3)

      const result = await storage.list({ start: 'b' })

      expect(result.size).toBe(2)
      expect(result.has('a')).toBe(false)
      expect(result.has('b')).toBe(true)
      expect(result.has('c')).toBe(true)
    })

    it('list with startAfter excludes start key', async () => {
      const storage = createMockStorage()

      await storage.put('a', 1)
      await storage.put('b', 2)
      await storage.put('c', 3)

      const result = await storage.list({ startAfter: 'a' })

      expect(result.size).toBe(2)
      expect(result.has('a')).toBe(false)
    })

    it('list with reverse sorts descending', async () => {
      const storage = createMockStorage()

      await storage.put('a', 1)
      await storage.put('b', 2)
      await storage.put('c', 3)

      const result = await storage.list({ reverse: true, limit: 2 })

      const keys = Array.from(result.keys())
      expect(keys[0]).toBe('c')
      expect(keys[1]).toBe('b')
    })
  })

  describe('Initial Data', () => {
    it('accepts Map as initial data', async () => {
      const initial = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
      ])
      const storage = createMockStorage(initial)

      expect(await storage.get('key1')).toBe('value1')
      expect(await storage.get('key2')).toBe('value2')
    })

    it('accepts object as initial data', async () => {
      const storage = createMockStorage({
        config: { name: 'Test' },
        count: 42,
      })

      expect(await storage.get('config')).toEqual({ name: 'Test' })
      expect(await storage.get('count')).toBe(42)
    })
  })

  describe('Operation Tracking', () => {
    it('tracks get operations', async () => {
      const storage = createMockStorage()

      await storage.get('key1')
      await storage.get('key2')

      expect(storage.gets).toEqual(['key1', 'key2'])
      expect(storage.operations.filter((op) => op.type === 'get')).toHaveLength(2)
    })

    it('tracks put operations', async () => {
      const storage = createMockStorage()

      await storage.put('key1', 'value1')
      await storage.put('key2', 'value2')

      expect(storage.puts).toEqual([
        ['key1', 'value1'],
        ['key2', 'value2'],
      ])
    })

    it('tracks delete operations', async () => {
      const storage = createMockStorage()

      await storage.delete('key1')
      await storage.delete('key2')

      expect(storage.deletes).toEqual(['key1', 'key2'])
    })

    it('clearTracking resets all tracking', async () => {
      const storage = createMockStorage()

      await storage.put('key', 'value')
      await storage.get('key')
      await storage.delete('key')

      storage.clearTracking()

      expect(storage.operations).toHaveLength(0)
      expect(storage.puts).toHaveLength(0)
      expect(storage.gets).toHaveLength(0)
      expect(storage.deletes).toHaveLength(0)
    })
  })
})

// ============================================================================
// TESTS: MOCK SQL STORAGE
// ============================================================================

describe('Mock SQL Storage', () => {
  it('tracks SQL operations', async () => {
    const sqlData = new Map([['users', [{ id: 1, name: 'Alice' }]]])
    const storage = createMockStorage(undefined, sqlData)

    storage.sql.exec('SELECT * FROM users')

    expect(storage.sql.operations).toHaveLength(1)
    expect(storage.sql.operations[0].query).toBe('SELECT * FROM users')
  })

  it('returns table data for SELECT queries', () => {
    const sqlData = new Map([
      ['users', [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]],
    ])
    const storage = createMockStorage(undefined, sqlData)

    const result = storage.sql.exec('SELECT * FROM users').toArray()

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ id: 1, name: 'Alice' })
  })

  it('one() returns first result', () => {
    const sqlData = new Map([
      ['users', [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]],
    ])
    const storage = createMockStorage(undefined, sqlData)

    const result = storage.sql.exec('SELECT * FROM users').one()

    expect(result).toEqual({ id: 1, name: 'Alice' })
  })

  it('cursor is iterable', () => {
    const sqlData = new Map([
      ['items', [{ id: 1 }, { id: 2 }, { id: 3 }]],
    ])
    const storage = createMockStorage(undefined, sqlData)

    const cursor = storage.sql.exec('SELECT * FROM items')
    const results = [...cursor]

    expect(results).toHaveLength(3)
  })

  it('mockResponse allows custom query results', () => {
    const storage = createMockStorage()

    storage.sql.mockResponse('SELECT COUNT', [{ count: 42 }])

    const result = storage.sql.exec('SELECT COUNT(*) FROM users').one()

    expect(result).toEqual({ count: 42 })
  })

  it('mockResponse supports RegExp patterns', () => {
    const storage = createMockStorage()

    storage.sql.mockResponse(/INSERT INTO \w+/, [])

    const result = storage.sql.exec('INSERT INTO users VALUES (1, "test")').toArray()

    expect(result).toEqual([])
  })

  it('DELETE clears table data', () => {
    const sqlData = new Map([
      ['users', [{ id: 1 }, { id: 2 }]],
    ])
    const storage = createMockStorage(undefined, sqlData)

    storage.sql.exec('DELETE FROM users')

    expect(sqlData.get('users')).toEqual([])
  })
})

// ============================================================================
// TESTS: TRANSACTION SUPPORT
// ============================================================================

describe('transactionSync', () => {
  it('executes closure and returns result', () => {
    const storage = createMockStorage()

    const result = storage.transactionSync(() => {
      storage.data.set('key', 'value')
      return 42
    })

    expect(result).toBe(42)
    expect(storage.data.get('key')).toBe('value')
  })

  it('commits changes on success', () => {
    const storage = createMockStorage({ existing: 'data' })

    storage.transactionSync(() => {
      storage.data.set('new-key', 'new-value')
      storage.data.delete('existing')
    })

    expect(storage.data.get('new-key')).toBe('new-value')
    expect(storage.data.has('existing')).toBe(false)
  })

  it('rolls back changes on error', () => {
    const storage = createMockStorage({ existing: 'data' })

    expect(() => {
      storage.transactionSync(() => {
        storage.data.set('new-key', 'new-value')
        storage.data.delete('existing')
        throw new Error('Simulated failure')
      })
    }).toThrow('Simulated failure')

    // Changes should be rolled back
    expect(storage.data.get('existing')).toBe('data')
    expect(storage.data.has('new-key')).toBe(false)
  })

  it('rolls back SQL table changes on error', () => {
    const sqlData = new Map([
      ['users', [{ id: 1, name: 'Alice' }]],
    ])
    const storage = createMockStorage(undefined, sqlData)

    expect(() => {
      storage.transactionSync(() => {
        // Modify the SQL table
        const users = sqlData.get('users')!
        users.push({ id: 2, name: 'Bob' })
        throw new Error('Simulated failure')
      })
    }).toThrow('Simulated failure')

    // SQL table changes should be rolled back
    expect(sqlData.get('users')).toEqual([{ id: 1, name: 'Alice' }])
  })

  it('supports nested operations within transaction', () => {
    const storage = createMockStorage()

    storage.transactionSync(() => {
      storage.data.set('a', 1)
      storage.data.set('b', 2)
      storage.data.set('c', 3)
    })

    expect(storage.data.size).toBe(3)
    expect(storage.data.get('a')).toBe(1)
    expect(storage.data.get('b')).toBe(2)
    expect(storage.data.get('c')).toBe(3)
  })

  it('propagates thrown error after rollback', () => {
    const storage = createMockStorage()
    const customError = new Error('Custom error')

    expect(() => {
      storage.transactionSync(() => {
        throw customError
      })
    }).toThrow(customError)
  })
})

// ============================================================================
// TESTS: MOCK STATE
// ============================================================================

describe('createMockState', () => {
  it('includes id and storage', () => {
    const id = createMockId('test-id')
    const storage = createMockStorage()
    const state = createMockState(id, storage)

    expect(state.id.toString()).toBe('test-id')
    expect(state.storage).toBe(storage)
  })

  it('waitUntil accepts promises', () => {
    const id = createMockId()
    const storage = createMockStorage()
    const state = createMockState(id, storage)

    // Should not throw
    state.waitUntil(Promise.resolve())
    state.waitUntil(Promise.resolve('data'))
  })

  it('blockConcurrencyWhile executes callback', async () => {
    const id = createMockId()
    const storage = createMockStorage()
    const state = createMockState(id, storage)

    const result = await state.blockConcurrencyWhile(async () => {
      return 42
    })

    expect(result).toBe(42)
  })

  describe('Alarm Methods', () => {
    it('getAlarm returns null initially', async () => {
      const state = createMockState(createMockId(), createMockStorage())
      expect(await state.getAlarm()).toBeNull()
    })

    it('setAlarm/getAlarm work with Date', async () => {
      const state = createMockState(createMockId(), createMockStorage())
      const alarmTime = new Date('2024-01-01T12:00:00Z')

      await state.setAlarm(alarmTime)
      const result = await state.getAlarm()

      expect(result).toBe(alarmTime.getTime())
    })

    it('setAlarm/getAlarm work with number', async () => {
      const state = createMockState(createMockId(), createMockStorage())
      const timestamp = Date.now() + 60000

      await state.setAlarm(timestamp)
      const result = await state.getAlarm()

      expect(result).toBe(timestamp)
    })

    it('deleteAlarm clears alarm', async () => {
      const state = createMockState(createMockId(), createMockStorage())

      await state.setAlarm(Date.now() + 60000)
      await state.deleteAlarm()
      const result = await state.getAlarm()

      expect(result).toBeNull()
    })
  })
})

// ============================================================================
// TESTS: MOCK ENV BINDINGS
// ============================================================================

describe('Environment Bindings', () => {
  describe('createMockDONamespace', () => {
    it('idFromName creates consistent IDs', () => {
      const ns = createMockDONamespace()

      const id1 = ns.idFromName('my-do')
      const id2 = ns.idFromName('my-do')

      expect(id1.toString()).toBe(id2.toString())
      expect(id1.name).toBe('my-do')
    })

    it('idFromString creates ID from string', () => {
      const ns = createMockDONamespace()
      const id = ns.idFromString('specific-id-123')

      expect(id.toString()).toBe('specific-id-123')
    })

    it('newUniqueId creates unique IDs', () => {
      const ns = createMockDONamespace()

      const id1 = ns.newUniqueId()
      const id2 = ns.newUniqueId()

      expect(id1.toString()).not.toBe(id2.toString())
    })

    it('newUniqueId stores locationHint', () => {
      const ns = createMockDONamespace()
      const id = ns.newUniqueId({ locationHint: 'ewr' })

      expect((id as any).locationHint).toBe('ewr')
    })

    it('get returns stub with fetch method', async () => {
      const ns = createMockDONamespace()
      const id = ns.idFromName('test')
      const stub = ns.get(id)

      expect(stub.id).toBe(id)
      expect(typeof stub.fetch).toBe('function')
    })

    it('get returns same stub for same ID', () => {
      const ns = createMockDONamespace()
      const id = ns.idFromName('test')

      const stub1 = ns.get(id)
      const stub2 = ns.get(id)

      expect(stub1).toBe(stub2)
    })

    it('stubs are tracked', () => {
      const ns = createMockDONamespace()

      ns.get(ns.idFromName('test1'))
      ns.get(ns.idFromName('test2'))

      expect(ns.stubs.size).toBe(2)
    })

    it('stubFactory allows custom stub creation', async () => {
      const ns = createMockDONamespace()

      ns.stubFactory = (id) => ({
        id,
        fetch: vi.fn(async () => Response.json({ custom: true })),
      })

      const stub = ns.get(ns.idFromName('test'))
      const response = await stub.fetch(new Request('https://test.com'))
      const data = await response.json()

      expect(data).toEqual({ custom: true })
    })
  })

  describe('createMockAI', () => {
    it('tracks AI calls', async () => {
      const ai = createMockAI()

      await ai.run('claude-3', { prompt: 'Hello' })
      await ai.run('gpt-4', { prompt: 'World' })

      expect(ai.calls).toHaveLength(2)
      expect(ai.calls[0]).toEqual({ model: 'claude-3', options: { prompt: 'Hello' } })
    })

    it('mockResponse configures model responses', async () => {
      const ai = createMockAI()
      ai.mockResponse('claude-3', { text: 'Custom response' })

      const result = await ai.run('claude-3', { prompt: 'Test' })

      expect(result).toEqual({ text: 'Custom response' })
    })

    it('returns default response for unconfigured models', async () => {
      const ai = createMockAI()
      const result = await ai.run('some-model', {})

      expect(result).toEqual({ text: 'Mock AI response for some-model' })
    })
  })

  describe('createMockR2', () => {
    it('put/get works', async () => {
      const r2 = createMockR2()

      await r2.put('file.txt', 'content')
      const result = await r2.get('file.txt')

      expect(result?.body).toBe('content')
    })

    it('get returns null for missing keys', async () => {
      const r2 = createMockR2()
      const result = await r2.get('nonexistent')

      expect(result).toBeNull()
    })

    it('delete removes objects', async () => {
      const r2 = createMockR2()

      await r2.put('file.txt', 'content')
      await r2.delete('file.txt')
      const result = await r2.get('file.txt')

      expect(result).toBeNull()
    })

    it('list returns all objects', async () => {
      const r2 = createMockR2()

      await r2.put('a/1.txt', 'a')
      await r2.put('a/2.txt', 'b')
      await r2.put('b/1.txt', 'c')

      const result = await r2.list()

      expect(result.objects).toHaveLength(3)
    })

    it('list with prefix filters', async () => {
      const r2 = createMockR2()

      await r2.put('a/1.txt', 'a')
      await r2.put('a/2.txt', 'b')
      await r2.put('b/1.txt', 'c')

      const result = await r2.list({ prefix: 'a/' })

      expect(result.objects).toHaveLength(2)
    })

    it('tracks operations', async () => {
      const r2 = createMockR2()

      await r2.put('key', 'value')
      await r2.get('key')
      await r2.delete('key')
      await r2.list()

      expect(r2.operations).toEqual([
        { type: 'put', key: 'key' },
        { type: 'get', key: 'key' },
        { type: 'delete', key: 'key' },
        { type: 'list' },
      ])
    })
  })

  describe('createMockKV', () => {
    it('put/get works', async () => {
      const kv = createMockKV()

      await kv.put('key', 'value')
      const result = await kv.get('key')

      expect(result).toBe('value')
    })

    it('get returns null for missing keys', async () => {
      const kv = createMockKV()
      const result = await kv.get('nonexistent')

      expect(result).toBeNull()
    })

    it('delete removes values', async () => {
      const kv = createMockKV()

      await kv.put('key', 'value')
      await kv.delete('key')
      const result = await kv.get('key')

      expect(result).toBeNull()
    })
  })

  describe('createMockPipeline', () => {
    it('send captures events', async () => {
      const pipeline = createMockPipeline()

      await pipeline.send({ event: 'test', data: 123 })

      expect(pipeline.events).toHaveLength(1)
      expect(pipeline.events[0]).toEqual({ event: 'test', data: 123 })
    })

    it('send flattens arrays', async () => {
      const pipeline = createMockPipeline()

      await pipeline.send([{ a: 1 }, { b: 2 }])

      expect(pipeline.events).toHaveLength(2)
      expect(pipeline.events).toEqual([{ a: 1 }, { b: 2 }])
    })
  })

  describe('createMockEnv', () => {
    it('includes all default bindings', () => {
      const env = createMockEnv()

      expect(env.DO).toBeDefined()
      expect(env.AI).toBeDefined()
      expect(env.R2).toBeDefined()
      expect(env.KV).toBeDefined()
      expect(env.PIPELINE).toBeDefined()
    })

    it('allows overrides', () => {
      const customAI = createMockAI()
      const env = createMockEnv({ AI: customAI })

      expect(env.AI).toBe(customAI)
    })

    it('allows custom bindings', () => {
      const env = createMockEnv({ CUSTOM_VAR: 'value' })

      expect(env.CUSTOM_VAR).toBe('value')
    })
  })
})

// ============================================================================
// TESTS: createMockDO FACTORY
// ============================================================================

describe('createMockDO', () => {
  describe('Basic Instantiation', () => {
    it('creates a DO instance', () => {
      const { instance } = createMockDO(TestDO)

      expect(instance).toBeInstanceOf(TestDO)
    })

    it('instance can access storage', async () => {
      const { instance, storage } = createMockDO(TestDO, {
        storage: { existing: 'data' },
      })

      const value = await instance.getValue('existing')

      expect(value).toBe('data')
      expect(storage.gets).toContain('existing')
    })

    it('uses provided ID', () => {
      const { instance, ctx } = createMockDO(TestDO, {
        id: 'custom-id-123',
      })

      expect(instance.getId()).toBe('custom-id-123')
      expect(ctx.id.toString()).toBe('custom-id-123')
    })

    it('uses provided name', () => {
      const { ctx } = createMockDO(TestDO, {
        name: 'my-do-name',
      })

      expect(ctx.id.name).toBe('my-do-name')
    })
  })

  describe('Storage Initialization', () => {
    it('accepts Map as initial storage', async () => {
      const { instance } = createMockDO(TestDO, {
        storage: new Map([
          ['key1', 'value1'],
          ['key2', { nested: true }],
        ]),
      })

      expect(await instance.getValue('key1')).toBe('value1')
      expect(await instance.getValue('key2')).toEqual({ nested: true })
    })

    it('accepts object as initial storage', async () => {
      const { instance } = createMockDO(TestDO, {
        storage: {
          config: { name: 'Test' },
          count: 42,
        },
      })

      expect(await instance.getValue('config')).toEqual({ name: 'Test' })
      expect(await instance.getValue('count')).toBe(42)
    })

    it('storage operations are tracked', async () => {
      const { instance, storage } = createMockDO(TestDO)

      await instance.setValue('new-key', 'new-value')
      await instance.getValue('new-key')
      await instance.deleteValue('new-key')

      expect(storage.puts).toContainEqual(['new-key', 'new-value'])
      expect(storage.gets).toContain('new-key')
      expect(storage.deletes).toContain('new-key')
    })
  })

  describe('SQL Data Initialization', () => {
    it('initializes default tables', () => {
      const { sqlData } = createMockDO(TestDO)

      expect(sqlData.has('things')).toBe(true)
      expect(sqlData.has('branches')).toBe(true)
      expect(sqlData.has('actions')).toBe(true)
      expect(sqlData.has('events')).toBe(true)
      expect(sqlData.has('objects')).toBe(true)
      expect(sqlData.has('relationships')).toBe(true)
    })

    it('accepts custom SQL data', async () => {
      const customData = new Map([
        ['users', [{ id: 1, name: 'Alice' }]],
        ['posts', [{ id: 1, title: 'Hello' }]],
      ])

      const { instance, sqlData } = createMockDO(TestDO, {
        sqlData: customData,
      })

      const users = await instance.runSql('SELECT * FROM users')
      const posts = await instance.runSql('SELECT * FROM posts')

      expect(users).toHaveLength(1)
      expect(posts).toHaveLength(1)
      expect(sqlData.get('users')).toEqual([{ id: 1, name: 'Alice' }])
    })
  })

  describe('Environment Bindings', () => {
    it('provides default environment', () => {
      const { env } = createMockDO(TestDO)

      expect(env.DO).toBeDefined()
      expect(env.AI).toBeDefined()
      expect(env.R2).toBeDefined()
      expect(env.PIPELINE).toBeDefined()
    })

    it('allows environment overrides', () => {
      const customAI = createMockAI()
      customAI.mockResponse('test', { special: true })

      const { env } = createMockDO(TestDO, {
        env: { AI: customAI },
      })

      expect(env.AI).toBe(customAI)
    })

    it('DO instance can use AI', async () => {
      const { instance, env } = createMockDO(ExtendedTestDO)

      env.AI!.mockResponse('test-model', { text: 'AI response' })
      const result = await instance.callAI('Hello')

      expect(result).toEqual({ text: 'AI response' })
      expect(env.AI!.calls).toHaveLength(1)
    })

    it('DO instance can use R2', async () => {
      const { instance, env } = createMockDO(ExtendedTestDO)

      await instance.storeInR2('file.txt', 'content')

      expect(env.R2!.data.get('file.txt')).toBe('content')
    })

    it('DO instance can use Pipeline', async () => {
      const { instance, env } = createMockDO(ExtendedTestDO)

      await instance.sendToPipeline({ event: 'test' })

      expect(env.PIPELINE!.events).toContainEqual({ event: 'test' })
    })
  })

  describe('Reset Function', () => {
    it('clears tracking', async () => {
      const { instance, storage, reset } = createMockDO(TestDO)

      await instance.setValue('key', 'value')
      await instance.getValue('key')

      reset()

      expect(storage.operations).toHaveLength(0)
      expect(storage.puts).toHaveLength(0)
      expect(storage.gets).toHaveLength(0)
    })

    it('preserves storage data by default', async () => {
      const { instance, reset } = createMockDO(TestDO, {
        storage: { initial: 'data' },
      })

      await instance.setValue('new', 'value')
      reset()

      expect(await instance.getValue('initial')).toBe('data')
      expect(await instance.getValue('new')).toBe('value')
    })

    it('clears storage when requested', async () => {
      const { instance, reset } = createMockDO(TestDO, {
        storage: { initial: 'data' },
      })

      await instance.setValue('new', 'value')
      reset({ clearStorage: true })

      expect(await instance.getValue('initial')).toBeUndefined()
      expect(await instance.getValue('new')).toBeUndefined()
    })
  })

  describe('Fetch Handler Testing', () => {
    it('can test fetch handlers', async () => {
      const { instance } = createMockDO(TestDO)

      const response = await instance.fetch(new Request('https://test.com/health'))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ status: 'ok' })
    })

    it('can test fetch with query params', async () => {
      const { instance } = createMockDO(TestDO, {
        storage: { 'test-key': 'test-value' },
      })

      const response = await instance.fetch(
        new Request('https://test.com/value?key=test-key')
      )
      const data = await response.json()

      expect(data).toEqual({ value: 'test-value' })
    })
  })
})

// ============================================================================
// TESTS: UTILITY FUNCTIONS
// ============================================================================

describe('Utility Functions', () => {
  describe('createMockRequest', () => {
    it('creates GET request by default', () => {
      const request = createMockRequest('https://test.com/path')

      expect(request.method).toBe('GET')
      expect(request.url).toBe('https://test.com/path')
    })

    it('creates request with method', () => {
      const request = createMockRequest('https://test.com', { method: 'POST' })

      expect(request.method).toBe('POST')
    })

    it('creates request with JSON body', async () => {
      const request = createMockRequest('https://test.com', {
        method: 'POST',
        body: { key: 'value' },
      })

      const body = await request.json()

      expect(body).toEqual({ key: 'value' })
      expect(request.headers.get('Content-Type')).toBe('application/json')
    })

    it('creates request with custom headers', () => {
      const request = createMockRequest('https://test.com', {
        headers: { 'X-Custom': 'value' },
      })

      expect(request.headers.get('X-Custom')).toBe('value')
    })
  })

  describe('expectStorageOperation', () => {
    it('passes when operation exists', async () => {
      const storage = createMockStorage()
      await storage.put('key', 'value')

      expect(() => expectStorageOperation(storage, 'put', 'key')).not.toThrow()
    })

    it('passes for operation type without key', async () => {
      const storage = createMockStorage()
      await storage.put('any-key', 'value')

      expect(() => expectStorageOperation(storage, 'put')).not.toThrow()
    })

    it('throws when operation missing', () => {
      const storage = createMockStorage()

      expect(() => expectStorageOperation(storage, 'put', 'key')).toThrow(
        /Expected storage operation "put" with key "key"/
      )
    })

    it('throws when key doesnt match', async () => {
      const storage = createMockStorage()
      await storage.put('different-key', 'value')

      expect(() => expectStorageOperation(storage, 'put', 'expected-key')).toThrow()
    })
  })

  describe('expectSqlQuery', () => {
    it('passes when query matches string', () => {
      const storage = createMockStorage()
      storage.sql.exec('SELECT * FROM users')

      expect(() => expectSqlQuery(storage, 'SELECT')).not.toThrow()
    })

    it('passes when query matches RegExp', () => {
      const storage = createMockStorage()
      storage.sql.exec('INSERT INTO users VALUES (1, "test")')

      expect(() => expectSqlQuery(storage, /INSERT INTO \w+/)).not.toThrow()
    })

    it('throws when no query matches', () => {
      const storage = createMockStorage()
      storage.sql.exec('SELECT * FROM posts')

      expect(() => expectSqlQuery(storage, 'DELETE')).toThrow(
        /Expected SQL query matching "DELETE"/
      )
    })
  })
})

// ============================================================================
// TESTS: INTEGRATION WITH DIFFERENT DO TYPES
// ============================================================================

describe('DO Type Hierarchy', () => {
  it('works with TestDO', () => {
    const { instance } = createMockDO(TestDO)
    expect((instance.constructor as any).$type).toBe('TestDO')
  })

  it('works with ExtendedTestDO', () => {
    const { instance } = createMockDO(ExtendedTestDO)
    expect((instance.constructor as any).$type).toBe('ExtendedTestDO')
  })

  it('maintains prototype chain', async () => {
    const { instance } = createMockDO(ExtendedTestDO, {
      storage: { key: 'value' },
    })

    // Should have both parent and child methods
    expect(await instance.getValue('key')).toBe('value')
    expect(typeof instance.callAI).toBe('function')
  })
})
