/**
 * Session Management for Python Execution
 *
 * Provides persistent Python sessions with state management,
 * variable tracking, and snapshot support via Durable Object storage.
 */

import type { PythonBackend, ExecResult, Package } from '../core/backend.js'

// =============================================================================
// Cloudflare Workers Types (inline to avoid dependency issues)
// =============================================================================

/**
 * Durable Object storage interface
 */
export interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>
}

// =============================================================================
// Types
// =============================================================================

/**
 * Session state stored in DO storage
 */
export interface SessionState {
  /** Session ID */
  id: string
  /** Creation timestamp */
  createdAt: number
  /** Last activity timestamp */
  lastActivityAt: number
  /** Installed packages */
  packages: Package[]
  /** Execution history count */
  executionCount: number
  /** Whether session is closed */
  closed: boolean
  /** Session metadata */
  metadata?: Record<string, unknown>
}

/**
 * Execution record for history tracking
 */
export interface ExecutionRecord {
  /** Unique execution ID */
  id: string
  /** Python code executed */
  code: string
  /** Execution result */
  result: ExecResult
  /** Timestamp */
  timestamp: number
}

/**
 * Session options
 */
export interface SessionOptions {
  /** Session timeout in milliseconds (default: 30 minutes) */
  timeout?: number
  /** Maximum executions to keep in history */
  maxHistory?: number
  /** Packages to pre-install */
  packages?: string[]
  /** Session metadata */
  metadata?: Record<string, unknown>
}

/**
 * Snapshot metadata stored with snapshots
 */
export interface SnapshotMetadata {
  /** Snapshot ID */
  id: string
  /** Session ID this snapshot was created from */
  sessionId: string
  /** Creation timestamp */
  createdAt: number
  /** Size in bytes */
  size: number
  /** Installed packages at snapshot time */
  packages: Package[]
  /** Optional description */
  description?: string
}

// =============================================================================
// Session Manager
// =============================================================================

/**
 * Manages Python sessions with persistent state
 *
 * Features:
 * - Automatic state persistence to DO storage
 * - Execution history tracking
 * - Memory snapshots for fast restoration
 * - Session timeout management
 */
export class SessionManager {
  private readonly storage: DurableObjectStorage
  private readonly backend: PythonBackend
  private readonly options: Required<SessionOptions>

  private state: SessionState | null = null
  private history: ExecutionRecord[] = []

  constructor(
    storage: DurableObjectStorage,
    backend: PythonBackend,
    options: SessionOptions = {}
  ) {
    this.storage = storage
    this.backend = backend
    this.options = {
      timeout: options.timeout ?? 30 * 60 * 1000, // 30 minutes
      maxHistory: options.maxHistory ?? 100,
      packages: options.packages ?? [],
      metadata: options.metadata ?? {},
    }
  }

  /**
   * Initialize or restore session
   */
  async init(sessionId?: string): Promise<SessionState> {
    // Try to restore existing session
    if (sessionId) {
      const existing = await this.storage.get<SessionState>(`session:${sessionId}`)
      if (existing && !existing.closed && !this.isExpired(existing)) {
        this.state = existing
        this.state.lastActivityAt = Date.now()
        await this.saveState()

        // Load history
        const historyData = await this.storage.get<ExecutionRecord[]>(
          `history:${sessionId}`
        )
        if (historyData) {
          this.history = historyData
        }

        return this.state
      }
    }

    // Create new session
    const id = sessionId ?? this.generateId()
    this.state = {
      id,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      packages: [],
      executionCount: 0,
      closed: false,
      metadata: this.options.metadata,
    }

    await this.saveState()

    // Pre-install packages if specified
    if (this.options.packages.length > 0) {
      for (const pkg of this.options.packages) {
        await this.installPackage(pkg)
      }
    }

    return this.state
  }

  /**
   * Execute Python code in this session
   */
  async exec(code: string): Promise<ExecResult> {
    this.ensureActive()

    const result = await this.backend.exec(code)

    // Update state
    this.state!.executionCount++
    this.state!.lastActivityAt = Date.now()

    // Add to history
    const record: ExecutionRecord = {
      id: this.generateId(),
      code,
      result,
      timestamp: Date.now(),
    }
    this.history.push(record)

    // Trim history if needed
    if (this.history.length > this.options.maxHistory) {
      this.history = this.history.slice(-this.options.maxHistory)
    }

    // Persist state
    await this.saveState()
    await this.saveHistory()

    return result
  }

  /**
   * Install a package in this session
   */
  async installPackage(name: string, version?: string): Promise<void> {
    this.ensureActive()

    await this.backend.installPackage(name, version)

    // Update state
    this.state!.packages.push({
      name,
      version: version ?? 'latest',
    })
    this.state!.lastActivityAt = Date.now()

    await this.saveState()
  }

  /**
   * Get session variables
   *
   * Executes Python code to inspect the current namespace and returns
   * serializable variable values.
   */
  async getVariables(): Promise<Record<string, unknown>> {
    this.ensureActive()

    const result = await this.backend.exec(`
import json

def _get_serializable_vars():
    result = {}
    for name, value in globals().items():
        if name.startswith('_'):
            continue
        try:
            # Try to serialize to JSON to ensure it's transferable
            json.dumps(value)
            result[name] = value
        except (TypeError, ValueError):
            # Not serializable, store type info
            result[name] = f"<{type(value).__name__}>"
    return result

_get_serializable_vars()
`)

    return (result.result as Record<string, unknown>) ?? {}
  }

  /**
   * Create a snapshot of the current session state
   */
  async createSnapshot(description?: string): Promise<SnapshotMetadata> {
    this.ensureActive()

    // Get memory snapshot from backend
    const snapshotData = await this.backend.createSnapshot()

    const metadata: SnapshotMetadata = {
      id: this.generateId(),
      sessionId: this.state!.id,
      createdAt: Date.now(),
      size: snapshotData.byteLength,
      packages: [...this.state!.packages],
      description,
    }

    // Store snapshot data and metadata
    await this.storage.put(`snapshot:${metadata.id}:data`, snapshotData)
    await this.storage.put(`snapshot:${metadata.id}:meta`, metadata)

    // Track snapshot in session
    const snapshots = await this.listSnapshots()
    await this.storage.put(
      `session:${this.state!.id}:snapshots`,
      [...snapshots.map((s: SnapshotMetadata) => s.id), metadata.id]
    )

    return metadata
  }

  /**
   * Restore from a snapshot
   */
  async restoreSnapshot(snapshotId: string): Promise<void> {
    const snapshotData = await this.storage.get<Uint8Array>(
      `snapshot:${snapshotId}:data`
    )
    const metadata = await this.storage.get<SnapshotMetadata>(
      `snapshot:${snapshotId}:meta`
    )

    if (!snapshotData || !metadata) {
      throw new Error(`Snapshot ${snapshotId} not found`)
    }

    // Restore backend state
    await this.backend.restoreSnapshot(snapshotData)

    // Update session state
    if (this.state) {
      this.state.packages = [...metadata.packages]
      this.state.lastActivityAt = Date.now()
      await this.saveState()
    }
  }

  /**
   * List snapshots for this session
   */
  async listSnapshots(): Promise<SnapshotMetadata[]> {
    if (!this.state) {
      return []
    }

    const snapshotIds = await this.storage.get<string[]>(
      `session:${this.state.id}:snapshots`
    )

    if (!snapshotIds) {
      return []
    }

    const snapshots: SnapshotMetadata[] = []
    for (const id of snapshotIds) {
      const meta = await this.storage.get<SnapshotMetadata>(`snapshot:${id}:meta`)
      if (meta) {
        snapshots.push(meta)
      }
    }

    return snapshots
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(snapshotId: string): Promise<void> {
    await this.storage.delete(`snapshot:${snapshotId}:data`)
    await this.storage.delete(`snapshot:${snapshotId}:meta`)

    if (this.state) {
      const snapshotIds = await this.storage.get<string[]>(
        `session:${this.state.id}:snapshots`
      )
      if (snapshotIds) {
        await this.storage.put(
          `session:${this.state.id}:snapshots`,
          snapshotIds.filter((id: string) => id !== snapshotId)
        )
      }
    }
  }

  /**
   * Get execution history
   */
  getHistory(): ExecutionRecord[] {
    return [...this.history]
  }

  /**
   * Close the session
   */
  async close(): Promise<void> {
    if (this.state) {
      this.state.closed = true
      await this.saveState()
    }

    // Reset backend
    await this.backend.reset()
  }

  /**
   * Get current session state
   */
  getState(): SessionState | null {
    return this.state
  }

  /**
   * Check if session is active
   */
  isActive(): boolean {
    return (
      this.state !== null &&
      !this.state.closed &&
      !this.isExpired(this.state)
    )
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private ensureActive(): void {
    if (!this.isActive()) {
      throw new Error('Session is not active')
    }
  }

  private isExpired(state: SessionState): boolean {
    return Date.now() - state.lastActivityAt > this.options.timeout
  }

  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`
  }

  private async saveState(): Promise<void> {
    if (this.state) {
      await this.storage.put(`session:${this.state.id}`, this.state)
    }
  }

  private async saveHistory(): Promise<void> {
    if (this.state) {
      await this.storage.put(`history:${this.state.id}`, this.history)
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a session manager
 */
export function createSessionManager(
  storage: DurableObjectStorage,
  backend: PythonBackend,
  options?: SessionOptions
): SessionManager {
  return new SessionManager(storage, backend, options)
}
