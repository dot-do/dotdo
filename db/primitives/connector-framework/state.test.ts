/**
 * State Management and Recovery Tests (dotdo-oe0oo)
 *
 * TDD tests for:
 * - Per-stream state tracking
 * - Global vs stream-level state
 * - State serialization format with versioning
 * - Recovery from partial syncs via checkpoints
 * - State migration between versions
 *
 * @module db/primitives/connector-framework/state
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  type StateManager,
  type StateStore,
  type PersistedState,
  type StateVersion,
  type StateMigration,
  createStateManager,
  createMemoryStateStore,
  type SyncState,
  type StreamState,
  type GlobalState,
} from './state'

describe('StateManager', () => {
  let stateManager: StateManager
  let stateStore: StateStore

  beforeEach(() => {
    stateStore = createMemoryStateStore()
    stateManager = createStateManager({ store: stateStore })
  })

  describe('per-stream state tracking', () => {
    it('should track state for individual streams', async () => {
      const streamState: StreamState = {
        streamDescriptor: { name: 'users', namespace: 'public' },
        streamState: { cursor: '2024-01-15T00:00:00Z', lastId: 1000 },
      }

      await stateManager.setStreamState('sync-123', streamState)
      const retrieved = await stateManager.getStreamState('sync-123', 'users', 'public')

      expect(retrieved).toEqual(streamState.streamState)
    })

    it('should track multiple streams independently', async () => {
      await stateManager.setStreamState('sync-123', {
        streamDescriptor: { name: 'users' },
        streamState: { cursor: 100 },
      })
      await stateManager.setStreamState('sync-123', {
        streamDescriptor: { name: 'orders' },
        streamState: { cursor: 200 },
      })

      const usersState = await stateManager.getStreamState('sync-123', 'users')
      const ordersState = await stateManager.getStreamState('sync-123', 'orders')

      expect(usersState?.cursor).toBe(100)
      expect(ordersState?.cursor).toBe(200)
    })

    it('should return undefined for non-existent stream state', async () => {
      const state = await stateManager.getStreamState('sync-123', 'non-existent')
      expect(state).toBeUndefined()
    })
  })

  describe('global vs stream-level state', () => {
    it('should support global state with shared data', async () => {
      const globalState: GlobalState = {
        sharedState: { syncId: 'abc123', startedAt: '2024-01-15T00:00:00Z' },
        streamStates: [
          { streamDescriptor: { name: 'users' }, streamState: { cursor: 100 } },
          { streamDescriptor: { name: 'orders' }, streamState: { cursor: 200 } },
        ],
      }

      await stateManager.setGlobalState('sync-123', globalState)
      const retrieved = await stateManager.getGlobalState('sync-123')

      expect(retrieved?.sharedState?.syncId).toBe('abc123')
      expect(retrieved?.streamStates).toHaveLength(2)
    })

    it('should merge stream state into global state', async () => {
      // Set initial global state
      await stateManager.setGlobalState('sync-123', {
        sharedState: { version: 1 },
        streamStates: [{ streamDescriptor: { name: 'users' }, streamState: { cursor: 100 } }],
      })

      // Update individual stream
      await stateManager.setStreamState('sync-123', {
        streamDescriptor: { name: 'users' },
        streamState: { cursor: 150 },
      })

      const globalState = await stateManager.getGlobalState('sync-123')
      const usersStream = globalState?.streamStates.find((s) => s.streamDescriptor.name === 'users')

      expect(usersStream?.streamState.cursor).toBe(150)
    })
  })

  describe('state serialization format', () => {
    it('should serialize state with version metadata', async () => {
      await stateManager.setStreamState('sync-123', {
        streamDescriptor: { name: 'users' },
        streamState: { cursor: 100 },
      })

      const persisted = await stateStore.load('sync-123')

      expect(persisted?.version).toBeDefined()
      expect(persisted?.version.major).toBeGreaterThanOrEqual(1)
      expect(persisted?.createdAt).toBeInstanceOf(Date)
      expect(persisted?.updatedAt).toBeInstanceOf(Date)
    })

    it('should include checksum for data integrity', async () => {
      await stateManager.setStreamState('sync-123', {
        streamDescriptor: { name: 'users' },
        streamState: { cursor: 100 },
      })

      const persisted = await stateStore.load('sync-123')

      expect(persisted?.checksum).toBeDefined()
      expect(typeof persisted?.checksum).toBe('string')
    })

    it('should detect corrupted state via checksum', async () => {
      await stateManager.setStreamState('sync-123', {
        streamDescriptor: { name: 'users' },
        streamState: { cursor: 100 },
      })

      // Manually corrupt the state
      const persisted = await stateStore.load('sync-123')
      if (persisted) {
        persisted.checksum = 'invalid-checksum'
        await stateStore.save('sync-123', persisted)
      }

      await expect(stateManager.getStreamState('sync-123', 'users')).rejects.toThrow(/checksum/i)
    })
  })

  describe('recovery from partial syncs', () => {
    it('should create checkpoints during sync', async () => {
      const checkpoint1 = await stateManager.createCheckpoint('sync-123', {
        streams: { users: { cursor: 50, recordsProcessed: 50 } },
      })

      const checkpoint2 = await stateManager.createCheckpoint('sync-123', {
        streams: { users: { cursor: 100, recordsProcessed: 100 } },
      })

      expect(checkpoint1.id).toBeDefined()
      expect(checkpoint2.id).toBeDefined()
      expect(checkpoint2.id).not.toBe(checkpoint1.id)
    })

    it('should recover from last valid checkpoint after failure', async () => {
      // Create checkpoints with small delays to ensure different timestamps
      await stateManager.createCheckpoint('sync-123', {
        streams: { users: { cursor: 50 } },
      })
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5))
      await stateManager.createCheckpoint('sync-123', {
        streams: { users: { cursor: 100 } },
      })

      // Simulate failure and recovery
      const recoveredState = await stateManager.recoverFromCheckpoint('sync-123')

      expect(recoveredState?.streams?.users?.cursor).toBe(100)
    })

    it('should list available checkpoints', async () => {
      await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 50 } } })
      await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 100 } } })
      await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 150 } } })

      const checkpoints = await stateManager.listCheckpoints('sync-123')

      expect(checkpoints).toHaveLength(3)
      expect(checkpoints[2].state.streams.users.cursor).toBe(150)
    })

    it('should rollback to specific checkpoint', async () => {
      const cp1 = await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 50 } } })
      await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 100 } } })

      await stateManager.rollbackToCheckpoint('sync-123', cp1.id)
      const currentState = await stateManager.getCurrentState('sync-123')

      expect(currentState?.streams?.users?.cursor).toBe(50)
    })

    it('should clean up old checkpoints based on retention policy', async () => {
      const retention = { maxCheckpoints: 2 }
      stateManager = createStateManager({ store: stateStore, checkpointRetention: retention })

      await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 50 } } })
      await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 100 } } })
      await stateManager.createCheckpoint('sync-123', { streams: { users: { cursor: 150 } } })

      const checkpoints = await stateManager.listCheckpoints('sync-123')

      expect(checkpoints).toHaveLength(2)
      expect(checkpoints[0].state.streams.users.cursor).toBe(100)
    })
  })

  describe('state migration between versions', () => {
    it('should migrate state from v1 to v2 format', async () => {
      // Manually save v1 format state
      const v1State: PersistedState = {
        version: { major: 1, minor: 0, patch: 0 },
        data: { streams: { users: { offset: 100 } } },
        createdAt: new Date(),
        updatedAt: new Date(),
        checksum: 'valid',
      }
      await stateStore.save('sync-123', v1State)

      // Define migration
      const migration: StateMigration = {
        fromVersion: { major: 1, minor: 0, patch: 0 },
        toVersion: { major: 2, minor: 0, patch: 0 },
        migrate: (data) => ({
          streams: Object.fromEntries(
            Object.entries(data.streams as Record<string, { offset: number }>).map(([k, v]) => [k, { cursor: v.offset }]),
          ),
        }),
      }

      stateManager = createStateManager({ store: stateStore, migrations: [migration] })

      const state = await stateManager.getCurrentState('sync-123')

      expect(state?.streams?.users?.cursor).toBe(100)
      expect(state?.streams?.users).not.toHaveProperty('offset')
    })

    it('should apply multiple migrations in sequence', async () => {
      const v1State: PersistedState = {
        version: { major: 1, minor: 0, patch: 0 },
        data: { cursors: { users: 100 } },
        createdAt: new Date(),
        updatedAt: new Date(),
        checksum: 'valid',
      }
      await stateStore.save('sync-123', v1State)

      const migrations: StateMigration[] = [
        {
          fromVersion: { major: 1, minor: 0, patch: 0 },
          toVersion: { major: 1, minor: 1, patch: 0 },
          migrate: (data) => ({ ...data, format: 'v1.1' }),
        },
        {
          fromVersion: { major: 1, minor: 1, patch: 0 },
          toVersion: { major: 2, minor: 0, patch: 0 },
          migrate: (data) => ({
            streams: Object.fromEntries(
              Object.entries(data.cursors as Record<string, number>).map(([k, v]) => [k, { cursor: v }]),
            ),
            migrated: true,
          }),
        },
      ]

      stateManager = createStateManager({ store: stateStore, migrations })

      const state = await stateManager.getCurrentState('sync-123')

      expect((state as any).migrated).toBe(true)
      expect(state?.streams?.users?.cursor).toBe(100)
    })

    it('should fail gracefully if migration path is missing', async () => {
      const v1State: PersistedState = {
        version: { major: 1, minor: 0, patch: 0 },
        data: { streams: {} },
        createdAt: new Date(),
        updatedAt: new Date(),
        checksum: 'valid',
      }
      await stateStore.save('sync-123', v1State)

      // No migrations provided for v1 -> current
      stateManager = createStateManager({ store: stateStore, migrations: [] })

      await expect(stateManager.getCurrentState('sync-123')).rejects.toThrow(/migration/i)
    })
  })
})
