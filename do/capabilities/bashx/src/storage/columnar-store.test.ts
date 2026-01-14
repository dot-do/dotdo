/**
 * Tests for Columnar Storage Pattern
 *
 * These tests verify the columnar storage implementation and demonstrate
 * the cost savings compared to a normalized approach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  WriteBufferCache,
  ColumnarStore,
  ColumnarSessionStore,
  analyzeWorkloadCost,
  printCostReport,
  type CommandHistoryEntry,
  type SchemaDefinition,
} from './columnar-store.js'

// Mock SqlStorage interface
const createMockSqlStorage = () => {
  const tables = new Map<string, Map<string, Record<string, unknown>>>()

  return {
    exec: vi.fn((query: string, ...params: unknown[]) => {
      const queryLower = query.toLowerCase().trim()

      // Handle CREATE TABLE
      if (queryLower.startsWith('create table')) {
        const tableMatch = query.match(/create table if not exists (\w+)/i)
        if (tableMatch) {
          const tableName = tableMatch[1]
          if (!tables.has(tableName)) {
            tables.set(tableName, new Map())
          }
        }
        return { toArray: () => [] }
      }

      // Handle SELECT
      if (queryLower.startsWith('select')) {
        const tableMatch = query.match(/from (\w+)/i)
        if (tableMatch) {
          const tableName = tableMatch[1]
          const table = tables.get(tableName)
          if (table && params.length > 0) {
            const id = params[0] as string
            const row = table.get(id)
            return { toArray: () => row ? [row] : [] }
          }
        }
        return { toArray: () => [] }
      }

      // Handle INSERT/UPSERT
      if (queryLower.startsWith('insert')) {
        const tableMatch = query.match(/insert into (\w+)/i)
        if (tableMatch) {
          const tableName = tableMatch[1]
          let table = tables.get(tableName)
          if (!table) {
            table = new Map()
            tables.set(tableName, table)
          }

          // Extract values from params
          if (tableName === 'sessions' && params.length >= 11) {
            const row: Record<string, unknown> = {
              id: params[0],
              cwd: params[1],
              env: params[2],
              history: params[3],
              open_files: params[4],
              processes: params[5],
              metadata: params[6],
              created_at: params[7],
              updated_at: params[8],
              checkpointed_at: params[9],
              version: params[10],
            }
            table.set(params[0] as string, row)
          }
        }
        return { toArray: () => [] }
      }

      return { toArray: () => [] }
    }),
    _tables: tables, // Expose for testing
  }
}

// ============================================================================
// WriteBufferCache Tests
// ============================================================================

describe('WriteBufferCache', () => {
  describe('basic operations', () => {
    it('should set and get values', () => {
      const cache = new WriteBufferCache<string>({ maxCount: 100 })

      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')
    })

    it('should track dirty entries', () => {
      const cache = new WriteBufferCache<string>({ maxCount: 100 })

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      expect(cache.dirtyCount).toBe(2)

      const dirty = cache.getDirtyEntries()
      expect(dirty.size).toBe(2)
      expect(dirty.get('key1')).toBe('value1')
      expect(dirty.get('key2')).toBe('value2')
    })

    it('should mark entries as clean', () => {
      const cache = new WriteBufferCache<string>({ maxCount: 100 })

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      cache.markClean(['key1'])

      expect(cache.dirtyCount).toBe(1)
      const dirty = cache.getDirtyEntries()
      expect(dirty.has('key1')).toBe(false)
      expect(dirty.has('key2')).toBe(true)
    })

    it('should not mark as dirty when explicitly requested', () => {
      const cache = new WriteBufferCache<string>({ maxCount: 100 })

      cache.set('key1', 'value1', { markDirty: false })

      expect(cache.dirtyCount).toBe(0)
      expect(cache.get('key1')).toBe('value1')
    })
  })

  describe('eviction', () => {
    it('should evict LRU entries when count exceeds max', () => {
      const evicted: string[] = []
      const cache = new WriteBufferCache<string>({
        maxCount: 3,
        onEvict: (key) => evicted.push(key),
      })

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')
      cache.set('key4', 'value4') // Should evict key1

      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key4')).toBe(true)
      expect(evicted).toContain('key1')
    })

    it('should evict LRU entries when size exceeds max', () => {
      const cache = new WriteBufferCache<string>({
        maxCount: 100,
        maxBytes: 50, // Very small limit
        sizeCalculator: (v) => v.length,
      })

      cache.set('key1', 'a'.repeat(20))
      cache.set('key2', 'b'.repeat(20))
      cache.set('key3', 'c'.repeat(20)) // Should evict key1

      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key3')).toBe(true)
    })

    it('should call eviction callback with dirty data', () => {
      const evictedData: Array<{ key: string; value: string }> = []
      const cache = new WriteBufferCache<string>({
        maxCount: 2,
        onEvict: (key, value) => evictedData.push({ key, value }),
      })

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3') // Evicts key1

      expect(evictedData.length).toBe(1)
      expect(evictedData[0]).toEqual({ key: 'key1', value: 'value1' })
    })
  })

  describe('statistics', () => {
    it('should track hits and misses', () => {
      const cache = new WriteBufferCache<string>({ maxCount: 100 })

      cache.set('key1', 'value1')
      cache.get('key1') // hit
      cache.get('key1') // hit
      cache.get('key2') // miss

      const stats = cache.getStats()
      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(1)
      expect(stats.hitRate).toBeCloseTo(0.667, 2)
    })

    it('should track checkpoint count', () => {
      const cache = new WriteBufferCache<string>({ maxCount: 100 })

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.markClean(['key1', 'key2'])

      const stats = cache.getStats()
      expect(stats.checkpoints).toBe(1)
    })
  })

  describe('TTL expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should expire entries after TTL', () => {
      const cache = new WriteBufferCache<string>({
        maxCount: 100,
        defaultTTL: 1000,
      })

      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')

      vi.advanceTimersByTime(1001)

      expect(cache.get('key1')).toBeUndefined()
    })

    it('should respect per-item TTL', () => {
      const cache = new WriteBufferCache<string>({
        maxCount: 100,
        defaultTTL: 5000,
      })

      cache.set('key1', 'value1', { ttl: 1000 })
      cache.set('key2', 'value2') // Uses default 5000

      vi.advanceTimersByTime(2000)

      expect(cache.get('key1')).toBeUndefined()
      expect(cache.get('key2')).toBe('value2')
    })
  })
})

// ============================================================================
// ColumnarSessionStore Tests
// ============================================================================

describe('ColumnarSessionStore', () => {
  let mockSql: ReturnType<typeof createMockSqlStorage>
  let store: ColumnarSessionStore

  beforeEach(() => {
    mockSql = createMockSqlStorage()
    store = new ColumnarSessionStore(mockSql as unknown as import('@cloudflare/workers-types').SqlStorage, {
      checkpointTriggers: {
        dirtyCount: 10, // High threshold for testing
        intervalMs: 60000, // Long interval for testing
        memoryPressureRatio: 0.9,
      },
    })
  })

  afterEach(() => {
    store.stop()
  })

  describe('session creation', () => {
    it('should create a new session', async () => {
      const session = await store.createSession('test-session-1', {
        cwd: '/home/user',
        env: { PATH: '/usr/bin', HOME: '/home/user' },
      })

      expect(session.id).toBe('test-session-1')
      expect(session.cwd).toBe('/home/user')
      expect(session.env.PATH).toBe('/usr/bin')
      expect(session.version).toBe(1)
    })

    it('should cache created session', async () => {
      await store.createSession('test-session-1')

      // Getting should be from cache (no DB call for already-cached item)
      const session = await store.getSession('test-session-1')
      expect(session).not.toBeNull()
      expect(session?.id).toBe('test-session-1')
    })
  })

  describe('session updates', () => {
    it('should update session and increment version', async () => {
      await store.createSession('test-session-1')

      const updated = await store.updateSession('test-session-1', {
        cwd: '/new/path',
      })

      expect(updated?.cwd).toBe('/new/path')
      expect(updated?.version).toBe(2)
    })

    it('should add history entries', async () => {
      await store.createSession('test-session-1')

      const entry: CommandHistoryEntry = {
        id: 'cmd-1',
        command: 'ls -la',
        exitCode: 0,
        timestamp: Date.now(),
        durationMs: 50,
        cwd: '/',
      }

      await store.addHistoryEntry('test-session-1', entry)

      const session = await store.getSession('test-session-1')
      expect(session?.history.length).toBe(1)
      expect(session?.history[0].command).toBe('ls -la')
    })

    it('should set environment variables', async () => {
      await store.createSession('test-session-1')

      await store.setEnvVar('test-session-1', 'MY_VAR', 'my_value')

      const session = await store.getSession('test-session-1')
      expect(session?.env.MY_VAR).toBe('my_value')
    })
  })

  describe('checkpointing', () => {
    it('should checkpoint dirty entries', async () => {
      await store.createSession('test-session-1')
      await store.createSession('test-session-2')

      const stats = await store.checkpoint()

      expect(stats.entityCount).toBe(2)
      expect(stats.trigger).toBe('manual')
    })

    it('should mark entries as clean after checkpoint', async () => {
      await store.createSession('test-session-1')

      const cacheStats1 = store.getCacheStats()
      expect(cacheStats1.dirtyCount).toBe(1)

      await store.checkpoint()

      const cacheStats2 = store.getCacheStats()
      expect(cacheStats2.dirtyCount).toBe(0)
    })

    it('should persist to database on checkpoint', async () => {
      await store.createSession('test-session-1', {
        cwd: '/test',
        env: { TEST: 'value' },
      })

      await store.checkpoint()

      // Verify database was called with correct data
      expect(mockSql.exec).toHaveBeenCalled()

      // Check the sessions table has the data
      const table = mockSql._tables.get('sessions')
      expect(table?.get('test-session-1')).toBeDefined()
    })
  })

  describe('cost tracking', () => {
    it('should track row writes', async () => {
      // Create 5 sessions with attributes (env vars, history, etc.)
      for (let i = 0; i < 5; i++) {
        await store.createSession(`session-${i}`, {
          cwd: `/home/user${i}`,
          env: { PATH: '/usr/bin', HOME: `/home/user${i}`, USER: `user${i}` },
          history: [
            { id: 'cmd1', command: 'ls', exitCode: 0, timestamp: Date.now(), durationMs: 10, cwd: '/' },
            { id: 'cmd2', command: 'pwd', exitCode: 0, timestamp: Date.now(), durationMs: 5, cwd: '/' },
          ],
        })
      }

      // Checkpoint - should write 5 rows (columnar)
      await store.checkpoint()

      const comparison = store.getCostComparison()

      // Columnar: 5 row writes (one per session)
      expect(comparison.columnar.rowWrites).toBe(5)

      // Normalized estimate: counts all fields including empty JSON columns
      // Each session has: id(1) + cwd(1) + env(3) + history(2) + openFiles(1) + processes(1) + metadata(1) + createdAt(1) + updatedAt(1) + checkpointedAt(1) + version(1) = 14 per session
      // 5 sessions * 14 = 70 rows in normalized schema
      expect(comparison.normalized.rowWrites).toBeGreaterThan(comparison.columnar.rowWrites)
      expect(comparison.normalized.rowWrites).toBe(70) // 5 * 14 attributes each
    })

    it('should show cost reduction for attribute updates', async () => {
      await store.createSession('session-1', {
        env: { VAR1: 'a', VAR2: 'b', VAR3: 'c' },
      })

      // Simulate many attribute updates (env vars)
      for (let i = 0; i < 10; i++) {
        await store.setEnvVar('session-1', `VAR_${i}`, `value_${i}`)
      }

      // Checkpoint once (columnar: 1 row write)
      await store.checkpoint()

      const comparison = store.getCostComparison()

      // Columnar: 1 row write
      expect(comparison.columnar.rowWrites).toBe(1)

      // Normalized: Would be 1 (create) + 10 (env updates) = 11+ row writes
      expect(comparison.normalized.rowWrites).toBeGreaterThan(10)

      // Should show significant reduction
      expect(comparison.reductionPercent).toBeGreaterThan(80)
    })
  })
})

// ============================================================================
// Cost Analysis Tests
// ============================================================================

describe('analyzeWorkloadCost', () => {
  it('should calculate realistic cost savings', () => {
    const comparison = analyzeWorkloadCost({
      entities: 100,
      attributesPerEntity: 50,
      updatesPerEntityPerHour: 60, // 1 update per minute per entity
      checkpointsPerEntityPerHour: 6, // Checkpoint every 10 minutes
      hoursPerMonth: 720, // 30 days
    })

    // Normalized: 100 entities * 60 updates/hr * 720 hrs = 4,320,000 rows
    expect(comparison.normalized.rowWrites).toBe(100 * 60 * 720)

    // Columnar: 100 entities * 6 checkpoints/hr * 720 hrs = 432,000 rows
    expect(comparison.columnar.rowWrites).toBe(100 * 6 * 720)

    // Should show 90% reduction (10x fewer writes)
    expect(comparison.reductionFactor).toBeCloseTo(10, 0)
    expect(comparison.reductionPercent).toBeCloseTo(90, 0)
  })

  it('should calculate costs correctly', () => {
    const comparison = analyzeWorkloadCost({
      entities: 1000,
      attributesPerEntity: 100,
      updatesPerEntityPerHour: 120, // 2 updates per minute
      checkpointsPerEntityPerHour: 12, // Every 5 minutes
      hoursPerMonth: 720,
    })

    // Cost at $0.75 per million rows
    // Normalized: 1000 * 120 * 720 = 86,400,000 rows = $64.80
    expect(comparison.normalized.rowWrites).toBe(86_400_000)
    expect(comparison.normalized.estimatedCost).toBeCloseTo(64.80, 2)

    // Columnar: 1000 * 12 * 720 = 8,640,000 rows = $6.48
    expect(comparison.columnar.rowWrites).toBe(8_640_000)
    expect(comparison.columnar.estimatedCost).toBeCloseTo(6.48, 2)
  })

  it('should handle aggressive buffering scenario', () => {
    // Aggressive buffering: checkpoint once per minute instead of per update
    const comparison = analyzeWorkloadCost({
      entities: 100,
      attributesPerEntity: 50,
      updatesPerEntityPerHour: 600, // 10 updates per minute (high activity)
      checkpointsPerEntityPerHour: 1, // Once per hour (aggressive buffering)
      hoursPerMonth: 720,
    })

    // 600x reduction factor (99.8% savings)
    expect(comparison.reductionFactor).toBe(600)
    expect(comparison.reductionPercent).toBeCloseTo(99.83, 1)
  })
})

describe('printCostReport', () => {
  it('should generate readable report', () => {
    const comparison = analyzeWorkloadCost({
      entities: 100,
      attributesPerEntity: 50,
      updatesPerEntityPerHour: 60,
      checkpointsPerEntityPerHour: 6,
      hoursPerMonth: 720,
    })

    const report = printCostReport(comparison)

    expect(report).toContain('DO SQLite Cost Comparison')
    expect(report).toContain('Normalized Approach')
    expect(report).toContain('Columnar Approach')
    expect(report).toContain('Cost Reduction')
    expect(report).toContain('90.0%')
  })
})

// ============================================================================
// Generic ColumnarStore<T> Tests
// ============================================================================

interface TestUser {
  id: string
  name: string
  email: string
  settings: Record<string, unknown>
  tags: string[]
  createdAt: Date
  updatedAt: Date
  version: number
}

const userSchema: SchemaDefinition<TestUser> = {
  tableName: 'users',
  primaryKey: 'id',
  versionField: 'version',
  updatedAtField: 'updatedAt',
  createdAtField: 'createdAt',
  columns: {
    id: { type: 'text', required: true },
    name: { type: 'text', required: true },
    email: { type: 'text', required: true },
    settings: { type: 'json', defaultValue: "'{}'" },
    tags: { type: 'json', defaultValue: "'[]'" },
    createdAt: { type: 'datetime', column: 'created_at', required: true },
    updatedAt: { type: 'datetime', column: 'updated_at', required: true },
    version: { type: 'integer', defaultValue: '1', required: true },
  },
}

describe('ColumnarStore<T> Generic', () => {
  let mockSql: ReturnType<typeof createMockSqlStorage>
  let store: ColumnarStore<TestUser>

  beforeEach(() => {
    mockSql = createMockSqlStorage()
    store = new ColumnarStore<TestUser>(
      mockSql as unknown as import('@cloudflare/workers-types').SqlStorage,
      userSchema,
      {
        checkpointTriggers: {
          dirtyCount: 10,
          intervalMs: 60000,
          memoryPressureRatio: 0.9,
        },
      }
    )
  })

  afterEach(() => {
    store.stop()
  })

  describe('schema definition', () => {
    it('should convert camelCase to snake_case for columns', () => {
      expect(store.getColumnName('createdAt')).toBe('created_at')
      expect(store.getColumnName('updatedAt')).toBe('updated_at')
      expect(store.getColumnName('name')).toBe('name')
    })

    it('should use custom column name when specified', () => {
      expect(store.getColumnName('createdAt')).toBe('created_at')
    })
  })

  describe('CRUD operations', () => {
    it('should create an entity with automatic timestamps', async () => {
      const user: TestUser = {
        id: 'user-1',
        name: 'John Doe',
        email: 'john@example.com',
        settings: { theme: 'dark' },
        tags: ['admin', 'active'],
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      }

      const created = await store.create(user)

      expect(created.id).toBe('user-1')
      expect(created.name).toBe('John Doe')
      expect(created.settings).toEqual({ theme: 'dark' })
      expect(created.tags).toEqual(['admin', 'active'])
      expect(created.version).toBe(1)
    })

    it('should get an entity from cache', async () => {
      const user: TestUser = {
        id: 'user-1',
        name: 'John Doe',
        email: 'john@example.com',
        settings: {},
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      }

      await store.create(user)
      const retrieved = await store.get('user-1')

      expect(retrieved).not.toBeNull()
      expect(retrieved?.name).toBe('John Doe')
    })

    it('should update an entity and increment version', async () => {
      const user: TestUser = {
        id: 'user-1',
        name: 'John Doe',
        email: 'john@example.com',
        settings: {},
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      }

      await store.create(user)
      const updated = await store.update('user-1', { name: 'Jane Doe' })

      expect(updated?.name).toBe('Jane Doe')
      expect(updated?.version).toBe(2)
    })

    it('should return null when updating non-existent entity', async () => {
      const updated = await store.update('non-existent', { name: 'Test' })
      expect(updated).toBeNull()
    })
  })

  describe('checkpointing', () => {
    it('should checkpoint entities to database', async () => {
      const user: TestUser = {
        id: 'user-1',
        name: 'John Doe',
        email: 'john@example.com',
        settings: { notifications: true },
        tags: ['user'],
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      }

      await store.create(user)
      const stats = await store.checkpoint()

      expect(stats.entityCount).toBe(1)
      expect(stats.trigger).toBe('manual')
    })
  })
})

// ============================================================================
// Integration Scenario Tests
// ============================================================================

describe('Integration Scenarios', () => {
  it('should demonstrate bashx session storage cost savings', async () => {
    // Simulate a bashx session with typical usage patterns
    const mockSql = createMockSqlStorage()
    const store = new ColumnarSessionStore(
      mockSql as unknown as import('@cloudflare/workers-types').SqlStorage,
      {
        checkpointTriggers: {
          dirtyCount: 100,
          intervalMs: 60000,
          memoryPressureRatio: 0.9,
        },
      }
    )

    // Create 10 active sessions
    for (let i = 0; i < 10; i++) {
      await store.createSession(`session-${i}`, {
        cwd: `/home/user${i}`,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: `/home/user${i}`,
          USER: `user${i}`,
          SHELL: '/bin/bash',
          TERM: 'xterm-256color',
        },
      })
    }

    // Simulate activity: each session runs 20 commands
    for (let session = 0; session < 10; session++) {
      for (let cmd = 0; cmd < 20; cmd++) {
        await store.addHistoryEntry(`session-${session}`, {
          id: `cmd-${session}-${cmd}`,
          command: `command-${cmd}`,
          exitCode: 0,
          timestamp: Date.now(),
          durationMs: Math.random() * 1000,
          cwd: `/home/user${session}`,
        })
      }
    }

    // Checkpoint once
    const stats = await store.checkpoint()

    // Verify: 10 sessions, each checkpointed as 1 row
    expect(stats.entityCount).toBe(10)

    // Get cost comparison
    const comparison = store.getCostComparison()

    console.log('\n' + printCostReport(comparison))

    // Columnar: 10 row writes
    expect(comparison.columnar.rowWrites).toBe(10)

    // Normalized estimate: 10 sessions * (1 create + 5 env + 20 history) = 260+ rows
    expect(comparison.normalized.rowWrites).toBeGreaterThan(200)

    // Should show 95%+ reduction
    expect(comparison.reductionPercent).toBeGreaterThan(95)

    store.stop()
  })
})
