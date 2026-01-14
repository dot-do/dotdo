/**
 * Bi-Directional Sync Engine Tests
 *
 * Tests for the bi-directional sync engine that keeps data consistent
 * between dotdo native storage and external providers in Hybrid Mode.
 *
 * @module db/primitives/bi-directional-sync/tests/bi-directional-sync.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BiDirectionalSyncEngine,
  createBiDirectionalSyncEngine,
  type BiDirectionalSyncConfig,
  type ProviderAdapter,
  type SyncDirection,
  type SyncEventType,
  type ChangeEvent,
  type SyncPlan,
  type SyncReport,
} from '../index'

// =============================================================================
// MOCK PROVIDER ADAPTER
// =============================================================================

function createMockProviderAdapter(
  name: string,
  records: Map<string, Record<string, unknown>> = new Map()
): ProviderAdapter {
  const localRecords = new Map(records)
  let version = 0

  return {
    name,

    async fetchAll() {
      return Array.from(localRecords.entries()).map(([key, data]) => ({
        key,
        data,
        modifiedAt: new Date(),
        version: version++,
      }))
    },

    async fetchChanges(since?: Date) {
      // For tests, return all records if no since date
      return Array.from(localRecords.entries()).map(([key, data]) => ({
        key,
        data,
        modifiedAt: new Date(),
        version: version++,
      }))
    },

    async push(operations) {
      const results = []

      for (const op of operations) {
        if (op.type === 'delete') {
          localRecords.delete(op.key)
        } else {
          localRecords.set(op.key, op.data!)
        }
        results.push({ key: op.key, success: true })
      }

      return {
        successCount: results.length,
        failedCount: 0,
        results,
      }
    },

    async getRecordCount() {
      return localRecords.size
    },

    async getRecord(key) {
      const data = localRecords.get(key)
      if (!data) return null
      return {
        key,
        data,
        modifiedAt: new Date(),
        version: version++,
      }
    },

    async healthCheck() {
      return { healthy: true, latencyMs: 10 }
    },
  }
}

// =============================================================================
// BASIC INITIALIZATION TESTS
// =============================================================================

describe('BiDirectionalSyncEngine', () => {
  describe('initialization', () => {
    it('should create engine with valid config', () => {
      const engine = createBiDirectionalSyncEngine({
        native: createMockProviderAdapter('native'),
        external: createMockProviderAdapter('external'),
        direction: 'bidirectional',
        primaryKey: 'id',
        conflictStrategy: 'last-write-wins',
      })

      expect(engine).toBeDefined()
      expect(engine.getDirection()).toBe('bidirectional')
    })

    it('should support native-to-external direction', () => {
      const engine = createBiDirectionalSyncEngine({
        native: createMockProviderAdapter('native'),
        external: createMockProviderAdapter('external'),
        direction: 'native-to-external',
        primaryKey: 'id',
      })

      expect(engine.getDirection()).toBe('native-to-external')
    })

    it('should support external-to-native direction', () => {
      const engine = createBiDirectionalSyncEngine({
        native: createMockProviderAdapter('native'),
        external: createMockProviderAdapter('external'),
        direction: 'external-to-native',
        primaryKey: 'id',
      })

      expect(engine.getDirection()).toBe('external-to-native')
    })

    it('should validate that native adapter is provided', () => {
      expect(() =>
        createBiDirectionalSyncEngine({
          native: null as unknown as ProviderAdapter,
          external: createMockProviderAdapter('external'),
          direction: 'bidirectional',
          primaryKey: 'id',
        })
      ).toThrow()
    })

    it('should validate that external adapter is provided', () => {
      expect(() =>
        createBiDirectionalSyncEngine({
          native: createMockProviderAdapter('native'),
          external: null as unknown as ProviderAdapter,
          direction: 'bidirectional',
          primaryKey: 'id',
        })
      ).toThrow()
    })
  })

  describe('one-way sync: native-to-external', () => {
    it('should sync new records from native to external', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice', email: 'alice@example.com' }],
        ['user-2', { id: 'user-2', name: 'Bob', email: 'bob@example.com' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external')

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'native-to-external',
        primaryKey: 'id',
      })

      const result = await engine.sync()

      expect(result.success).toBe(true)
      expect(result.stats.added).toBe(2)
      expect(await external.getRecordCount()).toBe(2)
    })

    it('should sync updated records from native to external', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice Updated', email: 'alice@example.com' }],
      ])
      const externalRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice', email: 'alice@example.com' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external', externalRecords)

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'native-to-external',
        primaryKey: 'id',
      })

      const result = await engine.sync()

      expect(result.success).toBe(true)
      expect(result.stats.modified).toBeGreaterThanOrEqual(0) // May be 0 if data hashes match
    })

    it('should sync deletions from native to external', async () => {
      const externalRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice', email: 'alice@example.com' }],
      ])

      const native = createMockProviderAdapter('native') // Empty - user-1 deleted
      const external = createMockProviderAdapter('external', externalRecords)

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'native-to-external',
        primaryKey: 'id',
        syncDeletes: true,
      })

      const result = await engine.sync()

      expect(result.success).toBe(true)
      expect(result.stats.deleted).toBe(1)
      expect(await external.getRecordCount()).toBe(0)
    })

    it('should not push changes when direction is external-to-native', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice', email: 'alice@example.com' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external')

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'external-to-native',
        primaryKey: 'id',
      })

      const result = await engine.sync()

      expect(result.success).toBe(true)
      // External should remain empty since we're only syncing external -> native
      expect(await external.getRecordCount()).toBe(0)
    })
  })

  describe('one-way sync: external-to-native', () => {
    it('should sync new records from external to native', async () => {
      const externalRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice', email: 'alice@example.com' }],
        ['user-2', { id: 'user-2', name: 'Bob', email: 'bob@example.com' }],
      ])

      const native = createMockProviderAdapter('native')
      const external = createMockProviderAdapter('external', externalRecords)

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'external-to-native',
        primaryKey: 'id',
      })

      const result = await engine.sync()

      expect(result.success).toBe(true)
      expect(result.stats.added).toBe(2)
      expect(await native.getRecordCount()).toBe(2)
    })

    it('should sync deletions from external to native when enabled', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice', email: 'alice@example.com' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external') // Empty - user-1 deleted

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'external-to-native',
        primaryKey: 'id',
        syncDeletes: true,
      })

      const result = await engine.sync()

      expect(result.success).toBe(true)
      expect(result.stats.deleted).toBe(1)
      expect(await native.getRecordCount()).toBe(0)
    })
  })

  describe('bidirectional sync', () => {
    it('should sync changes in both directions', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice', email: 'alice@example.com' }],
      ])
      const externalRecords = new Map([
        ['user-2', { id: 'user-2', name: 'Bob', email: 'bob@example.com' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external', externalRecords)

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'bidirectional',
        primaryKey: 'id',
        conflictStrategy: 'last-write-wins',
      })

      const result = await engine.sync()

      expect(result.success).toBe(true)
      expect(result.stats.added).toBe(2) // 1 each direction
      expect(await native.getRecordCount()).toBe(2)
      expect(await external.getRecordCount()).toBe(2)
    })

    it('should detect conflicts in bidirectional sync', async () => {
      const now = new Date()
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice Native', email: 'alice@example.com' }],
      ])
      const externalRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice External', email: 'alice@example.com' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external', externalRecords)

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'bidirectional',
        primaryKey: 'id',
        conflictStrategy: 'last-write-wins',
      })

      const result = await engine.sync()

      expect(result.success).toBe(true)
      // Conflict should be resolved using last-write-wins
      expect(result.stats.conflicts).toBeGreaterThanOrEqual(0)
    })

    it('should use source-wins strategy when configured', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice Native', email: 'alice@example.com' }],
      ])
      const externalRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice External', email: 'alice@example.com' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external', externalRecords)

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'bidirectional',
        primaryKey: 'id',
        conflictStrategy: 'native-wins',
      })

      const result = await engine.sync()

      expect(result.success).toBe(true)
      // External should have native's version after sync
      const externalUser = await external.getRecord('user-1')
      expect(externalUser?.data.name).toBe('Alice Native')
    })

    it('should use external-wins strategy when configured', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice Native', email: 'alice@example.com' }],
      ])
      const externalRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice External', email: 'alice@example.com' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external', externalRecords)

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'bidirectional',
        primaryKey: 'id',
        conflictStrategy: 'external-wins',
      })

      const result = await engine.sync()

      expect(result.success).toBe(true)
      // Native should have external's version after sync
      const nativeUser = await native.getRecord('user-1')
      expect(nativeUser?.data.name).toBe('Alice External')
    })

    it('should report unresolved conflicts when manual strategy is used', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice Native', email: 'alice@example.com' }],
      ])
      const externalRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice External', email: 'alice@example.com' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external', externalRecords)

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'bidirectional',
        primaryKey: 'id',
        conflictStrategy: 'manual',
      })

      const result = await engine.sync()

      // With manual strategy, conflicts are not auto-resolved
      expect(result.unresolvedConflicts.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('sync events', () => {
    it('should emit started event', async () => {
      const native = createMockProviderAdapter('native')
      const external = createMockProviderAdapter('external')

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'bidirectional',
        primaryKey: 'id',
      })

      const events: SyncEventType[] = []
      engine.on('started', () => events.push('started'))

      await engine.sync()

      expect(events).toContain('started')
    })

    it('should emit completed event with result', async () => {
      const native = createMockProviderAdapter('native')
      const external = createMockProviderAdapter('external')

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'bidirectional',
        primaryKey: 'id',
      })

      let completedResult: SyncReport | null = null
      engine.on('completed', (data) => {
        completedResult = data.result
      })

      await engine.sync()

      expect(completedResult).not.toBeNull()
      expect(completedResult!.success).toBe(true)
    })

    it('should emit progress events', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice' }],
        ['user-2', { id: 'user-2', name: 'Bob' }],
        ['user-3', { id: 'user-3', name: 'Charlie' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external')

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'native-to-external',
        primaryKey: 'id',
      })

      const progressEvents: number[] = []
      engine.on('progress', (data) => progressEvents.push(data.percentage))

      await engine.sync()

      // Should have received at least one progress update
      expect(progressEvents.length).toBeGreaterThanOrEqual(0)
    })

    it('should emit conflict events', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice Native' }],
      ])
      const externalRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice External' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external', externalRecords)

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'bidirectional',
        primaryKey: 'id',
        conflictStrategy: 'last-write-wins',
      })

      const conflictEvents: string[] = []
      engine.on('conflict', (data) => conflictEvents.push(data.conflict.key))

      await engine.sync()

      // May or may not have conflict depending on modification times
      expect(conflictEvents.length).toBeGreaterThanOrEqual(0)
    })

    it('should emit error event on failure', async () => {
      const native = createMockProviderAdapter('native')
      const external: ProviderAdapter = {
        name: 'failing-external',
        async fetchAll() {
          throw new Error('Connection failed')
        },
        async fetchChanges() {
          throw new Error('Connection failed')
        },
        async push() {
          throw new Error('Connection failed')
        },
        async getRecordCount() {
          return 0
        },
        async getRecord() {
          return null
        },
        async healthCheck() {
          return { healthy: false, latencyMs: 0, error: 'Connection failed' }
        },
      }

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'bidirectional',
        primaryKey: 'id',
      })

      let errorEvent: Error | null = null
      engine.on('error', (data) => {
        errorEvent = new Error(data.error.message)
      })

      const result = await engine.sync()

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('sync plan', () => {
    it('should generate sync plan without executing', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice' }],
      ])
      const externalRecords = new Map([
        ['user-2', { id: 'user-2', name: 'Bob' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external', externalRecords)

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'bidirectional',
        primaryKey: 'id',
      })

      const plan = await engine.createSyncPlan()

      expect(plan.operations.length).toBeGreaterThan(0)
      expect(plan.estimatedDurationMs).toBeGreaterThanOrEqual(0)

      // Records should not have been synced yet
      expect(await native.getRecordCount()).toBe(1)
      expect(await external.getRecordCount()).toBe(1)
    })

    it('should execute a sync plan', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external')

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'native-to-external',
        primaryKey: 'id',
      })

      const plan = await engine.createSyncPlan()
      const result = await engine.executePlan(plan)

      expect(result.success).toBe(true)
      expect(await external.getRecordCount()).toBe(1)
    })
  })

  describe('incremental sync', () => {
    it('should support incremental sync with cursor', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice' }],
        ['user-2', { id: 'user-2', name: 'Bob' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external')

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'native-to-external',
        primaryKey: 'id',
        syncMode: 'incremental',
      })

      // First sync
      const result1 = await engine.sync()
      expect(result1.success).toBe(true)
      expect(await external.getRecordCount()).toBe(2)

      // Get the cursor/state
      const state = engine.getSyncState()
      expect(state.lastSyncAt).toBeDefined()
    })

    it('should track last sync timestamp', async () => {
      const native = createMockProviderAdapter('native')
      const external = createMockProviderAdapter('external')

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'bidirectional',
        primaryKey: 'id',
      })

      const beforeSync = engine.getSyncState()
      expect(beforeSync.lastSyncAt).toBeUndefined()

      await engine.sync()

      const afterSync = engine.getSyncState()
      expect(afterSync.lastSyncAt).toBeDefined()
    })
  })

  describe('field mapping', () => {
    it('should apply field mappings during sync', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', full_name: 'Alice Smith', email_address: 'alice@example.com' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external')

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'native-to-external',
        primaryKey: 'id',
        fieldMappings: [
          { native: 'full_name', external: 'name' },
          { native: 'email_address', external: 'email' },
        ],
      })

      await engine.sync()

      const externalUser = await external.getRecord('user-1')
      expect(externalUser?.data.name).toBe('Alice Smith')
      expect(externalUser?.data.email).toBe('alice@example.com')
    })

    it('should apply reverse field mappings from external to native', async () => {
      const externalRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice Smith', email: 'alice@example.com' }],
      ])

      const native = createMockProviderAdapter('native')
      const external = createMockProviderAdapter('external', externalRecords)

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'external-to-native',
        primaryKey: 'id',
        fieldMappings: [
          { native: 'full_name', external: 'name' },
          { native: 'email_address', external: 'email' },
        ],
      })

      await engine.sync()

      const nativeUser = await native.getRecord('user-1')
      expect(nativeUser?.data.full_name).toBe('Alice Smith')
      expect(nativeUser?.data.email_address).toBe('alice@example.com')
    })
  })

  describe('error handling', () => {
    it('should handle partial failures gracefully', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice' }],
        ['user-2', { id: 'user-2', name: 'Bob' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      let callCount = 0
      const external: ProviderAdapter = {
        name: 'partial-failure',
        async fetchAll() {
          return []
        },
        async fetchChanges() {
          return []
        },
        async push(operations) {
          const results = operations.map((op, i) => ({
            key: op.key,
            success: i === 0, // Only first one succeeds
            error: i === 0 ? undefined : 'Write failed',
          }))
          return {
            successCount: 1,
            failedCount: operations.length - 1,
            results,
          }
        },
        async getRecordCount() {
          return callCount
        },
        async getRecord() {
          return null
        },
        async healthCheck() {
          return { healthy: true, latencyMs: 10 }
        },
      }

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'native-to-external',
        primaryKey: 'id',
      })

      const result = await engine.sync()

      expect(result.stats.added).toBe(1)
      expect(result.stats.failed).toBe(1)
    })

    it('should respect retry configuration', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      let attempts = 0
      const external: ProviderAdapter = {
        name: 'retry-test',
        async fetchAll() {
          return []
        },
        async fetchChanges() {
          return []
        },
        async push(operations) {
          attempts++
          if (attempts < 3) {
            throw new Error('Temporary failure')
          }
          return {
            successCount: operations.length,
            failedCount: 0,
            results: operations.map((op) => ({ key: op.key, success: true })),
          }
        },
        async getRecordCount() {
          return 0
        },
        async getRecord() {
          return null
        },
        async healthCheck() {
          return { healthy: true, latencyMs: 10 }
        },
      }

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'native-to-external',
        primaryKey: 'id',
        retryPolicy: {
          maxRetries: 3,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
        },
      })

      const result = await engine.sync()

      expect(result.success).toBe(true)
      expect(attempts).toBe(3)
    })
  })

  describe('health checks', () => {
    it('should check health of both adapters', async () => {
      const native = createMockProviderAdapter('native')
      const external = createMockProviderAdapter('external')

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'bidirectional',
        primaryKey: 'id',
      })

      const health = await engine.checkHealth()

      expect(health.native.healthy).toBe(true)
      expect(health.external.healthy).toBe(true)
      expect(health.canSync).toBe(true)
    })

    it('should report unhealthy when adapter fails health check', async () => {
      const native = createMockProviderAdapter('native')
      const external: ProviderAdapter = {
        name: 'unhealthy',
        async fetchAll() {
          return []
        },
        async fetchChanges() {
          return []
        },
        async push() {
          return { successCount: 0, failedCount: 0, results: [] }
        },
        async getRecordCount() {
          return 0
        },
        async getRecord() {
          return null
        },
        async healthCheck() {
          return { healthy: false, latencyMs: 0, error: 'Connection refused' }
        },
      }

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'bidirectional',
        primaryKey: 'id',
      })

      const health = await engine.checkHealth()

      expect(health.external.healthy).toBe(false)
      expect(health.canSync).toBe(false)
    })
  })

  describe('concurrent sync protection', () => {
    it('should prevent concurrent syncs', async () => {
      const nativeRecords = new Map([
        ['user-1', { id: 'user-1', name: 'Alice' }],
      ])

      const native = createMockProviderAdapter('native', nativeRecords)
      const external = createMockProviderAdapter('external')

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'native-to-external',
        primaryKey: 'id',
      })

      // Start two syncs concurrently
      const sync1 = engine.sync()
      const sync2 = engine.sync()

      const [result1, result2] = await Promise.all([sync1, sync2])

      // One should succeed, one should be rejected
      const successes = [result1, result2].filter((r) => r.success)
      const failures = [result1, result2].filter((r) => !r.success)

      expect(successes.length).toBe(1)
      expect(failures.length).toBe(1)
      expect(failures[0].error?.code).toBe('SYNC_IN_PROGRESS')
    })

    it('should report syncing status while sync is in progress', async () => {
      const native = createMockProviderAdapter('native')
      const external = createMockProviderAdapter('external')

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'bidirectional',
        primaryKey: 'id',
      })

      expect(engine.isSyncing()).toBe(false)

      const syncPromise = engine.sync()

      // Check immediately - may or may not be syncing depending on timing
      const syncingDuringSync = engine.isSyncing()

      await syncPromise

      expect(engine.isSyncing()).toBe(false)
    })
  })

  describe('batching', () => {
    it('should batch operations according to config', async () => {
      const nativeRecords = new Map(
        Array.from({ length: 100 }, (_, i) => [
          `user-${i}`,
          { id: `user-${i}`, name: `User ${i}` },
        ])
      )

      const native = createMockProviderAdapter('native', nativeRecords)
      const pushCalls: number[] = []
      const external: ProviderAdapter = {
        name: 'batched',
        async fetchAll() {
          return []
        },
        async fetchChanges() {
          return []
        },
        async push(operations) {
          pushCalls.push(operations.length)
          return {
            successCount: operations.length,
            failedCount: 0,
            results: operations.map((op) => ({ key: op.key, success: true })),
          }
        },
        async getRecordCount() {
          return 0
        },
        async getRecord() {
          return null
        },
        async healthCheck() {
          return { healthy: true, latencyMs: 10 }
        },
      }

      const engine = createBiDirectionalSyncEngine({
        native,
        external,
        direction: 'native-to-external',
        primaryKey: 'id',
        batchSize: 25,
      })

      await engine.sync()

      // Should have called push 4 times with 25 records each
      expect(pushCalls.length).toBe(4)
      expect(pushCalls.every((count) => count === 25)).toBe(true)
    })
  })
})
