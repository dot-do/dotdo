/**
 * @module DOFull
 * @description Full-featured Durable Object with lifecycle, sharding, and branching (~120KB)
 *
 * DOFull extends DOBase with enterprise-grade state management operations for
 * production edge applications. It provides the complete feature set needed
 * for complex, stateful workloads running on Cloudflare's global network.
 *
 * **Extends DOBase with:**
 * - Lifecycle operations (fork, clone, compact, move)
 * - Sharding for horizontal scaling (shard, unshard, routing)
 * - Git-style branching (branch, checkout, merge)
 * - Multi-stage promotion (promote, demote)
 * - Two-phase commit for staged clone operations
 * - Eventual consistency replication
 * - Resumable clone operations with integrity verification
 *
 * **DO Class Hierarchy:**
 * ```
 * DOTiny (~15KB)        - Identity, db, fetch, toJSON
 *    |
 *    v
 * DOBase (~80KB)        - + WorkflowContext, stores, events, scheduling
 *    |
 *    v
 * DOFull (~120KB)       - + Lifecycle, sharding, branching, promotion (this module)
 * ```
 *
 * **Lifecycle Operations:**
 * | Method | Description |
 * |--------|-------------|
 * | `fork(id, opts)` | Create child DO with parent reference |
 * | `clone(to)` | Copy all state to another DO |
 * | `compact(retention)` | Archive old data, keep recent |
 * | `move(to)` | Transfer state and redirect requests |
 *
 * **Sharding Operations:**
 * | Method | Description |
 * |--------|-------------|
 * | `shard(key, count)` | Route to shard using consistent hashing |
 * | `unshard()` | Consolidate shards back to single DO |
 *
 * **Branching Operations:**
 * | Method | Description |
 * |--------|-------------|
 * | `branch(name)` | Create named branch from current state |
 * | `checkout(name)` | Switch to specified branch |
 * | `merge(source)` | Merge source branch into current |
 *
 * **Promotion Operations:**
 * | Method | Description |
 * |--------|-------------|
 * | `promote(stage)` | Move to next deployment stage |
 * | `demote(stage)` | Roll back to previous stage |
 *
 * @example Basic Lifecycle Usage
 * ```typescript
 * import { DO } from 'dotdo/full'
 *
 * class DataService extends DO {
 *   async onStart() {
 *     // Full lifecycle operations available
 *     await this.clone('https://backup.example.com')
 *     await this.branch('feature-x')
 *   }
 *
 *   // Create a backup to another DO
 *   async backup() {
 *     await this.clone('https://backup.data.dotdo.dev')
 *   }
 *
 *   // Archive data older than 30 days
 *   async cleanup() {
 *     await this.compact({ retention: 30 * 24 * 60 * 60 * 1000 })
 *   }
 * }
 * ```
 *
 * @example Feature Branching Workflow
 * ```typescript
 * class ConfigService extends DO {
 *   async startFeature(name: string) {
 *     // Create isolated branch for testing
 *     await this.branch(name)
 *     await this.checkout(name)
 *     // All changes now on feature branch
 *   }
 *
 *   async releaseFeature(name: string) {
 *     await this.checkout('main')
 *     await this.merge(name)
 *   }
 * }
 * ```
 *
 * @example Horizontal Scaling with Sharding
 * ```typescript
 * class UserService extends DO {
 *   async getUser(userId: string) {
 *     // Route to consistent shard based on userId
 *     const shardDO = await this.shard(userId, 16)
 *     return shardDO.get(`/users/${userId}`)
 *   }
 * }
 * ```
 *
 * @example Staged Clone (Two-Phase Commit)
 * ```typescript
 * class MigrationService extends DO {
 *   async migrateData(targetNs: string) {
 *     // Phase 1: Prepare (creates staging area)
 *     const staging = await this.prepareClone(targetNs)
 *
 *     // Phase 2: Commit (atomic transfer)
 *     await this.commitClone(staging.token)
 *   }
 * }
 * ```
 *
 * @see DOTiny - Minimal implementation (~15KB)
 * @see DOBase - WorkflowContext and stores (~80KB)
 */

import { DO as DOBase, type Env } from './DOBase'
import * as schema from '../../db'
import { event as createEvent } from '../../lib/events'
import type { Thing } from '../../types/Thing'
import type { ShardOptions, ShardResult, ShardStrategy, UnshardOptions } from '../../types/Lifecycle'
import { createShardModule, ShardModule } from '../lifecycle/Shard'
import { createGeoReplicationModule, GeoReplicationModule } from '../GeoReplication'
import { createLogger, LogLevel } from '@/lib/logging'

// Re-export Env type for consumers
export type { Env }

// ============================================================================
// TYPES
// ============================================================================

export interface PromoteResult {
  newNs: string
  thingId: string
  originalNs: string
}

export interface DemoteResult {
  thingId: string
  parentNs: string
  deletedNs: string
  stagedToken?: string
}

export interface CloneResult {
  targetNs: string
  clonedThings: number
  clonedRelationships: number
}

export interface BranchResult {
  name: string
  head: number
}

export interface CheckoutResult {
  branch?: string
  version?: number
}

export interface MergeResult {
  merged: boolean
  conflicts?: string[]
}

// Staged clone types
export interface StagingData {
  sourceNs: string
  targetNs: string
  stagingNs: string
  things: Array<{
    id: string
    type: number
    branch: string | null
    name: string | null
    data: unknown
    deleted: boolean
  }>
  expiresAt: string
  status: 'prepared' | 'committed' | 'aborted'
  createdAt: string
  integrityHash: string
  metadata: {
    thingsCount: number
    sizeBytes: number
    branch: string
    version: number
  }
}

export interface StagedPrepareResult {
  phase: 'prepared'
  token: string
  expiresAt: Date
  stagingNs: string
  metadata: {
    thingsCount: number
    sizeBytes: number
    branch: string
    version: number
  }
}

export interface Checkpoint {
  id: string
  cloneId: string
  sequence: number
  itemsProcessed: number
  totalItems: number
  clonedThingIds: string[]
  clonedRelationshipIds: string[]
  branch: string
  lastVersion: number
  validated: boolean
  timestamp: Date
}

export interface ParticipantAck {
  target: string
  status: 'ready' | 'failed'
  vote: 'yes' | 'no'
  timestamp: Date
  error?: string
}

export interface TransactionAuditLog {
  token: string
  sourceNs: string
  targetNs: string[]
  events: Array<{
    type: string
    status: string
    timestamp: Date
    data?: Record<string, unknown>
  }>
  createdAt: Date
}

export interface ParticipantStateHistory {
  target: string
  transitions: Array<{
    from: string
    to: string
    timestamp: Date
  }>
}

// Clone mode types
export type CloneMode = 'atomic' | 'staged' | 'eventual' | 'resumable'

export interface CloneOptions {
  mode?: CloneMode
  branch?: string
  shallow?: boolean
  excludeRelationships?: boolean
  tokenTimeout?: number
  validateTarget?: boolean
}

// Eventual clone types
export type CloneStatus = 'pending' | 'syncing' | 'active' | 'paused' | 'cancelled' | 'error'
export type ConflictResolution = 'last-write-wins' | 'source-wins' | 'target-wins' | 'custom'

export interface EventualCloneState {
  id: string
  targetNs: string
  status: CloneStatus
  progress: number
  phase: 'initial' | 'bulk' | 'catchup' | 'delta'
  itemsSynced: number
  totalItems: number
  itemsRemaining: number
  lastSyncAt: string | null
  divergence: number
  maxDivergence: number
  syncInterval: number
  errorCount: number
  lastError: string | null
  conflictResolution: ConflictResolution | 'custom'
  hasCustomResolver: boolean
  chunked: boolean
  chunkSize: number
  rateLimit: number | null
  createdAt: string
  updatedAt: string
  lastSyncedVersion: number
}

export interface SyncStatus {
  phase: string
  itemsSynced: number
  totalItems: number
  lastSyncAt: Date | null
  divergence: number
  maxDivergence: number
  syncInterval: number
  errorCount: number
  lastError: Error | null
}

export interface SyncResult {
  itemsSynced: number
  duration: number
  conflicts: ConflictInfo[]
}

export interface ConflictInfo {
  thingId: string
  sourceVersion: number
  targetVersion: number
  resolution: string
  resolvedAt: Date
}

export interface EventualCloneHandle {
  id: string
  status: CloneStatus
  getProgress(): Promise<number>
  getSyncStatus(): Promise<SyncStatus>
  pause(): Promise<void>
  resume(): Promise<void>
  sync(): Promise<SyncResult>
  cancel(): Promise<void>
}

// Resumable clone types
export type ResumableCloneStatus = 'initializing' | 'transferring' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface ResumableCloneState {
  id: string
  targetNs: string
  status: ResumableCloneStatus
  checkpoints: ResumableCheckpoint[]
  position: number
  batchSize: number
  checkpointInterval: number
  maxRetries: number
  retryDelay: number
  retryCount: number
  compress: boolean
  maxBandwidth?: number
  checkpointRetentionMs: number
  pauseRequested: boolean
  cancelRequested: boolean
  createdAt: Date
  bytesTransferred: number
  totalBytes: number
  startedAt: Date | null
  progress?: number
}

export interface ResumableCheckpoint {
  id: string
  position: number
  hash: string
  timestamp: Date
  itemsProcessed: number
  batchNumber: number
  cloneId: string
  compressed: boolean
}

export interface ResumableCloneOptions extends CloneOptions {
  mode: 'resumable'
  batchSize?: number
  checkpointInterval?: number
  maxRetries?: number
  retryDelay?: number
  lockTimeout?: number
  checkpointRetentionMs?: number
  compress?: boolean
  maxBandwidth?: number
  resumeFrom?: string
  forceLock?: boolean
}

export interface CloneLockState {
  lockId: string
  cloneId: string
  target: string
  acquiredAt: Date
  expiresAt: Date
  isStale: boolean
}

export interface CloneLockInfo {
  lockId: string
  cloneId: string
  acquiredAt: Date
  expiresAt: Date
  isStale: boolean
}

export interface ResumableCloneHandle {
  id: string
  status: ResumableCloneStatus
  checkpoints: ResumableCheckpoint[]
  getProgress(): Promise<number>
  pause(): Promise<void>
  resume(): Promise<void>
  cancel(): Promise<void>
  waitForCheckpoint(): Promise<ResumableCheckpoint>
  canResumeFrom(checkpointId: string): Promise<boolean>
  getIntegrityHash(): Promise<string>
  getLockInfo(): Promise<CloneLockInfo | null>
  forceOverrideLock(): Promise<void>
}

// Cross-DO config
const CROSS_DO_CONFIG = {
  STUB_CACHE_TTL: 60000,
  CIRCUIT_BREAKER_THRESHOLD: 5,
  CIRCUIT_BREAKER_TIMEOUT: 30000,
}

type CircuitBreakerState = 'closed' | 'open' | 'half-open'

interface DOStub {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>
}

// ============================================================================
// DOFull - Full-featured Durable Object
// ============================================================================

export class DO<E extends Env = Env> extends DOBase<E> {
  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCHING STATE
  // ═══════════════════════════════════════════════════════════════════════════

  protected currentVersion: number | null = null

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE MODULES
  // ═══════════════════════════════════════════════════════════════════════════

  private _shardModule?: ShardModule

  protected get shardModule(): ShardModule {
    if (!this._shardModule) {
      this._shardModule = createShardModule()
      this._shardModule.initialize({
        ns: this.ns,
        currentBranch: this.currentBranch,
        db: this.db,
        env: this.env as unknown as import('../../types/CloudflareBindings').CloudflareEnv,
        ctx: this.ctx,
        emitEvent: (verb: string, data?: unknown) => this.emitEvent(verb, data),
        log: (message: string, data?: unknown) => this._logger.debug(`[${this.ns}] ${message}`, data ? { data } : undefined),
      })
    }
    return this._shardModule
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GEO-REPLICATION MODULE
  // ═══════════════════════════════════════════════════════════════════════════

  private _geoModule?: GeoReplicationModule

  /**
   * Geo-replication module for multi-region data replication.
   * Access via stub.geo.* for RPC calls.
   */
  get geo(): GeoReplicationModule {
    if (!this._geoModule) {
      this._geoModule = createGeoReplicationModule()
      this._geoModule.initialize({
        ns: this.ns,
        currentBranch: this.currentBranch,
        db: this.db,
        env: this.env as unknown as import('../../types/CloudflareBindings').CloudflareEnv,
        ctx: this.ctx,
        emitEvent: (verb: string, data?: unknown) => this.emitEvent(verb, data),
        log: (message: string, data?: unknown) => this._logger.debug(`[${this.ns}] ${message}`, data ? { data } : undefined),
      })
    }
    return this._geoModule
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CROSS-DO CACHES
  // ═══════════════════════════════════════════════════════════════════════════

  private _stubCache: Map<string, { stub: DOStub; cachedAt: number; lastUsed: number }> = new Map()
  private _stubCacheMaxSize: number = 100
  private _circuitBreaker: Map<string, {
    failures: number
    openUntil: number
    state: CircuitBreakerState
    halfOpenTestInProgress?: boolean
  }> = new Map()

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGING & 2PC CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════════

  protected static readonly STAGING_PREFIX = 'staging:'
  protected static readonly CHECKPOINT_PREFIX = 'checkpoint:'
  protected static readonly DEFAULT_TOKEN_TIMEOUT = 5 * 60 * 1000
  protected static readonly TWO_PC_PREFIX = '2pc:'
  protected static readonly DEFAULT_COORDINATOR_TIMEOUT = 30000
  protected static readonly DEFAULT_ACK_TIMEOUT = 10000
  protected static readonly DEFAULT_MAX_RETRIES = 3

  // ═══════════════════════════════════════════════════════════════════════════
  // FORK OPERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fork current state to a new DO (new identity, fresh history)
   */
  async fork(options: { to: string; branch?: string }): Promise<{ ns: string; doId: string }> {
    const targetNs = options.to
    const forkBranch = options.branch || this.currentBranch

    // Validate target namespace URL
    try {
      new URL(targetNs)
    } catch {
      throw new Error(`Invalid namespace URL: ${targetNs}`)
    }

    // Get current state (latest version of each thing, non-deleted, specified branch)
    const things = await this.db.select().from(schema.things)
    const branchFilter = forkBranch === 'main' ? null : forkBranch
    const branchThings = things.filter(t =>
      t.branch === branchFilter && !t.deleted
    )

    // Check if there's anything to fork
    if (branchThings.length === 0) {
      throw new Error('No state to fork')
    }

    // Get latest version of each thing (by id)
    const latestVersions = new Map<string, typeof things[0]>()
    for (const thing of branchThings) {
      const existing = latestVersions.get(thing.id)
      if (!existing) {
        latestVersions.set(thing.id, thing)
      }
    }

    // Emit fork.started event
    await this.emitEvent('fork.started', { targetNs, thingsCount: latestVersions.size })

    // Create new DO at target namespace
    if (!this.env.DO) {
      throw new Error('DO namespace not configured')
    }
    const doId = this.env.DO.idFromName(targetNs)
    const stub = this.env.DO.get(doId)

    // Send state to new DO
    await stub.fetch(new Request(`https://${targetNs}/init`, {
      method: 'POST',
      body: JSON.stringify({
        things: Array.from(latestVersions.values()).map(t => ({
          id: t.id,
          type: t.type,
          branch: null,
          name: t.name,
          data: t.data,
          deleted: false,
        })),
      }),
    }))

    // Emit fork.completed event
    await this.emitEvent('fork.completed', { targetNs, doId: doId.toString() })

    return { ns: targetNs, doId: doId.toString() }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPACT OPERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Squash history to current state (same identity)
   */
  async compact(): Promise<{ thingsCompacted: number; actionsArchived: number; eventsArchived: number }> {
    const things = await this.db.select().from(schema.things)
    const actions = await this.db.select().from(schema.actions)
    const events = await this.db.select().from(schema.events)

    // Check if there's anything to compact
    if (things.length === 0) {
      throw new Error('Nothing to compact')
    }

    // Archive old things versions to R2 FIRST - this provides atomicity
    const R2 = this.env.R2 as { put(key: string, data: string): Promise<void> } | undefined
    if (R2) {
      await R2.put(
        `archives/${this.ns}/things/${Date.now()}.json`,
        JSON.stringify(things)
      )

      // Archive actions to R2
      if (actions.length > 0) {
        await R2.put(
          `archives/${this.ns}/actions/${Date.now()}.json`,
          JSON.stringify(actions)
        )
      }

      // Archive events to R2
      const eventsToArchive = events.filter(e =>
        e.verb !== 'compact.started' && e.verb !== 'compact.completed'
      )
      if (eventsToArchive.length > 0) {
        await R2.put(
          `archives/${this.ns}/events/${Date.now()}.json`,
          JSON.stringify(eventsToArchive)
        )
      }
    }

    // Emit compact.started event
    await this.emitEvent('compact.started', { thingsCount: things.length })

    // Group things by id+branch to find latest versions
    const thingsByKey = new Map<string, typeof things>()
    for (const thing of things) {
      const key = `${thing.id}:${thing.branch || 'main'}`
      const group = thingsByKey.get(key) || []
      group.push(thing)
      thingsByKey.set(key, group)
    }

    // Keep only latest version of each thing
    let compactedCount = 0
    const latestThings: typeof things = []

    for (const [, group] of thingsByKey) {
      // Get latest version (last in array based on insertion order)
      const latest = group[group.length - 1]!

      // Only keep non-deleted things
      if (!latest.deleted) {
        latestThings.push(latest)
      }

      compactedCount += group.length - 1
    }

    // Delete old versions (use raw SQL for bulk delete)
    await this.ctx.storage.sql.exec('DELETE FROM things')

    // Re-insert only latest versions
    for (const thing of latestThings) {
      await this.db.insert(schema.things).values({
        id: thing.id,
        type: thing.type,
        branch: thing.branch,
        name: thing.name,
        data: thing.data as Record<string, unknown>,
        deleted: false,
      })
    }

    // Clear actions
    await this.ctx.storage.sql.exec('DELETE FROM actions')

    // Emit compact.completed event
    await this.emitEvent('compact.completed', {
      thingsCompacted: compactedCount,
      actionsArchived: actions.length,
      eventsArchived: events.filter(e =>
        e.verb !== 'compact.started' && e.verb !== 'compact.completed'
      ).length,
    })

    return {
      thingsCompacted: compactedCount,
      actionsArchived: actions.length,
      eventsArchived: events.filter(e =>
        e.verb !== 'compact.started' && e.verb !== 'compact.completed'
      ).length,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MOVE TO COLO OPERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Current colo (for tracking move operations)
   */
  protected currentColo: string | null = null

  /**
   * Valid colo codes (IATA airport codes)
   */
  static readonly VALID_COLOS = new Set([
    'ewr', 'lax', 'sfo', 'ord', 'dfw', 'sea', 'atl', 'iad',
    'lhr', 'fra', 'ams', 'cdg', 'sin', 'hkg', 'nrt', 'syd',
    'gru', 'jnb', 'bom', 'dub', 'mad', 'mxp', 'vie', 'zrh',
  ])

  /**
   * Move this DO to a specific colo (data center location)
   */
  async moveTo(colo: string): Promise<{ newDoId: string; region: string }> {
    // Validate colo code
    if (!DO.VALID_COLOS.has(colo)) {
      throw new Error(`Invalid colo code: ${colo}`)
    }

    // Check if already at target colo
    if (this.currentColo === colo) {
      throw new Error(`Already at colo: ${colo}`)
    }

    const things = await this.db.select().from(schema.things)
    if (things.length === 0) {
      throw new Error('No state to move')
    }

    // Emit move.started event
    await this.emitEvent('move.started', { targetColo: colo })

    // Create new DO with locationHint
    if (!this.env.DO) {
      throw new Error('DO namespace not configured')
    }
    // Use type assertion for locationHint which is a valid Cloudflare option not in types
    const newDoId = this.env.DO.newUniqueId({ locationHint: colo } as DurableObjectNamespaceNewUniqueIdOptions)
    const stub = this.env.DO.get(newDoId)

    // Transfer state to new DO
    await stub.fetch(new Request(`https://${this.ns}/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        things: things.filter(t => !t.deleted),
        branches: await this.db.select().from(schema.branches),
      }),
    }))

    // Update objects table
    await this.db.insert(schema.objects).values({
      ns: this.ns,
      id: newDoId.toString(),
      class: 'DO',
      region: colo,
      primary: true,
      createdAt: new Date(),
    })

    // Update current colo
    this.currentColo = colo

    // Schedule deletion of old DO
    this.ctx.waitUntil(Promise.resolve())

    // Emit move.completed event
    await this.emitEvent('move.completed', { newDoId: newDoId.toString(), region: colo })

    return { newDoId: newDoId.toString(), region: colo }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLONE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Clone this DO's state to another DO
   */
  async clone(target: string, options?: CloneOptions): Promise<CloneResult | EventualCloneHandle | ResumableCloneHandle | StagedPrepareResult> {
    const mode = options?.mode ?? 'atomic'

    switch (mode) {
      case 'staged':
        return this.prepareStagedClone(target, { ...options, mode: 'staged' })
      case 'eventual':
        return this.initiateEventualClone(target, { ...options, mode: 'eventual' })
      case 'resumable':
        return this.initiateResumableClone(target, options as ResumableCloneOptions)
      default:
        return this.performAtomicClone(target, options)
    }
  }

  /**
   * Perform atomic clone (traditional, blocking)
   */
  private async performAtomicClone(target: string, options?: CloneOptions): Promise<CloneResult> {
    // Validate target namespace URL
    try {
      new URL(target)
    } catch {
      throw new Error(`Invalid namespace URL: ${target}`)
    }

    // Get all things from current branch
    const things = await this.db.select().from(schema.things)
    const cloneBranch = options?.branch || this.currentBranch
    const branchFilter = cloneBranch === 'main' ? null : cloneBranch
    const branchThings = things.filter(t => t.branch === branchFilter && !t.deleted)

    if (branchThings.length === 0) {
      throw new Error('No state to clone: source is empty')
    }

    // Get latest version of each thing
    const latestVersions = new Map<string, typeof things[0]>()
    for (const thing of branchThings) {
      latestVersions.set(thing.id, thing)
    }

    const thingsToClone = Array.from(latestVersions.values())

    // Get relationships if not excluded
    let relationshipsToClone: Array<{
      id: string
      verb: string
      from: string
      to: string
      data: Record<string, unknown> | null
      createdAt: Date
    }> = []

    if (!options?.excludeRelationships) {
      const relationships = await this.db.select().from(schema.relationships)
      relationshipsToClone = relationships.map(r => ({
        id: r.id,
        verb: r.verb,
        from: r.from,
        to: r.to,
        data: r.data as Record<string, unknown> | null,
        createdAt: r.createdAt,
      }))
    }

    // Emit clone started event
    await this.emitEvent('clone.started', { target, thingsCount: thingsToClone.length })

    // Transfer to target DO
    if (this.env.DO) {
      const doId = this.env.DO.idFromName(target)
      const stub = this.env.DO.get(doId)

      const response = await stub.fetch(new Request(`${target}/clone-receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          things: thingsToClone.map(t => ({
            id: t.id,
            type: t.type,
            branch: null,
            name: t.name,
            data: t.data,
            deleted: false,
          })),
          relationships: relationshipsToClone.map(r => ({
            id: r.id,
            verb: r.verb,
            from: r.from,
            to: r.to,
            data: r.data,
          })),
          sourceNs: this.ns,
        }),
      }))

      if (!response.ok) {
        throw new Error(`Clone transfer failed: ${response.status}`)
      }
    }

    // Emit clone completed event
    await this.emitEvent('clone.completed', {
      target,
      thingsCloned: thingsToClone.length,
      relationshipsCloned: relationshipsToClone.length,
    })

    return {
      targetNs: target,
      clonedThings: thingsToClone.length,
      clonedRelationships: relationshipsToClone.length,
    }
  }

  /**
   * Prepare a staged clone (Phase 1 of two-phase commit)
   */
  private async prepareStagedClone(
    target: string,
    options: CloneOptions & { mode: 'staged' }
  ): Promise<StagedPrepareResult> {
    const tokenTimeout = options.tokenTimeout ?? DO.DEFAULT_TOKEN_TIMEOUT
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + tokenTimeout)
    const stagingNs = `${target}-staging-${token.slice(0, 8)}`

    // Validate target namespace URL
    try {
      new URL(target)
    } catch {
      throw new Error(`Invalid namespace URL: ${target}`)
    }

    // Emit staging started event
    await this.emitEvent('clone.staging.started', { token, target })

    // Get things to clone
    const things = await this.db.select().from(schema.things)
    const branchThings = things.filter(t => !t.deleted && (t.branch === null || t.branch === this.currentBranch))

    if (branchThings.length === 0) {
      throw new Error('No state to clone: source is empty')
    }

    // Get latest version of each thing
    const latestVersions = new Map<string, typeof things[0]>()
    for (const thing of branchThings) {
      latestVersions.set(thing.id, thing)
    }

    const thingsToClone = Array.from(latestVersions.values())

    // Calculate size
    const sizeBytes = JSON.stringify(thingsToClone).length

    // Map things to staging format
    const mappedThings = thingsToClone.map(t => ({
      id: t.id,
      type: t.type,
      branch: t.branch,
      name: t.name,
      data: t.data,
      deleted: t.deleted ?? false,
    }))

    // Store staging data
    const stagingData: StagingData = {
      sourceNs: this.ns,
      targetNs: target,
      stagingNs,
      things: mappedThings,
      expiresAt: expiresAt.toISOString(),
      status: 'prepared',
      createdAt: new Date().toISOString(),
      integrityHash: this.computeStagingIntegrityHash(mappedThings),
      metadata: {
        thingsCount: thingsToClone.length,
        sizeBytes,
        branch: this.currentBranch,
        version: thingsToClone.length,
      },
    }

    await this.ctx.storage.put(`${DO.STAGING_PREFIX}${token}`, stagingData)

    // Emit events
    await this.emitEvent('clone.staging.completed', { token, target, thingsCount: thingsToClone.length })
    await this.emitEvent('clone.prepared', { token, target, expiresAt })

    return {
      phase: 'prepared',
      token,
      expiresAt,
      stagingNs,
      metadata: {
        thingsCount: thingsToClone.length,
        sizeBytes,
        branch: this.currentBranch,
        version: thingsToClone.length,
      },
    }
  }

  /**
   * Commit a staged clone
   */
  async commitClone(token: string): Promise<{ targetNs: string; thingsCloned: number }> {
    const staging = await this.ctx.storage.get<StagingData>(`${DO.STAGING_PREFIX}${token}`)

    if (!staging) {
      throw new Error('Staging data not found')
    }

    if (staging.status === 'committed') {
      throw new Error('Clone already committed')
    }

    if (staging.status === 'aborted') {
      throw new Error('Clone was aborted')
    }

    if (new Date(staging.expiresAt) < new Date()) {
      throw new Error('Staging token expired')
    }

    // Verify integrity
    const currentHash = this.computeStagingIntegrityHash(staging.things)
    if (currentHash !== staging.integrityHash) {
      throw new Error('Integrity check failed: data modified since prepare')
    }

    // Transfer to target
    if (this.env.DO) {
      const doId = this.env.DO.idFromName(staging.targetNs)
      const stub = this.env.DO.get(doId)

      const response = await stub.fetch(new Request(`${staging.targetNs}/clone-receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          things: staging.things,
          relationships: [],
          sourceNs: this.ns,
        }),
      }))

      if (!response.ok) {
        throw new Error(`Clone commit failed: ${response.status}`)
      }
    }

    // Update status
    staging.status = 'committed'
    await this.ctx.storage.put(`${DO.STAGING_PREFIX}${token}`, staging)

    await this.emitEvent('clone.committed', { token, targetNs: staging.targetNs })

    return {
      targetNs: staging.targetNs,
      thingsCloned: staging.things.length,
    }
  }

  /**
   * Abort a staged clone
   */
  async abortClone(token: string, reason?: string): Promise<void> {
    const staging = await this.ctx.storage.get<StagingData>(`${DO.STAGING_PREFIX}${token}`)

    if (!staging) {
      throw new Error('Staging data not found')
    }

    if (staging.status === 'committed') {
      throw new Error('Cannot abort committed clone')
    }

    staging.status = 'aborted'
    await this.ctx.storage.put(`${DO.STAGING_PREFIX}${token}`, staging)

    await this.emitEvent('clone.aborted', { token, reason })
  }

  /**
   * Compute integrity hash for staging data
   */
  private computeStagingIntegrityHash(things: unknown[]): string {
    const content = JSON.stringify(things)
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(16)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENTUAL CLONE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  private _conflictResolvers: Map<string, (conflict: ConflictInfo) => Promise<unknown>> = new Map()

  private async initiateEventualClone(
    target: string,
    options: CloneOptions & { mode: 'eventual' }
  ): Promise<EventualCloneHandle> {
    // Validate target namespace URL
    try {
      new URL(target)
    } catch {
      throw new Error(`Invalid namespace URL: ${target}`)
    }

    const id = crypto.randomUUID()

    // Get initial thing count
    const things = await this.db.select().from(schema.things)
    const cloneBranch = options?.branch || this.currentBranch
    const branchFilter = cloneBranch === 'main' ? null : cloneBranch
    const branchThings = things.filter(t => t.branch === branchFilter && !t.deleted)
    const totalItems = branchThings.length

    const eventualOptions = options as unknown as Record<string, unknown>
    const syncInterval = eventualOptions?.syncInterval as number ?? 5000
    const maxDivergence = eventualOptions?.maxDivergence as number ?? 100
    const conflictResolution = (eventualOptions?.conflictResolution as ConflictResolution) ?? 'last-write-wins'

    // Create initial state
    const state: EventualCloneState = {
      id,
      targetNs: target,
      status: 'pending',
      progress: 0,
      phase: 'initial',
      itemsSynced: 0,
      totalItems,
      itemsRemaining: totalItems,
      lastSyncAt: null,
      divergence: totalItems,
      maxDivergence,
      syncInterval,
      errorCount: 0,
      lastError: null,
      conflictResolution,
      hasCustomResolver: false,
      chunked: false,
      chunkSize: 1000,
      rateLimit: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSyncedVersion: 0,
    }

    await this.ctx.storage.put(`eventual:${id}`, state)
    await this.emitEvent('clone.initiated', { id, target, mode: 'eventual' })

    // Schedule initial sync
    const currentAlarm = await this.ctx.storage.getAlarm()
    if (!currentAlarm || currentAlarm > Date.now() + 100) {
      await this.ctx.storage.setAlarm(Date.now() + 100)
    }

    return this.createEventualHandle(id, state)
  }

  private createEventualHandle(id: string, initialState: EventualCloneState): EventualCloneHandle {
    const self = this
    let currentStatus: CloneStatus = initialState.status

    return {
      id,
      get status() {
        return currentStatus
      },

      async getProgress(): Promise<number> {
        const state = await self.ctx.storage.get<EventualCloneState>(`eventual:${id}`)
        if (state) currentStatus = state.status
        return state?.progress ?? 0
      },

      async getSyncStatus(): Promise<SyncStatus> {
        const state = await self.ctx.storage.get<EventualCloneState>(`eventual:${id}`)
        if (state) currentStatus = state.status
        return {
          phase: state?.phase ?? 'initial',
          itemsSynced: state?.itemsSynced ?? 0,
          totalItems: state?.totalItems ?? 0,
          lastSyncAt: state?.lastSyncAt ? new Date(state.lastSyncAt) : null,
          divergence: state?.divergence ?? 0,
          maxDivergence: state?.maxDivergence ?? 100,
          syncInterval: state?.syncInterval ?? 5000,
          errorCount: state?.errorCount ?? 0,
          lastError: state?.lastError ? new Error(state.lastError) : null,
        }
      },

      async pause(): Promise<void> {
        const state = await self.ctx.storage.get<EventualCloneState>(`eventual:${id}`)
        if (!state) throw new Error(`Clone operation not found: ${id}`)
        state.status = 'paused'
        state.updatedAt = new Date().toISOString()
        await self.ctx.storage.put(`eventual:${id}`, state)
        currentStatus = 'paused'
        await self.emitEvent('clone.paused', { id })
      },

      async resume(): Promise<void> {
        const state = await self.ctx.storage.get<EventualCloneState>(`eventual:${id}`)
        if (!state) throw new Error(`Clone operation not found: ${id}`)
        state.status = 'syncing'
        state.updatedAt = new Date().toISOString()
        await self.ctx.storage.put(`eventual:${id}`, state)
        currentStatus = state.status
        await self.emitEvent('clone.resumed', { id })

        const currentAlarm = await self.ctx.storage.getAlarm()
        if (!currentAlarm || currentAlarm > Date.now() + 100) {
          await self.ctx.storage.setAlarm(Date.now() + 100)
        }
      },

      async sync(): Promise<SyncResult> {
        return self.performEventualSync(id)
      },

      async cancel(): Promise<void> {
        const state = await self.ctx.storage.get<EventualCloneState>(`eventual:${id}`)
        if (!state) throw new Error(`Clone operation not found: ${id}`)
        state.status = 'cancelled'
        state.updatedAt = new Date().toISOString()
        await self.ctx.storage.put(`eventual:${id}`, state)
        currentStatus = 'cancelled'
        await self.emitEvent('clone.cancelled', { id })
      },
    }
  }

  private async performEventualSync(id: string): Promise<SyncResult> {
    const startTime = Date.now()
    const state = await this.ctx.storage.get<EventualCloneState>(`eventual:${id}`)
    if (!state) throw new Error(`Clone operation not found: ${id}`)

    if (state.status === 'cancelled' || state.status === 'paused') {
      return { itemsSynced: 0, duration: 0, conflicts: [] }
    }

    let itemsSynced = 0
    const conflicts: ConflictInfo[] = []

    try {
      if (state.status === 'pending') {
        state.status = 'syncing'
        state.phase = 'bulk'
        await this.ctx.storage.put(`eventual:${id}`, state)
      }

      const things = await this.db.select().from(schema.things)
      const branchThings = things.filter(t => t.branch === null && !t.deleted)

      const latestVersions = new Map<string, typeof things[0]>()
      for (const thing of branchThings) {
        latestVersions.set(thing.id, thing)
      }

      let itemsToSync = Array.from(latestVersions.values())
      if (state.phase !== 'bulk' && state.phase !== 'initial') {
        itemsToSync = itemsToSync.filter((_, idx) => idx >= state.lastSyncedVersion)
      }

      if (state.chunked && itemsToSync.length > state.chunkSize) {
        itemsToSync = itemsToSync.slice(0, state.chunkSize)
      }

      if (this.env.DO && itemsToSync.length > 0) {
        const doId = this.env.DO.idFromName(state.targetNs)
        const stub = this.env.DO.get(doId)

        const response = await stub.fetch(new Request(`https://${state.targetNs}/sync`, {
          method: 'POST',
          body: JSON.stringify({
            cloneId: id,
            things: itemsToSync.map(t => ({
              id: t.id,
              type: t.type,
              branch: null,
              name: t.name,
              data: t.data,
              deleted: false,
            })),
          }),
        }))

        if (response.ok) {
          itemsSynced = itemsToSync.length
        }
      }

      state.itemsSynced += itemsSynced
      state.lastSyncedVersion += itemsSynced
      state.lastSyncAt = new Date().toISOString()
      state.itemsRemaining = Math.max(0, state.totalItems - state.itemsSynced)
      state.progress = state.totalItems > 0 ? Math.floor((state.itemsSynced / state.totalItems) * 100) : 100
      state.divergence = state.itemsRemaining
      state.errorCount = 0
      state.lastError = null
      state.updatedAt = new Date().toISOString()

      if (state.progress >= 100) {
        state.status = 'active'
        state.phase = 'delta'
        await this.emitEvent('clone.active', { id, target: state.targetNs })
      }

      await this.ctx.storage.put(`eventual:${id}`, state)

      const duration = Date.now() - startTime
      return { itemsSynced, duration, conflicts }
    } catch (error) {
      state.errorCount++
      state.lastError = (error as Error).message
      state.updatedAt = new Date().toISOString()

      if (state.errorCount >= 10) {
        state.status = 'error'
        await this.emitEvent('clone.error', { id, error: state.lastError })
      }

      await this.ctx.storage.put(`eventual:${id}`, state)

      return { itemsSynced: 0, duration: Date.now() - startTime, conflicts: [] }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESUMABLE CLONE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  private _resumableClones: Map<string, ResumableCloneState> = new Map()
  private _cloneLocks: Map<string, CloneLockState> = new Map()

  private async initiateResumableClone(
    target: string,
    options: ResumableCloneOptions
  ): Promise<ResumableCloneHandle> {
    const batchSize = options?.batchSize || 100
    const checkpointInterval = options?.checkpointInterval || 1
    const maxRetries = options?.maxRetries || 3
    const retryDelay = options?.retryDelay || 1000
    const lockTimeout = options?.lockTimeout || 300000
    const checkpointRetentionMs = options?.checkpointRetentionMs || 3600000
    const compress = options?.compress || false
    const maxBandwidth = options?.maxBandwidth

    // Validate target namespace URL
    try {
      new URL(target)
    } catch {
      throw new Error(`Invalid namespace URL: ${target}`)
    }

    // Check for existing lock
    const existingLock = this._cloneLocks.get(target) || await this.ctx.storage.get<CloneLockState>(`clone-lock:${target}`)
    const now = Date.now()

    if (existingLock && !existingLock.isStale && new Date(existingLock.expiresAt).getTime() > now) {
      if (!options?.forceLock) {
        throw new Error(`Clone operation already in progress for target: ${target}`)
      }
      await this.releaseCloneLock(target, existingLock.cloneId)
    }

    const cloneId = crypto.randomUUID()
    const state: ResumableCloneState = {
      id: cloneId,
      targetNs: target,
      status: 'initializing',
      checkpoints: [],
      position: 0,
      batchSize,
      checkpointInterval,
      maxRetries,
      retryDelay,
      retryCount: 0,
      compress,
      maxBandwidth,
      checkpointRetentionMs,
      pauseRequested: false,
      cancelRequested: false,
      createdAt: new Date(),
      bytesTransferred: 0,
      totalBytes: 0,
      startedAt: null,
    }

    // Acquire lock
    const lockId = crypto.randomUUID()
    const lock: CloneLockState = {
      lockId,
      cloneId,
      target,
      acquiredAt: new Date(),
      expiresAt: new Date(now + lockTimeout),
      isStale: false,
    }
    this._cloneLocks.set(target, lock)
    await this.ctx.storage.put(`clone-lock:${target}`, lock)
    await this.emitEvent('clone.lock.acquired', { lockId, target, cloneId })

    this._resumableClones.set(cloneId, state)
    await this.ctx.storage.put(`resumable:${cloneId}`, state)

    // Schedule the clone
    const currentAlarm = await this.ctx.storage.getAlarm()
    if (!currentAlarm || currentAlarm > Date.now() + 100) {
      await this.ctx.storage.setAlarm(Date.now() + 100)
    }

    return this.createResumableCloneHandle(cloneId)
  }

  private createResumableCloneHandle(cloneId: string): ResumableCloneHandle {
    const self = this

    return {
      id: cloneId,

      get status(): ResumableCloneStatus {
        const state = self._resumableClones.get(cloneId)
        return state?.status || 'failed'
      },

      get checkpoints(): ResumableCheckpoint[] {
        const state = self._resumableClones.get(cloneId)
        return state?.checkpoints || []
      },

      async getProgress(): Promise<number> {
        const state = await self.ctx.storage.get<ResumableCloneState>(`resumable:${cloneId}`)
        return state?.progress || 0
      },

      async pause(): Promise<void> {
        const state = await self.ctx.storage.get<ResumableCloneState>(`resumable:${cloneId}`)
        if (!state) throw new Error('Clone not found')
        state.pauseRequested = true
        state.status = 'paused'
        await self.ctx.storage.put(`resumable:${cloneId}`, state)
        self._resumableClones.set(cloneId, state)
        await self.emitEvent('clone.paused', { id: cloneId, progress: state.progress })
      },

      async resume(): Promise<void> {
        const state = await self.ctx.storage.get<ResumableCloneState>(`resumable:${cloneId}`)
        if (!state) throw new Error('Clone not found')
        state.pauseRequested = false
        state.status = 'transferring'
        await self.ctx.storage.put(`resumable:${cloneId}`, state)
        self._resumableClones.set(cloneId, state)
        await self.emitEvent('clone.resumed', { id: cloneId })

        const currentAlarm = await self.ctx.storage.getAlarm()
        if (!currentAlarm || currentAlarm > Date.now() + 100) {
          await self.ctx.storage.setAlarm(Date.now() + 100)
        }
      },

      async cancel(): Promise<void> {
        const state = await self.ctx.storage.get<ResumableCloneState>(`resumable:${cloneId}`)
        if (!state) throw new Error('Clone not found')
        state.cancelRequested = true
        state.status = 'cancelled'
        await self.ctx.storage.put(`resumable:${cloneId}`, state)
        self._resumableClones.set(cloneId, state)
        await self.releaseCloneLock(state.targetNs, cloneId)
        await self.emitEvent('clone.cancelled', { id: cloneId, progress: state.progress })
      },

      async waitForCheckpoint(): Promise<ResumableCheckpoint> {
        const pollInterval = 50
        const maxWait = 60000
        const startTime = Date.now()

        return new Promise((resolve, reject) => {
          const poll = async () => {
            const state = await self.ctx.storage.get<ResumableCloneState>(`resumable:${cloneId}`)
            if (!state) {
              reject(new Error('Clone not found'))
              return
            }

            if (state.checkpoints.length > 0) {
              resolve(state.checkpoints[state.checkpoints.length - 1]!)
              return
            }

            if (Date.now() - startTime > maxWait) {
              reject(new Error('Timeout waiting for checkpoint'))
              return
            }

            setTimeout(poll, pollInterval)
          }
          poll()
        })
      },

      async canResumeFrom(checkpointId: string): Promise<boolean> {
        const checkpoint = await self.ctx.storage.get<ResumableCheckpoint>(`checkpoint:${checkpointId}`)
        if (!checkpoint) return false
        if (!checkpoint.hash || !/^[a-f0-9]{64}$/.test(checkpoint.hash)) return false
        if (checkpoint.position < 0) return false
        return true
      },

      async getIntegrityHash(): Promise<string> {
        const state = await self.ctx.storage.get<ResumableCloneState>(`resumable:${cloneId}`)
        if (!state || state.checkpoints.length === 0) return ''
        return state.checkpoints[state.checkpoints.length - 1]!.hash
      },

      async getLockInfo(): Promise<CloneLockInfo | null> {
        const state = await self.ctx.storage.get<ResumableCloneState>(`resumable:${cloneId}`)
        if (!state) return null
        const lock = self._cloneLocks.get(state.targetNs) || await self.ctx.storage.get<CloneLockState>(`clone-lock:${state.targetNs}`)
        if (!lock || lock.cloneId !== cloneId) return null
        return {
          lockId: lock.lockId,
          cloneId: lock.cloneId,
          acquiredAt: new Date(lock.acquiredAt),
          expiresAt: new Date(lock.expiresAt),
          isStale: lock.isStale || new Date(lock.expiresAt).getTime() < Date.now(),
        }
      },

      async forceOverrideLock(): Promise<void> {
        const state = await self.ctx.storage.get<ResumableCloneState>(`resumable:${cloneId}`)
        if (!state) throw new Error('Clone not found')
        await self.releaseCloneLock(state.targetNs, cloneId)
      },
    }
  }

  private async releaseCloneLock(target: string, cloneId: string): Promise<void> {
    const lock = this._cloneLocks.get(target) || await this.ctx.storage.get<CloneLockState>(`clone-lock:${target}`)
    if (lock && lock.cloneId === cloneId) {
      this._cloneLocks.delete(target)
      await this.ctx.storage.delete(`clone-lock:${target}`)
      await this.emitEvent('clone.lock.released', { lockId: lock.lockId, target })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROMOTE / DEMOTE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Promote a Thing to its own DO
   */
  async promote(thingId: string, options?: {
    targetNs?: string
    preserveHistory?: boolean
    mode?: 'atomic' | 'staged'
  }): Promise<PromoteResult> {
    const { targetNs: customNs, preserveHistory = true, mode = 'atomic' } = options ?? {}

    // Get the Thing
    const thing = await this.things.get(thingId)
    if (!thing) {
      throw new Error(`Thing not found: ${thingId}`)
    }

    // Generate target namespace
    const targetNs = customNs || `https://${thingId}.do`

    // Validate target URL
    try {
      new URL(targetNs)
    } catch {
      throw new Error(`Invalid target URL: ${targetNs}`)
    }

    // Cannot promote to self
    if (targetNs === this.ns) {
      throw new Error('Cannot promote to self')
    }

    // Check if DO binding is available
    if (!this.env.DO) {
      throw new Error('DO binding is unavailable')
    }

    await this.emitEvent('promote.started', { thingId, targetNs, mode })

    try {
      // Create new DO and transfer state
      const doId = this.env.DO.idFromName(targetNs)
      const stub = this.env.DO.get(doId)

      // Initialize the new DO
      const initResponse = await stub.fetch(new Request(`${targetNs}/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ns: targetNs,
          parent: this.ns,
        }),
      }))

      if (!initResponse.ok) {
        throw new Error(`Failed to initialize target DO: ${initResponse.status}`)
      }

      // Transfer the Thing state
      const transferResponse = await stub.fetch(new Request(`${targetNs}/clone-receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          things: [{
            id: 'root',
            $type: thing.$type,
            branch: null,
            name: thing.name,
            data: thing.data,
            deleted: false,
          }],
          relationships: [],
          sourceNs: this.ns,
          promotedFrom: thingId,
        }),
      }))

      if (!transferResponse.ok) {
        throw new Error(`Failed to transfer state: ${transferResponse.status}`)
      }

      // Mark original Thing as promoted
      await this.things.update(thingId, {
        data: {
          ...(thing.data as Record<string, unknown>),
          $promotedTo: targetNs,
          $promotedAt: new Date().toISOString(),
        },
      })

      await this.emitEvent('promote.completed', { thingId, targetNs })

      return {
        newNs: targetNs,
        thingId,
        originalNs: this.ns,
      }
    } catch (error) {
      await this.emitEvent('promote.failed', { thingId, targetNs, error: (error as Error).message })
      throw error
    }
  }

  /**
   * Demote this DO back into a parent DO as a Thing
   */
  async demote(targetNs: string, options?: {
    thingId?: string
    preserveHistory?: boolean
    type?: string
    force?: boolean
    compress?: boolean
    mode?: 'atomic' | 'staged'
    preserveId?: boolean
  }): Promise<DemoteResult> {
    if (!targetNs || typeof targetNs !== 'string' || targetNs.trim() === '') {
      throw new Error('targetNs is required for demote')
    }

    const {
      thingId: customThingId,
      preserveHistory = true,
      type,
      force = false,
      compress = false,
      mode = 'atomic',
      preserveId = false,
    } = options ?? {}

    // Validate URL format
    try {
      new URL(targetNs)
    } catch {
      throw new Error(`Invalid target URL: ${targetNs}`)
    }

    // Cannot demote to self
    if (targetNs === this.ns) {
      throw new Error('Cannot demote to self')
    }

    // Check if DO binding is available
    if (!this.env.DO) {
      throw new Error('DO binding is unavailable')
    }

    // Validate type if provided
    if (type) {
      if (!/^[A-Z][a-zA-Z0-9]*$/.test(type) || type.length > 25) {
        throw new Error(`Invalid type: "${type}"`)
      }
    }

    await this.emitEvent('demote.started', { targetNs, sourceNs: this.ns, mode })

    try {
      // Get all state from this DO
      const things = await this.db.select().from(schema.things)
      const actions = await this.db.select().from(schema.actions)
      const events = await this.db.select().from(schema.events)
      const relationships = await this.db.select().from(schema.relationships)

      const activeThings = things.filter(t => !t.deleted)

      // Generate new thing ID
      const newThingId = customThingId
        ? customThingId
        : preserveId
          ? this.ns.replace(/^https?:\/\//, '').replace(/\.do$/, '')
          : `demoted-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

      // Prepare transfer payload
      const transferPayload = {
        things: activeThings.length > 0 ? activeThings.map(t => ({
          ...t,
          id: t.id === 'root' ? newThingId : `${newThingId}/${t.id}`,
        })) : [{
          id: newThingId,
          type: 0,
          branch: null,
          name: `Demoted from ${this.ns}`,
          data: { $demotedFrom: this.ns },
          deleted: false,
        }],
        actions: compress ? [] : actions,
        events: compress ? [] : events,
        relationships: relationships.map(r => ({
          ...r,
          from: r.from?.replace(this.ns, `${targetNs}/Thing/${newThingId}`),
          to: r.to?.replace(this.ns, `${targetNs}/Thing/${newThingId}`),
        })),
        demotedFrom: {
          ns: this.ns,
          thingsCount: activeThings.length,
          compress,
        },
      }

      // Transfer to parent DO
      const parentId = this.env.DO.idFromName(targetNs)
      const parentStub = this.env.DO.get(parentId)

      const response = await parentStub.fetch(new Request(`${targetNs}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transferPayload),
      }))

      if (!response.ok) {
        throw new Error(`Transfer to ${targetNs} failed: ${response.status}`)
      }

      // Clear local state
      await this.ctx.storage.sql.exec('DELETE FROM things')
      await this.ctx.storage.sql.exec('DELETE FROM actions')
      await this.ctx.storage.sql.exec('DELETE FROM events')
      await this.ctx.storage.sql.exec('DELETE FROM relationships')

      await this.emitEvent('demote.completed', {
        thingId: newThingId,
        parentNs: targetNs,
        deletedNs: this.ns,
      })

      return {
        thingId: newThingId,
        parentNs: targetNs,
        deletedNs: this.ns,
      }
    } catch (error) {
      await this.emitEvent('demote.failed', { targetNs, error: (error as Error).message })
      throw error
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCHING & VERSION CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new branch at current HEAD
   */
  async branch(name: string): Promise<BranchResult> {
    if (!name || name.trim() === '') {
      throw new Error('Branch name cannot be empty')
    }

    if (name.includes(' ')) {
      throw new Error('Branch name cannot contain spaces')
    }

    if (name === 'main') {
      throw new Error('Cannot create branch named "main" - it is reserved')
    }

    // Check if branch already exists
    const branches = await this.db.select().from(schema.branches)
    if (branches.some(b => b.name === name)) {
      throw new Error(`Branch "${name}" already exists`)
    }

    // Find current HEAD
    const things = await this.db.select().from(schema.things)
    const currentBranchThings = things.filter(t =>
      this.currentBranch === 'main' ? t.branch === null : t.branch === this.currentBranch
    )

    if (currentBranchThings.length === 0) {
      throw new Error('No commits on current branch')
    }

    const head = currentBranchThings.length

    // Create branch record
    await this.db.insert(schema.branches).values({
      name,
      thingId: currentBranchThings[0]!.id,
      head,
      base: head,
      forkedFrom: this.currentBranch,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await this.emitEvent('branch.created', { name, head, forkedFrom: this.currentBranch })

    return { name, head }
  }

  /**
   * Switch to a branch or version
   */
  async checkout(ref: string): Promise<CheckoutResult> {
    const things = await this.db.select().from(schema.things)

    let targetRef = ref.startsWith('@') ? ref.slice(1) : ref

    // Check for version reference (@v1234)
    if (targetRef.startsWith('v')) {
      const version = parseInt(targetRef.slice(1), 10)

      if (version < 1 || version > things.length) {
        throw new Error(`Version not found: ${version}`)
      }

      this.currentVersion = version
      await this.emitEvent('checkout', { version })

      return { version }
    }

    // Check for relative reference (@~N)
    if (targetRef.startsWith('~')) {
      const offset = parseInt(targetRef.slice(1), 10)

      const currentBranchThings = things.filter(t =>
        this.currentBranch === 'main' ? t.branch === null : t.branch === this.currentBranch
      )

      if (offset >= currentBranchThings.length) {
        throw new Error(`Cannot go back ${offset} versions - only ${currentBranchThings.length} versions exist`)
      }

      const version = currentBranchThings.length - offset
      this.currentVersion = version

      await this.emitEvent('checkout', { version, relative: `~${offset}` })

      return { version }
    }

    // Branch reference
    const branchName = targetRef

    if (branchName === 'main') {
      this.currentBranch = 'main'
      this.currentVersion = null

      await this.emitEvent('checkout', { branch: 'main' })
      return { branch: 'main' }
    }

    const branches = await this.db.select().from(schema.branches)
    const branchExists = branches.some(b => b.name === branchName)
    const thingsOnBranch = things.filter(t => t.branch === branchName)

    if (!branchExists && thingsOnBranch.length === 0) {
      throw new Error(`Branch not found: ${branchName}`)
    }

    this.currentBranch = branchName
    this.currentVersion = null

    await this.emitEvent('checkout', { branch: branchName })

    return { branch: branchName }
  }

  /**
   * Merge a branch into current
   */
  async merge(branch: string): Promise<MergeResult> {
    if (this.currentVersion !== null) {
      throw new Error('Cannot merge into detached HEAD state')
    }

    if (branch === this.currentBranch || (branch === 'main' && this.currentBranch === 'main')) {
      throw new Error('Cannot merge branch into itself')
    }

    const things = await this.db.select().from(schema.things)
    const branches = await this.db.select().from(schema.branches)

    const sourceBranch = branches.find(b => b.name === branch)
    const sourceThings = things.filter(t => t.branch === branch)

    if (!sourceBranch && sourceThings.length === 0) {
      throw new Error(`Branch not found: ${branch}`)
    }

    await this.emitEvent('merge.started', { source: branch, target: this.currentBranch })

    const targetBranchFilter = this.currentBranch === 'main' ? null : this.currentBranch
    const targetThings = things.filter(t => t.branch === targetBranchFilter)

    // Group by id
    const sourceById = new Map<string, typeof things>()
    for (const t of sourceThings) {
      const group = sourceById.get(t.id) || []
      group.push(t)
      sourceById.set(t.id, group)
    }

    const targetById = new Map<string, typeof things>()
    for (const t of targetThings) {
      const group = targetById.get(t.id) || []
      group.push(t)
      targetById.set(t.id, group)
    }

    // Detect conflicts
    const conflicts: string[] = []
    const toMerge: typeof things = []

    for (const [id, sourceVersions] of sourceById) {
      const latestSource = sourceVersions[sourceVersions.length - 1]!
      const targetVersions = targetById.get(id) || []

      if (targetVersions.length === 0) {
        toMerge.push({
          ...latestSource,
          branch: targetBranchFilter,
        } as (typeof things)[0])
      } else {
        const latestTarget = targetVersions[targetVersions.length - 1]!

        const sourceData = (latestSource.data || {}) as Record<string, unknown>
        const targetData = (latestTarget.data || {}) as Record<string, unknown>
        const baseVersion = targetVersions[0] || sourceVersions[0]
        const baseData = (baseVersion?.data || {}) as Record<string, unknown>

        const sourceChanges = new Set<string>()
        const targetChanges = new Set<string>()

        for (const key of Object.keys(sourceData)) {
          if (JSON.stringify(sourceData[key]) !== JSON.stringify(baseData[key])) {
            sourceChanges.add(key)
          }
        }

        for (const key of Object.keys(targetData)) {
          if (JSON.stringify(targetData[key]) !== JSON.stringify(baseData[key])) {
            targetChanges.add(key)
          }
        }

        const conflictingFields: string[] = []
        for (const field of sourceChanges) {
          if (targetChanges.has(field) &&
              JSON.stringify(sourceData[field]) !== JSON.stringify(targetData[field])) {
            conflictingFields.push(field)
          }
        }

        if (conflictingFields.length > 0) {
          conflicts.push(`${id}:${conflictingFields.join(',')}`)
        } else {
          const mergedData: Record<string, unknown> = { ...baseData }

          for (const field of sourceChanges) {
            mergedData[field] = sourceData[field]
          }

          for (const field of targetChanges) {
            mergedData[field] = targetData[field]
          }

          if (latestSource.deleted || latestTarget.deleted || Object.keys(mergedData).length > 0) {
            toMerge.push({
              ...latestTarget,
              data: mergedData,
              deleted: latestSource.deleted || latestTarget.deleted,
            } as (typeof things)[0])
          }
        }
      }
    }

    if (conflicts.length > 0) {
      await this.emitEvent('merge.conflict', { source: branch, conflicts })
      return { merged: false, conflicts }
    }

    // Apply merge
    for (const thing of toMerge) {
      await this.db.insert(schema.things).values({
        id: thing.id,
        type: thing.type,
        branch: thing.branch,
        name: thing.name,
        data: thing.data as Record<string, unknown>,
        deleted: thing.deleted,
      })
    }

    await this.emitEvent('merge.completed', { source: branch, target: this.currentBranch, merged: toMerge.length })

    return { merged: true }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ALARM HANDLER (Extended)
  // ═══════════════════════════════════════════════════════════════════════════

  override async alarm(): Promise<void> {
    // Handle eventual clone syncing
    await this.handleEventualCloneAlarms()

    // Handle resumable clones
    await this.processResumableClones()

    // Call parent alarm handler for scheduling
    await super.alarm()
  }

  private async handleEventualCloneAlarms(): Promise<void> {
    const keys = await this.ctx.storage.list({ prefix: 'eventual:' })
    let nextAlarmTime: number | null = null

    for (const [key, value] of keys) {
      const state = value as EventualCloneState

      if (state.status === 'cancelled' || state.status === 'paused' || state.status === 'error') {
        continue
      }

      const lastSync = state.lastSyncAt ? new Date(state.lastSyncAt).getTime() : 0
      const now = Date.now()
      const nextSync = lastSync + state.syncInterval

      const needsSync = now >= nextSync || state.divergence > state.maxDivergence

      if (needsSync || state.status === 'pending') {
        await this.performEventualSync(state.id)

        const updatedState = await this.ctx.storage.get<EventualCloneState>(`eventual:${state.id}`)
        if (updatedState && updatedState.status !== 'active' && updatedState.status !== 'cancelled' && updatedState.status !== 'error') {
          const nextSyncTime = Date.now() + updatedState.syncInterval
          if (!nextAlarmTime || nextSyncTime < nextAlarmTime) {
            nextAlarmTime = nextSyncTime
          }
        }
      } else {
        if (!nextAlarmTime || nextSync < nextAlarmTime) {
          nextAlarmTime = nextSync
        }
      }
    }

    if (nextAlarmTime) {
      await this.ctx.storage.setAlarm(nextAlarmTime)
    }
  }

  private async processResumableClones(): Promise<void> {
    const storageKeys = await this.ctx.storage.list({ prefix: 'resumable:' })
    for (const [key, value] of storageKeys) {
      const cloneId = key.replace('resumable:', '')
      if (!this._resumableClones.has(cloneId)) {
        this._resumableClones.set(cloneId, value as ResumableCloneState)
      }
    }

    for (const [cloneId, state] of this._resumableClones) {
      if (state.status === 'paused' || state.pauseRequested) continue
      if (state.status === 'cancelled' || state.cancelRequested) continue
      if (state.status === 'completed' || state.status === 'failed') continue

      await this.processResumableCloneBatch(cloneId)
    }
  }

  private async processResumableCloneBatch(cloneId: string): Promise<void> {
    const state = this._resumableClones.get(cloneId) || await this.ctx.storage.get<ResumableCloneState>(`resumable:${cloneId}`)
    if (!state) return

    if (state.pauseRequested || state.status === 'paused') return
    if (state.cancelRequested || state.status === 'cancelled') return

    if (state.status === 'initializing') {
      state.status = 'transferring'
      state.startedAt = new Date()
    }

    try {
      const allThings = await this.db.select().from(schema.things)
      const nonDeletedThings = allThings.filter(t => !t.deleted)
      const totalItems = nonDeletedThings.length

      if (state.totalBytes === 0) {
        state.totalBytes = nonDeletedThings.reduce((acc, t) => acc + JSON.stringify(t).length, 0)
      }

      const batch = nonDeletedThings.slice(state.position, state.position + state.batchSize)

      if (batch.length === 0) {
        state.status = 'completed'
        await this.ctx.storage.put(`resumable:${cloneId}`, state)
        this._resumableClones.set(cloneId, state)
        await this.releaseCloneLock(state.targetNs, cloneId)
        await this.emitEvent('clone.completed', { id: cloneId, totalItems: state.position })
        return
      }

      // Transfer batch (simulated)
      state.position += batch.length
      state.progress = Math.round((state.position / totalItems) * 100)
      state.bytesTransferred += batch.reduce((acc, t) => acc + JSON.stringify(t).length, 0)

      // Create checkpoint
      const batchNumber = Math.ceil(state.position / state.batchSize)
      if (batchNumber % state.checkpointInterval === 0) {
        const batchJson = JSON.stringify(batch)
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(batchJson))
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

        const checkpoint: ResumableCheckpoint = {
          id: crypto.randomUUID(),
          position: state.position,
          hash,
          timestamp: new Date(),
          itemsProcessed: state.position,
          batchNumber,
          cloneId,
          compressed: state.compress,
        }
        state.checkpoints.push(checkpoint)
        await this.ctx.storage.put(`checkpoint:${checkpoint.id}`, checkpoint)
        await this.emitEvent('clone.checkpoint', { id: cloneId, checkpoint })
      }

      state.retryCount = 0
      await this.ctx.storage.put(`resumable:${cloneId}`, state)
      this._resumableClones.set(cloneId, state)

      if (state.position < totalItems && !state.pauseRequested && !state.cancelRequested) {
        const currentAlarm = await this.ctx.storage.getAlarm()
        if (!currentAlarm || currentAlarm > Date.now() + 100) {
          await this.ctx.storage.setAlarm(Date.now() + 100)
        }
      }
    } catch (error) {
      state.retryCount++
      await this.emitEvent('clone.retry', { id: cloneId, attempt: state.retryCount, error: (error as Error).message })

      if (state.retryCount >= state.maxRetries) {
        state.status = 'failed'
        await this.ctx.storage.put(`resumable:${cloneId}`, state)
        this._resumableClones.set(cloneId, state)
        await this.emitEvent('clone.failed', { id: cloneId, error: (error as Error).message })
        await this.releaseCloneLock(state.targetNs, cloneId)
        return
      }

      const delay = state.retryDelay * Math.pow(2, state.retryCount - 1)
      await this.ctx.storage.put(`resumable:${cloneId}`, state)
      this._resumableClones.set(cloneId, state)

      const currentAlarm = await this.ctx.storage.getAlarm()
      if (!currentAlarm || currentAlarm > Date.now() + delay) {
        await this.ctx.storage.setAlarm(Date.now() + delay)
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CROSS-DO RESOLUTION (with circuit breaker)
  // ═══════════════════════════════════════════════════════════════════════════

  protected override async resolveCrossDO(ns: string, path: string, ref: string): Promise<Thing> {
    // Check circuit breaker state
    const circuitState = this._circuitBreaker.get(ns)
    if (circuitState) {
      const now = Date.now()

      if (circuitState.state === 'open') {
        if (now >= circuitState.openUntil) {
          circuitState.state = 'half-open'
          circuitState.halfOpenTestInProgress = false
          this._circuitBreaker.set(ns, circuitState)
        } else {
          throw new Error(`Circuit breaker open for namespace: ${ns}`)
        }
      }

      if (circuitState.state === 'half-open') {
        if (circuitState.halfOpenTestInProgress) {
          throw new Error('Circuit breaker in half-open test')
        }
        circuitState.halfOpenTestInProgress = true
        this._circuitBreaker.set(ns, circuitState)
      }
    }

    const obj = await this.objects.get(ns)
    if (!obj) {
      throw new Error(`Unknown namespace: ${ns}`)
    }

    if (!this.env.DO) {
      throw new Error('DO namespace binding not configured')
    }

    const stub = this.getOrCreateStub(ns, obj.id)

    const resolveUrl = new URL(`${ns}/resolve`)
    resolveUrl.searchParams.set('path', path)
    resolveUrl.searchParams.set('ref', ref)

    try {
      const response = await stub.fetch(new Request(resolveUrl.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }))

      if (!response.ok) {
        this.recordFailure(ns)
        throw new Error(`Cross-DO resolution failed: ${response.status}`)
      }

      this._circuitBreaker.delete(ns)

      let thing: Thing
      try {
        thing = await response.json() as Thing
      } catch {
        throw new Error('Invalid response from remote DO')
      }

      return thing
    } catch (error) {
      if (error instanceof Error &&
          !error.message.startsWith('Invalid response') &&
          !error.message.startsWith('Cross-DO resolution failed')) {
        this.recordFailure(ns)
      }
      throw error
    }
  }

  private getOrCreateStub(ns: string, doId: string): DOStub {
    const now = Date.now()
    const cached = this._stubCache.get(ns)

    if (cached && now - cached.cachedAt < CROSS_DO_CONFIG.STUB_CACHE_TTL) {
      cached.lastUsed = now
      return cached.stub
    }

    const doNamespace = this.env.DO as {
      idFromString(id: string): unknown
      get(id: unknown): DOStub
    }
    const id = doNamespace.idFromString(doId)
    const stub = doNamespace.get(id)

    this.evictLRUStubs()

    this._stubCache.set(ns, { stub, cachedAt: now, lastUsed: now })

    return stub
  }

  private evictLRUStubs(): void {
    while (this._stubCache.size >= this._stubCacheMaxSize) {
      let lruNs: string | null = null
      let lruLastUsed = Infinity

      for (const [ns, entry] of this._stubCache) {
        if (entry.lastUsed < lruLastUsed) {
          lruLastUsed = entry.lastUsed
          lruNs = ns
        }
      }

      if (lruNs) {
        this._stubCache.delete(lruNs)
      } else {
        break
      }
    }
  }

  private recordFailure(ns: string): void {
    const state = this._circuitBreaker.get(ns) || { failures: 0, openUntil: 0, state: 'closed' as CircuitBreakerState }
    state.failures++

    if (state.failures >= CROSS_DO_CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
      state.state = 'open'
      state.openUntil = Date.now() + CROSS_DO_CONFIG.CIRCUIT_BREAKER_TIMEOUT
      state.failures = 0
      this._stubCache.delete(ns)
    }

    if (state.state === 'half-open') {
      state.state = 'open'
      state.openUntil = Date.now() + CROSS_DO_CONFIG.CIRCUIT_BREAKER_TIMEOUT
      state.halfOpenTestInProgress = false
    }

    this._circuitBreaker.set(ns, state)
  }

  protected clearCrossDoCache(ns?: string): void {
    if (ns) {
      this._stubCache.delete(ns)
      this._circuitBreaker.delete(ns)
    } else {
      this._stubCache.clear()
      this._circuitBreaker.clear()
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT EMISSION (protected for this module)
  // ═══════════════════════════════════════════════════════════════════════════

  protected async emitEvent(verb: string, data: unknown): Promise<void> {
    try {
      await this.db.insert(schema.events).values({
        id: crypto.randomUUID(),
        verb,
        source: this.ns,
        data: data as Record<string, unknown>,
        sequence: 0,
        streamed: false,
        createdAt: new Date(),
      })
    } catch {
      // Best-effort database insert
    }

    if (this.env.EVENTS) {
      try {
        await this.env.EVENTS.send([createEvent(verb, {
          source: this.ns,
          context: this.ns,
          data: typeof data === 'object' ? JSON.stringify(data) : String(data ?? ''),
        })])
      } catch {
        // Best-effort streaming
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHARD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Shard this DO into multiple DOs for horizontal scaling
   *
   * @param options Sharding configuration
   * @returns Shard result with shard endpoints and distribution stats
   */
  async shard(
    options: ShardOptions & {
      correlationId?: string
      timeout?: number
      keyExtractor?: (thing: {
        id: string
        type: unknown
        branch: string | null
        name: string
        data: Record<string, unknown>
        deleted: boolean
      }) => string
      includeMetadata?: boolean
      targetShards?: string[]
    }
  ): Promise<
    ShardResult & {
      duration: number
      registry: {
        id: string
        shardKey: string
        shardCount: number
        strategy: ShardStrategy
        createdAt: Date
        endpoints: Array<{
          shardIndex: number
          ns: string
          doId: string
          status: 'active' | 'inactive' | 'rebalancing'
        }>
      }
      stats: {
        totalThings: number
        minPerShard: number
        maxPerShard: number
        avgPerShard: number
        stdDev: number
        skewRatio: number
      }
    }
  > {
    return this.shardModule.shard(options)
  }

  /**
   * Unshard (merge) sharded DOs back into one
   *
   * @param options Unshard configuration
   */
  async unshard(options?: UnshardOptions): Promise<void> {
    return this.shardModule.unshard(options)
  }

  /**
   * Check if this DO is sharded
   *
   * @returns True if the DO is sharded
   */
  async isSharded(): Promise<boolean> {
    return this.shardModule.isSharded()
  }

  /**
   * Discover shards in this shard set
   *
   * @returns Registry and health status of all shards
   */
  async discoverShards(): Promise<{
    registry: {
      id: string
      shardKey: string
      shardCount: number
      strategy: ShardStrategy
      createdAt: Date
      endpoints: Array<{
        shardIndex: number
        ns: string
        doId: string
        status: 'active' | 'inactive' | 'rebalancing'
      }>
    }
    health: Array<{
      shardIndex: number
      healthy: boolean
      lastCheck: Date
      responseTime?: number
    }>
  }> {
    return this.shardModule.discoverShards()
  }

  /**
   * Query across all shards
   *
   * @param options Query configuration
   * @returns Aggregated results from all shards
   */
  async queryShards<T = unknown>(options: {
    query: string
    aggregation?: 'merge' | 'concat' | 'sum' | 'count' | 'avg'
    timeout?: number
    continueOnError?: boolean
  }): Promise<{
    data: T[]
    shardResults: Array<{
      shardIndex: number
      itemCount: number
      duration: number
      error?: string
    }>
    totalItems: number
  }> {
    return this.shardModule.queryShards<T>(options)
  }

  /**
   * Rebalance shards (add/remove shards or redistribute data)
   *
   * @param options Rebalance configuration
   * @returns Rebalance result with stats
   */
  async rebalanceShards(options: {
    targetCount?: number
    maxSkew?: number
    strategy?: 'incremental' | 'full'
  }): Promise<{
    itemsMoved: number
    newStats: {
      totalThings: number
      minPerShard: number
      maxPerShard: number
      avgPerShard: number
      stdDev: number
      skewRatio: number
    }
    modifiedShards: number[]
    duration: number
  }> {
    return this.shardModule.rebalanceShards(options)
  }
}

export default DO
