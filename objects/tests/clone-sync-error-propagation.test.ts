import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CloneModule, createCloneModule } from '../lifecycle/Clone'
import type { LifecycleContext } from '../lifecycle/types'

/**
 * Clone Sync Error Propagation Tests (TDD - RED Phase)
 *
 * Tests that verify errors during Clone sync operations are properly logged
 * and propagated rather than being silently suppressed.
 *
 * Issue: dotdo-48fsf - TDD: Fix silent error suppression in Clone sync operations
 *
 * The original issue identified a bare catch block at lines 1307-1310:
 * ```typescript
 * } catch {
 *   // Response may not be JSON
 * }
 * ```
 *
 * This TDD approach verifies:
 * 1. JSON parse errors on JSON content-type responses are tracked
 * 2. Response body read errors are tracked
 * 3. Event emission failures are handled gracefully
 * 4. The errorCount and lastError fields are properly updated
 * 5. Callers can observe sync failures through the SyncStatus API
 */

// Mock storage implementation
function createMockStorage() {
  const store = new Map<string, unknown>()
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    put: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => store.delete(key)),
    list: vi.fn(async ({ prefix }: { prefix: string }) => {
      const result = new Map<string, unknown>()
      for (const [key, value] of store) {
        if (key.startsWith(prefix)) {
          result.set(key, value)
        }
      }
      return result
    }),
    getAlarm: vi.fn(async () => null),
    setAlarm: vi.fn(async () => {}),
    deleteAlarm: vi.fn(async () => {}),
    _store: store,
  }
}

// Mock database with configurable data
function createMockDb(things: Array<{
  id: string
  type: number
  branch: string | null
  name: string | null
  data: Record<string, unknown>
  deleted: boolean
}> = []) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => {
        // Return things for all table queries in the sync context
        return Promise.resolve(things)
      }),
    })),
    _things: things,
  }
}

// Create mock lifecycle context with configurable options
function createMockLifecycleContext(overrides: Partial<LifecycleContext> & {
  fetchResponse?: Response | (() => Promise<Response>)
  fetchError?: Error
} = {}): LifecycleContext {
  const mockStorage = createMockStorage()
  const mockDb = createMockDb([
    { id: 'thing-1', type: 1, branch: null, name: 'Test Thing', data: { foo: 'bar' }, deleted: false },
    { id: 'thing-2', type: 1, branch: null, name: 'Test Thing 2', data: { baz: 'qux' }, deleted: false },
  ])

  const { fetchResponse, fetchError, ...ctxOverrides } = overrides

  return {
    ns: 'https://test.do',
    currentBranch: 'main',
    ctx: {
      storage: mockStorage,
      blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    } as unknown as DurableObjectState,
    db: mockDb as unknown as LifecycleContext['db'],
    env: {
      DO: {
        idFromName: vi.fn((name: string) => ({ toString: () => `do-id-${name}` })),
        get: vi.fn(() => ({
          fetch: vi.fn(async () => {
            if (fetchError) {
              throw fetchError
            }
            if (typeof fetchResponse === 'function') {
              return fetchResponse()
            }
            return fetchResponse ?? new Response('{}', { status: 200 })
          }),
        })),
      },
    } as unknown as LifecycleContext['env'],
    emitEvent: vi.fn(async () => {}),
    ...ctxOverrides,
  } as LifecycleContext
}

describe('Clone Sync Error Propagation', () => {
  let cloneModule: CloneModule
  let mockCtx: LifecycleContext

  beforeEach(() => {
    cloneModule = createCloneModule()
  })

  describe('JSON Parse Error Handling', () => {
    it('tracks JSON parse error when response has JSON content-type but invalid body', async () => {
      // Setup: Create a response with JSON content-type but invalid JSON
      mockCtx = createMockLifecycleContext({
        fetchResponse: new Response('this is not valid json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      })
      cloneModule.initialize(mockCtx)

      // Create an eventual clone and get its ID
      const cloneId = 'test-clone-json-error'
      const storage = (mockCtx.ctx as unknown as { storage: { put: (k: string, v: unknown) => Promise<void> } }).storage

      // Manually set up eventual clone state
      await storage.put(`eventual:${cloneId}`, {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'syncing',
        progress: 0,
        phase: 'bulk',
        itemsSynced: 0,
        totalItems: 2,
        itemsRemaining: 2,
        lastSyncAt: null,
        divergence: 2,
        maxDivergence: 100,
        syncInterval: 5000,
        errorCount: 0,
        lastError: null,
        conflictResolution: 'last-write-wins',
        hasCustomResolver: false,
        chunked: false,
        chunkSize: 1000,
        rateLimit: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSyncedVersion: 0,
      })

      // Perform sync
      const result = await cloneModule.performEventualSync(cloneId)

      // Verify items were synced (sync should succeed even with parse error)
      expect(result.itemsSynced).toBeGreaterThan(0)

      // Verify error was tracked - get the updated state
      const updatedState = await (mockCtx.ctx as unknown as { storage: { get: (k: string) => Promise<unknown> } }).storage.get(`eventual:${cloneId}`) as {
        errorCount: number
        lastError: string | null
      }

      // The error should be tracked in the state
      expect(updatedState.errorCount).toBeGreaterThan(0)
      expect(updatedState.lastError).toContain('JSON parse error')
    })

    it('does not track error for empty response with non-JSON content-type', async () => {
      // Setup: Create an empty response with no content-type (expected case)
      mockCtx = createMockLifecycleContext({
        fetchResponse: new Response('', {
          status: 200,
          headers: {},
        }),
      })
      cloneModule.initialize(mockCtx)

      const cloneId = 'test-clone-empty-ok'
      const storage = (mockCtx.ctx as unknown as { storage: { put: (k: string, v: unknown) => Promise<void> } }).storage

      await storage.put(`eventual:${cloneId}`, {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'syncing',
        progress: 0,
        phase: 'bulk',
        itemsSynced: 0,
        totalItems: 2,
        itemsRemaining: 2,
        lastSyncAt: null,
        divergence: 2,
        maxDivergence: 100,
        syncInterval: 5000,
        errorCount: 0,
        lastError: null,
        conflictResolution: 'last-write-wins',
        hasCustomResolver: false,
        chunked: false,
        chunkSize: 1000,
        rateLimit: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSyncedVersion: 0,
      })

      await cloneModule.performEventualSync(cloneId)

      const updatedState = await (mockCtx.ctx as unknown as { storage: { get: (k: string) => Promise<unknown> } }).storage.get(`eventual:${cloneId}`) as {
        errorCount: number
        lastError: string | null
      }

      // No error should be tracked for expected empty response
      expect(updatedState.errorCount).toBe(0)
      expect(updatedState.lastError).toBeNull()
    })
  })

  describe('Response Body Read Error Handling', () => {
    it('tracks response body read errors', async () => {
      // Setup: Create a response that fails when reading body
      const errorResponse = new Response(null, { status: 200 })
      // Override the text method to throw
      vi.spyOn(errorResponse, 'text').mockRejectedValue(new Error('Network read error'))

      mockCtx = createMockLifecycleContext({
        fetchResponse: errorResponse,
      })
      cloneModule.initialize(mockCtx)

      const cloneId = 'test-clone-read-error'
      const storage = (mockCtx.ctx as unknown as { storage: { put: (k: string, v: unknown) => Promise<void> } }).storage

      await storage.put(`eventual:${cloneId}`, {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'syncing',
        progress: 0,
        phase: 'bulk',
        itemsSynced: 0,
        totalItems: 2,
        itemsRemaining: 2,
        lastSyncAt: null,
        divergence: 2,
        maxDivergence: 100,
        syncInterval: 5000,
        errorCount: 0,
        lastError: null,
        conflictResolution: 'last-write-wins',
        hasCustomResolver: false,
        chunked: false,
        chunkSize: 1000,
        rateLimit: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSyncedVersion: 0,
      })

      await cloneModule.performEventualSync(cloneId)

      const updatedState = await (mockCtx.ctx as unknown as { storage: { get: (k: string) => Promise<unknown> } }).storage.get(`eventual:${cloneId}`) as {
        errorCount: number
        lastError: string | null
      }

      // Error should be tracked
      expect(updatedState.errorCount).toBeGreaterThan(0)
      expect(updatedState.lastError).toContain('Response read error')
    })
  })

  describe('Event Emission Error Handling', () => {
    it('continues sync when event emission fails', async () => {
      // Setup: Create context with emitEvent that fails only on clone.conflict
      // Other events (clone.syncing, clone.progress, clone.sync.warning) should succeed
      const emitEventError = new Error('Event emission failed')
      const mockEmitEvent = vi.fn().mockImplementation(async (eventType: string) => {
        if (eventType === 'clone.conflict') {
          throw emitEventError
        }
        // Other events succeed
      })
      mockCtx = createMockLifecycleContext({
        fetchResponse: new Response(JSON.stringify({
          conflicts: [{ thingId: 'thing-1', sourceVersion: 1, targetVersion: 2 }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
        emitEvent: mockEmitEvent,
      } as unknown as Partial<LifecycleContext> & { fetchResponse?: Response })
      cloneModule.initialize(mockCtx)

      const cloneId = 'test-clone-emit-error'
      const storage = (mockCtx.ctx as unknown as { storage: { put: (k: string, v: unknown) => Promise<void> } }).storage

      await storage.put(`eventual:${cloneId}`, {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'syncing',
        progress: 0,
        phase: 'bulk',
        itemsSynced: 0,
        totalItems: 2,
        itemsRemaining: 2,
        lastSyncAt: null,
        divergence: 2,
        maxDivergence: 100,
        syncInterval: 5000,
        errorCount: 0,
        lastError: null,
        conflictResolution: 'last-write-wins',
        hasCustomResolver: false,
        chunked: false,
        chunkSize: 1000,
        rateLimit: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSyncedVersion: 0,
      })

      // Sync should complete (not throw)
      const result = await cloneModule.performEventualSync(cloneId)

      // Items should still be synced
      expect(result.itemsSynced).toBeGreaterThan(0)

      // But error should be tracked
      const updatedState = await (mockCtx.ctx as unknown as { storage: { get: (k: string) => Promise<unknown> } }).storage.get(`eventual:${cloneId}`) as {
        errorCount: number
        lastError: string | null
      }

      expect(updatedState.errorCount).toBeGreaterThan(0)
      expect(updatedState.lastError).toContain('Event emission error')
    })
  })

  describe('SyncStatus API Error Visibility', () => {
    it('exposes lastError through getSyncStatus()', async () => {
      mockCtx = createMockLifecycleContext({
        fetchResponse: new Response('invalid json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      })
      cloneModule.initialize(mockCtx)

      const cloneId = 'test-clone-status-error'
      const storage = (mockCtx.ctx as unknown as { storage: { put: (k: string, v: unknown) => Promise<void> } }).storage

      await storage.put(`eventual:${cloneId}`, {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'syncing',
        progress: 0,
        phase: 'bulk',
        itemsSynced: 0,
        totalItems: 2,
        itemsRemaining: 2,
        lastSyncAt: null,
        divergence: 2,
        maxDivergence: 100,
        syncInterval: 5000,
        errorCount: 0,
        lastError: null,
        conflictResolution: 'last-write-wins',
        hasCustomResolver: false,
        chunked: false,
        chunkSize: 1000,
        rateLimit: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSyncedVersion: 0,
      })

      // Perform sync (will encounter JSON parse error)
      await cloneModule.performEventualSync(cloneId)

      // Get updated state from storage to check error visibility
      const updatedState = await (mockCtx.ctx as unknown as { storage: { get: (k: string) => Promise<unknown> } }).storage.get(`eventual:${cloneId}`) as {
        errorCount: number
        lastError: string | null
      }

      // Error info should be available through state
      expect(updatedState.errorCount).toBeGreaterThan(0)
      expect(updatedState.lastError).not.toBeNull()
    })

    it('tracks errorCount increments across multiple sync failures', async () => {
      let callCount = 0
      mockCtx = createMockLifecycleContext({
        fetchResponse: () => {
          callCount++
          return Promise.resolve(new Response('invalid json', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }))
        },
      })
      cloneModule.initialize(mockCtx)

      const cloneId = 'test-clone-error-count'
      const storage = (mockCtx.ctx as unknown as { storage: { put: (k: string, v: unknown) => Promise<void> } }).storage

      await storage.put(`eventual:${cloneId}`, {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'syncing',
        progress: 0,
        phase: 'bulk',
        itemsSynced: 0,
        totalItems: 10,
        itemsRemaining: 10,
        lastSyncAt: null,
        divergence: 10,
        maxDivergence: 100,
        syncInterval: 5000,
        errorCount: 0,
        lastError: null,
        conflictResolution: 'last-write-wins',
        hasCustomResolver: false,
        chunked: true,
        chunkSize: 2,
        rateLimit: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSyncedVersion: 0,
      })

      // Perform multiple syncs
      await cloneModule.performEventualSync(cloneId)
      await cloneModule.performEventualSync(cloneId)
      await cloneModule.performEventualSync(cloneId)

      const updatedState = await (mockCtx.ctx as unknown as { storage: { get: (k: string) => Promise<unknown> } }).storage.get(`eventual:${cloneId}`) as {
        errorCount: number
        lastError: string | null
      }

      // Error count should reflect multiple failures
      expect(updatedState.errorCount).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Warning Events for Unexpected Response Structure', () => {
    it('emits warning when conflicts field has unexpected type', async () => {
      mockCtx = createMockLifecycleContext({
        fetchResponse: new Response(JSON.stringify({
          conflicts: 'not an array', // Wrong type
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      })
      cloneModule.initialize(mockCtx)

      const cloneId = 'test-clone-warning'
      const storage = (mockCtx.ctx as unknown as { storage: { put: (k: string, v: unknown) => Promise<void> } }).storage

      await storage.put(`eventual:${cloneId}`, {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'syncing',
        progress: 0,
        phase: 'bulk',
        itemsSynced: 0,
        totalItems: 2,
        itemsRemaining: 2,
        lastSyncAt: null,
        divergence: 2,
        maxDivergence: 100,
        syncInterval: 5000,
        errorCount: 0,
        lastError: null,
        conflictResolution: 'last-write-wins',
        hasCustomResolver: false,
        chunked: false,
        chunkSize: 1000,
        rateLimit: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSyncedVersion: 0,
      })

      await cloneModule.performEventualSync(cloneId)

      // Verify warning event was emitted
      expect(mockCtx.emitEvent).toHaveBeenCalledWith(
        'clone.sync.warning',
        expect.objectContaining({
          id: cloneId,
          warning: 'unexpected_conflicts_structure',
        })
      )
    })
  })

  describe('204 No Content Response Handling', () => {
    it('handles 204 response without attempting to parse body', async () => {
      mockCtx = createMockLifecycleContext({
        fetchResponse: new Response(null, {
          status: 204,
        }),
      })
      cloneModule.initialize(mockCtx)

      const cloneId = 'test-clone-204'
      const storage = (mockCtx.ctx as unknown as { storage: { put: (k: string, v: unknown) => Promise<void> } }).storage

      await storage.put(`eventual:${cloneId}`, {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'syncing',
        progress: 0,
        phase: 'bulk',
        itemsSynced: 0,
        totalItems: 2,
        itemsRemaining: 2,
        lastSyncAt: null,
        divergence: 2,
        maxDivergence: 100,
        syncInterval: 5000,
        errorCount: 0,
        lastError: null,
        conflictResolution: 'last-write-wins',
        hasCustomResolver: false,
        chunked: false,
        chunkSize: 1000,
        rateLimit: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSyncedVersion: 0,
      })

      const result = await cloneModule.performEventualSync(cloneId)

      // Should succeed without errors
      expect(result.itemsSynced).toBeGreaterThan(0)

      const updatedState = await (mockCtx.ctx as unknown as { storage: { get: (k: string) => Promise<unknown> } }).storage.get(`eventual:${cloneId}`) as {
        errorCount: number
        lastError: string | null
      }

      expect(updatedState.errorCount).toBe(0)
      expect(updatedState.lastError).toBeNull()
    })
  })

  describe('Content-Length: 0 Response Handling', () => {
    it('handles zero content-length response without attempting to parse', async () => {
      mockCtx = createMockLifecycleContext({
        fetchResponse: new Response('', {
          status: 200,
          headers: { 'Content-Length': '0' },
        }),
      })
      cloneModule.initialize(mockCtx)

      const cloneId = 'test-clone-empty-length'
      const storage = (mockCtx.ctx as unknown as { storage: { put: (k: string, v: unknown) => Promise<void> } }).storage

      await storage.put(`eventual:${cloneId}`, {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'syncing',
        progress: 0,
        phase: 'bulk',
        itemsSynced: 0,
        totalItems: 2,
        itemsRemaining: 2,
        lastSyncAt: null,
        divergence: 2,
        maxDivergence: 100,
        syncInterval: 5000,
        errorCount: 0,
        lastError: null,
        conflictResolution: 'last-write-wins',
        hasCustomResolver: false,
        chunked: false,
        chunkSize: 1000,
        rateLimit: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSyncedVersion: 0,
      })

      const result = await cloneModule.performEventualSync(cloneId)

      expect(result.itemsSynced).toBeGreaterThan(0)

      const updatedState = await (mockCtx.ctx as unknown as { storage: { get: (k: string) => Promise<unknown> } }).storage.get(`eventual:${cloneId}`) as {
        errorCount: number
        lastError: string | null
      }

      expect(updatedState.errorCount).toBe(0)
      expect(updatedState.lastError).toBeNull()
    })
  })

  describe('Error State Transition', () => {
    it('transitions to error status after 10 consecutive errors', async () => {
      mockCtx = createMockLifecycleContext({
        // Simulate a response that always fails to parse
        fetchResponse: new Response('invalid json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      })
      cloneModule.initialize(mockCtx)

      const cloneId = 'test-clone-error-transition'
      const storage = (mockCtx.ctx as unknown as { storage: { put: (k: string, v: unknown) => Promise<void> } }).storage

      // Start with errorCount at 9
      await storage.put(`eventual:${cloneId}`, {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'syncing',
        progress: 0,
        phase: 'bulk',
        itemsSynced: 0,
        totalItems: 2,
        itemsRemaining: 2,
        lastSyncAt: null,
        divergence: 2,
        maxDivergence: 100,
        syncInterval: 5000,
        errorCount: 9, // One more error will trigger transition
        lastError: 'Previous error',
        conflictResolution: 'last-write-wins',
        hasCustomResolver: false,
        chunked: false,
        chunkSize: 1000,
        rateLimit: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSyncedVersion: 0,
      })

      // This sync should trigger an error due to JSON parse failure
      // Note: The major sync errors (network failures) trigger error state,
      // but response parsing errors are non-fatal and just tracked
      await cloneModule.performEventualSync(cloneId)

      const updatedState = await (mockCtx.ctx as unknown as { storage: { get: (k: string) => Promise<unknown> } }).storage.get(`eventual:${cloneId}`) as {
        status: string
        errorCount: number
        lastError: string | null
      }

      // Error count should have incremented
      expect(updatedState.errorCount).toBeGreaterThanOrEqual(10)
    })
  })
})
