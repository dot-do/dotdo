/**
 * Clone Sync Error Handling Tests
 *
 * TDD tests for proper error handling in Clone sync operations.
 * Addresses issue dotdo-48fsf: Silent error suppression in Clone sync operations.
 *
 * The problematic code in Clone.ts silently catches all errors:
 * ```typescript
 * } catch {
 *   // Response may not be JSON
 * }
 * ```
 *
 * This is problematic because:
 * 1. It swallows actual JSON parsing errors (malformed JSON)
 * 2. It swallows errors from conflict event emission
 * 3. It provides no logging or debugging information
 *
 * Proper behavior should:
 * 1. Only catch expected non-JSON responses (204 No Content, empty body)
 * 2. Log and propagate actual errors (malformed JSON, event emission failures)
 * 3. Distinguish between "expected" and "unexpected" parse failures
 *
 * @see objects/lifecycle/Clone.ts performEventualSync method
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { CloneModule } from '../../../objects/lifecycle/Clone'
import type { LifecycleContext } from '../../../objects/lifecycle/types'
import type { EventualCloneState } from '../../../types/Lifecycle'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock LifecycleContext for testing Clone sync error handling
 */
function createMockContext(options?: {
  fetchResponse?: () => Promise<Response>
  emitEvent?: (verb: string, data?: unknown) => Promise<void>
}): { ctx: LifecycleContext; storageData: Map<string, unknown>; emittedEvents: Array<{ verb: string; data: unknown }> } {
  const storageData = new Map<string, unknown>()
  const emittedEvents: Array<{ verb: string; data: unknown }> = []

  const ctx: LifecycleContext = {
    ns: 'https://source.test.do',
    currentBranch: 'main',
    env: {
      DO: {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-do-id' }),
        get: vi.fn().mockReturnValue({
          fetch: options?.fetchResponse ?? vi.fn().mockResolvedValue(new Response('OK')),
        }),
      },
    },
    ctx: {
      storage: {
        get: vi.fn().mockImplementation((key: string) => storageData.get(key)),
        put: vi.fn().mockImplementation((key: string, value: unknown) => {
          storageData.set(key, value)
          return Promise.resolve()
        }),
        delete: vi.fn().mockImplementation((key: string) => {
          storageData.delete(key)
          return Promise.resolve()
        }),
        list: vi.fn().mockImplementation(({ prefix }: { prefix: string }) => {
          const entries: [string, unknown][] = []
          for (const [key, value] of storageData.entries()) {
            if (key.startsWith(prefix)) {
              entries.push([key, value])
            }
          }
          return new Map(entries)
        }),
        getAlarm: vi.fn().mockResolvedValue(null),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      },
      blockConcurrencyWhile: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
    },
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue(
          Array.from({ length: 10 }, (_, i) => ({
            id: `thing-${i}`,
            type: 1,
            branch: null,
            name: `Item ${i}`,
            data: { index: i },
            deleted: false,
          }))
        ),
      }),
    },
    emitEvent: options?.emitEvent ?? vi.fn().mockImplementation(async (verb: string, data?: unknown) => {
      emittedEvents.push({ verb, data })
    }),
    log: vi.fn(),
  } as unknown as LifecycleContext

  return { ctx, storageData, emittedEvents }
}

/**
 * Create an eventual clone state for testing
 */
function createEventualCloneState(id: string, targetNs: string): EventualCloneState {
  return {
    id,
    targetNs,
    status: 'syncing',
    phase: 'bulk',
    progress: 0,
    itemsSynced: 0,
    lastSyncedVersion: 0,
    totalItems: 10,
    itemsRemaining: 10,
    divergence: 10,
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
  }
}

// ============================================================================
// TEST SUITE: Clone Sync Error Handling (dotdo-48fsf)
// ============================================================================

describe('Clone Sync Error Handling (dotdo-48fsf)', () => {
  let cloneModule: CloneModule

  beforeEach(() => {
    vi.useFakeTimers()
    cloneModule = new CloneModule()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Error Propagation During Sync
  // ==========================================================================

  describe('Error Propagation', () => {
    it('should emit clone.sync.error event when JSON parsing fails on non-empty response', async () => {
      // Setup mock that returns malformed JSON
      const { ctx, storageData, emittedEvents } = createMockContext({
        fetchResponse: vi.fn().mockResolvedValue(
          new Response('{ invalid json missing quotes }', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        ),
      })

      cloneModule.initialize(ctx)

      // Setup clone state in storage
      const cloneId = 'test-clone-1'
      const cloneState = createEventualCloneState(cloneId, 'https://target.test.do')
      storageData.set(`eventual:${cloneId}`, cloneState)

      // Trigger sync
      await cloneModule.performEventualSync(cloneId)

      // Should emit an error event for malformed JSON (not silently swallow it)
      const errorEvents = emittedEvents.filter(e =>
        e.verb === 'clone.sync.error' ||
        e.verb === 'clone.sync.json.error' ||
        e.verb === 'clone.error'
      )

      expect(errorEvents.length).toBeGreaterThan(0)
    })

    it('should log malformed JSON response to lastError in sync status', async () => {
      const { ctx, storageData } = createMockContext({
        fetchResponse: vi.fn().mockResolvedValue(
          new Response('not json at all', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        ),
      })

      cloneModule.initialize(ctx)

      const cloneId = 'test-clone-2'
      const cloneState = createEventualCloneState(cloneId, 'https://target.test.do')
      storageData.set(`eventual:${cloneId}`, cloneState)

      await cloneModule.performEventualSync(cloneId)

      // Get updated state from storage
      const updatedState = storageData.get(`eventual:${cloneId}`) as EventualCloneState

      // lastError should capture the parse error info
      expect(updatedState.lastError).not.toBeNull()
      expect(updatedState.lastError).toContain('JSON')
    })

    it('should not silently swallow emitEvent errors during conflict processing', async () => {
      const emittedEvents: Array<{ verb: string; data: unknown }> = []

      // Setup context where emitEvent throws on clone.conflict
      const { ctx, storageData } = createMockContext({
        fetchResponse: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({
            conflicts: [
              { thingId: 'thing-0', sourceVersion: 1, targetVersion: 2 },
            ],
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        ),
        emitEvent: vi.fn().mockImplementation(async (verb: string, data?: unknown) => {
          emittedEvents.push({ verb, data })
          if (verb === 'clone.conflict') {
            throw new Error('Event emission failed')
          }
        }),
      })

      cloneModule.initialize(ctx)

      const cloneId = 'test-clone-3'
      const cloneState = createEventualCloneState(cloneId, 'https://target.test.do')
      storageData.set(`eventual:${cloneId}`, cloneState)

      // The sync should handle the error gracefully
      await cloneModule.performEventualSync(cloneId)

      const updatedState = storageData.get(`eventual:${cloneId}`) as EventualCloneState

      // One of these should be true - either error is logged or warning is emitted
      const errorWasReported =
        updatedState.lastError !== null ||
        emittedEvents.some(e => e.verb.includes('error') || e.verb.includes('warning'))

      expect(errorWasReported).toBe(true)
    })

    it('should handle empty response body gracefully without error', async () => {
      const { ctx, storageData } = createMockContext({
        fetchResponse: vi.fn().mockResolvedValue(
          new Response('', { status: 200 })
        ),
      })

      cloneModule.initialize(ctx)

      const cloneId = 'test-clone-4'
      const cloneState = createEventualCloneState(cloneId, 'https://target.test.do')
      storageData.set(`eventual:${cloneId}`, cloneState)

      await cloneModule.performEventualSync(cloneId)

      const updatedState = storageData.get(`eventual:${cloneId}`) as EventualCloneState

      // Empty response should be handled gracefully - no error logged
      expect(updatedState.lastError).toBeNull()
    })

    it('should handle 204 No Content response gracefully', async () => {
      const { ctx, storageData } = createMockContext({
        fetchResponse: vi.fn().mockResolvedValue(
          new Response(null, { status: 204 })
        ),
      })

      cloneModule.initialize(ctx)

      const cloneId = 'test-clone-5'
      const cloneState = createEventualCloneState(cloneId, 'https://target.test.do')
      storageData.set(`eventual:${cloneId}`, cloneState)

      await cloneModule.performEventualSync(cloneId)

      const updatedState = storageData.get(`eventual:${cloneId}`) as EventualCloneState

      // 204 No Content is expected - no error should be logged
      expect(updatedState.lastError).toBeNull()
    })

    it('should increment errorCount for unexpected JSON errors', async () => {
      const { ctx, storageData } = createMockContext({
        fetchResponse: vi.fn().mockResolvedValue(
          new Response('{ broken: json', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        ),
      })

      cloneModule.initialize(ctx)

      const cloneId = 'test-clone-6'
      const cloneState = createEventualCloneState(cloneId, 'https://target.test.do')
      storageData.set(`eventual:${cloneId}`, cloneState)

      // Initial error count
      const initialErrorCount = cloneState.errorCount

      // Trigger sync with broken JSON response
      await cloneModule.performEventualSync(cloneId)

      const updatedState = storageData.get(`eventual:${cloneId}`) as EventualCloneState

      // Error count should increment for JSON parse errors
      expect(updatedState.errorCount).toBeGreaterThan(initialErrorCount)
    })
  })

  // ==========================================================================
  // Expected Behavior: Distinguishing Error Types
  // ==========================================================================

  describe('Error Type Distinction', () => {
    it('should distinguish between empty response and malformed JSON', async () => {
      // First test: empty response (expected, not an error)
      const { ctx: ctx1, storageData: storageData1 } = createMockContext({
        fetchResponse: vi.fn().mockResolvedValue(
          new Response('', { status: 200 })
        ),
      })

      const cloneModule1 = new CloneModule()
      cloneModule1.initialize(ctx1)

      const cloneId1 = 'test-empty'
      const cloneState1 = createEventualCloneState(cloneId1, 'https://target.test.do')
      storageData1.set(`eventual:${cloneId1}`, cloneState1)

      await cloneModule1.performEventualSync(cloneId1)
      const status1 = storageData1.get(`eventual:${cloneId1}`) as EventualCloneState

      // Second test: malformed JSON (unexpected, should log error)
      const { ctx: ctx2, storageData: storageData2 } = createMockContext({
        fetchResponse: vi.fn().mockResolvedValue(
          new Response('this is not JSON', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        ),
      })

      const cloneModule2 = new CloneModule()
      cloneModule2.initialize(ctx2)

      const cloneId2 = 'test-malformed'
      const cloneState2 = createEventualCloneState(cloneId2, 'https://target.test.do')
      storageData2.set(`eventual:${cloneId2}`, cloneState2)

      await cloneModule2.performEventualSync(cloneId2)
      const status2 = storageData2.get(`eventual:${cloneId2}`) as EventualCloneState

      // Empty response should not increase errorCount
      // Malformed JSON SHOULD increase errorCount
      expect(status1.errorCount).toBe(0)
      expect(status2.errorCount).toBeGreaterThan(0)
    })

    it('should log SyntaxError details for JSON parse failures', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { ctx, storageData } = createMockContext({
        fetchResponse: vi.fn().mockResolvedValue(
          new Response('{ "incomplete": ', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        ),
      })

      cloneModule.initialize(ctx)

      const cloneId = 'test-syntax-error'
      const cloneState = createEventualCloneState(cloneId, 'https://target.test.do')
      storageData.set(`eventual:${cloneId}`, cloneState)

      await cloneModule.performEventualSync(cloneId)

      // Should log a warning for SyntaxError in JSON parsing
      expect(consoleWarnSpy).toHaveBeenCalled()

      consoleWarnSpy.mockRestore()
    })
  })

  // ==========================================================================
  // Conflict Processing Error Handling
  // ==========================================================================

  describe('Conflict Processing Errors', () => {
    it('should emit clone.sync.warning for non-critical errors during conflict processing', async () => {
      const { ctx, storageData, emittedEvents } = createMockContext({
        fetchResponse: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({
            conflicts: 'not an array',
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        ),
      })

      cloneModule.initialize(ctx)

      const cloneId = 'test-warning'
      const cloneState = createEventualCloneState(cloneId, 'https://target.test.do')
      storageData.set(`eventual:${cloneId}`, cloneState)

      await cloneModule.performEventualSync(cloneId)

      // Should emit a warning event for unexpected response structure
      const warningEvents = emittedEvents.filter(e =>
        e.verb === 'clone.sync.warning' ||
        e.verb === 'clone.warning'
      )

      expect(warningEvents.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // Recovery from Parse Errors
  // ==========================================================================

  describe('Error Recovery', () => {
    it('should continue syncing after recovering from parse error', async () => {
      let callCount = 0

      const { ctx, storageData } = createMockContext({
        fetchResponse: vi.fn().mockImplementation(async () => {
          callCount++
          if (callCount === 1) {
            // First call: malformed JSON (but no content-type, so not an error)
            return new Response('broken', { status: 200 })
          }
          // Subsequent calls: valid response
          return new Response(JSON.stringify({ conflicts: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }),
      })

      cloneModule.initialize(ctx)

      const cloneId = 'test-recovery'
      const cloneState = createEventualCloneState(cloneId, 'https://target.test.do')
      storageData.set(`eventual:${cloneId}`, cloneState)

      // First sync
      await cloneModule.performEventualSync(cloneId)
      const status1 = storageData.get(`eventual:${cloneId}`) as EventualCloneState

      // Second sync should succeed
      await cloneModule.performEventualSync(cloneId)
      const status2 = storageData.get(`eventual:${cloneId}`) as EventualCloneState

      // Should have processed both syncs
      expect(status2.itemsSynced).toBeGreaterThan(0)
    })
  })
})
