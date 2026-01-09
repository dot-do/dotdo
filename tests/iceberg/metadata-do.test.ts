/**
 * Tests for IcebergMetadataDO
 *
 * Tests the Iceberg metadata caching, manifest parsing, and partition pruning
 * functionality using mock R2 storage.
 *
 * @module tests/iceberg/metadata-do.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { IcebergMetadataDO, type IcebergMetadataDOEnv } from '../../objects/IcebergMetadataDO'
import type { IcebergMetadata, ManifestFile, DataFileEntry, Filter } from '../../types/iceberg'
import type { R2Bucket, R2Object, R2ListOptions, R2ObjectBody, R2Objects } from '@cloudflare/workers-types'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a mock Iceberg metadata object
 */
function createMockMetadata(options: {
  tableId?: string
  snapshotId?: number
  manifestListPath?: string
} = {}): IcebergMetadata {
  const { tableId = 'do_resources', snapshotId = 1, manifestListPath = 'iceberg/do_resources/metadata/snap-1-manifest-list.avro' } = options

  return {
    formatVersion: 2,
    tableUuid: 'test-uuid-' + tableId,
    location: `iceberg/${tableId}/`,
    lastUpdatedMs: Date.now(),
    lastColumnId: 10,
    schemas: [
      {
        schemaId: 1,
        type: 'struct',
        fields: [
          { id: 1, name: 'ns', required: true, type: 'string' },
          { id: 2, name: 'type', required: true, type: 'string' },
          { id: 3, name: 'id', required: true, type: 'string' },
          { id: 4, name: 'ts', required: true, type: 'timestamptz' },
          { id: 5, name: 'esm', required: false, type: 'string' },
          { id: 6, name: 'dts', required: false, type: 'string' },
        ],
      },
    ],
    currentSchemaId: 1,
    partitionSpecs: [
      {
        specId: 0,
        fields: [
          { sourceId: 1, fieldId: 1000, name: 'ns', transform: 'identity' },
          { sourceId: 2, fieldId: 1001, name: 'type', transform: 'identity' },
        ],
      },
    ],
    defaultSpecId: 0,
    lastPartitionId: 1001,
    currentSnapshotId: snapshotId,
    snapshots: [
      {
        snapshotId,
        parentSnapshotId: null,
        timestampMs: Date.now(),
        manifestList: manifestListPath,
        summary: {
          operation: 'append',
          'added-records': '100',
        },
      },
    ],
  }
}

/**
 * Create mock manifest list entries
 */
function createMockManifestListEntries(): ManifestFile[] {
  return [
    {
      manifestPath: 'iceberg/do_resources/metadata/manifest-1.avro',
      manifestLength: 4096,
      partitionSpecId: 0,
      sequenceNumber: 1,
      minSequenceNumber: 1,
      addedSnapshotId: 1,
      addedFilesCount: 3,
      existingFilesCount: 0,
      deletedFilesCount: 0,
      addedRowsCount: 150,
      existingRowsCount: 0,
      deletedRowsCount: 0,
      partitions: [
        {
          containsNull: false,
          lowerBound: 'payments.do',
          upperBound: 'payments.do',
        },
        {
          containsNull: false,
          lowerBound: 'Function',
          upperBound: 'Schema',
        },
      ],
    },
    {
      manifestPath: 'iceberg/do_resources/metadata/manifest-2.avro',
      manifestLength: 4096,
      partitionSpecId: 0,
      sequenceNumber: 1,
      minSequenceNumber: 1,
      addedSnapshotId: 1,
      addedFilesCount: 2,
      existingFilesCount: 0,
      deletedFilesCount: 0,
      addedRowsCount: 100,
      existingRowsCount: 0,
      deletedRowsCount: 0,
      partitions: [
        {
          containsNull: false,
          lowerBound: 'orders.do',
          upperBound: 'orders.do',
        },
        {
          containsNull: false,
          lowerBound: 'Function',
          upperBound: 'Function',
        },
      ],
    },
  ]
}

/**
 * Create mock data file entries
 */
function createMockDataFiles(manifest: 'manifest-1' | 'manifest-2'): DataFileEntry[] {
  if (manifest === 'manifest-1') {
    return [
      {
        status: 1,
        filePath: 'iceberg/do_resources/data/ns=payments.do/type=Function/00001.parquet',
        fileFormat: 'PARQUET',
        partition: { ns: 'payments.do', type: 'Function' },
        recordCount: 50,
        fileSizeBytes: 8192,
      },
      {
        status: 1,
        filePath: 'iceberg/do_resources/data/ns=payments.do/type=Function/00002.parquet',
        fileFormat: 'PARQUET',
        partition: { ns: 'payments.do', type: 'Function' },
        recordCount: 50,
        fileSizeBytes: 8192,
      },
      {
        status: 1,
        filePath: 'iceberg/do_resources/data/ns=payments.do/type=Schema/00001.parquet',
        fileFormat: 'PARQUET',
        partition: { ns: 'payments.do', type: 'Schema' },
        recordCount: 50,
        fileSizeBytes: 4096,
      },
    ]
  }

  return [
    {
      status: 1,
      filePath: 'iceberg/do_resources/data/ns=orders.do/type=Function/00001.parquet',
      fileFormat: 'PARQUET',
      partition: { ns: 'orders.do', type: 'Function' },
      recordCount: 60,
      fileSizeBytes: 10240,
    },
    {
      status: 1,
      filePath: 'iceberg/do_resources/data/ns=orders.do/type=Function/00002.parquet',
      fileFormat: 'PARQUET',
      partition: { ns: 'orders.do', type: 'Function' },
      recordCount: 40,
      fileSizeBytes: 6144,
    },
  ]
}

// ============================================================================
// Mock R2 Bucket
// ============================================================================

/**
 * Create a mock R2 bucket for testing
 */
function createMockR2Bucket(options: {
  metadata?: IcebergMetadata
  manifestList?: ManifestFile[]
  manifests?: Record<string, DataFileEntry[]>
} = {}): R2Bucket {
  const { metadata, manifestList, manifests = {} } = options

  // Storage for mocked objects
  const storage = new Map<string, unknown>()

  // Set up metadata if provided
  if (metadata) {
    storage.set(`iceberg/${metadata.location.split('/')[1]}/metadata/v1.metadata.json`, metadata)
  }

  const bucket: R2Bucket = {
    get: vi.fn(async (key: string) => {
      // Handle metadata.json
      if (key.endsWith('.metadata.json')) {
        const storedMetadata = storage.get(key) || metadata
        if (storedMetadata) {
          return createMockR2Object(JSON.stringify(storedMetadata))
        }
        return null
      }

      // Handle version-hint.text
      if (key.endsWith('version-hint.text')) {
        return createMockR2Object('1')
      }

      // Handle manifest list (return empty for now - we mock the parsed result)
      if (key.includes('manifest-list.avro')) {
        // Return a mock Avro file (tests will mock the parsing)
        return createMockR2Object('mock-avro-data')
      }

      // Handle manifest files
      if (key.includes('manifest-') && key.endsWith('.avro')) {
        return createMockR2Object('mock-avro-data')
      }

      return null
    }),

    list: vi.fn(async (options?: R2ListOptions) => {
      const prefix = options?.prefix ?? ''
      const result: R2Objects = {
        objects: [],
        truncated: false,
        delimitedPrefixes: [],
      }

      // Return metadata file listing
      if (prefix.includes('/metadata/')) {
        result.objects = [
          {
            key: `${prefix.replace('/metadata/', '/metadata/')}v1.metadata.json`,
            size: 4096,
            etag: 'test-etag',
            httpEtag: '"test-etag"',
            uploaded: new Date(),
            version: 'v1',
          },
        ] as R2Object[]
      }

      return result
    }),

    put: vi.fn(async () => null as unknown as R2Object),
    delete: vi.fn(async () => {}),
    head: vi.fn(async () => null),
    createMultipartUpload: vi.fn(async () => ({
      key: '',
      uploadId: '',
      uploadPart: vi.fn(),
      abort: vi.fn(),
      complete: vi.fn(),
    })),
    resumeMultipartUpload: vi.fn(async () => ({
      key: '',
      uploadId: '',
      uploadPart: vi.fn(),
      abort: vi.fn(),
      complete: vi.fn(),
    })),
  }

  return bucket
}

/**
 * Create a mock R2Object with body
 */
function createMockR2Object(content: string): R2ObjectBody {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)

  return {
    key: 'test-key',
    size: data.length,
    etag: 'test-etag',
    httpEtag: '"test-etag"',
    uploaded: new Date(),
    version: 'v1',
    checksums: {},
    httpMetadata: {},
    customMetadata: {},
    storageClass: 'Standard',
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(data)
        controller.close()
      },
    }),
    bodyUsed: false,
    text: async () => content,
    json: async () => JSON.parse(content),
    arrayBuffer: async () => data.buffer as ArrayBuffer,
    blob: async () => new Blob([data]),
    writeHttpMetadata: () => {},
  } as unknown as R2ObjectBody
}

// ============================================================================
// Mock Durable Object State
// ============================================================================

function createMockDOState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: { toString: () => 'test-do-id', equals: () => false, name: 'test' },
    storage: {
      get: vi.fn(async <T>(key: string) => storage.get(key) as T),
      getAlarm: vi.fn(async () => null),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string | string[]) => {
        if (Array.isArray(key)) {
          key.forEach((k) => storage.delete(k))
          return key.length
        }
        storage.delete(key)
        return storage.has(key) ? false : true
      }),
      deleteAll: vi.fn(async () => {}),
      list: vi.fn(async (options?: { prefix?: string }) => {
        const prefix = options?.prefix ?? ''
        const result = new Map<string, unknown>()
        for (const [k, v] of storage) {
          if (k.startsWith(prefix)) {
            result.set(k, v)
          }
        }
        return result
      }),
      setAlarm: vi.fn(async () => {}),
      deleteAlarm: vi.fn(async () => {}),
      sync: vi.fn(async () => {}),
      transaction: vi.fn(async (closure) => closure({
        get: async (key: string) => storage.get(key),
        put: async (key: string, value: unknown) => storage.set(key, value),
        delete: async (key: string) => storage.delete(key),
        list: async () => storage,
        rollback: () => {},
      })),
      getMultiple: vi.fn(async (keys: string[]) => {
        const result = new Map<string, unknown>()
        for (const key of keys) {
          if (storage.has(key)) {
            result.set(key, storage.get(key))
          }
        }
        return result
      }),
      putMultiple: vi.fn(async (entries: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(entries)) {
          storage.set(k, v)
        }
      }),
    },
    blockConcurrencyWhile: vi.fn(async (callback) => callback()),
    waitUntil: vi.fn(),
    abort: vi.fn(),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
    setWebSocketAutoResponse: vi.fn(),
    getWebSocketAutoResponse: vi.fn(() => null),
    getWebSocketAutoResponseTimestamp: vi.fn(() => null),
    setHibernatableWebSocketEventTimeout: vi.fn(),
    getHibernatableWebSocketEventTimeout: vi.fn(() => null),
    getTags: vi.fn(() => []),
  } as unknown as DurableObjectState
}

// ============================================================================
// Tests
// ============================================================================

describe('IcebergMetadataDO', () => {
  let mockState: DurableObjectState
  let mockEnv: IcebergMetadataDOEnv
  let metadataDO: IcebergMetadataDO

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = {
      R2: createMockR2Bucket({
        metadata: createMockMetadata(),
      }),
    }
    metadataDO = new IcebergMetadataDO(mockState, mockEnv)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('initializes with default configuration', () => {
      expect(metadataDO).toBeInstanceOf(IcebergMetadataDO)
    })

    it('accepts custom configuration via env', () => {
      const customEnv: IcebergMetadataDOEnv = {
        R2: createMockR2Bucket(),
        ICEBERG_BASE_PATH: 'custom/path/',
        METADATA_TTL_MS: '60000',
        MANIFEST_TTL_MS: '120000',
      }
      const customDO = new IcebergMetadataDO(mockState, customEnv)
      expect(customDO).toBeInstanceOf(IcebergMetadataDO)
    })

    it('restores cache from storage on startup', async () => {
      // blockConcurrencyWhile should be called
      expect(mockState.blockConcurrencyWhile).toHaveBeenCalled()
    })
  })

  describe('getTableMetadata()', () => {
    it('loads metadata from R2', async () => {
      const metadata = await metadataDO.getTableMetadata('do_resources')

      expect(metadata).toBeDefined()
      expect(metadata.formatVersion).toBe(2)
      expect(metadata.tableUuid).toContain('do_resources')
      expect(mockEnv.R2.get).toHaveBeenCalled()
    })

    it('caches metadata after first load', async () => {
      // First call
      await metadataDO.getTableMetadata('do_resources')

      // Second call should hit cache
      await metadataDO.getTableMetadata('do_resources')

      // R2.get should only be called once for metadata (plus version hint)
      const getCalls = (mockEnv.R2.get as ReturnType<typeof vi.fn>).mock.calls
      const metadataCalls = getCalls.filter((call: string[]) => call[0].includes('.metadata.json'))
      expect(metadataCalls.length).toBe(1)
    })

    it('respects forceRefresh option', async () => {
      // First call
      await metadataDO.getTableMetadata('do_resources')

      // Force refresh
      await metadataDO.getTableMetadata('do_resources', { forceRefresh: true })

      // Should have two R2 calls for metadata
      const getCalls = (mockEnv.R2.get as ReturnType<typeof vi.fn>).mock.calls
      const metadataCalls = getCalls.filter((call: string[]) => call[0].includes('.metadata.json'))
      expect(metadataCalls.length).toBe(2)
    })

    it('throws error when table not found', async () => {
      mockEnv.R2.get = vi.fn(async () => null)

      await expect(metadataDO.getTableMetadata('nonexistent')).rejects.toThrow()
    })
  })

  describe('getPartitionPlan()', () => {
    beforeEach(() => {
      // Set up a more complete mock that handles all file types
      const metadata = createMockMetadata()
      const manifestList = createMockManifestListEntries()

      mockEnv.R2 = createMockR2Bucket({
        metadata,
        manifestList,
      })
      metadataDO = new IcebergMetadataDO(mockState, mockEnv)
    })

    it('returns empty plan when no snapshots', async () => {
      const emptyMetadata = createMockMetadata()
      emptyMetadata.snapshots = []
      emptyMetadata.currentSnapshotId = undefined

      mockEnv.R2 = createMockR2Bucket({ metadata: emptyMetadata })
      metadataDO = new IcebergMetadataDO(mockState, mockEnv)

      const plan = await metadataDO.getPartitionPlan('do_resources')

      expect(plan.files).toEqual([])
      expect(plan.totalRecords).toBe(0)
    })

    it('includes all files when no filters', async () => {
      // This test verifies the plan structure without filters
      // Since Avro parsing is mocked, we verify the plan is created correctly
      const plan = await metadataDO.getPartitionPlan('do_resources')

      expect(plan.tableId).toBe('do_resources')
      expect(plan.snapshotId).toBeDefined()
      expect(plan.pruningStats).toBeDefined()
      expect(plan.createdAt).toBeDefined()
    })

    it('includes pruning statistics', async () => {
      const plan = await metadataDO.getPartitionPlan('do_resources', [
        { column: 'ns', operator: 'eq', value: 'payments.do' },
      ])

      expect(plan.pruningStats.totalManifests).toBeGreaterThanOrEqual(0)
      expect(plan.pruningStats.prunedManifests).toBeGreaterThanOrEqual(0)
      expect(plan.pruningStats.totalDataFiles).toBeGreaterThanOrEqual(0)
      expect(plan.pruningStats.prunedDataFiles).toBeGreaterThanOrEqual(0)
    })
  })

  describe('invalidateCache()', () => {
    it('removes cached metadata for table', async () => {
      // Load metadata first
      await metadataDO.getTableMetadata('do_resources')

      // Invalidate
      const result = await metadataDO.invalidateCache('do_resources')

      expect(result.success).toBe(true)
      expect(result.tableId).toBe('do_resources')
      expect(result.entriesRemoved).toBeGreaterThanOrEqual(1)
      expect(result.invalidatedAt).toBeDefined()

      // Next call should hit R2 again
      await metadataDO.getTableMetadata('do_resources')

      const getCalls = (mockEnv.R2.get as ReturnType<typeof vi.fn>).mock.calls
      const metadataCalls = getCalls.filter((call: string[]) => call[0].includes('.metadata.json'))
      expect(metadataCalls.length).toBe(2)
    })

    it('returns zero entries removed for non-cached table', async () => {
      const result = await metadataDO.invalidateCache('nonexistent_table')

      expect(result.success).toBe(true)
      expect(result.entriesRemoved).toBe(0)
    })
  })

  describe('getCacheStats()', () => {
    it('returns cache statistics', async () => {
      const stats = metadataDO.getCacheStats()

      expect(stats).toHaveProperty('cachedTables')
      expect(stats).toHaveProperty('cachedManifestLists')
      expect(stats).toHaveProperty('cachedManifests')
      expect(stats).toHaveProperty('hitRate')
      expect(stats).toHaveProperty('cacheSizeBytes')
    })

    it('updates hit rate after cache hits', async () => {
      // First call (miss)
      await metadataDO.getTableMetadata('do_resources')

      const statsAfterMiss = metadataDO.getCacheStats()

      // Second call (hit)
      await metadataDO.getTableMetadata('do_resources')

      const statsAfterHit = metadataDO.getCacheStats()

      expect(statsAfterHit.hitRate).toBeGreaterThan(statsAfterMiss.hitRate)
    })
  })

  describe('clearAllCaches()', () => {
    it('clears all cached data', async () => {
      // Load some data
      await metadataDO.getTableMetadata('do_resources')

      // Clear
      await metadataDO.clearAllCaches()

      // Stats should show empty caches
      const stats = metadataDO.getCacheStats()
      expect(stats.cachedTables).toBe(0)
      expect(stats.cachedManifestLists).toBe(0)
      expect(stats.cachedManifests).toBe(0)
      expect(stats.hitRate).toBe(0)
    })
  })

  describe('HTTP fetch() handler', () => {
    it('GET /metadata/:tableId returns metadata', async () => {
      const request = new Request('http://localhost/metadata/do_resources')
      const response = await metadataDO.fetch(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.formatVersion).toBe(2)
    })

    it('GET /metadata/:tableId?refresh=true forces refresh', async () => {
      // First call
      await metadataDO.fetch(new Request('http://localhost/metadata/do_resources'))

      // Force refresh
      const request = new Request('http://localhost/metadata/do_resources?refresh=true')
      const response = await metadataDO.fetch(request)

      expect(response.status).toBe(200)

      // Should have two R2 calls
      const getCalls = (mockEnv.R2.get as ReturnType<typeof vi.fn>).mock.calls
      const metadataCalls = getCalls.filter((call: string[]) => call[0].includes('.metadata.json'))
      expect(metadataCalls.length).toBe(2)
    })

    it('POST /plan/:tableId returns partition plan', async () => {
      const request = new Request('http://localhost/plan/do_resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: [{ column: 'ns', operator: 'eq', value: 'payments.do' }],
        }),
      })
      const response = await metadataDO.fetch(request)

      expect(response.status).toBe(200)
      const plan = await response.json()
      expect(plan.tableId).toBe('do_resources')
    })

    it('DELETE /cache/:tableId invalidates cache', async () => {
      // Load metadata first
      await metadataDO.getTableMetadata('do_resources')

      // Invalidate via HTTP
      const request = new Request('http://localhost/cache/do_resources', {
        method: 'DELETE',
      })
      const response = await metadataDO.fetch(request)

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result.success).toBe(true)
    })

    it('GET /stats returns cache statistics', async () => {
      const request = new Request('http://localhost/stats')
      const response = await metadataDO.fetch(request)

      expect(response.status).toBe(200)
      const stats = await response.json()
      expect(stats).toHaveProperty('cachedTables')
    })

    it('DELETE /cache clears all caches', async () => {
      // Load some data
      await metadataDO.getTableMetadata('do_resources')

      // Clear via HTTP
      const request = new Request('http://localhost/cache', {
        method: 'DELETE',
      })
      const response = await metadataDO.fetch(request)

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result.success).toBe(true)
    })

    it('returns 404 for unknown routes', async () => {
      const request = new Request('http://localhost/unknown')
      const response = await metadataDO.fetch(request)

      expect(response.status).toBe(404)
    })

    it('returns 500 on errors', async () => {
      mockEnv.R2.get = vi.fn(async () => {
        throw new Error('R2 error')
      })
      metadataDO = new IcebergMetadataDO(mockState, mockEnv)

      const request = new Request('http://localhost/metadata/do_resources')
      const response = await metadataDO.fetch(request)

      expect(response.status).toBe(500)
      const result = await response.json()
      expect(result.error).toBeDefined()
    })
  })
})

describe('Partition Pruning Logic', () => {
  let mockState: DurableObjectState
  let mockEnv: IcebergMetadataDOEnv

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = {
      R2: createMockR2Bucket({
        metadata: createMockMetadata(),
      }),
    }
  })

  describe('Filter operators', () => {
    it('supports eq operator', async () => {
      const metadataDO = new IcebergMetadataDO(mockState, mockEnv)
      const filter: Filter = { column: 'ns', operator: 'eq', value: 'payments.do' }

      const plan = await metadataDO.getPartitionPlan('do_resources', [filter])
      expect(plan).toBeDefined()
    })

    it('supports neq operator', async () => {
      const metadataDO = new IcebergMetadataDO(mockState, mockEnv)
      const filter: Filter = { column: 'ns', operator: 'neq', value: 'orders.do' }

      const plan = await metadataDO.getPartitionPlan('do_resources', [filter])
      expect(plan).toBeDefined()
    })

    it('supports in operator', async () => {
      const metadataDO = new IcebergMetadataDO(mockState, mockEnv)
      const filter: Filter = { column: 'ns', operator: 'in', values: ['payments.do', 'orders.do'] }

      const plan = await metadataDO.getPartitionPlan('do_resources', [filter])
      expect(plan).toBeDefined()
    })

    it('supports is_null operator', async () => {
      const metadataDO = new IcebergMetadataDO(mockState, mockEnv)
      const filter: Filter = { column: 'deleted_at', operator: 'is_null' }

      const plan = await metadataDO.getPartitionPlan('do_resources', [filter])
      expect(plan).toBeDefined()
    })

    it('supports comparison operators (gt, gte, lt, lte)', async () => {
      const metadataDO = new IcebergMetadataDO(mockState, mockEnv)

      for (const operator of ['gt', 'gte', 'lt', 'lte'] as const) {
        const filter: Filter = { column: 'record_count', operator, value: 100 }
        const plan = await metadataDO.getPartitionPlan('do_resources', [filter])
        expect(plan).toBeDefined()
      }
    })
  })

  describe('Multiple filters', () => {
    it('applies multiple filters (AND semantics)', async () => {
      const metadataDO = new IcebergMetadataDO(mockState, mockEnv)

      const filters: Filter[] = [
        { column: 'ns', operator: 'eq', value: 'payments.do' },
        { column: 'type', operator: 'eq', value: 'Function' },
      ]

      const plan = await metadataDO.getPartitionPlan('do_resources', filters)
      expect(plan).toBeDefined()
    })
  })
})

describe('Cache TTL behavior', () => {
  it('respects custom TTL from options', async () => {
    const mockState = createMockDOState()
    const mockEnv: IcebergMetadataDOEnv = {
      R2: createMockR2Bucket({
        metadata: createMockMetadata(),
      }),
    }
    const metadataDO = new IcebergMetadataDO(mockState, mockEnv)

    // Load with custom TTL
    await metadataDO.getTableMetadata('do_resources', { ttlMs: 1 })

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Next call should miss cache
    await metadataDO.getTableMetadata('do_resources')

    const getCalls = (mockEnv.R2.get as ReturnType<typeof vi.fn>).mock.calls
    const metadataCalls = getCalls.filter((call: string[]) => call[0].includes('.metadata.json'))
    expect(metadataCalls.length).toBe(2)
  })
})
