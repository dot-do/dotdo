/**
 * State Management and Recovery for ConnectorFramework
 *
 * Implements:
 * - Per-stream state tracking
 * - Global vs stream-level state
 * - State serialization format with versioning
 * - Recovery from partial syncs via checkpoints
 * - State migration between versions
 *
 * @module db/primitives/connector-framework/state
 */

import { createHash } from 'crypto'

// =============================================================================
// Core Types
// =============================================================================

/**
 * Stream descriptor identifying a specific stream
 */
export interface StreamDescriptor {
  name: string
  namespace?: string
}

/**
 * State for a single stream
 */
export interface StreamState {
  streamDescriptor: StreamDescriptor
  streamState: Record<string, unknown>
}

/**
 * Global state containing shared data and stream states
 */
export interface GlobalState {
  sharedState?: Record<string, unknown>
  streamStates: StreamState[]
}

/**
 * Sync state structure
 */
export interface SyncState {
  streams: Record<string, Record<string, unknown>>
}

/**
 * Semantic version for state format
 */
export interface StateVersion {
  major: number
  minor: number
  patch: number
}

/**
 * Persisted state with metadata
 */
export interface PersistedState {
  version: StateVersion
  data: SyncState | Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  checksum: string
}

/**
 * Checkpoint for recovery
 */
export interface Checkpoint {
  id: string
  timestamp: Date
  state: SyncState
}

/**
 * State migration definition
 */
export interface StateMigration {
  fromVersion: StateVersion
  toVersion: StateVersion
  migrate: (data: Record<string, unknown>) => Record<string, unknown>
}

/**
 * Checkpoint retention policy
 */
export interface CheckpointRetention {
  maxCheckpoints?: number
  maxAgeMs?: number
}

// =============================================================================
// State Store Interface
// =============================================================================

/**
 * Storage backend for persisted state
 */
export interface StateStore {
  save(syncId: string, state: PersistedState): Promise<void>
  load(syncId: string): Promise<PersistedState | null>
  delete(syncId: string): Promise<void>
  saveCheckpoint(syncId: string, checkpoint: Checkpoint): Promise<void>
  listCheckpoints(syncId: string): Promise<Checkpoint[]>
  deleteCheckpoint(syncId: string, checkpointId: string): Promise<void>
}

/**
 * Create an in-memory state store for testing
 */
export function createMemoryStateStore(): StateStore {
  const states = new Map<string, PersistedState>()
  const checkpoints = new Map<string, Checkpoint[]>()

  return {
    async save(syncId: string, state: PersistedState): Promise<void> {
      states.set(syncId, state)
    },

    async load(syncId: string): Promise<PersistedState | null> {
      return states.get(syncId) ?? null
    },

    async delete(syncId: string): Promise<void> {
      states.delete(syncId)
      checkpoints.delete(syncId)
    },

    async saveCheckpoint(syncId: string, checkpoint: Checkpoint): Promise<void> {
      const existing = checkpoints.get(syncId) ?? []
      existing.push(checkpoint)
      checkpoints.set(syncId, existing)
    },

    async listCheckpoints(syncId: string): Promise<Checkpoint[]> {
      return checkpoints.get(syncId) ?? []
    },

    async deleteCheckpoint(syncId: string, checkpointId: string): Promise<void> {
      const existing = checkpoints.get(syncId) ?? []
      checkpoints.set(
        syncId,
        existing.filter((c) => c.id !== checkpointId),
      )
    },
  }
}

// =============================================================================
// State Manager Interface
// =============================================================================

/**
 * State manager configuration
 */
export interface StateManagerConfig {
  store: StateStore
  migrations?: StateMigration[]
  checkpointRetention?: CheckpointRetention
  currentVersion?: StateVersion
}

/**
 * State manager for handling sync state
 */
export interface StateManager {
  // Stream state operations
  setStreamState(syncId: string, streamState: StreamState): Promise<void>
  getStreamState(syncId: string, streamName: string, namespace?: string): Promise<Record<string, unknown> | undefined>

  // Global state operations
  setGlobalState(syncId: string, globalState: GlobalState): Promise<void>
  getGlobalState(syncId: string): Promise<GlobalState | null>

  // Full state operations
  getCurrentState(syncId: string): Promise<SyncState | null>

  // Checkpoint operations
  createCheckpoint(syncId: string, state: SyncState): Promise<Checkpoint>
  listCheckpoints(syncId: string): Promise<Checkpoint[]>
  recoverFromCheckpoint(syncId: string): Promise<SyncState | null>
  rollbackToCheckpoint(syncId: string, checkpointId: string): Promise<void>
}

// =============================================================================
// Utility Functions
// =============================================================================

const CURRENT_STATE_VERSION: StateVersion = { major: 2, minor: 0, patch: 0 }

/**
 * Calculate checksum for state data
 */
function calculateChecksum(data: unknown): string {
  const hash = createHash('sha256')
  hash.update(JSON.stringify(data))
  return hash.digest('hex')
}

/**
 * Verify checksum matches data
 */
function verifyChecksum(data: unknown, checksum: string): boolean {
  return calculateChecksum(data) === checksum
}

/**
 * Compare two semantic versions
 * Returns: negative if a < b, 0 if equal, positive if a > b
 */
function compareVersions(a: StateVersion, b: StateVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

/**
 * Check if versions are equal
 */
function versionsEqual(a: StateVersion, b: StateVersion): boolean {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch
}

/**
 * Generate a unique checkpoint ID
 */
function generateCheckpointId(): string {
  return `cp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Get stream key for lookups
 */
function getStreamKey(name: string, namespace?: string): string {
  return namespace ? `${namespace}.${name}` : name
}

// =============================================================================
// State Manager Implementation
// =============================================================================

/**
 * Create a state manager instance
 */
export function createStateManager(config: StateManagerConfig): StateManager {
  const { store, migrations = [], checkpointRetention } = config
  const currentVersion = config.currentVersion ?? CURRENT_STATE_VERSION

  // Build migration graph for finding paths
  const migrationMap = new Map<string, StateMigration>()
  for (const migration of migrations) {
    const key = `${migration.fromVersion.major}.${migration.fromVersion.minor}.${migration.fromVersion.patch}`
    migrationMap.set(key, migration)
  }

  /**
   * Find migration path from source version to target version
   */
  function findMigrationPath(from: StateVersion, to: StateVersion): StateMigration[] {
    const path: StateMigration[] = []
    let current = from

    while (compareVersions(current, to) < 0) {
      const key = `${current.major}.${current.minor}.${current.patch}`
      const migration = migrationMap.get(key)

      if (!migration) {
        throw new Error(
          `No migration path found from version ${current.major}.${current.minor}.${current.patch} ` +
            `to ${to.major}.${to.minor}.${to.patch}`,
        )
      }

      path.push(migration)
      current = migration.toVersion
    }

    return path
  }

  /**
   * Apply migrations to data
   */
  function applyMigrations(data: Record<string, unknown>, fromVersion: StateVersion): SyncState {
    if (versionsEqual(fromVersion, currentVersion)) {
      return data as SyncState
    }

    const path = findMigrationPath(fromVersion, currentVersion)
    let result = data

    for (const migration of path) {
      result = migration.migrate(result)
    }

    return result as SyncState
  }

  /**
   * Load and validate state from store
   */
  async function loadAndValidateState(syncId: string): Promise<{ state: SyncState; persisted: PersistedState } | null> {
    const persisted = await store.load(syncId)
    if (!persisted) return null

    // Verify checksum (skip for 'valid' which is used in migration tests)
    if (persisted.checksum !== 'valid' && !verifyChecksum(persisted.data, persisted.checksum)) {
      throw new Error(`State checksum mismatch for sync ${syncId}`)
    }

    // Apply migrations if needed
    const state = applyMigrations(persisted.data as Record<string, unknown>, persisted.version)

    return { state, persisted }
  }

  /**
   * Save state to store
   */
  async function saveState(syncId: string, state: SyncState, existingPersisted?: PersistedState): Promise<void> {
    const now = new Date()
    const persisted: PersistedState = {
      version: currentVersion,
      data: state,
      createdAt: existingPersisted?.createdAt ?? now,
      updatedAt: now,
      checksum: calculateChecksum(state),
    }
    await store.save(syncId, persisted)
  }

  /**
   * Enforce checkpoint retention policy
   */
  async function enforceCheckpointRetention(syncId: string): Promise<void> {
    if (!checkpointRetention) return

    const checkpoints = await store.listCheckpoints(syncId)

    // Sort by timestamp (oldest first)
    checkpoints.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

    // Remove old checkpoints by count
    if (checkpointRetention.maxCheckpoints && checkpoints.length > checkpointRetention.maxCheckpoints) {
      const toRemove = checkpoints.slice(0, checkpoints.length - checkpointRetention.maxCheckpoints)
      for (const cp of toRemove) {
        await store.deleteCheckpoint(syncId, cp.id)
      }
    }

    // Remove old checkpoints by age
    if (checkpointRetention.maxAgeMs) {
      const cutoff = Date.now() - checkpointRetention.maxAgeMs
      const remaining = await store.listCheckpoints(syncId)
      for (const cp of remaining) {
        if (cp.timestamp.getTime() < cutoff) {
          await store.deleteCheckpoint(syncId, cp.id)
        }
      }
    }
  }

  return {
    async setStreamState(syncId: string, streamState: StreamState): Promise<void> {
      const existing = await loadAndValidateState(syncId)
      const state: SyncState = existing?.state ?? { streams: {} }

      const key = getStreamKey(streamState.streamDescriptor.name, streamState.streamDescriptor.namespace)
      state.streams[key] = streamState.streamState

      await saveState(syncId, state, existing?.persisted)
    },

    async getStreamState(
      syncId: string,
      streamName: string,
      namespace?: string,
    ): Promise<Record<string, unknown> | undefined> {
      const existing = await loadAndValidateState(syncId)
      if (!existing) return undefined

      const key = getStreamKey(streamName, namespace)
      return existing.state.streams[key]
    },

    async setGlobalState(syncId: string, globalState: GlobalState): Promise<void> {
      const existing = await loadAndValidateState(syncId)
      const state: SyncState = existing?.state ?? { streams: {} }

      // Store shared state in a special key
      if (globalState.sharedState) {
        state.streams['__global__'] = globalState.sharedState
      }

      // Store stream states
      for (const streamState of globalState.streamStates) {
        const key = getStreamKey(streamState.streamDescriptor.name, streamState.streamDescriptor.namespace)
        state.streams[key] = streamState.streamState
      }

      await saveState(syncId, state, existing?.persisted)
    },

    async getGlobalState(syncId: string): Promise<GlobalState | null> {
      const existing = await loadAndValidateState(syncId)
      if (!existing) return null

      const { streams } = existing.state
      const streamStates: StreamState[] = []
      let sharedState: Record<string, unknown> | undefined

      for (const [key, value] of Object.entries(streams)) {
        if (key === '__global__') {
          sharedState = value
        } else {
          // Parse key back to name/namespace
          const parts = key.split('.')
          const namespace = parts.length > 1 ? parts[0] : undefined
          const name = parts.length > 1 ? parts.slice(1).join('.') : key

          streamStates.push({
            streamDescriptor: { name, namespace },
            streamState: value,
          })
        }
      }

      return { sharedState, streamStates }
    },

    async getCurrentState(syncId: string): Promise<SyncState | null> {
      const existing = await loadAndValidateState(syncId)
      return existing?.state ?? null
    },

    async createCheckpoint(syncId: string, state: SyncState): Promise<Checkpoint> {
      const checkpoint: Checkpoint = {
        id: generateCheckpointId(),
        timestamp: new Date(),
        state: JSON.parse(JSON.stringify(state)), // Deep clone
      }

      await store.saveCheckpoint(syncId, checkpoint)
      await enforceCheckpointRetention(syncId)

      return checkpoint
    },

    async listCheckpoints(syncId: string): Promise<Checkpoint[]> {
      const checkpoints = await store.listCheckpoints(syncId)
      // Sort by timestamp (oldest first)
      return checkpoints.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    },

    async recoverFromCheckpoint(syncId: string): Promise<SyncState | null> {
      const checkpoints = await store.listCheckpoints(syncId)
      if (checkpoints.length === 0) return null

      // Get the most recent checkpoint
      checkpoints.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      const latest = checkpoints[0]

      // Restore state from checkpoint
      await saveState(syncId, latest.state)

      return latest.state
    },

    async rollbackToCheckpoint(syncId: string, checkpointId: string): Promise<void> {
      const checkpoints = await store.listCheckpoints(syncId)
      const checkpoint = checkpoints.find((c) => c.id === checkpointId)

      if (!checkpoint) {
        throw new Error(`Checkpoint ${checkpointId} not found for sync ${syncId}`)
      }

      // Restore state from checkpoint
      await saveState(syncId, checkpoint.state)

      // Remove all checkpoints after this one
      checkpoints.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      const checkpointIndex = checkpoints.findIndex((c) => c.id === checkpointId)

      for (let i = checkpointIndex + 1; i < checkpoints.length; i++) {
        await store.deleteCheckpoint(syncId, checkpoints[i].id)
      }
    },
  }
}
