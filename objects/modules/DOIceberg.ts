/**
 * DOIceberg Module - R2 state persistence
 *
 * This module extracts Iceberg-related functionality from DOBase:
 * - loadFromIceberg() - restore state from R2 snapshot
 * - saveToIceberg() - persist state to R2 snapshot
 * - Auto-checkpoint configuration and management
 * - Fencing token for single-writer semantics
 * - Lifecycle event emission
 *
 * @module DOIceberg
 */

import { IcebergStateAdapter } from '../persistence/iceberg-state'
import { AuthorizedR2Client, type R2Bucket } from '../../lib/storage/authorized-r2'

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
 * Context required for Iceberg operations
 */
export interface IcebergContext {
  /** DO id accessor */
  getDoId(): string
  /** JWT token accessor */
  getJwt(): string | null
  /** R2 bucket from env */
  getR2(): R2Bucket | undefined
  /** SQL interface from storage */
  getSqlInterface(): { exec(query: string, ...params: unknown[]): { toArray(): unknown[] } } | undefined
  /** Lifecycle event emitter */
  emitLifecycleEvent(event: string, data: unknown): void
}

/**
 * DOIceberg - Manages R2 state persistence with Iceberg format
 */
export class DOIceberg {
  private _snapshotSequence: number = 0
  private _r2Client?: AuthorizedR2Client
  private _icebergAdapter?: IcebergStateAdapter
  private _pendingChanges: number = 0
  private _lastCheckpointTimestamp: number = 0
  private _checkpointTimer?: ReturnType<typeof setInterval>
  private _icebergOptions: IcebergOptions = {}
  private _fencingToken?: string

  private readonly _context: IcebergContext

  constructor(context: IcebergContext) {
    this._context = context
  }

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
   * Load state from Iceberg snapshot on cold start.
   * Uses JWT claims to determine R2 path.
   * @param jwt - Optional JWT token (if not provided, will try to get from context)
   */
  async loadFromIceberg(jwt?: string): Promise<void> {
    const r2 = this._context.getR2()

    if (!r2) {
      console.warn('No R2 bucket configured, starting with empty state')
      this._context.emitLifecycleEvent('stateLoaded', { fromSnapshot: false })
      return
    }

    const token = jwt ?? this._context.getJwt()

    // Build prefix for snapshot path
    let prefix: string
    if (token) {
      // Extract storage claims from JWT
      const claims = this.decodeJwtClaims(token)
      const orgId = claims.org_id as string
      const tenantId = (claims.tenant_id as string) ?? orgId
      prefix = `orgs/${orgId}/tenants/${tenantId}/do/${this._context.getDoId()}/snapshots/`
    } else {
      // Fallback: use DO id only (for tests without JWT)
      console.warn('No JWT available, using default snapshot path')
      prefix = `do/${this._context.getDoId()}/snapshots/`
    }

    // List snapshots - propagate R2 errors directly
    const result = await (r2 as unknown as {
      list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>
    }).list({ prefix })
    const snapshots = result.objects.map((obj) => obj.key)

    if (snapshots.length === 0) {
      this._context.emitLifecycleEvent('stateLoaded', { fromSnapshot: false })
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
      this._context.emitLifecycleEvent('stateLoaded', { fromSnapshot: false })
      return
    }

    // Load snapshot data
    const snapshotData = await (r2 as unknown as {
      get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>
    }).get(snapshotPath)
    if (!snapshotData) {
      this._context.emitLifecycleEvent('stateLoaded', { fromSnapshot: false })
      return
    }

    // Parse snapshot
    const snapshotBuffer = await snapshotData.arrayBuffer()
    const snapshotText = new TextDecoder().decode(snapshotBuffer)
    const snapshot = JSON.parse(snapshotText)

    // Only attempt restore if we have a proper IcebergSnapshot
    const sqlInterface = this._context.getSqlInterface()
    if (sqlInterface && this.isValidIcebergSnapshot(snapshot)) {
      this._icebergAdapter = new IcebergStateAdapter(sqlInterface)
      await this._icebergAdapter.restoreFromSnapshot(snapshot)
    }

    this._context.emitLifecycleEvent('stateLoaded', { fromSnapshot: true, snapshotId: snapshotPath })
  }

  /**
   * Save current state to Iceberg snapshot on R2.
   * Creates metadata, manifests, and Parquet data files.
   *
   * @throws Error if no JWT is available for storage authorization
   * @throws Error if R2 operations fail
   */
  async saveToIceberg(): Promise<void> {
    const jwt = this._context.getJwt()
    if (!jwt) {
      throw new Error('No JWT available for storage')
    }

    const r2 = this._context.getR2()
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

    // Initialize Iceberg adapter if needed
    if (!this._icebergAdapter) {
      const sqlInterface = this._context.getSqlInterface()
      if (!sqlInterface) {
        throw new Error('SQL storage not available')
      }
      this._icebergAdapter = new IcebergStateAdapter(sqlInterface)
    }

    // Create snapshot
    this._snapshotSequence++
    const snapshot = await this._icebergAdapter.createSnapshot()
    const snapshotId = `seq-${this._snapshotSequence}-${snapshot.id}`
    const doId = this._context.getDoId()

    // Write data files (Parquet)
    for (const [table, data] of Object.entries(snapshot.tables)) {
      await this._r2Client.putSnapshot(
        doId,
        snapshotId,
        `data/${table}.parquet`,
        data
      )
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

    // Write metadata.json with Iceberg format
    const metadataWithTimestamp = {
      ...snapshot.metadata,
      snapshots: snapshot.metadata.snapshots.map((s: { snapshot_id: number; manifest_list: string }) => ({
        ...s,
        'timestamp-ms': Date.now(),
      })),
    }
    await this._r2Client.putSnapshot(
      doId,
      snapshotId,
      'metadata.json',
      JSON.stringify(metadataWithTimestamp)
    )

    // Update latest pointer
    await this._r2Client.putSnapshot(
      doId,
      'snapshots',
      'latest',
      snapshotId
    )

    // Emit lifecycle event
    this._context.emitLifecycleEvent('checkpointed', { snapshotId, sequence: this._snapshotSequence })

    // Reset pending changes counter and update timestamp
    this._pendingChanges = 0
    this._lastCheckpointTimestamp = Date.now()
  }

  /**
   * Configure Iceberg state persistence options.
   * Enables auto-checkpoint, debounced saves, and consistency guards.
   */
  configure(options: IcebergOptions): void {
    this._icebergOptions = { ...options }

    // Start auto-checkpoint if enabled
    if (options.autoCheckpoint) {
      this.startAutoCheckpoint(options.checkpointIntervalMs ?? 60000)
    }
  }

  /**
   * Start automatic periodic checkpointing.
   */
  private startAutoCheckpoint(intervalMs: number): void {
    this.stopAutoCheckpoint()

    const minChanges = this._icebergOptions.minChangesBeforeCheckpoint ?? 1

    this._checkpointTimer = setInterval(async () => {
      if (this._pendingChanges >= minChanges) {
        try {
          await this.saveToIceberg()
        } catch (error) {
          console.error('Auto-checkpoint failed:', error)
          this._context.emitLifecycleEvent('checkpointFailed', { error })
        }
      }
    }, intervalMs)

    this._context.emitLifecycleEvent('autoCheckpointStarted', { intervalMs, minChanges })
  }

  /**
   * Stop automatic checkpointing.
   */
  stopAutoCheckpoint(): void {
    if (this._checkpointTimer) {
      clearInterval(this._checkpointTimer)
      this._checkpointTimer = undefined
      this._context.emitLifecycleEvent('autoCheckpointStopped', {})
    }
  }

  /**
   * Track data changes for smart checkpointing.
   */
  onDataChange(): void {
    this._pendingChanges++
  }

  /**
   * Acquire a fencing token for single-writer semantics.
   */
  async acquireFencingToken(): Promise<string> {
    const jwt = this._context.getJwt()
    if (!jwt) {
      throw new Error('No JWT available for storage')
    }

    const r2 = this._context.getR2()
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
    const doId = this._context.getDoId()

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
    this._context.emitLifecycleEvent('fencingTokenAcquired', { token })

    return token
  }

  /**
   * Release a previously acquired fencing token.
   */
  async releaseFencingToken(token: string): Promise<void> {
    if (!this._r2Client) {
      throw new Error('R2 client not initialized - was fencing token acquired?')
    }

    if (this._fencingToken !== token) {
      throw new Error('Fencing token mismatch - cannot release lock held by another instance')
    }

    const doId = this._context.getDoId()

    // Read current lock to verify we own it
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
    this._context.emitLifecycleEvent('fencingTokenReleased', { token })
  }

  /**
   * Check if a parsed snapshot object is a valid IcebergSnapshot.
   */
  private isValidIcebergSnapshot(snapshot: unknown): boolean {
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
   * Decode JWT payload without signature verification.
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
}
