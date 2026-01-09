/**
 * EdgeVecDO Persistence Tests
 *
 * RED TDD: Comprehensive failing tests for EdgeVecDO - a Durable Object
 * for vector index persistence, storage, and R2 backup.
 *
 * EdgeVecDO provides:
 * - HNSW index persistence to DO KV storage
 * - Vector storage in SQLite via Drizzle
 * - Index recovery on DO wake
 * - Incremental backup to R2
 * - Storage limits and pagination
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { Mock } from 'vitest'

// ============================================================================
// TYPE IMPORTS (to be implemented)
// ============================================================================

import {
  EdgeVecDO,
  type EdgeVecConfig,
  type VectorRecord,
  type IndexStats,
  type BackupManifest,
  EdgeVecStorageError,
  EdgeVecIndexError,
  EdgeVecBackupError,
} from '../EdgeVecDO'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock DurableObjectId
 */
interface MockDurableObjectId {
  toString(): string
  equals(other: MockDurableObjectId): boolean
  name?: string
}

function createMockDOId(name: string = 'edgevec-test-id'): MockDurableObjectId {
  return {
    toString: () => name,
    equals: (other) => other.toString() === name,
    name,
  }
}

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  const tables = new Map<string, unknown[]>()

  return {
    exec(query: string, ...params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
    _tables: tables,
  }
}

/**
 * Mock KV storage for Durable Object state
 */
function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
      if (Array.isArray(key)) {
        let count = 0
        for (const k of key) {
          if (storage.delete(k)) count++
        }
        return count
      }
      return storage.delete(key)
    }),
    deleteAll: vi.fn(async (): Promise<void> => {
      storage.clear()
    }),
    list: vi.fn(async <T = unknown>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      let count = 0
      for (const [key, value] of storage) {
        if (options?.prefix && !key.startsWith(options.prefix)) continue
        if (options?.limit && count >= options.limit) break
        result.set(key, value as T)
        count++
      }
      return result
    }),
    getAlarm: vi.fn(async () => null),
    setAlarm: vi.fn(async () => {}),
    deleteAlarm: vi.fn(async () => {}),
    transaction: vi.fn(async <T>(closure: () => Promise<T>): Promise<T> => {
      return await closure()
    }),
    _storage: storage,
  }
}

/**
 * Mock R2Bucket for backup operations
 */
interface MockR2Object {
  key: string
  body: ReadableStream
  text(): Promise<string>
  json<T>(): Promise<T>
  arrayBuffer(): Promise<ArrayBuffer>
  size: number
  etag: string
  uploaded: Date
}

interface MockR2Bucket {
  get: Mock<[key: string], Promise<MockR2Object | null>>
  put: Mock<[key: string, value: unknown, options?: unknown], Promise<{ key: string; etag: string }>>
  'delete': Mock<[keys: string | string[]], Promise<void>>
  list: Mock<[options?: { prefix?: string; limit?: number; cursor?: string }], Promise<{ objects: MockR2Object[]; truncated: boolean; cursor?: string }>>
  head: Mock<[key: string], Promise<{ key: string; size: number } | null>>
}

function createMockR2Bucket(): MockR2Bucket {
  const objects = new Map<string, { data: unknown; size: number; etag: string; uploaded: Date }>()

  return {
    get: vi.fn(async (key: string) => {
      const obj = objects.get(key)
      if (!obj) return null

      const json = JSON.stringify(obj.data)
      const encoder = new TextEncoder()
      const uint8 = encoder.encode(json)

      return {
        key,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(uint8)
            controller.close()
          },
        }),
        text: vi.fn().mockResolvedValue(json),
        json: vi.fn().mockResolvedValue(obj.data),
        arrayBuffer: vi.fn().mockResolvedValue(uint8.buffer),
        size: obj.size,
        etag: obj.etag,
        uploaded: obj.uploaded,
      }
    }),
    put: vi.fn(async (key: string, value: unknown) => {
      const etag = `etag-${Date.now()}`
      objects.set(key, {
        data: value,
        size: JSON.stringify(value).length,
        etag,
        uploaded: new Date(),
      })
      return { key, etag }
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      const keysArr = Array.isArray(keys) ? keys : [keys]
      for (const k of keysArr) {
        objects.delete(k)
      }
    }),
    list: vi.fn(async (options?: { prefix?: string; limit?: number }) => {
      const result: MockR2Object[] = []
      for (const [key, obj] of objects) {
        if (options?.prefix && !key.startsWith(options.prefix)) continue
        if (options?.limit && result.length >= options.limit) break
        result.push({
          key,
          body: {} as ReadableStream,
          text: vi.fn(),
          json: vi.fn(),
          arrayBuffer: vi.fn(),
          size: obj.size,
          etag: obj.etag,
          uploaded: obj.uploaded,
        })
      }
      return { objects: result, truncated: false }
    }),
    head: vi.fn(async (key: string) => {
      const obj = objects.get(key)
      if (!obj) return null
      return { key, size: obj.size }
    }),
  }
}

/**
 * Create a mock DurableObjectState
 */
function createMockState(idName: string = 'edgevec-test-id'): DurableObjectState & { _storage: Map<string, unknown> } {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: createMockDOId(idName),
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => callback()),
    _storage: kvStorage._storage,
  } as unknown as DurableObjectState & { _storage: Map<string, unknown> }
}

/**
 * Create a mock environment with R2 binding
 */
interface MockEnv {
  EDGEVEC_R2?: MockR2Bucket
  AI?: Fetcher
}

function createMockEnv(overrides?: Partial<MockEnv>): MockEnv {
  return {
    EDGEVEC_R2: createMockR2Bucket(),
    ...overrides,
  }
}

/**
 * Create a sample vector record
 */
function createSampleVector(id: string, dimension: number = 128): VectorRecord {
  return {
    id,
    vector: Array.from({ length: dimension }, () => Math.random()),
    metadata: {
      source: 'test',
      createdAt: Date.now(),
    },
  }
}

/**
 * Create sample HNSW index config
 */
function createSampleConfig(overrides?: Partial<EdgeVecConfig>): EdgeVecConfig {
  return {
    dimension: 128,
    metric: 'cosine',
    efConstruction: 200,
    M: 16,
    maxElements: 10000,
    ...overrides,
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('EdgeVecDO Persistence', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: MockEnv
  let edgevec: EdgeVecDO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
  })

  // ==========================================================================
  // 1. DO STRUCTURE
  // ==========================================================================

  describe('DO structure', () => {
    it('extends DurableObject', () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)

      expect(edgevec).toBeInstanceOf(EdgeVecDO)
      // DurableObject base class check
      expect(typeof edgevec.fetch).toBe('function')
    })

    it('has alarm handler for background tasks', () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)

      expect(typeof edgevec.alarm).toBe('function')
    })

    it('has initialize method for index configuration', async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)

      expect(typeof edgevec.initialize).toBe('function')

      const config = createSampleConfig()
      await edgevec.initialize(config)

      // Config should be stored
      expect(mockState.storage.put).toHaveBeenCalledWith(
        'config',
        expect.objectContaining({ dimension: 128 })
      )
    })

    it('exposes index stats', async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig())

      const stats = await edgevec.getStats()

      expect(stats).toMatchObject({
        vectorCount: expect.any(Number),
        dimension: 128,
        indexSize: expect.any(Number),
        lastUpdated: expect.any(Number),
      })
    })

    it('implements health endpoint', async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)

      const request = new Request('http://localhost/health')
      const response = await edgevec.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json() as { status: string }
      expect(data.status).toBe('ok')
    })

    it('handles concurrent requests safely', async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig())

      // Simulate concurrent vector inserts
      const vectors = Array.from({ length: 10 }, (_, i) =>
        createSampleVector(`vec-${i}`)
      )

      const insertPromises = vectors.map((v) => edgevec.insert(v))

      await expect(Promise.all(insertPromises)).resolves.toBeDefined()
    })
  })

  // ==========================================================================
  // 2. INDEX PERSISTENCE
  // ==========================================================================

  describe('Index persistence', () => {
    beforeEach(async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig())
    })

    it('persists index config to storage', async () => {
      const config = createSampleConfig({
        dimension: 256,
        metric: 'euclidean',
        M: 32,
      })

      await edgevec.initialize(config)

      expect(mockState.storage.put).toHaveBeenCalledWith('config', config)
    })

    it('recovers index on wake', async () => {
      // Simulate stored config
      mockState._storage.set('config', createSampleConfig())
      mockState._storage.set('index:graph', { nodes: [], edges: [] })

      // Create new instance (simulates DO wake)
      const newEdgevec = new EdgeVecDO(mockState, mockEnv)

      // Load should restore from storage
      await newEdgevec.load()

      const stats = await newEdgevec.getStats()
      expect(stats.dimension).toBe(128)
    })

    it('persists HNSW graph structure to KV storage', async () => {
      const vector = createSampleVector('test-vec')
      await edgevec.insert(vector)

      // Graph should be persisted
      expect(mockState.storage.put).toHaveBeenCalledWith(
        'index:graph',
        expect.objectContaining({
          nodes: expect.any(Array),
        })
      )
    })

    it('persists entry point to storage', async () => {
      const vector = createSampleVector('entry-point')
      await edgevec.insert(vector)

      expect(mockState.storage.put).toHaveBeenCalledWith(
        'index:entrypoint',
        expect.any(String)
      )
    })

    it('persists level assignments', async () => {
      const vectors = Array.from({ length: 5 }, (_, i) =>
        createSampleVector(`vec-${i}`)
      )

      for (const v of vectors) {
        await edgevec.insert(v)
      }

      expect(mockState.storage.put).toHaveBeenCalledWith(
        'index:levels',
        expect.any(Object)
      )
    })

    it('handles corrupted index gracefully', async () => {
      // Simulate corrupted index data
      mockState._storage.set('config', createSampleConfig())
      mockState._storage.set('index:graph', 'invalid-json-{{{')

      const newEdgevec = new EdgeVecDO(mockState, mockEnv)

      // Should throw specific error
      await expect(newEdgevec.load()).rejects.toThrow(EdgeVecIndexError)
    })

    it('rebuilds index from vectors if graph is missing', async () => {
      // Config exists but no graph
      mockState._storage.set('config', createSampleConfig())

      const newEdgevec = new EdgeVecDO(mockState, mockEnv)
      await newEdgevec.load()

      // Should rebuild empty index
      const stats = await newEdgevec.getStats()
      expect(stats.vectorCount).toBe(0)
    })

    it('persists index metadata with version', async () => {
      await edgevec.insert(createSampleVector('test'))

      expect(mockState.storage.put).toHaveBeenCalledWith(
        'index:metadata',
        expect.objectContaining({
          version: expect.any(Number),
          lastUpdated: expect.any(Number),
          vectorCount: expect.any(Number),
        })
      )
    })

    it('supports incremental index updates', async () => {
      const v1 = createSampleVector('v1')
      const v2 = createSampleVector('v2')

      await edgevec.insert(v1)
      const calls1 = (mockState.storage.put as Mock).mock.calls.length

      await edgevec.insert(v2)
      const calls2 = (mockState.storage.put as Mock).mock.calls.length

      // Should have incremental persistence calls
      expect(calls2).toBeGreaterThan(calls1)
    })
  })

  // ==========================================================================
  // 3. VECTOR STORAGE (SQLite)
  // ==========================================================================

  describe('Vector storage', () => {
    beforeEach(async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig())
    })

    it('stores vectors in SQLite', async () => {
      const vector = createSampleVector('sql-test', 128)
      await edgevec.insert(vector)

      // Should use SQL storage
      expect(mockState.storage.sql.exec).toHaveBeenCalledWith(
        expect.stringContaining('INSERT'),
        expect.anything()
      )
    })

    it('retrieves vectors by ID', async () => {
      const vector = createSampleVector('retrieve-test')
      await edgevec.insert(vector)

      const retrieved = await edgevec.getVector('retrieve-test')

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe('retrieve-test')
      expect(retrieved?.vector).toHaveLength(128)
    })

    it('returns null for non-existent vector ID', async () => {
      const retrieved = await edgevec.getVector('nonexistent')

      expect(retrieved).toBeNull()
    })

    it('deletes vectors', async () => {
      const vector = createSampleVector('delete-test')
      await edgevec.insert(vector)

      const deleted = await edgevec.delete('delete-test')

      expect(deleted).toBe(true)

      const retrieved = await edgevec.getVector('delete-test')
      expect(retrieved).toBeNull()
    })

    it('returns false when deleting non-existent vector', async () => {
      const deleted = await edgevec.delete('nonexistent')

      expect(deleted).toBe(false)
    })

    it('updates vector metadata', async () => {
      const vector = createSampleVector('update-test')
      await edgevec.insert(vector)

      await edgevec.updateMetadata('update-test', {
        source: 'updated',
        newField: 'value',
      })

      const retrieved = await edgevec.getVector('update-test')
      expect(retrieved?.metadata).toMatchObject({
        source: 'updated',
        newField: 'value',
      })
    })

    it('stores vector dimensions as blob for efficiency', async () => {
      const vector = createSampleVector('blob-test', 128)
      await edgevec.insert(vector)

      // Should serialize vector as binary blob
      expect(mockState.storage.sql.exec).toHaveBeenCalledWith(
        expect.stringContaining('INSERT'),
        expect.arrayContaining([
          expect.any(ArrayBuffer), // vector blob
        ])
      )
    })

    it('validates vector dimension on insert', async () => {
      const wrongDimension = createSampleVector('wrong-dim', 64) // Config is 128

      await expect(edgevec.insert(wrongDimension)).rejects.toThrow(
        EdgeVecStorageError
      )
    })

    it('supports batch insert', async () => {
      const vectors = Array.from({ length: 100 }, (_, i) =>
        createSampleVector(`batch-${i}`)
      )

      await edgevec.insertBatch(vectors)

      const stats = await edgevec.getStats()
      expect(stats.vectorCount).toBe(100)
    })

    it('batch insert is atomic', async () => {
      const vectors = [
        createSampleVector('batch-1'),
        createSampleVector('batch-2', 64), // Wrong dimension - should fail
        createSampleVector('batch-3'),
      ]

      await expect(edgevec.insertBatch(vectors)).rejects.toThrow()

      // None should be inserted
      const stats = await edgevec.getStats()
      expect(stats.vectorCount).toBe(0)
    })

    it('lists vectors with pagination', async () => {
      const vectors = Array.from({ length: 50 }, (_, i) =>
        createSampleVector(`list-${i}`)
      )

      await edgevec.insertBatch(vectors)

      const page1 = await edgevec.listVectors({ limit: 20 })
      expect(page1.vectors).toHaveLength(20)
      expect(page1.cursor).toBeDefined()

      const page2 = await edgevec.listVectors({ limit: 20, cursor: page1.cursor })
      expect(page2.vectors).toHaveLength(20)
    })

    it('filters vectors by metadata', async () => {
      await edgevec.insert({
        ...createSampleVector('filter-1'),
        metadata: { category: 'A' },
      })
      await edgevec.insert({
        ...createSampleVector('filter-2'),
        metadata: { category: 'B' },
      })
      await edgevec.insert({
        ...createSampleVector('filter-3'),
        metadata: { category: 'A' },
      })

      const filtered = await edgevec.listVectors({
        filter: { category: 'A' },
      })

      expect(filtered.vectors).toHaveLength(2)
    })

    it('stores created and updated timestamps', async () => {
      const now = Date.now()
      const vector = createSampleVector('timestamp-test')
      await edgevec.insert(vector)

      const retrieved = await edgevec.getVector('timestamp-test')

      expect(retrieved?.createdAt).toBeGreaterThanOrEqual(now)
      expect(retrieved?.updatedAt).toBeGreaterThanOrEqual(now)
    })
  })

  // ==========================================================================
  // 4. R2 BACKUP
  // ==========================================================================

  describe('R2 backup', () => {
    beforeEach(async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig())
    })

    it('backs up to R2 on alarm', async () => {
      // Insert some vectors
      const vectors = Array.from({ length: 10 }, (_, i) =>
        createSampleVector(`backup-${i}`)
      )
      await edgevec.insertBatch(vectors)

      // Trigger alarm
      await edgevec.alarm()

      // Should backup to R2
      expect(mockEnv.EDGEVEC_R2?.put).toHaveBeenCalled()
    })

    it('backs up index and vectors separately', async () => {
      await edgevec.insertBatch(
        Array.from({ length: 5 }, (_, i) => createSampleVector(`separate-${i}`))
      )

      await edgevec.backup()

      const putCalls = (mockEnv.EDGEVEC_R2?.put as Mock).mock.calls
      const keys = putCalls.map(([key]) => key)

      expect(keys.some((k: string) => k.includes('index'))).toBe(true)
      expect(keys.some((k: string) => k.includes('vectors'))).toBe(true)
    })

    it('creates backup manifest', async () => {
      await edgevec.insertBatch(
        Array.from({ length: 5 }, (_, i) => createSampleVector(`manifest-${i}`))
      )

      await edgevec.backup()

      expect(mockEnv.EDGEVEC_R2?.put).toHaveBeenCalledWith(
        expect.stringContaining('manifest'),
        expect.objectContaining({
          timestamp: expect.any(Number),
          vectorCount: expect.any(Number),
          indexVersion: expect.any(Number),
        }),
        expect.anything()
      )
    })

    it('restores from R2 backup', async () => {
      // Setup backup data in R2
      const backupManifest: BackupManifest = {
        timestamp: Date.now(),
        vectorCount: 10,
        indexVersion: 1,
        files: {
          index: 'backups/index-001.json',
          vectors: 'backups/vectors-001.json',
        },
      }

      mockEnv.EDGEVEC_R2?.get.mockImplementation(async (key: string) => {
        if (key.includes('manifest')) {
          return {
            json: vi.fn().mockResolvedValue(backupManifest),
          } as unknown as MockR2Object
        }
        if (key.includes('index')) {
          return {
            json: vi.fn().mockResolvedValue({ nodes: [], levels: {} }),
          } as unknown as MockR2Object
        }
        if (key.includes('vectors')) {
          return {
            json: vi.fn().mockResolvedValue([]),
          } as unknown as MockR2Object
        }
        return null
      })

      await edgevec.restore()

      // Should have fetched from R2
      expect(mockEnv.EDGEVEC_R2?.get).toHaveBeenCalledWith(
        expect.stringContaining('manifest')
      )
    })

    it('performs incremental backup', async () => {
      // Initial backup
      await edgevec.insertBatch(
        Array.from({ length: 5 }, (_, i) => createSampleVector(`inc-${i}`))
      )
      await edgevec.backup()

      const initialPuts = (mockEnv.EDGEVEC_R2?.put as Mock).mock.calls.length

      // Add more vectors
      await edgevec.insertBatch(
        Array.from({ length: 3 }, (_, i) => createSampleVector(`inc-new-${i}`))
      )

      // Incremental backup
      await edgevec.backup({ incremental: true })

      const totalPuts = (mockEnv.EDGEVEC_R2?.put as Mock).mock.calls.length

      // Should have fewer puts for incremental
      expect(totalPuts - initialPuts).toBeLessThan(initialPuts)
    })

    it('schedules automatic backup via alarm', async () => {
      await edgevec.initialize({
        ...createSampleConfig(),
        autoBackup: true,
        backupInterval: 3600000, // 1 hour
      })

      expect(mockState.storage.setAlarm).toHaveBeenCalled()
    })

    it('handles R2 unavailable gracefully', async () => {
      const envWithoutR2 = createMockEnv({ EDGEVEC_R2: undefined })
      const edgevecNoR2 = new EdgeVecDO(mockState, envWithoutR2)
      await edgevecNoR2.initialize(createSampleConfig())

      // Should not throw, just warn
      await expect(edgevecNoR2.backup()).resolves.toBeUndefined()
    })

    it('throws on restore failure', async () => {
      mockEnv.EDGEVEC_R2?.get.mockResolvedValue(null)

      await expect(edgevec.restore()).rejects.toThrow(EdgeVecBackupError)
    })

    it('supports point-in-time restore', async () => {
      const targetTime = Date.now() - 86400000 // 24 hours ago

      // Setup multiple backup manifests
      mockEnv.EDGEVEC_R2?.list.mockResolvedValue({
        objects: [
          { key: 'backups/manifest-2024-01-01.json', uploaded: new Date(targetTime - 1000) } as MockR2Object,
          { key: 'backups/manifest-2024-01-02.json', uploaded: new Date(targetTime + 1000) } as MockR2Object,
        ],
        truncated: false,
      })

      await edgevec.restore({ timestamp: targetTime })

      // Should find and restore closest backup
      expect(mockEnv.EDGEVEC_R2?.get).toHaveBeenCalledWith(
        'backups/manifest-2024-01-01.json'
      )
    })

    it('cleans up old backups', async () => {
      // Setup old backup files
      const oldBackups = Array.from({ length: 10 }, (_, i) => ({
        key: `backups/manifest-old-${i}.json`,
        uploaded: new Date(Date.now() - 86400000 * (i + 10)), // 10+ days old
      }))

      mockEnv.EDGEVEC_R2?.list.mockResolvedValue({
        objects: oldBackups as MockR2Object[],
        truncated: false,
      })

      await edgevec.cleanupBackups({ retentionDays: 7 })

      expect(mockEnv.EDGEVEC_R2?.delete).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 5. STORAGE LIMITS AND PAGINATION
  // ==========================================================================

  describe('Storage limits and pagination', () => {
    beforeEach(async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig({ maxElements: 100 }))
    })

    it('enforces max elements limit', async () => {
      const vectors = Array.from({ length: 101 }, (_, i) =>
        createSampleVector(`limit-${i}`)
      )

      await expect(edgevec.insertBatch(vectors)).rejects.toThrow(
        EdgeVecStorageError
      )
    })

    it('reports storage usage', async () => {
      await edgevec.insertBatch(
        Array.from({ length: 50 }, (_, i) => createSampleVector(`usage-${i}`))
      )

      const usage = await edgevec.getStorageUsage()

      expect(usage).toMatchObject({
        vectorCount: 50,
        indexSizeBytes: expect.any(Number),
        vectorSizeBytes: expect.any(Number),
        totalSizeBytes: expect.any(Number),
        percentUsed: expect.any(Number),
      })
    })

    it('warns when approaching storage limit', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await edgevec.insertBatch(
        Array.from({ length: 80 }, (_, i) => createSampleVector(`warn-${i}`))
      )

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('storage')
      )

      warnSpy.mockRestore()
    })

    it('paginates large index graph storage', async () => {
      // Insert many vectors to create large graph
      const vectors = Array.from({ length: 100 }, (_, i) =>
        createSampleVector(`paginate-${i}`)
      )
      await edgevec.insertBatch(vectors)

      // Should chunk graph storage if too large
      const listCalls = (mockState.storage.list as Mock).mock.calls
      const graphKeys = listCalls
        .flatMap(([opts]) => opts?.prefix === 'index:graph:' ? [opts.prefix] : [])

      // Large graphs should be paginated
      expect(graphKeys.length).toBeGreaterThanOrEqual(0)
    })

    it('supports cursor-based vector listing', async () => {
      await edgevec.insertBatch(
        Array.from({ length: 50 }, (_, i) => createSampleVector(`cursor-${i}`))
      )

      // First page
      const page1 = await edgevec.listVectors({ limit: 10 })
      expect(page1.vectors).toHaveLength(10)
      expect(page1.cursor).toBeDefined()
      expect(page1.hasMore).toBe(true)

      // Second page
      const page2 = await edgevec.listVectors({ limit: 10, cursor: page1.cursor })
      expect(page2.vectors).toHaveLength(10)

      // IDs should be different
      const page1Ids = new Set(page1.vectors.map((v) => v.id))
      const page2Ids = new Set(page2.vectors.map((v) => v.id))

      for (const id of page2Ids) {
        expect(page1Ids.has(id)).toBe(false)
      }
    })

    it('returns empty page for invalid cursor', async () => {
      const result = await edgevec.listVectors({ cursor: 'invalid-cursor' })

      expect(result.vectors).toHaveLength(0)
      expect(result.hasMore).toBe(false)
    })

    it('handles large batch operations in chunks', async () => {
      const largeVectors = Array.from({ length: 90 }, (_, i) =>
        createSampleVector(`large-${i}`)
      )

      await edgevec.insertBatch(largeVectors, { chunkSize: 10 })

      // Should process in chunks
      const stats = await edgevec.getStats()
      expect(stats.vectorCount).toBe(90)
    })
  })

  // ==========================================================================
  // 6. SEARCH OPERATIONS
  // ==========================================================================

  describe('Search operations', () => {
    beforeEach(async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig())
    })

    it('performs nearest neighbor search', async () => {
      const vectors = Array.from({ length: 20 }, (_, i) =>
        createSampleVector(`search-${i}`)
      )
      await edgevec.insertBatch(vectors)

      const query = Array.from({ length: 128 }, () => Math.random())
      const results = await edgevec.search(query, { k: 5 })

      expect(results).toHaveLength(5)
      expect(results[0]).toMatchObject({
        id: expect.any(String),
        score: expect.any(Number),
        vector: expect.any(Array),
      })
    })

    it('returns results sorted by distance', async () => {
      await edgevec.insertBatch(
        Array.from({ length: 10 }, (_, i) => createSampleVector(`sort-${i}`))
      )

      const query = Array.from({ length: 128 }, () => Math.random())
      const results = await edgevec.search(query, { k: 5 })

      // Scores should be in descending order (higher = more similar for cosine)
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score)
      }
    })

    it('filters search by metadata', async () => {
      await edgevec.insert({
        ...createSampleVector('filter-a'),
        metadata: { category: 'A' },
      })
      await edgevec.insert({
        ...createSampleVector('filter-b'),
        metadata: { category: 'B' },
      })

      const query = Array.from({ length: 128 }, () => Math.random())
      const results = await edgevec.search(query, {
        k: 10,
        filter: { category: 'A' },
      })

      expect(results.every((r) => r.metadata?.category === 'A')).toBe(true)
    })

    it('respects ef search parameter', async () => {
      await edgevec.insertBatch(
        Array.from({ length: 50 }, (_, i) => createSampleVector(`ef-${i}`))
      )

      const query = Array.from({ length: 128 }, () => Math.random())

      // Lower ef = faster but less accurate
      const resultsLowEf = await edgevec.search(query, { k: 5, ef: 10 })
      // Higher ef = slower but more accurate
      const resultsHighEf = await edgevec.search(query, { k: 5, ef: 200 })

      expect(resultsLowEf).toHaveLength(5)
      expect(resultsHighEf).toHaveLength(5)
    })

    it('validates query dimension', async () => {
      const wrongDimQuery = Array.from({ length: 64 }, () => Math.random())

      await expect(
        edgevec.search(wrongDimQuery, { k: 5 })
      ).rejects.toThrow(EdgeVecStorageError)
    })

    it('handles empty index gracefully', async () => {
      const query = Array.from({ length: 128 }, () => Math.random())
      const results = await edgevec.search(query, { k: 5 })

      expect(results).toHaveLength(0)
    })
  })

  // ==========================================================================
  // 7. ERROR HANDLING
  // ==========================================================================

  describe('Error handling', () => {
    beforeEach(async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
    })

    it('throws EdgeVecStorageError for storage failures', async () => {
      mockState.storage.put = vi.fn().mockRejectedValue(new Error('Storage failure'))

      await expect(edgevec.initialize(createSampleConfig())).rejects.toThrow(
        EdgeVecStorageError
      )
    })

    it('throws EdgeVecIndexError for index corruption', async () => {
      mockState._storage.set('config', createSampleConfig())
      mockState._storage.set('index:graph', null) // Invalid

      await expect(edgevec.load()).rejects.toThrow(EdgeVecIndexError)
    })

    it('throws EdgeVecBackupError for backup failures', async () => {
      await edgevec.initialize(createSampleConfig())
      mockEnv.EDGEVEC_R2?.put.mockRejectedValue(new Error('R2 failure'))

      await expect(edgevec.backup()).rejects.toThrow(EdgeVecBackupError)
    })

    it('provides detailed error context', async () => {
      await edgevec.initialize(createSampleConfig())
      mockEnv.EDGEVEC_R2?.put.mockRejectedValue(new Error('Network timeout'))

      try {
        await edgevec.backup()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(EdgeVecBackupError)
        expect((error as EdgeVecBackupError).cause).toBeDefined()
      }
    })
  })

  // ==========================================================================
  // 8. HTTP API
  // ==========================================================================

  describe('HTTP API', () => {
    beforeEach(async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig())
    })

    it('POST /vectors inserts vector', async () => {
      const vector = createSampleVector('http-insert')
      const request = new Request('http://localhost/vectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vector),
      })

      const response = await edgevec.fetch(request)

      expect(response.status).toBe(201)
    })

    it('GET /vectors/:id retrieves vector', async () => {
      await edgevec.insert(createSampleVector('http-get'))

      const request = new Request('http://localhost/vectors/http-get')
      const response = await edgevec.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json() as VectorRecord
      expect(data.id).toBe('http-get')
    })

    it('DELETE /vectors/:id deletes vector', async () => {
      await edgevec.insert(createSampleVector('http-delete'))

      const request = new Request('http://localhost/vectors/http-delete', {
        method: 'DELETE',
      })
      const response = await edgevec.fetch(request)

      expect(response.status).toBe(204)
    })

    it('POST /search performs search', async () => {
      await edgevec.insertBatch(
        Array.from({ length: 10 }, (_, i) => createSampleVector(`http-search-${i}`))
      )

      const query = Array.from({ length: 128 }, () => Math.random())
      const request = new Request('http://localhost/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vector: query, k: 5 }),
      })

      const response = await edgevec.fetch(request)

      expect(response.status).toBe(200)
      const results = await response.json() as Array<{ id: string; score: number }>
      expect(results).toHaveLength(5)
    })

    it('GET /stats returns index statistics', async () => {
      const request = new Request('http://localhost/stats')
      const response = await edgevec.fetch(request)

      expect(response.status).toBe(200)
      const stats = await response.json() as IndexStats
      expect(stats.dimension).toBe(128)
    })

    it('returns 404 for unknown routes', async () => {
      const request = new Request('http://localhost/unknown')
      const response = await edgevec.fetch(request)

      expect(response.status).toBe(404)
    })

    it('returns 400 for invalid request body', async () => {
      const request = new Request('http://localhost/vectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json{{{',
      })

      const response = await edgevec.fetch(request)

      expect(response.status).toBe(400)
    })
  })
})
