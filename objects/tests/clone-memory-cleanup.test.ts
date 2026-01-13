import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CloneModule, createCloneModule } from '../lifecycle/Clone'
import type { LifecycleContext } from '../lifecycle/types'

/**
 * Clone Memory Cleanup Tests (TDD - RED Phase)
 *
 * These tests verify that the CloneModule properly cleans up in-memory Maps
 * to prevent memory leaks. The Maps in question are:
 * - _conflictResolvers: Map<string, function>
 * - _resumableClones: Map<string, ResumableCloneState>
 * - _cloneLocks: Map<string, CloneLockState>
 *
 * Memory leaks occur when:
 * 1. Clones complete but entries remain in Maps
 * 2. Clones fail/error but entries remain in Maps
 * 3. Clones are cancelled but entries remain in Maps
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

// Mock database
function createMockDb() {
  const things: Array<{
    id: string
    type: number
    branch: string | null
    name: string | null
    data: Record<string, unknown>
    deleted: boolean
  }> = [
    { id: 'thing-1', type: 1, branch: null, name: 'Test Thing', data: { foo: 'bar' }, deleted: false },
  ]

  return {
    select: vi.fn(() => ({
      from: vi.fn((table: { name?: string }) => {
        if (table && (table as unknown as { name?: string }).name === 'things') {
          return Promise.resolve(things)
        }
        return Promise.resolve([])
      }),
    })),
    _things: things,
  }
}

// Create mock lifecycle context
function createMockLifecycleContext(overrides: Partial<LifecycleContext> = {}): LifecycleContext {
  const mockStorage = createMockStorage()
  const mockDb = createMockDb()

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
          fetch: vi.fn(async () => new Response('{}', { status: 200 })),
        })),
      },
    } as unknown as LifecycleContext['env'],
    emitEvent: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('CloneModule Memory Cleanup', () => {
  let cloneModule: CloneModule
  let mockCtx: LifecycleContext

  beforeEach(() => {
    cloneModule = createCloneModule()
    mockCtx = createMockLifecycleContext()
    cloneModule.initialize(mockCtx)
  })

  describe('Memory Stats Reporting', () => {
    it('getMemoryStats() returns current Map sizes', () => {
      const stats = cloneModule.getMemoryStats()

      expect(stats).toHaveProperty('conflictResolvers')
      expect(stats).toHaveProperty('resumableClones')
      expect(stats).toHaveProperty('cloneLocks')
      expect(stats).toHaveProperty('activeClones')
      expect(stats).toHaveProperty('completedClones')

      expect(stats.conflictResolvers).toBe(0)
      expect(stats.resumableClones).toBe(0)
      expect(stats.cloneLocks).toBe(0)
    })
  })

  describe('Resumable Clone Map Cleanup', () => {
    it('_resumableClones Map is cleaned up after clone completion', async () => {
      // Setup: Manually add a completed clone state
      const cloneId = 'test-clone-completed'
      const completedState = {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'completed' as const,
        checkpoints: [],
        position: 100,
        batchSize: 10,
        checkpointInterval: 1,
        maxRetries: 3,
        retryDelay: 1000,
        retryCount: 0,
        compress: false,
        maxBandwidth: undefined,
        checkpointRetentionMs: 3600000,
        pauseRequested: false,
        cancelRequested: false,
        createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
        bytesTransferred: 1000,
        totalBytes: 1000,
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
      }

      // @ts-expect-error - accessing private member for test
      cloneModule._resumableClones.set(cloneId, completedState)

      // Verify it's there
      const statsBefore = cloneModule.getMemoryStats()
      expect(statsBefore.resumableClones).toBe(1)
      expect(statsBefore.completedClones).toBe(1)

      // Call cleanup
      const cleaned = await cloneModule.cleanupCompletedClones()

      // Verify it was cleaned up
      expect(cleaned).toBeGreaterThanOrEqual(1)
      const statsAfter = cloneModule.getMemoryStats()
      expect(statsAfter.resumableClones).toBe(0)
    })

    it('_resumableClones Map is cleaned up after clone failure', async () => {
      const cloneId = 'test-clone-failed'
      const failedState = {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'failed' as const,
        checkpoints: [],
        position: 50,
        batchSize: 10,
        checkpointInterval: 1,
        maxRetries: 3,
        retryDelay: 1000,
        retryCount: 3,
        compress: false,
        maxBandwidth: undefined,
        checkpointRetentionMs: 3600000,
        pauseRequested: false,
        cancelRequested: false,
        createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
        bytesTransferred: 500,
        totalBytes: 1000,
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
      }

      // @ts-expect-error - accessing private member for test
      cloneModule._resumableClones.set(cloneId, failedState)

      const statsBefore = cloneModule.getMemoryStats()
      expect(statsBefore.completedClones).toBe(1) // 'failed' counts as completed

      const cleaned = await cloneModule.cleanupCompletedClones()

      expect(cleaned).toBeGreaterThanOrEqual(1)
      const statsAfter = cloneModule.getMemoryStats()
      expect(statsAfter.resumableClones).toBe(0)
    })

    it('_resumableClones Map is cleaned up after clone cancellation', async () => {
      const cloneId = 'test-clone-cancelled'
      const cancelledState = {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'cancelled' as const,
        checkpoints: [],
        position: 25,
        batchSize: 10,
        checkpointInterval: 1,
        maxRetries: 3,
        retryDelay: 1000,
        retryCount: 0,
        compress: false,
        maxBandwidth: undefined,
        checkpointRetentionMs: 3600000,
        pauseRequested: false,
        cancelRequested: true,
        createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
        bytesTransferred: 250,
        totalBytes: 1000,
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
      }

      // @ts-expect-error - accessing private member for test
      cloneModule._resumableClones.set(cloneId, cancelledState)

      const statsBefore = cloneModule.getMemoryStats()
      expect(statsBefore.completedClones).toBe(1) // 'cancelled' counts as completed

      const cleaned = await cloneModule.cleanupCompletedClones()

      expect(cleaned).toBeGreaterThanOrEqual(1)
      const statsAfter = cloneModule.getMemoryStats()
      expect(statsAfter.resumableClones).toBe(0)
    })

    it('active clones are NOT cleaned up', async () => {
      const cloneId = 'test-clone-active'
      const activeState = {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'transferring' as const,
        checkpoints: [],
        position: 50,
        batchSize: 10,
        checkpointInterval: 1,
        maxRetries: 3,
        retryDelay: 1000,
        retryCount: 0,
        compress: false,
        maxBandwidth: undefined,
        checkpointRetentionMs: 3600000,
        pauseRequested: false,
        cancelRequested: false,
        createdAt: new Date(),
        bytesTransferred: 500,
        totalBytes: 1000,
        startedAt: new Date(),
      }

      // @ts-expect-error - accessing private member for test
      cloneModule._resumableClones.set(cloneId, activeState)

      const statsBefore = cloneModule.getMemoryStats()
      expect(statsBefore.activeClones).toBe(1)

      const cleaned = await cloneModule.cleanupCompletedClones()

      // Active clones should NOT be cleaned
      const statsAfter = cloneModule.getMemoryStats()
      expect(statsAfter.activeClones).toBe(1)
      expect(statsAfter.resumableClones).toBe(1)
    })
  })

  describe('Clone Locks Map Cleanup', () => {
    it('stale clone locks are cleaned up', async () => {
      const target = 'https://target.do'
      const staleLock = {
        lockId: 'lock-1',
        cloneId: 'old-clone',
        target,
        acquiredAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
        expiresAt: new Date(Date.now() - 5 * 60 * 1000), // expired 5 minutes ago
        isStale: false,
      }

      // @ts-expect-error - accessing private member for test
      cloneModule._cloneLocks.set(target, staleLock)

      const statsBefore = cloneModule.getMemoryStats()
      expect(statsBefore.cloneLocks).toBe(1)

      const cleaned = await cloneModule.cleanupCompletedClones()

      expect(cleaned).toBeGreaterThanOrEqual(1)
      const statsAfter = cloneModule.getMemoryStats()
      expect(statsAfter.cloneLocks).toBe(0)
    })

    it('locks for active clones are NOT cleaned up', async () => {
      const target = 'https://target.do'
      const cloneId = 'active-clone'

      // Add an active clone
      const activeState = {
        id: cloneId,
        targetNs: target,
        status: 'transferring' as const,
        checkpoints: [],
        position: 50,
        batchSize: 10,
        checkpointInterval: 1,
        maxRetries: 3,
        retryDelay: 1000,
        retryCount: 0,
        compress: false,
        maxBandwidth: undefined,
        checkpointRetentionMs: 3600000,
        pauseRequested: false,
        cancelRequested: false,
        createdAt: new Date(),
        bytesTransferred: 500,
        totalBytes: 1000,
        startedAt: new Date(),
      }

      // @ts-expect-error - accessing private member for test
      cloneModule._resumableClones.set(cloneId, activeState)

      // Add corresponding lock (old but for active clone)
      const activeLock = {
        lockId: 'lock-active',
        cloneId,
        target,
        acquiredAt: new Date(Date.now() - 10 * 60 * 1000),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // still valid
        isStale: false,
      }

      // @ts-expect-error - accessing private member for test
      cloneModule._cloneLocks.set(target, activeLock)

      const statsBefore = cloneModule.getMemoryStats()
      expect(statsBefore.cloneLocks).toBe(1)

      await cloneModule.cleanupCompletedClones()

      // Lock for active clone should remain
      const statsAfter = cloneModule.getMemoryStats()
      expect(statsAfter.cloneLocks).toBe(1)
    })
  })

  describe('Conflict Resolvers Map Cleanup', () => {
    it('orphaned conflict resolvers are cleaned up', async () => {
      const id = 'eventual-clone-done'

      // Add a conflict resolver without a corresponding active eventual clone
      // @ts-expect-error - accessing private member for test
      cloneModule._conflictResolvers.set(id, async () => ({}))

      const statsBefore = cloneModule.getMemoryStats()
      expect(statsBefore.conflictResolvers).toBe(1)

      const cleaned = await cloneModule.cleanupCompletedClones()

      // Orphaned resolver should be cleaned
      expect(cleaned).toBeGreaterThanOrEqual(1)
      const statsAfter = cloneModule.getMemoryStats()
      expect(statsAfter.conflictResolvers).toBe(0)
    })
  })

  describe('Automatic Cleanup on Alarm', () => {
    it('cleanupCompletedClones is called during alarm processing', async () => {
      // This test verifies that cleanup happens automatically as part of alarm handling
      const cloneId = 'test-clone-for-alarm'
      const completedState = {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'completed' as const,
        checkpoints: [],
        position: 100,
        batchSize: 10,
        checkpointInterval: 1,
        maxRetries: 3,
        retryDelay: 1000,
        retryCount: 0,
        compress: false,
        maxBandwidth: undefined,
        checkpointRetentionMs: 3600000,
        pauseRequested: false,
        cancelRequested: false,
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        bytesTransferred: 1000,
        totalBytes: 1000,
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
      }

      // @ts-expect-error - accessing private member for test
      cloneModule._resumableClones.set(cloneId, completedState)

      // Call handleEventualCloneAlarms which should include cleanup
      await cloneModule.handleEventualCloneAlarms()

      // The completed clone should be cleaned up (note: this test will FAIL
      // initially because automatic cleanup is not yet implemented)
      const statsAfter = cloneModule.getMemoryStats()
      expect(statsAfter.resumableClones).toBe(0)
    })
  })

  describe('TTL-based Cleanup', () => {
    it('respects custom TTL for cleanup', async () => {
      const cloneId = 'test-clone-ttl'
      // Clone completed 2 minutes ago
      const recentCompletedState = {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'completed' as const,
        checkpoints: [],
        position: 100,
        batchSize: 10,
        checkpointInterval: 1,
        maxRetries: 3,
        retryDelay: 1000,
        retryCount: 0,
        compress: false,
        maxBandwidth: undefined,
        checkpointRetentionMs: 3600000,
        pauseRequested: false,
        cancelRequested: false,
        createdAt: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
        bytesTransferred: 1000,
        totalBytes: 1000,
        startedAt: new Date(Date.now() - 2 * 60 * 1000),
      }

      // @ts-expect-error - accessing private member for test
      cloneModule._resumableClones.set(cloneId, recentCompletedState)

      // Call with 1 minute TTL - should clean up
      const cleanedShortTtl = await cloneModule.cleanupCompletedClones(1 * 60 * 1000)
      expect(cleanedShortTtl).toBeGreaterThanOrEqual(1)

      // Reset
      // @ts-expect-error - accessing private member for test
      cloneModule._resumableClones.set(cloneId, recentCompletedState)

      // Call with 10 minute TTL - should NOT clean up (clone is only 2 min old)
      const cleanedLongTtl = await cloneModule.cleanupCompletedClones(10 * 60 * 1000)
      expect(cleanedLongTtl).toBe(0)
    })
  })

  describe('Edge Cases', () => {
    it('handles cleanup when Maps are empty', async () => {
      const stats = cloneModule.getMemoryStats()
      expect(stats.resumableClones).toBe(0)

      // Should not throw when cleaning up empty Maps
      const cleaned = await cloneModule.cleanupCompletedClones()
      expect(cleaned).toBe(0)
    })

    it('handles concurrent cleanup calls', async () => {
      const cloneId = 'test-clone-concurrent'
      const completedState = {
        id: cloneId,
        targetNs: 'https://target.do',
        status: 'completed' as const,
        checkpoints: [],
        position: 100,
        batchSize: 10,
        checkpointInterval: 1,
        maxRetries: 3,
        retryDelay: 1000,
        retryCount: 0,
        compress: false,
        maxBandwidth: undefined,
        checkpointRetentionMs: 3600000,
        pauseRequested: false,
        cancelRequested: false,
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        bytesTransferred: 1000,
        totalBytes: 1000,
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
      }

      // @ts-expect-error - accessing private member for test
      cloneModule._resumableClones.set(cloneId, completedState)

      // Call cleanup concurrently
      const [result1, result2] = await Promise.all([
        cloneModule.cleanupCompletedClones(),
        cloneModule.cleanupCompletedClones(),
      ])

      // Total cleaned should be 1 (not 2 due to race)
      expect(result1 + result2).toBeGreaterThanOrEqual(1)

      const statsAfter = cloneModule.getMemoryStats()
      expect(statsAfter.resumableClones).toBe(0)
    })

    it('handles mixed states across Maps', async () => {
      // Add completed clone
      const completedClone = {
        id: 'completed-1',
        targetNs: 'https://target1.do',
        status: 'completed' as const,
        checkpoints: [],
        position: 100,
        batchSize: 10,
        checkpointInterval: 1,
        maxRetries: 3,
        retryDelay: 1000,
        retryCount: 0,
        compress: false,
        maxBandwidth: undefined,
        checkpointRetentionMs: 3600000,
        pauseRequested: false,
        cancelRequested: false,
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        bytesTransferred: 1000,
        totalBytes: 1000,
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
      }

      // Add active clone
      const activeClone = {
        id: 'active-1',
        targetNs: 'https://target2.do',
        status: 'transferring' as const,
        checkpoints: [],
        position: 50,
        batchSize: 10,
        checkpointInterval: 1,
        maxRetries: 3,
        retryDelay: 1000,
        retryCount: 0,
        compress: false,
        maxBandwidth: undefined,
        checkpointRetentionMs: 3600000,
        pauseRequested: false,
        cancelRequested: false,
        createdAt: new Date(),
        bytesTransferred: 500,
        totalBytes: 1000,
        startedAt: new Date(),
      }

      // @ts-expect-error - accessing private member for test
      cloneModule._resumableClones.set('completed-1', completedClone)
      // @ts-expect-error - accessing private member for test
      cloneModule._resumableClones.set('active-1', activeClone)

      // Add stale lock
      // @ts-expect-error - accessing private member for test
      cloneModule._cloneLocks.set('https://old-target.do', {
        lockId: 'stale-lock',
        cloneId: 'old-clone',
        target: 'https://old-target.do',
        acquiredAt: new Date(Date.now() - 10 * 60 * 1000),
        expiresAt: new Date(Date.now() - 5 * 60 * 1000),
        isStale: true,
      })

      // Add orphaned conflict resolver
      // @ts-expect-error - accessing private member for test
      cloneModule._conflictResolvers.set('orphan-id', async () => ({}))

      const statsBefore = cloneModule.getMemoryStats()
      expect(statsBefore.resumableClones).toBe(2)
      expect(statsBefore.completedClones).toBe(1)
      expect(statsBefore.activeClones).toBe(1)
      expect(statsBefore.cloneLocks).toBe(1)
      expect(statsBefore.conflictResolvers).toBe(1)

      await cloneModule.cleanupCompletedClones()

      const statsAfter = cloneModule.getMemoryStats()
      // Only completed clone should be removed
      expect(statsAfter.resumableClones).toBe(1)
      expect(statsAfter.activeClones).toBe(1)
      expect(statsAfter.completedClones).toBe(0)
      // Stale lock should be removed
      expect(statsAfter.cloneLocks).toBe(0)
      // Orphaned resolver should be removed
      expect(statsAfter.conflictResolvers).toBe(0)
    })
  })
})
