/**
 * Session Storage using Columnar Pattern
 *
 * This module extends the generic ColumnarStore from fsx.do/storage with
 * bashx-specific session types and the ColumnarSessionStore.
 *
 * The core ColumnarStore and WriteBufferCache are imported from fsx.do/storage
 * to enable reuse across projects.
 *
 * @module bashx/storage/columnar-store
 */

import type { SqlStorage } from '@cloudflare/workers-types'

// Re-export the generic columnar store from fsx.do/storage
export {
  // Write buffer cache
  WriteBufferCache,
  type WriteBufferCacheOptions,
  type EvictionReason,
  type CacheStats,
  // Columnar store
  ColumnarStore,
  type ColumnType,
  type ColumnDefinition,
  type SchemaDefinition,
  type CheckpointTriggers,
  type ColumnarStoreOptions,
  type CheckpointStats,
  type CostComparison,
  // Cost analysis utilities
  analyzeWorkloadCost,
  printCostReport,
} from 'fsx.do/storage'

// Import for internal use
import {
  ColumnarStore,
  type SchemaDefinition,
  type ColumnarStoreOptions,
} from 'fsx.do/storage'

// ============================================================================
// Session-Specific Types (bashx-specific)
// ============================================================================

/**
 * Session state stored in columnar format
 */
export interface SessionState {
  /** Session ID (primary key) */
  id: string
  /** Current working directory */
  cwd: string
  /** Environment variables (JSON column) */
  env: Record<string, string>
  /** Command history (JSON column) */
  history: CommandHistoryEntry[]
  /** Open file handles (JSON column) */
  openFiles: OpenFileHandle[]
  /** Running processes (JSON column) */
  processes: ProcessInfo[]
  /** Custom session metadata (JSON column) */
  metadata: Record<string, unknown>
  /** Creation timestamp */
  createdAt: Date
  /** Last update timestamp */
  updatedAt: Date
  /** Last checkpoint timestamp */
  checkpointedAt: Date | null
  /** Version for optimistic locking */
  version: number
}

/**
 * Command history entry stored in JSON column
 */
export interface CommandHistoryEntry {
  /** Unique command ID */
  id: string
  /** The command that was executed */
  command: string
  /** Exit code */
  exitCode: number
  /** Execution timestamp */
  timestamp: number
  /** Duration in ms */
  durationMs: number
  /** Working directory at execution time */
  cwd: string
}

/**
 * Open file handle stored in JSON column
 */
export interface OpenFileHandle {
  /** File descriptor number */
  fd: number
  /** File path */
  path: string
  /** Open mode (r, w, a, r+, etc.) */
  mode: string
  /** Current position */
  position: number
}

/**
 * Process info stored in JSON column
 */
export interface ProcessInfo {
  /** Process ID */
  pid: number
  /** Command being run */
  command: string
  /** Process state */
  state: 'running' | 'stopped' | 'zombie'
  /** Start timestamp */
  startedAt: number
}

/**
 * Options for ColumnarSessionStore (backwards compatibility)
 */
export type ColumnarSessionStoreOptions = ColumnarStoreOptions<SessionState>

// ============================================================================
// Session Schema Definition
// ============================================================================

/**
 * Pre-defined schema for SessionState
 */
export const SESSION_SCHEMA: SchemaDefinition<SessionState> = {
  tableName: 'sessions',
  primaryKey: 'id',
  versionField: 'version',
  updatedAtField: 'updatedAt',
  createdAtField: 'createdAt',
  checkpointedAtField: 'checkpointedAt',
  columns: {
    id: { type: 'text', required: true },
    cwd: { type: 'text', required: true },
    env: { type: 'json', defaultValue: "'{}'" },
    history: { type: 'json', defaultValue: "'[]'" },
    openFiles: { type: 'json', column: 'open_files', defaultValue: "'[]'" },
    processes: { type: 'json', defaultValue: "'[]'" },
    metadata: { type: 'json', defaultValue: "'{}'" },
    createdAt: { type: 'datetime', column: 'created_at', required: true },
    updatedAt: { type: 'datetime', column: 'updated_at', required: true },
    checkpointedAt: { type: 'datetime', column: 'checkpointed_at' },
    version: { type: 'integer', defaultValue: '1', required: true },
  },
}

// ============================================================================
// Columnar Session Store (bashx-specific)
// ============================================================================

/**
 * Columnar Session Store with write buffering
 *
 * This is a specialized version of ColumnarStore for SessionState with
 * convenience methods for session-specific operations.
 */
export class ColumnarSessionStore extends ColumnarStore<SessionState> {
  constructor(sql: SqlStorage, options: ColumnarSessionStoreOptions = {}) {
    super(sql, SESSION_SCHEMA, options)
  }

  /**
   * Initialize the database schema (override to also create normalized example table)
   */
  async ensureSchema(): Promise<void> {
    await super.ensureSchema()

    // For cost comparison, also create a normalized schema (not used in production)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS sessions_normalized_example (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        attribute_type TEXT NOT NULL,
        attribute_key TEXT NOT NULL,
        attribute_value TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
  }

  /**
   * Get a session by ID (alias for get)
   */
  async getSession(id: string): Promise<SessionState | null> {
    return this.get(id)
  }

  /**
   * Create a new session
   */
  async createSession(id: string, initialState?: Partial<SessionState>): Promise<SessionState> {
    const now = new Date()
    const session: SessionState = {
      id,
      cwd: initialState?.cwd ?? '/',
      env: initialState?.env ?? {},
      history: initialState?.history ?? [],
      openFiles: initialState?.openFiles ?? [],
      processes: initialState?.processes ?? [],
      metadata: initialState?.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      checkpointedAt: null,
      version: 1,
    }

    return this.create(session)
  }

  /**
   * Update a session (alias for update)
   */
  async updateSession(id: string, updates: Partial<SessionState>): Promise<SessionState | null> {
    return this.update(id, updates)
  }

  /**
   * Add a command to session history
   */
  async addHistoryEntry(sessionId: string, entry: CommandHistoryEntry): Promise<void> {
    await this.ensureSchema()

    const session = await this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    await this.update(sessionId, {
      history: [...session.history, entry],
    })

    // In normalized schema, this would be a new row (already counted in update)
  }

  /**
   * Update environment variable
   */
  async setEnvVar(sessionId: string, key: string, value: string): Promise<void> {
    await this.ensureSchema()

    const session = await this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    await this.update(sessionId, {
      env: { ...session.env, [key]: value },
    })

    // In normalized schema, this would be a new/updated row (already counted in update)
  }
}
