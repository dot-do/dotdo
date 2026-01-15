/**
 * Session Factory
 *
 * Factory functions for creating and loading sessions.
 *
 * @module bashx/session/factory
 */

import type { BashResult } from '../types.js'
import type {
  SessionState,
  SessionId,
  SessionConfig,
  CheckpointStorage,
  WALStorage,
  WALEntry,
  EnvChange,
  CwdChange,
  SessionMetricsCollector,
  CommandHistoryEntry,
} from './types.js'
import { createInitialSessionState } from './types.js'
import { Session } from './session.js'
import { logger } from '../../../../../lib/logging'

// ============================================================================
// Factory Types
// ============================================================================

/**
 * Dependencies required to create a session.
 */
export interface SessionDependencies {
  /** Storage for checkpoints (R2) */
  checkpointStorage: CheckpointStorage

  /** Storage for WAL (DO SQLite) */
  walStorage: WALStorage

  /** Bash command executor */
  executor: BashExecutor

  /** Function to get current filesystem tree hash */
  getTreeHash: () => Promise<string>

  /** Function to restore filesystem from tree hash */
  restoreFilesystem: (treeHash: string) => Promise<void>

  /** Optional metrics collector for observability */
  metricsCollector?: SessionMetricsCollector
}

/**
 * Options for creating a new session.
 */
export interface CreateSessionOptions {
  /** Custom session ID (auto-generated if not provided) */
  id?: SessionId

  /** Initial working directory */
  cwd?: string

  /** Initial environment variables */
  env?: Record<string, string>

  /** Session configuration overrides */
  config?: Partial<SessionConfig>
}

/**
 * Bash executor interface.
 */
interface BashExecutor {
  execute(
    command: string,
    options?: { cwd?: string; env?: Record<string, string>; timeout?: number }
  ): Promise<BashResult>
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new session.
 */
export async function createSession(
  deps: SessionDependencies,
  options: CreateSessionOptions = {}
): Promise<Session> {
  // Generate session ID
  const id = options.id || `session-${crypto.randomUUID().slice(0, 12)}`

  // Create initial state
  const state = createInitialSessionState(id, options.config)

  // Apply initial cwd and env
  if (options.cwd) {
    state.cwd = options.cwd
  }
  if (options.env) {
    state.env = { ...state.env, ...options.env }
  }

  // Get initial tree hash (empty or from current fs state)
  state.treeHash = await deps.getTreeHash()

  // Create session factory for forks
  const createSessionFn = async (forkId: SessionId): Promise<Session> => {
    return loadSession(deps, forkId)
  }

  return new Session(
    state,
    deps.checkpointStorage,
    deps.walStorage,
    deps.executor,
    deps.getTreeHash,
    createSessionFn,
    deps.restoreFilesystem,
    deps.metricsCollector
  )
}

/**
 * Load an existing session from storage.
 */
export async function loadSession(
  deps: SessionDependencies,
  sessionId: SessionId
): Promise<Session> {
  const startTime = Date.now()
  let checkpointHash: string | undefined

  try {
    // Emit recovery start event
    deps.metricsCollector?.emit({
      type: 'recovery:start',
      sessionId,
      timestamp: startTime,
      checkpointHash: '', // Will be set once we have it
    })

    // Try to load HEAD reference
    const headRef = await deps.checkpointStorage.getRef(
      `sessions/${sessionId}/HEAD`
    )

    if (!headRef) {
      const error = `Session not found: ${sessionId}`
      deps.metricsCollector?.emit({
        type: 'recovery:failure',
        sessionId,
        timestamp: Date.now(),
        error,
        checkpointHash: undefined,
      })
      throw new Error(error)
    }

    checkpointHash = headRef.checkpointHash

    // Load checkpoint
    const checkpoint = await deps.checkpointStorage.getCheckpoint(checkpointHash)

    if (!checkpoint) {
      const error = `Checkpoint not found: ${checkpointHash}`
      deps.metricsCollector?.emit({
        type: 'recovery:failure',
        sessionId,
        timestamp: Date.now(),
        error,
        checkpointHash,
      })
      throw new Error(error)
    }

    // Get WAL entries since checkpoint
    const lastSeq = checkpoint.state.history.length
    const walEntries = await deps.walStorage.getEntriesSince(sessionId, lastSeq)

    // Replay WAL entries
    const state = { ...checkpoint.state }

    const maxReplay = state.config.checkpoint.maxReplayOps
    const entriesToReplay = walEntries.length > maxReplay
      ? walEntries.slice(-maxReplay)
      : walEntries

    for (const entry of entriesToReplay) {
      replayWALEntry(state, entry)
    }

    if (walEntries.length > maxReplay) {
      logger.warn('WAL entries exceeded limit and were dropped', {
        source: 'bashx/session/factory',
        sessionId,
        dropped: walEntries.length - maxReplay,
        maxReplay,
      })
    }

    // Update recovery metrics
    state.metrics.recoveryCount++
    state.metrics.recoverySuccessCount++
    state.updatedAt = Date.now()

    // Restore filesystem state
    await deps.restoreFilesystem(state.treeHash)

    const duration = Date.now() - startTime

    // Emit recovery success event
    deps.metricsCollector?.emit({
      type: 'recovery:success',
      sessionId,
      timestamp: Date.now(),
      checkpointHash,
      durationMs: duration,
      walEntriesReplayed: entriesToReplay.length,
    })

    // Create session factory for forks
    const createSessionFn = async (forkId: SessionId): Promise<Session> => {
      return loadSession(deps, forkId)
    }

    return new Session(
      state,
      deps.checkpointStorage,
      deps.walStorage,
      deps.executor,
      deps.getTreeHash,
      createSessionFn,
      deps.restoreFilesystem,
      deps.metricsCollector
    )
  } catch (error) {
    // If we haven't already emitted a failure event (for specific cases handled above),
    // emit a generic failure
    if (error instanceof Error &&
        !error.message.startsWith('Session not found:') &&
        !error.message.startsWith('Checkpoint not found:')) {
      deps.metricsCollector?.emit({
        type: 'recovery:failure',
        sessionId,
        timestamp: Date.now(),
        error: error.message,
        checkpointHash,
      })

      // Update failure count if we can get the state
      // (In practice this would be tracked at the deps level, not in the session state)
    }
    throw error
  }
}

/**
 * Replay a WAL entry to update session state.
 */
function replayWALEntry(state: SessionState, entry: WALEntry): void {
  switch (entry.op) {
    case 'command':
      // Command entries contain full CommandHistoryEntry
      state.history.push(entry.data as CommandHistoryEntry)
      state.metrics.commandCount++
      break

    case 'env':
      const envChange = entry.data as EnvChange
      if (envChange.newValue !== undefined) {
        state.env[envChange.key] = envChange.newValue
      } else {
        delete state.env[envChange.key]
      }
      break

    case 'cwd':
      state.cwd = (entry.data as CwdChange).newCwd
      break

    case 'file':
      // File changes affect treeHash - would need to recompute
      // In practice, the treeHash in checkpoint is authoritative
      break
  }

  state.updatedAt = entry.timestamp
}

// ============================================================================
// Recovery Utilities
// ============================================================================

/**
 * Check if a session exists and can be recovered.
 */
export async function sessionExists(
  checkpointStorage: CheckpointStorage,
  sessionId: SessionId
): Promise<boolean> {
  const headRef = await checkpointStorage.getRef(`sessions/${sessionId}/HEAD`)
  return headRef !== null
}

/**
 * List all available sessions.
 */
export async function listSessions(
  checkpointStorage: CheckpointStorage
): Promise<SessionId[]> {
  const refs = await checkpointStorage.listRefs('sessions/')
  const sessionIds = new Set<SessionId>()

  for (const ref of refs) {
    // Extract session ID from ref name like "sessions/{id}/HEAD"
    const match = ref.name.match(/^sessions\/([^/]+)\/HEAD$/)
    if (match) {
      sessionIds.add(match[1])
    }
  }

  return Array.from(sessionIds)
}

/**
 * Delete a session and all its checkpoints.
 */
export async function deleteSession(
  deps: Pick<SessionDependencies, 'checkpointStorage' | 'walStorage'>,
  sessionId: SessionId
): Promise<void> {
  // Delete all refs for this session
  const allRefs = await deps.checkpointStorage.listRefs('')
  const sessionRefs = allRefs.filter(
    ref => ref.sessionId === sessionId || ref.name.includes(sessionId)
  )

  const checkpointHashes = new Set<string>()
  for (const ref of sessionRefs) {
    checkpointHashes.add(ref.checkpointHash)
    await deps.checkpointStorage.deleteRef(ref.name)
  }

  // Delete all checkpoints
  for (const hash of Array.from(checkpointHashes)) {
    await deps.checkpointStorage.deleteCheckpoint(hash)
  }

  // Prune WAL entries
  await deps.walStorage.prune(sessionId)
}
