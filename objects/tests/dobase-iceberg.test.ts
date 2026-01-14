/**
 * DOBase Iceberg State Persistence Tests (RED Phase - TDD)
 *
 * RED TDD: These tests should FAIL because loadFromIceberg() and saveToIceberg()
 * don't exist yet on DOBase.
 *
 * This file defines the expected behavior for saving and loading Durable Object
 * state to/from Iceberg snapshots on R2. This enables:
 * - Stateless deployments on any platform (Vercel, fly.io, K8s)
 * - JWT-authorized storage access via oauth.do
 * - No Turso dependency for state persistence
 *
 * Test Suites:
 *
 * DOBase.loadFromIceberg:
 * 1. Basic Load - Load state from Iceberg on cold start
 * 2. JWT Path Construction - Use JWT claims to locate snapshot
 * 3. Fresh DO Handling - Handle missing snapshot gracefully
 * 4. Latest Snapshot Selection - Load most recent snapshot when multiple exist
 * 5. Lifecycle Events - Emit stateLoaded event on load
 *
 * DOBase.saveToIceberg:
 * 1. Basic Save - Save state to Iceberg snapshot on R2
 * 2. Snapshot Sequencing - Increment sequence numbers, update latest pointer
 * 3. Iceberg Format - Write metadata.json, manifests, Parquet data files
 * 4. Lifecycle Events - Emit checkpointed event
 * 5. Error Handling - Handle R2 failures, missing JWT
 *
 * Target: 30+ test cases (all failing until implementation)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// These imports will FAIL - implementation doesn't exist yet
import { DO } from '../core/DO'
import { DOBase } from '../core/DOBase'

// ============================================================================
// TYPE DEFINITIONS (for test clarity)
// ============================================================================

/**
 * R2 object metadata structure
 */
interface R2Object {
  key: string
  size?: number
  etag?: string
  uploaded?: Date
}

/**
 * R2 list result structure
 */
interface R2ListResult {
  objects: R2Object[]
  truncated?: boolean
  cursor?: string
}

/**
 * R2 object body structure
 */
interface R2ObjectBody {
  text(): Promise<string>
  json<T>(): Promise<T>
  arrayBuffer(): Promise<ArrayBuffer>
}

// ============================================================================
// MOCK HELPERS
// ============================================================================

/**
 * Create a mock R2 bucket for testing Iceberg snapshot operations
 */
function createMockR2() {
  const storage = new Map<string, ArrayBuffer>()

  return {
    put: vi.fn(async (key: string, value: ArrayBuffer | string) => {
      const buffer = typeof value === 'string'
        ? new TextEncoder().encode(value).buffer
        : value
      storage.set(key, buffer)
      return {}
    }),
    get: vi.fn(async (key: string): Promise<R2ObjectBody | null> => {
      const value = storage.get(key)
      if (!value) return null
      return {
        text: async () => new TextDecoder().decode(value),
        json: async <T>() => JSON.parse(new TextDecoder().decode(value)) as T,
        arrayBuffer: async () => value,
      }
    }),
    list: vi.fn(async (options?: { prefix?: string }): Promise<R2ListResult> => {
      const objects: R2Object[] = []
      for (const [key] of storage) {
        if (options?.prefix && !key.startsWith(options.prefix)) continue
        objects.push({ key })
      }
      return { objects }
    }),
    delete: vi.fn(async (key: string) => {
      storage.delete(key)
      return undefined
    }),
    // Internal access for test setup
    _storage: storage,
  }
}

/**
 * Create mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  const tables = new Map<string, unknown[]>()

  return {
    exec: vi.fn((query: string, ...params: unknown[]) => {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    }),
    _tables: tables,
  }
}

/**
 * Create mock DurableObjectState for testing
 */
function createMockDOState(id: string = 'do_123') {
  const kvStorage = new Map<string, unknown>()
  const sqlStorage = createMockSqlStorage()

  return {
    id: {
      toString: () => id,
      name: id,
      equals: (other: { toString: () => string }) => other.toString() === id,
    },
    storage: {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => kvStorage.get(key) as T | undefined),
      put: vi.fn(async <T>(key: string, value: T): Promise<void> => {
        kvStorage.set(key, value)
      }),
      delete: vi.fn(async (key: string): Promise<boolean> => kvStorage.delete(key)),
      deleteAll: vi.fn(async (): Promise<void> => kvStorage.clear()),
      list: vi.fn(async <T>(options?: { prefix?: string }): Promise<Map<string, T>> => {
        const result = new Map<string, T>()
        for (const [key, value] of kvStorage) {
          if (options?.prefix && !key.startsWith(options.prefix)) continue
          result.set(key, value as T)
        }
        return result
      }),
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
    _kvStorage: kvStorage,
    _sqlStorage: sqlStorage,
  } as unknown as DurableObjectState & {
    _kvStorage: Map<string, unknown>
    _sqlStorage: ReturnType<typeof createMockSqlStorage>
  }
}

/**
 * Create mock environment with R2 bucket
 */
function createMockEnv(mockR2: ReturnType<typeof createMockR2>) {
  return {
    R2: mockR2,
    DO: {
      idFromName: vi.fn((name: string) => ({ toString: () => `id-for-${name}` })),
      get: vi.fn(() => ({
        fetch: vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
      })),
    },
    // For JWT context testing
    JWT: undefined as string | undefined,
  }
}

/**
 * Create a test JWT with claims for storage path construction
 */
function createTestJwt(claims: Record<string, unknown> = {}) {
  // Simple base64 encoded JWT for testing (not cryptographically valid)
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({
    org_id: 'org_123',
    tenant_id: 'tenant_456',
    sub: 'user_789',
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    iat: Math.floor(Date.now() / 1000),
    ...claims,
  }))
  const signature = 'test_signature_not_valid'
  return `${header}.${payload}.${signature}`
}

/**
 * Create a mock Iceberg snapshot for testing
 */
function createMockSnapshot(data: Record<string, unknown> = {}) {
  const snapshot = {
    version: 1,
    sequenceNumber: 1,
    timestamp: Date.now(),
    tables: {
      things: [],
      branches: [],
      actions: [],
      events: [],
      objects: [],
      ...data,
    },
    checksum: 'mock_checksum_abc123',
  }
  return new TextEncoder().encode(JSON.stringify(snapshot)).buffer
}

// ============================================================================
// TEST SUITE: DOBase.loadFromIceberg
// ============================================================================

describe('DOBase.loadFromIceberg', () => {
  let mockR2: ReturnType<typeof createMockR2>
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    vi.clearAllMocks()
    mockR2 = createMockR2()
    mockState = createMockDOState()
    mockEnv = createMockEnv(mockR2)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --------------------------------------------------------------------------
  // Test 1: Basic Load
  // --------------------------------------------------------------------------
  describe('Basic Load', () => {
    it('should load state from Iceberg on cold start', async () => {
      // Setup: JWT for authorization
      const testJwt = createTestJwt({ org_id: 'org_123', tenant_id: 'tenant_456' })
      mockEnv.JWT = testJwt

      // Setup: mock a snapshot exists in R2
      const snapshotKey = 'orgs/org_123/tenants/tenant_456/do/do_123/snapshots/seq-1-abc123'
      mockR2._storage.set(snapshotKey, createMockSnapshot({
        things: [{ id: 't1', type: 'Test', data: { name: 'Test Thing' } }],
      }))

      mockR2.list.mockResolvedValue({
        objects: [{ key: snapshotKey }],
      })
      mockR2.get.mockResolvedValue({
        text: async () => JSON.stringify({ tables: { things: [{ id: 't1' }] } }),
        json: async () => ({ tables: { things: [{ id: 't1' }] } }),
        arrayBuffer: async () => createMockSnapshot(),
      })

      // Create DO instance (simulating cold start)
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      // Act: Load state from Iceberg
      await doInstance.loadFromIceberg()

      // Assert: R2 was queried for snapshots
      expect(mockR2.list).toHaveBeenCalled()
    })

    it('should restore SQLite state from snapshot data', async () => {
      // Setup: JWT for authorization
      const testJwt = createTestJwt({ org_id: 'org_123', tenant_id: 'tenant_456' })
      mockEnv.JWT = testJwt

      const snapshotKey = 'orgs/org_123/tenants/tenant_456/do/do_123/snapshots/seq-1-abc123'
      const snapshotData = {
        version: 1,
        sequenceNumber: 1,
        tables: {
          things: [
            { id: 't1', type: 'Customer', data: { name: 'Alice' } },
            { id: 't2', type: 'Order', data: { total: 100 } },
          ],
        },
      }

      mockR2.list.mockResolvedValue({ objects: [{ key: snapshotKey }] })
      mockR2.get.mockResolvedValue({
        text: async () => JSON.stringify(snapshotData),
        json: async () => snapshotData,
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(snapshotData)).buffer,
      })

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.loadFromIceberg()

      // The SQL storage should have been populated
      expect(mockState._sqlStorage.exec).toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Test 2: JWT Path Construction
  // --------------------------------------------------------------------------
  describe('JWT Path Construction', () => {
    it('should use JWT claims to locate snapshot', async () => {
      const testJwt = createTestJwt({ org_id: 'org_123', tenant_id: 'tenant_456' })
      mockEnv.JWT = testJwt

      mockR2.list.mockResolvedValue({ objects: [] })

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.loadFromIceberg()

      // Should have called R2 list with correct path prefix
      expect(mockR2.list).toHaveBeenCalledWith(
        expect.objectContaining({
          prefix: expect.stringContaining('orgs/org_123/tenants/tenant_456/do/'),
        })
      )
    })

    it('should extract org_id and tenant_id from JWT for path', async () => {
      const testJwt = createTestJwt({
        org_id: 'custom_org_abc',
        tenant_id: 'custom_tenant_xyz'
      })
      mockEnv.JWT = testJwt

      mockR2.list.mockResolvedValue({ objects: [] })

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.loadFromIceberg()

      // Verify path includes the custom org and tenant
      expect(mockR2.list).toHaveBeenCalledWith(
        expect.objectContaining({
          prefix: expect.stringContaining('orgs/custom_org_abc/tenants/custom_tenant_xyz'),
        })
      )
    })

    it('should handle JWT passed as parameter', async () => {
      const testJwt = createTestJwt({ org_id: 'param_org', tenant_id: 'param_tenant' })

      mockR2.list.mockResolvedValue({ objects: [] })

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.loadFromIceberg(testJwt)

      // Should use JWT from parameter, not environment
      expect(mockR2.list).toHaveBeenCalledWith(
        expect.objectContaining({
          prefix: expect.stringContaining('orgs/param_org/tenants/param_tenant'),
        })
      )
    })
  })

  // --------------------------------------------------------------------------
  // Test 3: Fresh DO Handling
  // --------------------------------------------------------------------------
  describe('Fresh DO (No Snapshot)', () => {
    it('should handle missing snapshot (fresh DO)', async () => {
      // Setup: JWT for authorization
      const testJwt = createTestJwt({ org_id: 'org_123', tenant_id: 'tenant_456' })
      mockEnv.JWT = testJwt

      // No snapshots exist
      mockR2.list.mockResolvedValue({ objects: [] })

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      // Should not throw - fresh DOs start with empty state
      await expect(doInstance.loadFromIceberg()).resolves.not.toThrow()
    })

    it('should succeed without error when no snapshot exists', async () => {
      // Setup: JWT for authorization
      const testJwt = createTestJwt({ org_id: 'org_123', tenant_id: 'tenant_456' })
      mockEnv.JWT = testJwt

      mockR2.list.mockResolvedValue({ objects: [] })

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.loadFromIceberg()

      // R2 list was called but get was not (no snapshot to retrieve)
      expect(mockR2.list).toHaveBeenCalled()
      expect(mockR2.get).not.toHaveBeenCalled()
    })

    it('should handle missing JWT gracefully', async () => {
      // No JWT in environment or passed as parameter
      mockEnv.JWT = undefined

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      // Should succeed (possibly with warning) and start with empty state
      await expect(doInstance.loadFromIceberg()).resolves.not.toThrow()
    })
  })

  // --------------------------------------------------------------------------
  // Test 4: Latest Snapshot Selection
  // --------------------------------------------------------------------------
  describe('Latest Snapshot Selection', () => {
    it('should load latest snapshot when multiple exist', async () => {
      // Setup: JWT for authorization
      const testJwt = createTestJwt({ org_id: 'org_123', tenant_id: 'tenant_456' })
      mockEnv.JWT = testJwt

      // Multiple snapshots with different sequence numbers
      mockR2.list.mockResolvedValue({
        objects: [
          { key: 'orgs/org_123/tenants/tenant_456/do/do_123/snapshots/seq-1-older' },
          { key: 'orgs/org_123/tenants/tenant_456/do/do_123/snapshots/seq-3-latest' },
          { key: 'orgs/org_123/tenants/tenant_456/do/do_123/snapshots/seq-2-middle' },
        ],
      })

      const latestSnapshotData = {
        version: 1,
        sequenceNumber: 3,
        tables: { things: [{ id: 'latest_thing' }] },
      }

      mockR2.get.mockResolvedValue({
        text: async () => JSON.stringify(latestSnapshotData),
        json: async () => latestSnapshotData,
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(latestSnapshotData)).buffer,
      })

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.loadFromIceberg()

      // Should load seq-3 (latest)
      expect(mockR2.get).toHaveBeenCalledWith(
        expect.stringContaining('seq-3')
      )
    })

    it('should sort snapshots by sequence number correctly', async () => {
      // Setup: JWT for authorization
      const testJwt = createTestJwt({ org_id: 'org_123', tenant_id: 'tenant_456' })
      mockEnv.JWT = testJwt

      // Snapshots in random order
      mockR2.list.mockResolvedValue({
        objects: [
          { key: 'snapshots/seq-10-ten' },
          { key: 'snapshots/seq-2-two' },
          { key: 'snapshots/seq-100-hundred' },
          { key: 'snapshots/seq-1-one' },
        ],
      })

      mockR2.get.mockResolvedValue({
        text: async () => '{}',
        json: async () => ({ tables: {} }),
        arrayBuffer: async () => new ArrayBuffer(10),
      })

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.loadFromIceberg()

      // Should load seq-100 (highest number)
      expect(mockR2.get).toHaveBeenCalledWith(
        expect.stringContaining('seq-100')
      )
    })

    it('should handle single snapshot correctly', async () => {
      // Setup: JWT for authorization
      const testJwt = createTestJwt({ org_id: 'org_123', tenant_id: 'tenant_456' })
      mockEnv.JWT = testJwt

      const singleSnapshot = 'orgs/org_123/tenants/tenant_456/do/do_123/snapshots/seq-1-only'
      mockR2.list.mockResolvedValue({
        objects: [{ key: singleSnapshot }],
      })

      mockR2.get.mockResolvedValue({
        text: async () => '{}',
        json: async () => ({ tables: {} }),
        arrayBuffer: async () => new ArrayBuffer(10),
      })

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.loadFromIceberg()

      expect(mockR2.get).toHaveBeenCalledWith(singleSnapshot)
    })
  })

  // --------------------------------------------------------------------------
  // Test 5: Lifecycle Events
  // --------------------------------------------------------------------------
  describe('Lifecycle Events', () => {
    it('should emit lifecycle event on load', async () => {
      const events: string[] = []

      mockR2.list.mockResolvedValue({ objects: [] })

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      // Subscribe to lifecycle event
      doInstance.on('stateLoaded', () => events.push('loaded'))

      await doInstance.loadFromIceberg()

      expect(events).toContain('loaded')
    })

    it('should emit stateLoaded with fromSnapshot: true when snapshot loaded', async () => {
      const eventData: Array<{ fromSnapshot: boolean; snapshotId?: string }> = []

      mockR2.list.mockResolvedValue({
        objects: [{ key: 'snapshots/seq-1-test' }],
      })
      mockR2.get.mockResolvedValue({
        text: async () => '{}',
        json: async () => ({ tables: {} }),
        arrayBuffer: async () => new ArrayBuffer(10),
      })

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      doInstance.on('stateLoaded', (data: { fromSnapshot: boolean; snapshotId?: string }) => {
        eventData.push(data)
      })

      await doInstance.loadFromIceberg()

      expect(eventData).toContainEqual(
        expect.objectContaining({ fromSnapshot: true })
      )
    })

    it('should emit stateLoaded with fromSnapshot: false when no snapshot exists', async () => {
      const eventData: Array<{ fromSnapshot: boolean }> = []

      mockR2.list.mockResolvedValue({ objects: [] })

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      doInstance.on('stateLoaded', (data: { fromSnapshot: boolean }) => {
        eventData.push(data)
      })

      await doInstance.loadFromIceberg()

      expect(eventData).toContainEqual(
        expect.objectContaining({ fromSnapshot: false })
      )
    })
  })

  // --------------------------------------------------------------------------
  // Test 6: Error Handling
  // --------------------------------------------------------------------------
  describe('Error Handling', () => {
    it('should throw on R2 access error', async () => {
      mockR2.list.mockRejectedValue(new Error('R2 access denied'))

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await expect(doInstance.loadFromIceberg()).rejects.toThrow('R2 access denied')
    })

    it('should handle corrupted snapshot data', async () => {
      mockR2.list.mockResolvedValue({
        objects: [{ key: 'snapshots/seq-1-corrupted' }],
      })
      mockR2.get.mockResolvedValue({
        text: async () => 'not valid json {{{',
        json: async () => { throw new Error('Invalid JSON') },
        arrayBuffer: async () => new TextEncoder().encode('not valid json').buffer,
      })

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await expect(doInstance.loadFromIceberg()).rejects.toThrow()
    })

    it('should handle R2 get returning null for listed snapshot', async () => {
      // Snapshot listed but not found when fetching (race condition)
      mockR2.list.mockResolvedValue({
        objects: [{ key: 'snapshots/seq-1-deleted' }],
      })
      mockR2.get.mockResolvedValue(null)

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      // Should handle gracefully (either retry or treat as fresh)
      await expect(doInstance.loadFromIceberg()).resolves.not.toThrow()
    })
  })
})

// ============================================================================
// TEST SUITE: DOBase.saveToIceberg
// ============================================================================

describe('DOBase.saveToIceberg', () => {
  let mockR2: ReturnType<typeof createMockR2>
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    vi.clearAllMocks()
    mockR2 = createMockR2()
    mockState = createMockDOState()
    mockEnv = createMockEnv(mockR2)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --------------------------------------------------------------------------
  // Test 1: Basic Save
  // --------------------------------------------------------------------------
  describe('Basic Save', () => {
    it('should save state to Iceberg snapshot', async () => {
      const testJwt = createTestJwt({ org_id: 'org_123' })
      mockEnv.JWT = testJwt

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await doInstance.saveToIceberg()

      // Verify R2 was called
      expect(mockR2.put).toHaveBeenCalled()

      // Verify snapshot structure - path should contain 'snapshots/'
      const putCall = mockR2.put.mock.calls[0]
      expect(putCall[0]).toContain('snapshots/')
    })

    it('should use JWT storage claims to determine R2 path', async () => {
      const testJwt = createTestJwt({
        org_id: 'acme-corp',
        tenant_id: 'tenant-42',
      })
      mockEnv.JWT = testJwt

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await doInstance.saveToIceberg()

      // Verify the R2 path includes org and tenant from JWT claims
      const putCall = mockR2.put.mock.calls[0]
      const path = putCall[0] as string
      expect(path).toContain('acme-corp')
      expect(path).toContain('tenant-42')
    })

    it('should include DO id in snapshot path', async () => {
      const testJwt = createTestJwt({ org_id: 'org_123' })
      mockEnv.JWT = testJwt

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await doInstance.saveToIceberg()

      // Verify the R2 path includes the DO id
      const putCall = mockR2.put.mock.calls[0]
      const path = putCall[0] as string
      expect(path).toContain('do_123')
    })
  })

  // --------------------------------------------------------------------------
  // Test 2: Snapshot Sequencing
  // --------------------------------------------------------------------------
  describe('Snapshot Sequencing', () => {
    it('should increment snapshot sequence', async () => {
      const testJwt = createTestJwt({ org_id: 'org_123' })
      mockEnv.JWT = testJwt

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await doInstance.saveToIceberg()
      await doInstance.saveToIceberg()

      const calls = mockR2.put.mock.calls
      // First snapshot should have seq-1, second should have seq-2
      expect(calls.some((c: unknown[]) => (c[0] as string).includes('seq-1'))).toBe(true)
      expect(calls.some((c: unknown[]) => (c[0] as string).includes('seq-2'))).toBe(true)
    })

    it('should update latest pointer file', async () => {
      const testJwt = createTestJwt({ org_id: 'org_123' })
      mockEnv.JWT = testJwt

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await doInstance.saveToIceberg()

      // Verify the 'latest' pointer was updated
      const latestCall = mockR2.put.mock.calls.find((c: unknown[]) =>
        (c[0] as string).endsWith('/latest') || (c[0] as string).includes('snapshots/latest')
      )
      expect(latestCall).toBeDefined()
    })
  })

  // --------------------------------------------------------------------------
  // Test 3: Iceberg Format
  // --------------------------------------------------------------------------
  describe('Iceberg Format', () => {
    it('should write Iceberg metadata.json', async () => {
      const testJwt = createTestJwt({ org_id: 'org_123' })
      mockEnv.JWT = testJwt

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await doInstance.saveToIceberg()

      // Find the metadata.json put call
      const metadataCall = mockR2.put.mock.calls.find((c: unknown[]) =>
        (c[0] as string).includes('metadata.json')
      )
      expect(metadataCall).toBeDefined()

      // Parse and verify Iceberg format version 2
      const metadataContent = typeof metadataCall![1] === 'string'
        ? metadataCall![1]
        : new TextDecoder().decode(metadataCall![1] as Uint8Array)
      const metadata = JSON.parse(metadataContent)
      expect(metadata['format-version']).toBe(2)
    })

    it('should write manifest files', async () => {
      const testJwt = createTestJwt({ org_id: 'org_123' })
      mockEnv.JWT = testJwt

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await doInstance.saveToIceberg()

      // Find the manifest put call
      const manifestCall = mockR2.put.mock.calls.find((c: unknown[]) =>
        (c[0] as string).includes('manifests/')
      )
      expect(manifestCall).toBeDefined()
    })

    it('should write Parquet data files', async () => {
      const testJwt = createTestJwt({ org_id: 'org_123' })
      mockEnv.JWT = testJwt

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await doInstance.saveToIceberg()

      // Find a data file put call (Parquet files)
      const dataCall = mockR2.put.mock.calls.find((c: unknown[]) =>
        (c[0] as string).includes('/data/') || (c[0] as string).includes('.parquet')
      )
      expect(dataCall).toBeDefined()
    })

    it('should include snapshot timestamp in metadata', async () => {
      const testJwt = createTestJwt({ org_id: 'org_123' })
      mockEnv.JWT = testJwt

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await doInstance.saveToIceberg()

      // Find the metadata.json put call
      const metadataCall = mockR2.put.mock.calls.find((c: unknown[]) =>
        (c[0] as string).includes('metadata.json')
      )
      expect(metadataCall).toBeDefined()

      const metadataContent = typeof metadataCall![1] === 'string'
        ? metadataCall![1]
        : new TextDecoder().decode(metadataCall![1] as Uint8Array)
      const metadata = JSON.parse(metadataContent)

      // Iceberg metadata should have a snapshot with timestamp
      expect(metadata.snapshots).toBeDefined()
      expect(metadata.snapshots.length).toBeGreaterThan(0)
      expect(metadata.snapshots[0]['timestamp-ms']).toBeDefined()
    })
  })

  // --------------------------------------------------------------------------
  // Test 4: Lifecycle Events
  // --------------------------------------------------------------------------
  describe('Lifecycle Events', () => {
    it('should emit checkpoint event', async () => {
      const events: string[] = []
      const testJwt = createTestJwt({ org_id: 'org_123' })
      mockEnv.JWT = testJwt

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      doInstance.on('checkpointed', () => events.push('checkpointed'))

      await doInstance.saveToIceberg()

      expect(events).toContain('checkpointed')
    })

    it('should emit checkpointed event with snapshot metadata', async () => {
      const eventData: Array<{ snapshotId: string; sequence: number }> = []
      const testJwt = createTestJwt({ org_id: 'org_123' })
      mockEnv.JWT = testJwt

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      doInstance.on('checkpointed', (data: { snapshotId: string; sequence: number }) => {
        eventData.push(data)
      })

      await doInstance.saveToIceberg()

      expect(eventData.length).toBeGreaterThan(0)
      expect(eventData[0].snapshotId).toBeDefined()
      expect(eventData[0].sequence).toBe(1)
    })
  })

  // --------------------------------------------------------------------------
  // Test 5: Error Handling
  // --------------------------------------------------------------------------
  describe('Error Handling', () => {
    it('should handle save errors gracefully', async () => {
      mockR2.put.mockRejectedValueOnce(new Error('R2 unavailable'))

      const testJwt = createTestJwt({ org_id: 'org_123' })
      mockEnv.JWT = testJwt

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      // Should propagate the R2 error
      await expect(doInstance.saveToIceberg()).rejects.toThrow('R2 unavailable')
    })

    it('should throw if no JWT is available', async () => {
      mockEnv.JWT = undefined

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      // Without JWT, should fail to determine storage location
      await expect(doInstance.saveToIceberg()).rejects.toThrow()
    })

    it('should handle partial write failure', async () => {
      const testJwt = createTestJwt({ org_id: 'org_123' })
      mockEnv.JWT = testJwt

      // First put succeeds, second fails
      mockR2.put
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Partial failure'))

      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      // Should report the error (state may be partially saved)
      await expect(doInstance.saveToIceberg()).rejects.toThrow('Partial failure')
    })
  })
})
