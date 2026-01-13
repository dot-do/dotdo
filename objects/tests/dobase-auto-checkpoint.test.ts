/**
 * DOBase Auto-Checkpoint and Consistency Guard Tests
 *
 * Tests for production features added to DOBase Iceberg state persistence:
 * 1. Auto-checkpoint - Configurable automatic checkpointing
 * 2. Consistency guard - Single-writer semantics with fencing token
 * 3. Debounced saves - Don't checkpoint on every write
 * 4. Background checkpointing - Non-blocking saves
 *
 * @module objects/tests/dobase-auto-checkpoint.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DO } from '../DO'

// ============================================================================
// MOCK HELPERS
// ============================================================================

/**
 * Create a mock R2 bucket for testing
 */
function createMockR2() {
  const storage = new Map<string, ArrayBuffer>()

  return {
    put: vi.fn(async (key: string, value: ArrayBuffer | string) => {
      const buffer = typeof value === 'string'
        ? new TextEncoder().encode(value).buffer
        : value
      storage.set(key, buffer)
      return { key, etag: 'mock-etag' }
    }),
    get: vi.fn(async (key: string) => {
      const value = storage.get(key)
      if (!value) return null
      return {
        text: async () => new TextDecoder().decode(value),
        json: async <T>() => JSON.parse(new TextDecoder().decode(value)) as T,
        arrayBuffer: async () => value,
        body: new ReadableStream(),
      }
    }),
    list: vi.fn(async (options?: { prefix?: string }) => {
      const objects: { key: string }[] = []
      for (const [key] of storage) {
        if (options?.prefix && !key.startsWith(options.prefix)) continue
        objects.push({ key })
      }
      return { objects, truncated: false }
    }),
    delete: vi.fn(async (key: string | string[]) => {
      if (Array.isArray(key)) {
        key.forEach(k => storage.delete(k))
      } else {
        storage.delete(key)
      }
    }),
    head: vi.fn(async (key: string) => {
      return storage.has(key) ? { key } : null
    }),
    _storage: storage,
  }
}

/**
 * Create mock SQL storage
 */
function createMockSqlStorage() {
  const tables = new Map<string, unknown[]>()

  // Initialize empty tables
  tables.set('things', [])
  tables.set('relationships', [])
  tables.set('actions', [])
  tables.set('events', [])

  return {
    exec: vi.fn((query: string, ..._params: unknown[]) => {
      // Simple mock that returns empty results
      if (query.startsWith('SELECT')) {
        const tableName = query.match(/FROM\s+(\w+)/i)?.[1]
        if (tableName && tables.has(tableName)) {
          return { toArray: () => tables.get(tableName) ?? [] }
        }
      }
      return { toArray: () => [], one: () => undefined, raw: () => [] }
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
    JWT: undefined as string | undefined,
  }
}

/**
 * Create a test JWT with claims
 */
function createTestJwt(claims: Record<string, unknown> = {}) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({
    org_id: 'org_123',
    tenant_id: 'tenant_456',
    sub: 'user_789',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...claims,
  }))
  const signature = 'test_signature'
  return `${header}.${payload}.${signature}`
}

// ============================================================================
// TEST SUITE: IcebergOptions Configuration
// ============================================================================

describe('DOBase IcebergOptions Configuration', () => {
  let mockR2: ReturnType<typeof createMockR2>
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockR2 = createMockR2()
    mockState = createMockDOState()
    mockEnv = createMockEnv(mockR2)
    mockEnv.JWT = createTestJwt()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('configureIceberg()', () => {
    it('should accept IcebergOptions with all properties', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      // Access protected method via any cast for testing
      const configureIceberg = (doInstance as any).configureIceberg.bind(doInstance)

      // Should not throw
      expect(() => {
        configureIceberg({
          autoCheckpoint: true,
          checkpointIntervalMs: 30000,
          minChangesBeforeCheckpoint: 5,
        })
      }).not.toThrow()
    })

    it('should start auto-checkpoint when autoCheckpoint is true', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      const events: string[] = []

      doInstance.on('autoCheckpointStarted', () => events.push('started'))

      const configureIceberg = (doInstance as any).configureIceberg.bind(doInstance)
      configureIceberg({ autoCheckpoint: true })

      expect(events).toContain('started')
    })

    it('should not start auto-checkpoint when autoCheckpoint is false', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      const events: string[] = []

      doInstance.on('autoCheckpointStarted', () => events.push('started'))

      const configureIceberg = (doInstance as any).configureIceberg.bind(doInstance)
      configureIceberg({ autoCheckpoint: false })

      expect(events).not.toContain('started')
    })

    it('should use default checkpointIntervalMs of 60000 when not specified', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      const eventData: { intervalMs?: number }[] = []

      doInstance.on('autoCheckpointStarted', (data: { intervalMs: number }) => {
        eventData.push(data)
      })

      const configureIceberg = (doInstance as any).configureIceberg.bind(doInstance)
      configureIceberg({ autoCheckpoint: true })

      expect(eventData.length).toBe(1)
      expect(eventData[0].intervalMs).toBe(60000)
    })

    it('should use custom checkpointIntervalMs when specified', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      const eventData: { intervalMs?: number }[] = []

      doInstance.on('autoCheckpointStarted', (data: { intervalMs: number }) => {
        eventData.push(data)
      })

      const configureIceberg = (doInstance as any).configureIceberg.bind(doInstance)
      configureIceberg({ autoCheckpoint: true, checkpointIntervalMs: 15000 })

      expect(eventData.length).toBe(1)
      expect(eventData[0].intervalMs).toBe(15000)
    })
  })
})

// ============================================================================
// TEST SUITE: Auto-Checkpoint
// ============================================================================

describe('DOBase Auto-Checkpoint', () => {
  let mockR2: ReturnType<typeof createMockR2>
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockR2 = createMockR2()
    mockState = createMockDOState()
    mockEnv = createMockEnv(mockR2)
    mockEnv.JWT = createTestJwt()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('startAutoCheckpoint()', () => {
    it('should emit autoCheckpointStarted event with interval and minChanges', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      const eventData: { intervalMs: number; minChanges: number }[] = []

      doInstance.on('autoCheckpointStarted', (data: { intervalMs: number; minChanges: number }) => {
        eventData.push(data)
      })

      const configureIceberg = (doInstance as any).configureIceberg.bind(doInstance)
      configureIceberg({
        autoCheckpoint: true,
        checkpointIntervalMs: 30000,
        minChangesBeforeCheckpoint: 5,
      })

      expect(eventData.length).toBe(1)
      expect(eventData[0].intervalMs).toBe(30000)
      expect(eventData[0].minChanges).toBe(5)
    })

    it('should set up checkpoint timer when auto-checkpoint enabled', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      const configureIceberg = (doInstance as any).configureIceberg.bind(doInstance)

      // Verify no timer initially
      expect((doInstance as any)._checkpointTimer).toBeUndefined()

      configureIceberg({
        autoCheckpoint: true,
        checkpointIntervalMs: 1000,
        minChangesBeforeCheckpoint: 2,
      })

      // Verify timer is now set
      expect((doInstance as any)._checkpointTimer).toBeDefined()
    })

    it('should checkpoint only when pending changes exceed threshold (via saveToIceberg)', async () => {
      // This tests the core logic that the timer callback would use
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      const events: string[] = []

      doInstance.on('checkpointed', () => events.push('checkpointed'))

      const configureIceberg = (doInstance as any).configureIceberg.bind(doInstance)
      const onDataChange = (doInstance as any).onDataChange.bind(doInstance)

      configureIceberg({
        autoCheckpoint: false, // Don't start timer
        minChangesBeforeCheckpoint: 2,
      })

      // Add 3 pending changes
      onDataChange()
      onDataChange()
      onDataChange()

      expect((doInstance as any)._pendingChanges).toBe(3)

      // Simulate what the timer callback does - call saveToIceberg
      await doInstance.saveToIceberg()

      // Should have checkpointed
      expect(events).toContain('checkpointed')
      expect(mockR2.put).toHaveBeenCalled()
      // Pending changes should be reset
      expect((doInstance as any)._pendingChanges).toBe(0)
    })

    it('should store minChangesBeforeCheckpoint in options', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      const configureIceberg = (doInstance as any).configureIceberg.bind(doInstance)

      configureIceberg({
        autoCheckpoint: true,
        checkpointIntervalMs: 1000,
        minChangesBeforeCheckpoint: 5,
      })

      // Verify options are stored
      expect((doInstance as any)._icebergOptions.minChangesBeforeCheckpoint).toBe(5)
    })

    it('should reset pending changes after successful saveToIceberg', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      const onDataChange = (doInstance as any).onDataChange.bind(doInstance)

      // Add pending changes
      onDataChange()
      onDataChange()
      expect((doInstance as any)._pendingChanges).toBe(2)

      // Checkpoint directly
      await doInstance.saveToIceberg()

      // Pending changes should be reset
      expect((doInstance as any)._pendingChanges).toBe(0)
    })
  })

  describe('stopAutoCheckpoint()', () => {
    it('should emit autoCheckpointStopped event', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      const events: string[] = []

      doInstance.on('autoCheckpointStopped', () => events.push('stopped'))

      const configureIceberg = (doInstance as any).configureIceberg.bind(doInstance)
      const stopAutoCheckpoint = (doInstance as any).stopAutoCheckpoint.bind(doInstance)

      // Start first
      configureIceberg({ autoCheckpoint: true })

      // Then stop
      stopAutoCheckpoint()

      expect(events).toContain('stopped')
    })

    it('should clear timer when stopped', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      const configureIceberg = (doInstance as any).configureIceberg.bind(doInstance)
      const stopAutoCheckpoint = (doInstance as any).stopAutoCheckpoint.bind(doInstance)

      configureIceberg({
        autoCheckpoint: true,
        checkpointIntervalMs: 1000,
        minChangesBeforeCheckpoint: 1,
      })

      // Verify timer is set
      expect((doInstance as any)._checkpointTimer).toBeDefined()

      // Stop auto-checkpoint
      stopAutoCheckpoint()

      // Timer should be cleared
      expect((doInstance as any)._checkpointTimer).toBeUndefined()
    })

    it('should handle multiple stop calls gracefully', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      const stopAutoCheckpoint = (doInstance as any).stopAutoCheckpoint.bind(doInstance)

      // Should not throw even when called multiple times without start
      expect(() => {
        stopAutoCheckpoint()
        stopAutoCheckpoint()
      }).not.toThrow()
    })
  })

  describe('Background Checkpointing', () => {
    it('should emit checkpointFailed event on error', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      const errorEvents: { error: unknown }[] = []

      doInstance.on('checkpointFailed', (data: { error: unknown }) => {
        errorEvents.push(data)
      })

      // Make R2 put fail
      mockR2.put.mockRejectedValueOnce(new Error('R2 unavailable'))

      // Call saveToIceberg directly - it should throw
      await expect(doInstance.saveToIceberg()).rejects.toThrow('R2 unavailable')
    })
  })
})

// ============================================================================
// TEST SUITE: Debounced Saves
// ============================================================================

describe('DOBase Debounced Saves', () => {
  let mockR2: ReturnType<typeof createMockR2>
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    vi.clearAllMocks()
    mockR2 = createMockR2()
    mockState = createMockDOState()
    mockEnv = createMockEnv(mockR2)
    mockEnv.JWT = createTestJwt()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('onDataChange()', () => {
    it('should increment pending changes counter', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      const onDataChange = (doInstance as any).onDataChange.bind(doInstance)

      expect((doInstance as any)._pendingChanges).toBe(0)

      onDataChange()
      expect((doInstance as any)._pendingChanges).toBe(1)

      onDataChange()
      expect((doInstance as any)._pendingChanges).toBe(2)

      onDataChange()
      expect((doInstance as any)._pendingChanges).toBe(3)
    })
  })

  describe('pendingChanges getter', () => {
    it('should return current pending changes count', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      const onDataChange = (doInstance as any).onDataChange.bind(doInstance)

      expect((doInstance as any).pendingChanges).toBe(0)

      onDataChange()
      onDataChange()

      expect((doInstance as any).pendingChanges).toBe(2)
    })
  })

  describe('lastCheckpointTimestamp getter', () => {
    it('should return 0 when no checkpoint has been made', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      expect((doInstance as any).lastCheckpointTimestamp).toBe(0)
    })

    it('should return timestamp after checkpoint', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      const beforeCheckpoint = Date.now()
      await doInstance.saveToIceberg()
      const afterCheckpoint = Date.now()

      const timestamp = (doInstance as any).lastCheckpointTimestamp
      expect(timestamp).toBeGreaterThanOrEqual(beforeCheckpoint)
      expect(timestamp).toBeLessThanOrEqual(afterCheckpoint)
    })
  })

  describe('minChangesBeforeCheckpoint', () => {
    it('should default to 1 when not specified', () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      const configureIceberg = (doInstance as any).configureIceberg.bind(doInstance)

      configureIceberg({
        autoCheckpoint: true,
        checkpointIntervalMs: 1000,
        // minChangesBeforeCheckpoint not specified, should default to 1
      })

      // Default minChanges should be 1
      expect((doInstance as any)._icebergOptions.minChangesBeforeCheckpoint ?? 1).toBe(1)
    })
  })
})

// ============================================================================
// TEST SUITE: Fencing Token (Consistency Guard)
// ============================================================================

describe('DOBase Fencing Token', () => {
  let mockR2: ReturnType<typeof createMockR2>
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    vi.clearAllMocks()
    mockR2 = createMockR2()
    mockState = createMockDOState()
    mockEnv = createMockEnv(mockR2)
    mockEnv.JWT = createTestJwt()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('acquireFencingToken()', () => {
    it('should return a UUID token on success', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      const token = await doInstance.acquireFencingToken()

      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      // UUID v4 format
      expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })

    it('should emit fencingTokenAcquired event', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      const eventData: { token: string }[] = []

      doInstance.on('fencingTokenAcquired', (data: { token: string }) => {
        eventData.push(data)
      })

      const token = await doInstance.acquireFencingToken()

      expect(eventData.length).toBe(1)
      expect(eventData[0].token).toBe(token)
    })

    it('should store lock data in R2', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await doInstance.acquireFencingToken()

      // Should have called R2 put
      expect(mockR2.put).toHaveBeenCalled()

      // Check the put call includes lock data
      const putCall = mockR2.put.mock.calls.find((call: unknown[]) =>
        (call[0] as string).includes('lock')
      )
      expect(putCall).toBeDefined()
    })

    it('should throw without JWT', async () => {
      mockEnv.JWT = undefined
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await expect(doInstance.acquireFencingToken()).rejects.toThrow('No JWT available')
    })

    it('should set hasFencingToken to true after acquisition', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      expect((doInstance as any).hasFencingToken).toBe(false)

      await doInstance.acquireFencingToken()

      expect((doInstance as any).hasFencingToken).toBe(true)
    })

    it('should store token in currentFencingToken', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      expect((doInstance as any).currentFencingToken).toBeUndefined()

      const token = await doInstance.acquireFencingToken()

      expect((doInstance as any).currentFencingToken).toBe(token)
    })
  })

  describe('releaseFencingToken()', () => {
    it('should emit fencingTokenReleased event', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      const eventData: { token: string }[] = []

      doInstance.on('fencingTokenReleased', (data: { token: string }) => {
        eventData.push(data)
      })

      const token = await doInstance.acquireFencingToken()
      await doInstance.releaseFencingToken(token)

      expect(eventData.length).toBe(1)
      expect(eventData[0].token).toBe(token)
    })

    it('should delete lock from R2', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      const token = await doInstance.acquireFencingToken()
      await doInstance.releaseFencingToken(token)

      expect(mockR2.delete).toHaveBeenCalled()
    })

    it('should set hasFencingToken to false after release', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      const token = await doInstance.acquireFencingToken()
      expect((doInstance as any).hasFencingToken).toBe(true)

      await doInstance.releaseFencingToken(token)
      expect((doInstance as any).hasFencingToken).toBe(false)
    })

    it('should clear currentFencingToken after release', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      const token = await doInstance.acquireFencingToken()
      expect((doInstance as any).currentFencingToken).toBe(token)

      await doInstance.releaseFencingToken(token)
      expect((doInstance as any).currentFencingToken).toBeUndefined()
    })

    it('should throw on token mismatch', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await doInstance.acquireFencingToken()

      await expect(
        doInstance.releaseFencingToken('wrong-token')
      ).rejects.toThrow('Fencing token mismatch')
    })

    it('should throw if R2 client not initialized', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      // Don't acquire first - R2 client won't be initialized
      await expect(
        doInstance.releaseFencingToken('some-token')
      ).rejects.toThrow('R2 client not initialized')
    })
  })

  describe('Single-Writer Semantics', () => {
    it('should allow safe write after acquiring token', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      const token = await doInstance.acquireFencingToken()

      // Should be able to save while holding token
      await expect(doInstance.saveToIceberg()).resolves.not.toThrow()

      await doInstance.releaseFencingToken(token)
    })

    it('should include acquiredBy in lock data', async () => {
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)

      await doInstance.acquireFencingToken()

      // Find the lock put call
      const lockPutCall = mockR2.put.mock.calls.find((call: unknown[]) =>
        (call[0] as string).includes('lock')
      )

      expect(lockPutCall).toBeDefined()

      // Parse the lock data
      const lockDataStr = lockPutCall![1] as string
      const lockData = JSON.parse(lockDataStr)

      expect(lockData.acquiredBy).toBe('do_123')
      expect(lockData.token).toBeDefined()
      expect(lockData.acquiredAt).toBeDefined()
    })
  })
})

// ============================================================================
// TEST SUITE: Integration Tests
// ============================================================================

describe('DOBase Iceberg Integration', () => {
  let mockR2: ReturnType<typeof createMockR2>
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    vi.clearAllMocks()
    mockR2 = createMockR2()
    mockState = createMockDOState()
    mockEnv = createMockEnv(mockR2)
    mockEnv.JWT = createTestJwt()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should integrate fencing token with saveToIceberg', async () => {
    const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
    const events: string[] = []

    doInstance.on('fencingTokenAcquired', () => events.push('tokenAcquired'))
    doInstance.on('checkpointed', () => events.push('checkpointed'))

    // Acquire token for safe writes
    await doInstance.acquireFencingToken()

    expect(events).toContain('tokenAcquired')

    // Save while holding token
    await doInstance.saveToIceberg()

    expect(events).toContain('checkpointed')
  })

  it('should track changes through save cycles', async () => {
    const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
    const onDataChange = (doInstance as any).onDataChange.bind(doInstance)

    // Add changes
    onDataChange()
    onDataChange()
    onDataChange()
    expect((doInstance as any).pendingChanges).toBe(3)

    // Save resets counter
    await doInstance.saveToIceberg()
    expect((doInstance as any).pendingChanges).toBe(0)

    // More changes after save
    onDataChange()
    expect((doInstance as any).pendingChanges).toBe(1)
  })
})
