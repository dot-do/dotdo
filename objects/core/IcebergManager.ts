/**
 * @module IcebergManager
 * @description Iceberg state persistence for Durable Objects
 *
 * Handles R2-based snapshot storage with:
 * - Load/save from Iceberg snapshots
 * - Auto-checkpoint with debouncing
 * - Fencing tokens for single-writer semantics
 *
 * Extracted from DOBase.ts for better modularity.
 */

import { IcebergStateAdapter, type IcebergSnapshot } from '../persistence/iceberg-state'
import { AuthorizedR2Client, type R2Bucket } from '../../lib/storage/authorized-r2'
import { logBestEffortError } from '@/lib/logging/error-logger'
import { createLogger, LogLevel } from '@/lib/logging'

const icebergLogger = createLogger({ name: 'iceberg', level: LogLevel.DEBUG })

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration options for Iceberg state persistence
 */
export interface IcebergOptions {
  /**
   * Enable automatic periodic checkpointing
   * @default false
   */
  autoCheckpoint?: boolean

  /**
   * Interval in milliseconds between automatic checkpoints
   * Only used when autoCheckpoint is enabled
   * @default 60000 (1 minute)
   */
  checkpointIntervalMs?: number

  /**
   * Minimum number of changes before a checkpoint will be created
   * Helps debounce saves to reduce R2 operations
   * @default 1
   */
  minChangesBeforeCheckpoint?: number
}

/**
 * Lifecycle events emitted by IcebergManager
 */
export type IcebergLifecycleEvent =
  | { type: 'stateLoaded'; fromSnapshot: boolean; snapshotId?: string }
  | { type: 'checkpointed'; snapshotId: string; sequence: number }
  | { type: 'checkpointFailed'; error: unknown }
  | { type: 'autoCheckpointStarted'; intervalMs: number; minChanges: number }
  | { type: 'autoCheckpointStopped' }
  | { type: 'fencingTokenAcquired'; token: string }
  | { type: 'fencingTokenReleased'; token: string }

/**
 * Callback for lifecycle events
 */
export type IcebergLifecycleCallback = (event: IcebergLifecycleEvent) => void

/**
 * Dependencies required by IcebergManager
 */
export interface IcebergManagerDeps {
  /** DurableObject context for storage access */
  ctx: DurableObjectState

  /** Environment bindings (for R2 access) */
  env: Record<string, unknown>

  /** Callback for lifecycle events */
  onLifecycleEvent?: IcebergLifecycleCallback

  /** Optional: get JWT from context */
  getJwt?: () => string | null
}

/**
 * R2 bucket interface for type safety
 */
interface R2BucketLike {
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>
    text(): Promise<string>
    json<T>(): Promise<T>
  } | null>
  put(key: string, data: ArrayBuffer | string): Promise<void>
}

// ============================================================================
// ICEBERG MANAGER CLASS
// ============================================================================

/**
 * IcebergManager - Manages R2-based state persistence for DOs
 *
 * This class encapsulates all Iceberg snapshot logic, allowing it to be
 * composed into DO classes rather than inherited.
 *
 * @example
 * ```typescript
 * class MyDO extends DOBase {
 *   private iceberg = new IcebergManager({
 *     ctx: this.ctx,
 *     env: this.env,
 *     onLifecycleEvent: (e) => this.emitLifecycleEvent(e.type, e),
 *   })
 *
 *   async onStart() {
 *     await this.iceberg.load()
 *     this.iceberg.configure({ autoCheckpoint: true })
 *   }
 * }
 * ```
 */
export class IcebergManager {
  private readonly deps: IcebergManagerDeps

  // State
  private _snapshotSequence: number = 0
  private _r2Client?: AuthorizedR2Client
  private _icebergAdapter?: IcebergStateAdapter
  private _pendingChanges: number = 0
  private _lastCheckpointTimestamp: number = 0
  private _checkpointTimer?: ReturnType<typeof setInterval>
  private _icebergOptions: IcebergOptions = {}
  private _fencingToken?: string

  constructor(deps: IcebergManagerDeps) {
    this.deps = deps
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC ACCESSORS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the current count of pending (unsaved) changes.
   */
  get pendingChanges(): number {
    return this._pendingChanges
  }

  /**
   * Get the timestamp of the last successful checkpoint.
   * Returns 0 if no checkpoint has been created yet.
   */
  get lastCheckpointTimestamp(): number {
    return this._lastCheckpointTimestamp
  }

  /**
   * Check if this instance currently holds a fencing token.
   */
  get hasFencingToken(): boolean {
    return this._fencingToken !== undefined
  }

  /**
   * Get the current fencing token if held.
   */
  get currentFencingToken(): string | undefined {
    return this._fencingToken
  }

  /**
   * Get the current snapshot sequence number.
   */
  get snapshotSequence(): number {
    return this._snapshotSequence
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Configure Iceberg state persistence options.
   *
   * @param options - Configuration options
   */
  configure(options: IcebergOptions): void {
    this._icebergOptions = { ...options }

    if (options.autoCheckpoint) {
      this.startAutoCheckpoint(options.checkpointIntervalMs ?? 60000)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD/SAVE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Load state from Iceberg snapshot on cold start.
   *
   * @param jwt - Optional JWT token (if not provided, will try to get from deps)
   */
  async load(jwt?: string): Promise<void> {
    const r2 = this.deps.env.R2 as R2BucketLike | undefined

    if (!r2) {
      icebergLogger.warn('No R2 bucket configured, starting with empty state')
      this.emitLifecycleEvent({ type: 'stateLoaded', fromSnapshot: false })
      return
    }

    const token = jwt ?? this.getJwt()

    // Build prefix for snapshot path
    let prefix: string
    if (token) {
      const claims = this.decodeJwtClaims(token)
      const orgId = claims.org_id as string
      const tenantId = (claims.tenant_id as string) ?? orgId
      prefix = `orgs/${orgId}/tenants/${tenantId}/do/${this.deps.ctx.id.toString()}/snapshots/`
    } else {
      icebergLogger.warn('No JWT available, using default snapshot path')
      prefix = `do/${this.deps.ctx.id.toString()}/snapshots/`
    }

    // List snapshots
    const result = await r2.list({ prefix })
    const snapshots = result.objects.map((obj) => obj.key)

    if (snapshots.length === 0) {
      this.emitLifecycleEvent({ type: 'stateLoaded', fromSnapshot: false })
      return
    }

    // Sort by sequence number (embedded in filename as seq-N)
    snapshots.sort((a, b) => {
      const seqA = parseInt(a.match(/seq-(\d+)/)?.[1] ?? '0')
      const seqB = parseInt(b.match(/seq-(\d+)/)?.[1] ?? '0')
      return seqB - seqA // Descending order (latest first)
    })

    const snapshotPath = snapshots[0]
    if (!snapshotPath) {
      this.emitLifecycleEvent({ type: 'stateLoaded', fromSnapshot: false })
      return
    }

    // Load snapshot data
    const snapshotData = await r2.get(snapshotPath)
    if (!snapshotData) {
      this.emitLifecycleEvent({ type: 'stateLoaded', fromSnapshot: false })
      return
    }

    // Parse snapshot
    const snapshotBuffer = await snapshotData.arrayBuffer()
    const snapshotText = new TextDecoder().decode(snapshotBuffer)
    const snapshot = JSON.parse(snapshotText)

    // Restore if valid snapshot
    const sqlInterface = this.getSqlInterface()
    if (sqlInterface && this.isValidSnapshot(snapshot)) {
      this._icebergAdapter = new IcebergStateAdapter(sqlInterface)
      await this._icebergAdapter.restoreFromSnapshot(snapshot)
    }

    this.emitLifecycleEvent({ type: 'stateLoaded', fromSnapshot: true, snapshotId: snapshotPath })
  }

  /**
   * Save current state to Iceberg snapshot on R2.
   *
   * @throws Error if no JWT is available or R2 operations fail
   */
  async save(): Promise<void> {
    const jwt = this.getJwt()
    if (!jwt) {
      throw new Error('No JWT available for storage')
    }

    const r2 = this.deps.env.R2 as R2BucketLike | undefined
    if (!r2) {
      throw new Error('No R2 bucket configured')
    }

    // Initialize R2 client if needed
    if (!this._r2Client) {
      const claims = this.decodeJwtClaims(jwt)
      const r2Claims = {
        orgId: claims.org_id as string,
        tenantId: (claims.tenant_id as string) ?? (claims.org_id as string),
        bucket: 'default',
        pathPrefix: '',
      }
      this._r2Client = new AuthorizedR2Client(r2Claims, r2 as unknown as R2Bucket)
    }

    // Initialize adapter if needed
    if (!this._icebergAdapter) {
      const sqlInterface = this.getSqlInterface()
      if (!sqlInterface) {
        throw new Error('SQL storage not available')
      }
      this._icebergAdapter = new IcebergStateAdapter(sqlInterface)
    }

    // Create snapshot
    this._snapshotSequence++
    const snapshot = await this._icebergAdapter.createSnapshot()
    const snapshotId = `seq-${this._snapshotSequence}-${snapshot.id}`
    const doId = this.deps.ctx.id.toString()

    // Write data files
    for (const [table, data] of Object.entries(snapshot.tables)) {
      await this._r2Client.putSnapshot(doId, snapshotId, `data/${table}.parquet`, data)
    }

    // Write manifests
    for (const manifest of snapshot.manifests) {
      await this._r2Client.putSnapshot(
        doId,
        snapshotId,
        `manifests/${manifest.manifest_path}`,
        JSON.stringify(manifest)
      )
    }

    // Write metadata.json
    const metadataWithTimestamp = {
      ...snapshot.metadata,
      snapshots: snapshot.metadata.snapshots.map((s: { snapshot_id: number; manifest_list: string }) => ({
        ...s,
        'timestamp-ms': Date.now(),
      })),
    }
    await this._r2Client.putSnapshot(doId, snapshotId, 'metadata.json', JSON.stringify(metadataWithTimestamp))

    // Update latest pointer
    await this._r2Client.putSnapshot(doId, 'snapshots', 'latest', snapshotId)

    // Emit event and reset state
    this.emitLifecycleEvent({ type: 'checkpointed', snapshotId, sequence: this._snapshotSequence })
    this._pendingChanges = 0
    this._lastCheckpointTimestamp = Date.now()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-CHECKPOINT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start automatic periodic checkpointing.
   */
  private startAutoCheckpoint(intervalMs: number): void {
    this.stopAutoCheckpoint()

    const minChanges = this._icebergOptions.minChangesBeforeCheckpoint ?? 1

    this._checkpointTimer = setInterval(async () => {
      if (this._pendingChanges >= minChanges) {
        try {
          await this.save()
        } catch (error) {
          logBestEffortError(error, {
            operation: 'autoCheckpoint',
            source: 'IcebergManager.startAutoCheckpoint',
            context: { pendingChanges: this._pendingChanges },
          })
          this.emitLifecycleEvent({ type: 'checkpointFailed', error })
        }
      }
    }, intervalMs)

    this.emitLifecycleEvent({ type: 'autoCheckpointStarted', intervalMs, minChanges })
  }

  /**
   * Stop automatic checkpointing.
   */
  stopAutoCheckpoint(): void {
    if (this._checkpointTimer) {
      clearInterval(this._checkpointTimer)
      this._checkpointTimer = undefined
      this.emitLifecycleEvent({ type: 'autoCheckpointStopped' })
    }
  }

  /**
   * Track data changes for smart checkpointing.
   */
  trackChange(): void {
    this._pendingChanges++
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FENCING TOKENS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Acquire a fencing token for single-writer semantics.
   *
   * @returns The fencing token if acquired successfully
   * @throws Error if lock already held or R2 operation fails
   */
  async acquireFencingToken(): Promise<string> {
    const jwt = this.getJwt()
    if (!jwt) {
      throw new Error('No JWT available for storage')
    }

    const r2 = this.deps.env.R2 as R2Bucket | undefined
    if (!r2) {
      throw new Error('No R2 bucket configured')
    }

    // Initialize R2 client if needed
    if (!this._r2Client) {
      const claims = this.decodeJwtClaims(jwt)
      const r2Claims = {
        orgId: claims.org_id as string,
        tenantId: (claims.tenant_id as string) ?? (claims.org_id as string),
        bucket: 'default',
        pathPrefix: '',
      }
      this._r2Client = new AuthorizedR2Client(r2Claims, r2)
    }

    const token = crypto.randomUUID()
    const doId = this.deps.ctx.id.toString()

    // Try to acquire lock with conditional write
    await this._r2Client.putWithCondition(
      doId,
      'lock',
      JSON.stringify({
        token,
        acquiredAt: Date.now(),
        acquiredBy: doId,
      }),
      { onlyIfNotExists: true }
    )

    this._fencingToken = token
    this.emitLifecycleEvent({ type: 'fencingTokenAcquired', token })

    return token
  }

  /**
   * Release a previously acquired fencing token.
   *
   * @param token - The fencing token to release
   * @throws Error if token doesn't match or R2 operation fails
   */
  async releaseFencingToken(token: string): Promise<void> {
    if (!this._r2Client) {
      throw new Error('R2 client not initialized - was fencing token acquired?')
    }

    if (this._fencingToken !== token) {
      throw new Error('Fencing token mismatch - cannot release lock held by another instance')
    }

    const doId = this.deps.ctx.id.toString()

    // Verify we own the lock
    const currentLock = await this._r2Client.get(doId, 'lock')
    if (currentLock) {
      const lockData = await currentLock.json<{ token: string }>()
      if (lockData.token !== token) {
        throw new Error('Lock stolen by another instance')
      }
    }

    // Delete the lock
    await this._r2Client.delete(doId, 'lock')

    this._fencingToken = undefined
    this.emitLifecycleEvent({ type: 'fencingTokenReleased', token })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get JWT from deps or context
   */
  private getJwt(): string | null {
    if (this.deps.getJwt) {
      return this.deps.getJwt()
    }
    return (
      (this.deps.ctx as { jwt?: string })?.jwt ??
      (this.deps.env as { JWT?: string })?.JWT ??
      null
    )
  }

  /**
   * Decode JWT payload without verification
   */
  private decodeJwtClaims(jwt: string): Record<string, unknown> {
    const parts = jwt.split('.')
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format')
    }
    try {
      const payload = parts[1]
      if (!payload) {
        throw new Error('Missing JWT payload')
      }
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
      const decoded = atob(padded)
      return JSON.parse(decoded)
    } catch {
      throw new Error('Failed to decode JWT payload')
    }
  }

  /**
   * Get SQL interface from context storage
   */
  private getSqlInterface(): { exec(query: string, ...params: unknown[]): { toArray(): unknown[] } } | undefined {
    return (this.deps.ctx.storage as { sql?: { exec(query: string, ...params: unknown[]): { toArray(): unknown[] } } }).sql
  }

  /**
   * Check if a parsed snapshot is a valid IcebergSnapshot
   */
  private isValidSnapshot(snapshot: unknown): snapshot is IcebergSnapshot {
    if (!snapshot || typeof snapshot !== 'object') return false
    const s = snapshot as Record<string, unknown>
    return (
      typeof s.checksum === 'string' &&
      typeof s.schemaVersion === 'number' &&
      typeof s.tables === 'object' &&
      s.tables !== null
    )
  }

  /**
   * Emit lifecycle event
   */
  private emitLifecycleEvent(event: IcebergLifecycleEvent): void {
    this.deps.onLifecycleEvent?.(event)
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an IcebergManager instance
 */
export function createIcebergManager(deps: IcebergManagerDeps): IcebergManager {
  return new IcebergManager(deps)
}
