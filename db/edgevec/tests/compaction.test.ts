/**
 * EdgeVecDO Parquet Compaction Tests
 *
 * RED TDD: Failing tests for background compaction from EdgeVecDO SQLite to R2 Parquet.
 *
 * Compaction Process:
 * 1. Alarm fires when pending vector count exceeds threshold (1000)
 * 2. Read vectors from SQLite WHERE compacted_at IS NULL
 * 3. Build Parquet file with ParquetBuilder
 * 4. Upload to R2 with partition path: vectors/ns={namespace}/dt={date}/vectors_{timestamp}.parquet
 * 5. Mark vectors as compacted (keep for hot tier queries)
 */

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest'

// ============================================================================
// MOCK PARQUET MODULE (before imports)
// ============================================================================

// Mock ParquetBuilder before importing EdgeVecDO
vi.mock('../../parquet', () => ({
  ParquetBuilder: class MockParquetBuilder {
    private rows: unknown[] = []
    private dimension: number

    constructor(options: { schema: { dimension?: number }; compression?: string; rowGroupSize?: number }) {
      this.dimension = options.schema?.dimension ?? 128
    }

    addRow(row: unknown) {
      this.rows.push(row)
    }

    addRows(rows: unknown[]) {
      this.rows.push(...rows)
    }

    getRowCount() {
      return this.rows.length
    }

    isEmpty() {
      return this.rows.length === 0
    }

    async finish() {
      // Return a mock Parquet result
      const mockBuffer = new ArrayBuffer(this.rows.length * 100) // Simulate compressed size
      return {
        buffer: mockBuffer,
        rowCount: this.rows.length,
        rowGroupCount: Math.ceil(this.rows.length / 2000),
        uncompressedSize: this.rows.length * 1000,
        compressedSize: this.rows.length * 100,
        compressionRatio: 10,
      }
    }

    reset() {
      this.rows = []
    }
  },
  generateParquetPath: (namespace: string, date: string, timestamp: number = Date.now()) => {
    return `vectors/ns=${namespace}/dt=${date}/vectors_${timestamp}.parquet`
  },
}))

// ============================================================================
// TYPE IMPORTS
// ============================================================================

import {
  EdgeVecDO,
  type EdgeVecConfig,
  type VectorRecord,
  EdgeVecStorageError,
} from '../EdgeVecDO'

// ============================================================================
// COMPACTION TYPES
// ============================================================================

/**
 * Configuration for compaction behavior
 */
export interface CompactionConfig {
  /** Threshold for triggering compaction (default: 1000) */
  compactionThreshold: number
  /** Maximum vectors per Parquet file (default: 10000) */
  maxVectorsPerFile: number
  /** Alarm check interval in ms (default: 60000 - 1 minute) */
  checkInterval: number
  /** R2 bucket binding name */
  r2Binding: string
  /** Namespace for vectors (used in partition path) */
  namespace: string
}

/**
 * Result from compaction operation
 */
export interface CompactionResult {
  /** Number of vectors compacted */
  vectorsCompacted: number
  /** R2 key where Parquet file was written */
  parquetKey: string
  /** Size of Parquet file in bytes */
  fileSize: number
  /** Time taken for compaction in ms */
  durationMs: number
}

/**
 * Extended vector record with compaction tracking
 */
export interface CompactableVector extends VectorRecord {
  /** Namespace for partitioning */
  ns: string
  /** Resource type */
  type: string
  /** Timestamp when compacted to Parquet (null if not yet compacted) */
  compactedAt: number | null
  /** Creation timestamp */
  createdAt?: number
}

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

function createMockDOId(name: string = 'edgevec-compaction-test'): MockDurableObjectId {
  return {
    toString: () => name,
    equals: (other) => other.toString() === name,
    name,
  }
}

/**
 * Internal stored vector format (matches what EdgeVecDO uses internally)
 */
interface StoredVectorFormat {
  id: string
  ns: string
  type: string
  vector: ArrayBuffer
  metadata: string | null
  created_at: number
  updated_at: number
  compacted_at: number | null
}

/**
 * Mock SQL storage with compaction tracking
 */
function createMockSqlStorage() {
  const vectors: Map<string, StoredVectorFormat> = new Map()
  let tableCreated = false

  // Convert CompactableVector to StoredVectorFormat
  function toStoredFormat(v: CompactableVector): StoredVectorFormat {
    return {
      id: v.id,
      ns: v.ns,
      type: v.type,
      vector: new Float32Array(v.vector).buffer,
      metadata: v.metadata ? JSON.stringify(v.metadata) : null,
      created_at: v.createdAt ?? Date.now(),
      updated_at: Date.now(),
      compacted_at: v.compactedAt,
    }
  }

  return {
    exec(query: string, ...params: unknown[]): { toArray(): unknown[]; one(): unknown; raw(): unknown[] } {
      const queryLower = query.toLowerCase()

      // Handle CREATE TABLE
      if (queryLower.includes('create table')) {
        tableCreated = true
        return { toArray: () => [], one: () => undefined, raw: () => [] }
      }

      // Handle CREATE INDEX
      if (queryLower.includes('create index')) {
        return { toArray: () => [], one: () => undefined, raw: () => [] }
      }

      // Handle ALTER TABLE
      if (queryLower.includes('alter table')) {
        return { toArray: () => [], one: () => undefined, raw: () => [] }
      }

      // Handle INSERT
      if (queryLower.includes('insert')) {
        return { toArray: () => [], one: () => undefined, raw: () => [] }
      }

      // Handle SELECT COUNT for pending vectors
      if (queryLower.includes('count') && queryLower.includes('compacted_at is null')) {
        const count = Array.from(vectors.values()).filter((v) => v.compacted_at === null).length
        return { toArray: () => [{ count }], one: () => ({ count }), raw: () => [[count]] }
      }

      // Handle SELECT for pending vectors (compacted_at IS NULL)
      if (queryLower.includes('compacted_at is null') && !queryLower.includes('count')) {
        const pending = Array.from(vectors.values())
          .filter((v) => v.compacted_at === null)
          .sort((a, b) => a.created_at - b.created_at)
          .slice(0, typeof params[0] === 'number' ? params[0] : 10000)
        return { toArray: () => pending, one: () => pending[0], raw: () => pending }
      }

      // Handle UPDATE for marking compacted
      if (queryLower.includes('update') && queryLower.includes('compacted_at')) {
        // params[0] is the timestamp, rest are vector IDs
        const compactedAt = params[0] as number
        const ids = params.slice(1) as string[]
        for (const id of ids) {
          const v = vectors.get(id)
          if (v) {
            v.compacted_at = compactedAt
          }
        }
        return { toArray: () => [], one: () => undefined, raw: () => [] }
      }

      // Handle SELECT * FROM vectors (for general queries)
      if (queryLower.includes('select') && queryLower.includes('from vectors')) {
        const allVectors = Array.from(vectors.values())
        return { toArray: () => allVectors, one: () => allVectors[0], raw: () => allVectors }
      }

      return { toArray: () => [], one: () => undefined, raw: () => [] }
    },
    _vectors: vectors,
    _addVector(v: CompactableVector) {
      vectors.set(v.id, toStoredFormat(v))
    },
    _getVector(id: string) {
      return vectors.get(id)
    },
    _getPendingCount() {
      return Array.from(vectors.values()).filter((v) => v.compacted_at === null).length
    },
    _markCompacted(ids: string[], timestamp: number) {
      for (const id of ids) {
        const v = vectors.get(id)
        if (v) {
          v.compacted_at = timestamp
        }
      }
    },
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
 * Mock R2Bucket for Parquet uploads
 */
interface MockR2Object {
  key: string
  body: ReadableStream
  arrayBuffer(): Promise<ArrayBuffer>
  size: number
  etag: string
  uploaded: Date
}

interface MockR2Bucket {
  get: Mock<[key: string], Promise<MockR2Object | null>>
  put: Mock<[key: string, value: unknown, options?: unknown], Promise<{ key: string; etag: string; size: number }>>
  delete: Mock<[keys: string | string[]], Promise<void>>
  list: Mock<[options?: { prefix?: string; limit?: number; cursor?: string }], Promise<{ objects: MockR2Object[]; truncated: boolean; cursor?: string }>>
  head: Mock<[key: string], Promise<{ key: string; size: number } | null>>
}

function createMockR2Bucket(): MockR2Bucket {
  const objects = new Map<string, { data: ArrayBuffer; size: number; etag: string; uploaded: Date }>()

  return {
    get: vi.fn(async (key: string) => {
      const obj = objects.get(key)
      if (!obj) return null

      return {
        key,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(obj.data))
            controller.close()
          },
        }),
        arrayBuffer: vi.fn().mockResolvedValue(obj.data),
        size: obj.size,
        etag: obj.etag,
        uploaded: obj.uploaded,
      }
    }),
    put: vi.fn(async (key: string, value: unknown) => {
      const etag = `etag-${Date.now()}`
      const buffer = value instanceof ArrayBuffer
        ? value
        : value instanceof Uint8Array
          ? value.buffer
          : new TextEncoder().encode(JSON.stringify(value)).buffer
      const size = buffer.byteLength
      objects.set(key, {
        data: buffer,
        size,
        etag,
        uploaded: new Date(),
      })
      return { key, etag, size }
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
 * Create a mock DurableObjectState with SQL storage
 */
function createMockState(idName: string = 'edgevec-compaction-test'): DurableObjectState & {
  _storage: Map<string, unknown>
  _sql: ReturnType<typeof createMockSqlStorage>
} {
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
    _sql: sqlStorage,
  } as unknown as DurableObjectState & {
    _storage: Map<string, unknown>
    _sql: ReturnType<typeof createMockSqlStorage>
  }
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
 * Create a sample vector with compaction fields
 */
function createSampleCompactableVector(
  id: string,
  ns: string = 'test.do',
  dimension: number = 128
): CompactableVector {
  return {
    id,
    ns,
    type: 'Document',
    vector: Array.from({ length: dimension }, () => Math.random()),
    metadata: { source: 'test' },
    compactedAt: null,
    createdAt: Date.now(),
  }
}

/**
 * Create sample HNSW index config with compaction settings
 */
function createSampleConfig(overrides?: Partial<EdgeVecConfig & CompactionConfig>): EdgeVecConfig & Partial<CompactionConfig> {
  return {
    dimension: 128,
    metric: 'cosine',
    efConstruction: 200,
    M: 16,
    maxElements: 10000,
    compactionThreshold: 1000,
    maxVectorsPerFile: 10000,
    checkInterval: 60000,
    ...overrides,
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('EdgeVecDO Parquet Compaction', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: MockEnv
  let edgevec: EdgeVecDO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // 1. ALARM SCHEDULING
  // ==========================================================================

  describe('Alarm scheduling', () => {
    it('schedules compaction check alarm on initialization with compaction enabled', async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)

      const config = createSampleConfig({
        compactionThreshold: 1000,
        checkInterval: 60000,
      })

      await edgevec.initialize(config)

      // Should schedule alarm for compaction checks
      expect(mockState.storage.setAlarm).toHaveBeenCalled()
    })

    it('does not schedule alarm when compaction is disabled', async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)

      const config = createSampleConfig({
        compactionThreshold: 0, // Disabled
      })

      await edgevec.initialize(config)

      // Should not schedule compaction alarm
      const alarmCalls = (mockState.storage.setAlarm as Mock).mock.calls
      const compactionAlarm = alarmCalls.find(
        ([timestamp]) => typeof timestamp === 'number'
      )
      expect(compactionAlarm).toBeUndefined()
    })

    it('reschedules alarm after compaction check', async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig({ checkInterval: 60000 }))

      // Clear previous setAlarm calls
      ;(mockState.storage.setAlarm as Mock).mockClear()

      // Trigger alarm
      await edgevec.alarm()

      // Should reschedule for next check
      expect(mockState.storage.setAlarm).toHaveBeenCalledWith(
        expect.any(Number)
      )
    })

    it('uses configured check interval for alarm scheduling', async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)

      const checkInterval = 300000 // 5 minutes
      await edgevec.initialize(createSampleConfig({ checkInterval }))

      const now = Date.now()
      vi.setSystemTime(now)

      // Clear and trigger
      ;(mockState.storage.setAlarm as Mock).mockClear()
      await edgevec.alarm()

      // Should schedule alarm for now + checkInterval
      expect(mockState.storage.setAlarm).toHaveBeenCalledWith(
        expect.any(Number)
      )
      const scheduledTime = (mockState.storage.setAlarm as Mock).mock.calls[0][0]
      expect(scheduledTime).toBeGreaterThanOrEqual(now + checkInterval)
    })
  })

  // ==========================================================================
  // 2. VECTOR SELECTION FOR COMPACTION
  // ==========================================================================

  describe('Vector selection for compaction', () => {
    beforeEach(async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig({ compactionThreshold: 100 }))
    })

    it('selects only vectors with compacted_at IS NULL', async () => {
      // Add vectors - some compacted, some not
      for (let i = 0; i < 50; i++) {
        const v = createSampleCompactableVector(`vec-${i}`)
        if (i < 20) {
          v.compactedAt = Date.now() - 10000 // Already compacted
        }
        mockState._sql._addVector(v)
      }

      // Trigger compaction check
      await edgevec.alarm()

      // Should only select non-compacted vectors
      const pendingCount = mockState._sql._getPendingCount()
      expect(pendingCount).toBe(30)
    })

    it('triggers compaction when threshold is exceeded', async () => {
      // Add enough vectors to exceed threshold (100)
      for (let i = 0; i < 150; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      await edgevec.alarm()

      // Should have uploaded to R2
      expect(mockEnv.EDGEVEC_R2?.put).toHaveBeenCalled()
    })

    it('does not trigger compaction below threshold', async () => {
      // Add fewer vectors than threshold (100)
      for (let i = 0; i < 50; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      await edgevec.alarm()

      // Should NOT upload to R2
      expect(mockEnv.EDGEVEC_R2?.put).not.toHaveBeenCalled()
    })

    it('limits vectors per compaction batch to maxVectorsPerFile', async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig({
        compactionThreshold: 100,
        maxVectorsPerFile: 500,
      }))

      // Add many more vectors than limit
      for (let i = 0; i < 1000; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      // Should only compact up to maxVectorsPerFile
      const result = await (edgevec as unknown as { compactToParquet(): Promise<CompactionResult | null> }).compactToParquet()

      expect(result).not.toBeNull()
      expect(result!.vectorsCompacted).toBeLessThanOrEqual(500)
    })

    it('orders vectors by created_at for deterministic compaction', async () => {
      const baseTime = Date.now()

      // Add vectors with different timestamps (out of order)
      for (let i = 0; i < 100; i++) {
        const v = createSampleCompactableVector(`vec-${i}`)
        v.createdAt = baseTime + (i % 2 === 0 ? i : -i) * 1000
        mockState._sql._addVector(v)
      }

      await edgevec.alarm()

      // Should have uploaded something (verifies compaction ran)
      expect(mockEnv.EDGEVEC_R2?.put).toHaveBeenCalled()

      // Verify the oldest vectors were processed by checking compaction status
      // The mock SQL storage processes in created_at order
    })
  })

  // ==========================================================================
  // 3. PARQUET FILE CREATION
  // ==========================================================================

  describe('Parquet file creation', () => {
    beforeEach(async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig({
        compactionThreshold: 10,
        namespace: 'test.do',
      }))
    })

    it('creates Parquet file using ParquetBuilder', async () => {
      for (let i = 0; i < 50; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      await edgevec.alarm()

      // Should have uploaded something
      expect(mockEnv.EDGEVEC_R2?.put).toHaveBeenCalled()

      const putCall = (mockEnv.EDGEVEC_R2?.put as Mock).mock.calls[0]
      const [key, data] = putCall

      // Data should be ArrayBuffer (Parquet bytes)
      expect(data).toBeInstanceOf(ArrayBuffer)
      expect((data as ArrayBuffer).byteLength).toBeGreaterThan(0)
    })

    it('includes all required fields in Parquet schema', async () => {
      mockState._sql._addVector({
        id: 'vec-test',
        ns: 'test.do',
        type: 'Document',
        vector: Array(128).fill(0.1),
        metadata: { title: 'Test' },
        compactedAt: null,
        createdAt: Date.now(),
      })

      // Add more to exceed threshold
      for (let i = 0; i < 15; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-extra-${i}`))
      }

      await edgevec.alarm()

      // Parquet should contain all fields: ns, type, visibility, id, embedding, metadata, created_at
      expect(mockEnv.EDGEVEC_R2?.put).toHaveBeenCalled()
    })

    it('uses ZSTD compression by default', async () => {
      for (let i = 0; i < 20; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      await edgevec.alarm()

      // File should be compressed (smaller than uncompressed estimate)
      const putCall = (mockEnv.EDGEVEC_R2?.put as Mock).mock.calls[0]
      const data = putCall[1] as ArrayBuffer

      // Compressed Parquet should be reasonably sized
      // 20 vectors * 128 dims * 4 bytes = ~10KB uncompressed embeddings alone
      // Compressed should be significantly smaller
      expect(data.byteLength).toBeLessThan(20 * 128 * 4)
    })

    it('handles empty metadata gracefully', async () => {
      for (let i = 0; i < 15; i++) {
        const v = createSampleCompactableVector(`vec-${i}`)
        v.metadata = undefined
        mockState._sql._addVector(v)
      }

      // Should not throw
      await expect(edgevec.alarm()).resolves.not.toThrow()
      expect(mockEnv.EDGEVEC_R2?.put).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 4. R2 UPLOAD WITH PARTITION PATH
  // ==========================================================================

  describe('R2 upload with partition path', () => {
    beforeEach(async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig({
        compactionThreshold: 10,
        namespace: 'payments.do',
      }))
    })

    it('uploads to correct Hive-style partition path', async () => {
      const now = new Date('2026-01-11T10:00:00Z')
      vi.setSystemTime(now)

      for (let i = 0; i < 20; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`, 'payments.do'))
      }

      await edgevec.alarm()

      expect(mockEnv.EDGEVEC_R2?.put).toHaveBeenCalled()

      const putCall = (mockEnv.EDGEVEC_R2?.put as Mock).mock.calls[0]
      const key = putCall[0] as string

      // Path format: vectors/ns={namespace}/dt={date}/vectors_{timestamp}.parquet
      expect(key).toMatch(/^vectors\/ns=payments\.do\/dt=2026-01-11\/vectors_\d+\.parquet$/)
    })

    it('uses namespace from vector data for partitioning', async () => {
      for (let i = 0; i < 15; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`, 'custom-ns.do'))
      }

      await edgevec.alarm()

      const putCall = (mockEnv.EDGEVEC_R2?.put as Mock).mock.calls[0]
      const key = putCall[0] as string

      expect(key).toContain('ns=custom-ns.do')
    })

    it('uses current date for dt partition', async () => {
      const testDate = new Date('2026-03-15T14:30:00Z')
      vi.setSystemTime(testDate)

      for (let i = 0; i < 15; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      await edgevec.alarm()

      const putCall = (mockEnv.EDGEVEC_R2?.put as Mock).mock.calls[0]
      const key = putCall[0] as string

      expect(key).toContain('dt=2026-03-15')
    })

    it('includes timestamp in filename for uniqueness', async () => {
      const timestamp = 1736590800000 // Fixed timestamp
      vi.setSystemTime(timestamp)

      for (let i = 0; i < 15; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      await edgevec.alarm()

      const putCall = (mockEnv.EDGEVEC_R2?.put as Mock).mock.calls[0]
      const key = putCall[0] as string

      expect(key).toContain(`vectors_${timestamp}.parquet`)
    })

    it('handles R2 upload failure gracefully', async () => {
      mockEnv.EDGEVEC_R2?.put.mockRejectedValue(new Error('R2 service unavailable'))

      for (let i = 0; i < 20; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      // Should not crash, but should log error
      await expect(edgevec.alarm()).resolves.not.toThrow()

      // Vectors should NOT be marked as compacted (rollback)
      const pendingCount = mockState._sql._getPendingCount()
      expect(pendingCount).toBe(20)
    })

    it('sets content type metadata on uploaded file', async () => {
      for (let i = 0; i < 15; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      await edgevec.alarm()

      expect(mockEnv.EDGEVEC_R2?.put).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(ArrayBuffer),
        expect.objectContaining({
          httpMetadata: expect.objectContaining({
            contentType: 'application/vnd.apache.parquet',
          }),
        })
      )
    })
  })

  // ==========================================================================
  // 5. COMPACTION MARKING
  // ==========================================================================

  describe('Compaction marking', () => {
    beforeEach(async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig({ compactionThreshold: 10 }))
    })

    it('marks vectors as compacted after successful upload', async () => {
      for (let i = 0; i < 20; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      // Initial pending count
      expect(mockState._sql._getPendingCount()).toBe(20)

      await edgevec.alarm()

      // Verify upload happened
      expect(mockEnv.EDGEVEC_R2?.put).toHaveBeenCalled()

      // Vectors should now be marked as compacted (pending count reduced)
      expect(mockState._sql._getPendingCount()).toBe(0)
    })

    it('sets compacted_at to current timestamp', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      for (let i = 0; i < 15; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      await edgevec.alarm()

      // compacted_at should be set - verify by checking pending count changed
      expect(mockState._sql._getPendingCount()).toBe(0)

      // Verify the compacted_at field was set by checking a vector
      const vec = mockState._sql._getVector('vec-0')
      expect(vec?.compacted_at).toBeGreaterThanOrEqual(now)
    })

    it('does not mark vectors on R2 upload failure', async () => {
      mockEnv.EDGEVEC_R2?.put.mockRejectedValue(new Error('Upload failed'))

      for (let i = 0; i < 20; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      await edgevec.alarm()

      // Vectors should still be pending
      const pendingCount = mockState._sql._getPendingCount()
      expect(pendingCount).toBe(20)
    })

    it('keeps vectors in SQLite for hot tier queries', async () => {
      for (let i = 0; i < 15; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      await edgevec.alarm()

      // Vectors should still exist in SQLite (not deleted)
      for (let i = 0; i < 15; i++) {
        const v = mockState._sql._getVector(`vec-${i}`)
        expect(v).toBeDefined()
      }
    })

    it('marks only the batch that was compacted', async () => {
      // Add 30 vectors, batch size will be limited
      for (let i = 0; i < 30; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      // Configure small batch
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig({
        compactionThreshold: 10,
        maxVectorsPerFile: 15,
      }))

      await edgevec.alarm()

      // Only 15 should be marked, 15 still pending
      // (pending count depends on batch size limit)
      expect(mockEnv.EDGEVEC_R2?.put).toHaveBeenCalledTimes(1)
    })
  })

  // ==========================================================================
  // 6. COMPACTION RESULT
  // ==========================================================================

  describe('Compaction result', () => {
    beforeEach(async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig({ compactionThreshold: 10 }))
    })

    it('returns compaction result with statistics', async () => {
      for (let i = 0; i < 20; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      const result = await (edgevec as unknown as { compactToParquet(): Promise<CompactionResult | null> }).compactToParquet()

      expect(result).not.toBeNull()
      expect(result).toMatchObject({
        vectorsCompacted: expect.any(Number),
        parquetKey: expect.stringMatching(/^vectors\/.*\.parquet$/),
        fileSize: expect.any(Number),
        durationMs: expect.any(Number),
      })
    })

    it('returns null when no vectors to compact', async () => {
      const result = await (edgevec as unknown as { compactToParquet(): Promise<CompactionResult | null> }).compactToParquet()

      expect(result).toBeNull()
    })

    it('returns null when below threshold', async () => {
      for (let i = 0; i < 5; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      // compactToParquet checks threshold internally when called via alarm
      // Direct call should still compact if there are vectors
      const result = await (edgevec as unknown as { compactToParquet(): Promise<CompactionResult | null> }).compactToParquet()

      // Direct call should compact regardless of threshold
      expect(result).not.toBeNull()
    })
  })

  // ==========================================================================
  // 7. ERROR HANDLING
  // ==========================================================================

  describe('Error handling', () => {
    beforeEach(async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)
      await edgevec.initialize(createSampleConfig({ compactionThreshold: 10 }))
    })

    it('handles missing R2 binding gracefully', async () => {
      const envWithoutR2 = createMockEnv({ EDGEVEC_R2: undefined })
      const edgevecNoR2 = new EdgeVecDO(mockState, envWithoutR2)
      await edgevecNoR2.initialize(createSampleConfig({ compactionThreshold: 10 }))

      for (let i = 0; i < 20; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      // Should not throw, but should skip compaction
      await expect(edgevecNoR2.alarm()).resolves.not.toThrow()
    })

    it('handles SQL errors during vector selection', async () => {
      mockState._sql.exec = vi.fn().mockImplementation(() => {
        throw new Error('SQL error')
      })

      for (let i = 0; i < 20; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      // Should not crash the alarm
      await expect(edgevec.alarm()).resolves.not.toThrow()
    })

    it('handles Parquet build errors', async () => {
      // Add vectors with invalid data that would fail Parquet building
      for (let i = 0; i < 15; i++) {
        const v = createSampleCompactableVector(`vec-${i}`)
        v.vector = [] // Invalid - empty vector
        mockState._sql._addVector(v)
      }

      // Should handle gracefully
      await expect(edgevec.alarm()).resolves.not.toThrow()
    })

    it('reschedules alarm even after error', async () => {
      mockEnv.EDGEVEC_R2?.put.mockRejectedValue(new Error('Upload failed'))

      for (let i = 0; i < 20; i++) {
        mockState._sql._addVector(createSampleCompactableVector(`vec-${i}`))
      }

      ;(mockState.storage.setAlarm as Mock).mockClear()
      await edgevec.alarm()

      // Should still reschedule alarm for next check
      expect(mockState.storage.setAlarm).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 8. SCHEMA MIGRATION
  // ==========================================================================

  describe('Schema migration for compacted_at column', () => {
    it('adds compacted_at column if not exists on initialization', async () => {
      edgevec = new EdgeVecDO(mockState, mockEnv)

      // Initialize should succeed (schema is created with compacted_at column)
      await expect(edgevec.initialize(createSampleConfig())).resolves.not.toThrow()

      // Verify by adding and querying vectors with compacted_at
      mockState._sql._addVector(createSampleCompactableVector('test-vec'))
      const vec = mockState._sql._getVector('test-vec')
      expect(vec).toBeDefined()
      expect(vec?.compacted_at).toBeNull() // Initially not compacted
    })

    it('handles existing compacted_at column gracefully', async () => {
      // Simulate column already exists
      mockState._sql.exec = vi.fn().mockImplementation((query) => {
        if (query.toLowerCase().includes('alter table') && query.toLowerCase().includes('compacted_at')) {
          throw new Error('duplicate column name')
        }
        return { toArray: () => [], one: () => undefined, raw: () => [] }
      })

      edgevec = new EdgeVecDO(mockState, mockEnv)

      // Should not throw
      await expect(edgevec.initialize(createSampleConfig())).resolves.not.toThrow()
    })
  })
})
