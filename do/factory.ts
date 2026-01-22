/**
 * DO Factory - Makes DO work as both a class and a function
 *
 * This module provides a Proxy-based pattern that allows DO to be used:
 * 1. As a class for extension: `class MyDO extends DO { ... }`
 * 2. As a factory function: `const MyDO = DO({ schema: { ... } })`
 *
 * @module @dotdo/do/factory
 */

import { DO as DOClass } from './DO'
import type { DOEnv, DOOptions } from './types/config'

// ============================================================================
// SCHEMA TYPES (IceType-inspired concise syntax)
// ============================================================================

/**
 * Field modifier suffixes:
 * - `!` = required/unique
 * - `#` = indexed
 * - `?` = optional
 * - `[]` = array
 */
export type FieldModifier = '!' | '#' | '?' | '[]'

/**
 * Relation operators:
 * - `->` = forward relation (belongs to)
 * - `<-` = backward relation (has many)
 * - `~>` = fuzzy/semantic forward relation
 * - `<~` = fuzzy/semantic backward relation
 */
export type RelationOperator = '->' | '<-' | '~>' | '<~'

/**
 * Base field types
 */
export type BaseFieldType =
  | 'string'
  | 'int'
  | 'float'
  | 'decimal'
  | 'boolean'
  | 'uuid'
  | 'datetime'
  | 'json'
  | 'blob'

/**
 * Field definition with optional modifiers
 * Examples: 'string!', 'int?', 'uuid#', 'string[]'
 */
export type FieldDefinition = `${BaseFieldType}${FieldModifier | ''}` | `${BaseFieldType}${FieldModifier}${FieldModifier}`

/**
 * Relation definition
 * Examples: '-> User', '<- Post.author[]', '~> User[]'
 */
export type RelationDefinition = `${RelationOperator} ${string}` | `${RelationOperator} ${string}${FieldModifier}`

/**
 * Entity schema definition
 */
export interface DOEntitySchemaDefinition {
  /** Entity type name */
  $type: string
  /** Partition keys for sharding */
  $partitionBy?: string[]
  /** Index definitions */
  $index?: string[][]
  /** Field definitions - any other key is a field */
  [field: string]: DOFieldDefinition | DORelationDefinition | string | string[] | string[][] | undefined
}

/** Field definition type alias for DO schemas */
export type DOFieldDefinition = FieldDefinition
/** Relation definition type alias for DO schemas */
export type DORelationDefinition = RelationDefinition

/**
 * DO factory configuration
 */
export interface DOFactoryConfig {
  /** Entity schema definitions */
  schema?: Record<string, DOEntitySchemaDefinition>
  /** DO options passed to constructor */
  options?: DOOptions
  /** Built-in agents (can be customized/overridden) */
  agents?: Record<string, AgentConfig>
  /** AI priority mode */
  aiPriority?: 'best' | 'fast' | 'cheap' | 'hybrid'
  /** Enable experiments/A/B testing */
  experiments?: boolean | ExperimentsConfig
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  name: string
  role: string
  prompt?: string
  tools?: string[]
  priority?: 'best' | 'fast' | 'cheap' | 'hybrid'
}

/**
 * Experiments configuration
 */
export interface ExperimentsConfig {
  enabled: boolean
  defaultSampleSize?: number
  metricsEndpoint?: string
}

// ============================================================================
// CLONE/FORK/MOVE TYPES (from v1)
// ============================================================================

/**
 * Clone operation modes
 */
export type CloneMode = 'atomic' | 'staged' | 'eventual' | 'resumable'

/**
 * Clone options
 */
export interface CloneOptions {
  /** Clone mode - determines durability/consistency tradeoffs */
  mode?: CloneMode
  /** Branch to clone from */
  branch?: string
  /** Exclude relationships from clone */
  excludeRelationships?: boolean
  /** Token timeout for staged mode (ms) */
  tokenTimeout?: number
  /** Sync interval for eventual mode (ms) */
  syncInterval?: number
  /** Max divergence for eventual mode */
  maxDivergence?: number
  /** Conflict resolution strategy */
  conflictResolution?: 'last-write-wins' | 'first-write-wins' | 'custom'
}

/**
 * Clone result (atomic mode)
 */
export interface CloneResult {
  targetNs: string
  clonedThings: number
  clonedRelationships: number
}

/**
 * Staged clone prepare result (two-phase commit)
 */
export interface StagedCloneResult {
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

/**
 * Eventual clone handle (async reconciliation)
 */
export interface EventualCloneHandle {
  id: string
  status: 'pending' | 'syncing' | 'paused' | 'completed' | 'cancelled'
  getProgress(): Promise<number>
  getSyncStatus(): Promise<{
    phase: string
    itemsSynced: number
    totalItems: number
    lastSyncAt: Date | null
    divergence: number
    maxDivergence: number
    syncInterval: number
    errorCount: number
    lastError: Error | null
  }>
  pause(): Promise<void>
  resume(): Promise<void>
  sync(): Promise<{ itemsSynced: number; conflicts: unknown[] }>
  cancel(): Promise<void>
}

/**
 * Resumable clone handle (checkpoint-based)
 */
export interface ResumableCloneHandle {
  id: string
  status: string
  checkpoints: Array<{ id: string; itemsCopied: number; timestamp: Date }>
  pause(): Promise<void>
  resume(): Promise<void>
  cancel(): Promise<void>
  getProgress(): Promise<number>
}

/**
 * Fork options
 */
export interface ForkOptions {
  /** Target namespace URL */
  to: string
  /** Branch to fork from */
  branch?: string
}

/**
 * Fork result
 */
export interface ForkResult {
  ns: string
  doId: string
}

/**
 * Move options
 */
export interface MoveOptions {
  /** Whether to merge state with existing target DO (default: false) */
  merge?: boolean
  /** Whether to delete the source DO after successful move (default: true) */
  deleteSource?: boolean
}

/**
 * Move result
 */
export interface MoveResult {
  /** The new DO ID at the target location */
  newDoId: string
  /** The resolved location/region of the target */
  location: string
  /** Whether state was merged (if merge option was true) */
  merged?: boolean
  /** Whether source was deleted (if deleteSource was true) */
  sourceDeleted?: boolean
  /** Number of things migrated */
  thingsMigrated: number
  /** Migration duration in milliseconds */
  durationMs: number
}

// ============================================================================
// COLO TYPES
// ============================================================================

/**
 * Cloudflare colo regions
 */
export type ColoRegion = 'wnam' | 'enam' | 'sam' | 'weur' | 'eeur' | 'apac' | 'oc' | 'afr' | 'me'

/**
 * Colo code (IATA airport codes)
 */
export type ColoCode =
  | 'ewr' | 'lax' | 'cdg' | 'sin' | 'syd' | 'nrt' | 'hkg' | 'gru'
  | 'ord' | 'dfw' | 'iad' | 'sjc' | 'atl' | 'mia' | 'sea' | 'den'
  | 'ams' | 'fra' | 'lhr' | 'mad' | 'mxp' | 'zrh' | 'vie' | 'arn'
  | 'bom' | 'del' | 'hnd' | 'icn' | 'kix' | 'mel' | 'akl' | 'jnb'

/**
 * Colo information for a DO instance
 */
export interface ColoInfo {
  /** The colo code (IATA) */
  code: string
  /** The region hint */
  region: ColoRegion
  /** City name */
  city?: string
  /** Country */
  country?: string
}

// ============================================================================
// EXTENDED DO CLASS WITH MOVE/CLONE/FORK
// ============================================================================

/**
 * Extended DO class with move/clone/fork capabilities
 */
export class DOWithMobility extends DOClass {
  /** Current colo information */
  private _colo: ColoInfo | null = null

  /**
   * Get the current colo information.
   * Available after the first request is processed.
   */
  get $colo(): ColoInfo | null {
    return this._colo
  }

  /**
   * Get the region for this DO instance
   */
  get $region(): ColoRegion | null {
    return this._colo?.region ?? null
  }

  /**
   * Clone this DO to a target namespace
   *
   * @param target - Target namespace URL
   * @param options - Clone options
   * @returns Clone result based on mode
   *
   * @example
   * ```typescript
   * // Atomic clone (default)
   * const result = await this.clone('https://target.do')
   *
   * // Staged clone with two-phase commit
   * const prepared = await this.clone('https://target.do', { mode: 'staged' })
   * await this.commitClone(prepared.token)
   *
   * // Eventual clone with async reconciliation
   * const handle = await this.clone('https://target.do', { mode: 'eventual' })
   * await handle.sync()
   *
   * // Resumable clone with checkpoints
   * const handle = await this.clone('https://target.do', { mode: 'resumable' })
   * ```
   */
  async clone(
    target: string,
    options?: CloneOptions
  ): Promise<CloneResult | StagedCloneResult | EventualCloneHandle | ResumableCloneHandle> {
    const mode = options?.mode ?? 'atomic'

    // Validate target URL
    if (!target.startsWith('https://') && !target.startsWith('http://')) {
      throw new Error(`Invalid target URL: ${target}. Must be a valid https:// URL.`)
    }

    // Get all things to clone
    const allThings = await this.things.list()
    if (allThings.length === 0) {
      throw new Error('No state to clone - source is empty')
    }

    // Get relationships if not excluded
    const relationships = options?.excludeRelationships ? [] : await this.relationships.find({})

    switch (mode) {
      case 'atomic':
        return this._cloneAtomic(target, allThings, relationships)
      case 'staged':
        return this._cloneStaged(target, allThings, relationships, options)
      case 'eventual':
        return this._cloneEventual(target, allThings, relationships, options)
      case 'resumable':
        return this._cloneResumable(target, allThings, relationships, options)
      default:
        throw new Error(`Unknown clone mode: ${mode}`)
    }
  }

  /**
   * Fork this DO to a new independent copy
   *
   * @param options - Fork options
   * @returns Fork result with new namespace and DO ID
   */
  async fork(options: ForkOptions): Promise<ForkResult> {
    const { to, branch } = options

    // Validate target URL
    if (!to.startsWith('https://') && !to.startsWith('http://')) {
      throw new Error(`Invalid target URL: ${to}. Must be a valid https:// URL.`)
    }

    // Get all things to fork
    const allThings = await this.things.list()
    if (allThings.length === 0) {
      throw new Error('No state to fork - source is empty')
    }

    // Clone atomically to target
    const cloneResult = await this._cloneAtomic(to, allThings, await this.relationships.find({}))

    return {
      ns: to,
      doId: cloneResult.targetNs,
    }
  }

  /**
   * Move this DO to a new location
   *
   * @param targetId - Target location (colo code, region hint, or namespace URL)
   * @param options - Move options
   * @returns Move result
   */
  async move(targetId: string, options?: MoveOptions): Promise<MoveResult> {
    const startTime = Date.now()
    const merge = options?.merge ?? false
    const deleteSource = options?.deleteSource ?? true

    // Validate target
    const location = this._normalizeLocation(targetId)

    // Get all things to move
    const allThings = await this.things.list()
    if (allThings.length === 0) {
      throw new Error('No state to move - nothing to migrate')
    }

    // Emit move.started event
    await this.events.emit({
      type: 'move.started',
      payload: { targetLocation: location },
    })

    try {
      // For URL targets, clone to the target
      if (targetId.startsWith('https://') || targetId.startsWith('http://')) {
        await this._cloneAtomic(targetId, allThings, await this.relationships.find({}))
      }

      const durationMs = Date.now() - startTime

      // Emit move.completed event
      await this.events.emit({
        type: 'move.completed',
        payload: {
          location,
          thingsMigrated: allThings.length,
          merged: merge,
          sourceDeleted: deleteSource,
          durationMs,
        },
      })

      return {
        newDoId: targetId,
        location,
        merged: merge,
        sourceDeleted: deleteSource,
        thingsMigrated: allThings.length,
        durationMs,
      }
    } catch (error) {
      // Emit move.failed event
      await this.events.emit({
        type: 'move.failed',
        payload: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  }

  /**
   * Commit a staged clone operation
   */
  async commitClone(token: string): Promise<{ targetNs: string; thingsCloned: number }> {
    // Implementation would commit the staged clone
    throw new Error('Staged clone commit not implemented')
  }

  /**
   * Abort a staged clone operation
   */
  async abortClone(token: string, reason?: string): Promise<void> {
    // Implementation would abort the staged clone
    throw new Error('Staged clone abort not implemented')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Normalize target location to a valid colo/region
   */
  private _normalizeLocation(targetId: string): string {
    if (targetId.startsWith('https://') || targetId.startsWith('http://')) {
      return targetId
    }
    return targetId.toLowerCase()
  }

  /**
   * Atomic clone implementation
   */
  private async _cloneAtomic(
    target: string,
    things: unknown[],
    relationships: unknown[]
  ): Promise<CloneResult> {
    // In real implementation, this would:
    // 1. Serialize all state
    // 2. Send to target DO via RPC
    // 3. Target DO imports the state atomically

    return {
      targetNs: target,
      clonedThings: things.length,
      clonedRelationships: relationships.length,
    }
  }

  /**
   * Staged clone implementation (two-phase commit)
   */
  private async _cloneStaged(
    target: string,
    things: unknown[],
    relationships: unknown[],
    options?: CloneOptions
  ): Promise<StagedCloneResult> {
    const token = crypto.randomUUID()
    const tokenTimeout = options?.tokenTimeout ?? 300000 // 5 minutes default

    return {
      phase: 'prepared',
      token,
      expiresAt: new Date(Date.now() + tokenTimeout),
      stagingNs: `${target}/_staging/${token}`,
      metadata: {
        thingsCount: things.length,
        sizeBytes: JSON.stringify({ things, relationships }).length,
        branch: options?.branch ?? 'main',
        version: 1,
      },
    }
  }

  /**
   * Eventual clone implementation (async reconciliation)
   */
  private async _cloneEventual(
    target: string,
    things: unknown[],
    relationships: unknown[],
    options?: CloneOptions
  ): Promise<EventualCloneHandle> {
    const id = crypto.randomUUID()
    const syncInterval = options?.syncInterval ?? 60000
    const maxDivergence = options?.maxDivergence ?? 100

    return {
      id,
      status: 'pending',
      getProgress: async () => 0,
      getSyncStatus: async () => ({
        phase: 'initializing',
        itemsSynced: 0,
        totalItems: things.length,
        lastSyncAt: null,
        divergence: 0,
        maxDivergence,
        syncInterval,
        errorCount: 0,
        lastError: null,
      }),
      pause: async () => {},
      resume: async () => {},
      sync: async () => ({ itemsSynced: 0, conflicts: [] }),
      cancel: async () => {},
    }
  }

  /**
   * Resumable clone implementation (checkpoint-based)
   */
  private async _cloneResumable(
    target: string,
    things: unknown[],
    relationships: unknown[],
    options?: CloneOptions
  ): Promise<ResumableCloneHandle> {
    const id = crypto.randomUUID()

    return {
      id,
      status: 'initializing',
      checkpoints: [],
      pause: async () => {},
      resume: async () => {},
      cancel: async () => {},
      getProgress: async () => 0,
    }
  }

  /**
   * Override fetch to capture colo information
   */
  async fetch(request: Request): Promise<Response> {
    // Extract colo from request if not already set
    if (!this._colo) {
      const cf = (request as Request & { cf?: { colo?: string } }).cf
      if (cf?.colo) {
        this._colo = {
          code: cf.colo.toLowerCase(),
          region: this._getRegionFromColo(cf.colo),
        }
      }
    }

    return super.fetch(request)
  }

  /**
   * Get region from colo code
   */
  private _getRegionFromColo(colo: string): ColoRegion {
    const coloLower = colo.toLowerCase()

    // North America
    if (['ewr', 'iad', 'ord', 'atl', 'mia'].includes(coloLower)) return 'enam'
    if (['lax', 'sjc', 'sea', 'den', 'dfw'].includes(coloLower)) return 'wnam'

    // South America
    if (['gru'].includes(coloLower)) return 'sam'

    // Europe
    if (['lhr', 'cdg', 'ams', 'fra', 'mad', 'mxp', 'zrh'].includes(coloLower)) return 'weur'
    if (['vie', 'arn'].includes(coloLower)) return 'eeur'

    // Asia Pacific
    if (['sin', 'hkg', 'nrt', 'hnd', 'icn', 'kix', 'bom', 'del'].includes(coloLower)) return 'apac'

    // Oceania
    if (['syd', 'mel', 'akl'].includes(coloLower)) return 'oc'

    // Africa
    if (['jnb'].includes(coloLower)) return 'afr'

    // Default to western North America
    return 'wnam'
  }
}

// ============================================================================
// DO FACTORY FUNCTION
// ============================================================================

/**
 * Create a configured DO class from a factory config
 */
function createDOClass(config: DOFactoryConfig): typeof DOWithMobility {
  const { schema, options, agents, aiPriority, experiments } = config

  // Create a new class that extends DOWithMobility with the config baked in
  return class ConfiguredDO extends DOWithMobility {
    // Store config as static properties
    static readonly _schema = schema
    static readonly _agents = agents
    static readonly _aiPriority = aiPriority
    static readonly _experiments = experiments

    constructor(state: DurableObjectState, env: DOEnv) {
      super(state, env, options)
    }
  }
}

// ============================================================================
// PROXY-BASED DO EXPORT
// ============================================================================

/**
 * The DO export that works as both a class and a function
 *
 * Usage as class:
 * ```typescript
 * class MyDO extends DO {
 *   // Custom methods
 * }
 * ```
 *
 * Usage as factory:
 * ```typescript
 * const MyDO = DO({
 *   schema: {
 *     Customer: { $type: 'Customer', name: 'string!', email: 'string#' },
 *     Order: { $type: 'Order', total: 'decimal!', customer: '-> Customer' },
 *   },
 *   aiPriority: 'best',
 *   experiments: true,
 * })
 * ```
 */
export const DO = new Proxy(DOWithMobility, {
  /**
   * Handle function call: DO({ schema: { ... } })
   */
  apply(target, thisArg, [config]: [DOFactoryConfig]) {
    return createDOClass(config)
  },

  /**
   * Handle constructor: new DO(state, env) or extends DO
   */
  construct(target, args, newTarget) {
    // If newTarget is different from target, it's being extended
    // Otherwise it's being instantiated directly
    return Reflect.construct(target, args, newTarget)
  },
})

// ============================================================================
// BUSINESS SUBCLASSES
// ============================================================================

/**
 * Business DO - Foundation for Business-as-Code
 *
 * Includes built-in analytics, finance tracking, experiments, and OKRs.
 */
export class Business extends DOWithMobility {
  // Analytics aggregations on events
  async getMRR(): Promise<number> {
    // Implementation would aggregate from events
    return 0
  }

  async getARR(): Promise<number> {
    return (await this.getMRR()) * 12
  }

  async getChurn(): Promise<number> {
    // Implementation would calculate churn from events
    return 0
  }

  async getNRR(): Promise<number> {
    // Net Revenue Retention
    return 100
  }
}

/**
 * SaaS DO - Software as a Service foundation
 */
export class SaaS extends Business {
  // SaaS-specific metrics and capabilities
}

/**
 * IaaS DO - Infrastructure as a Service foundation
 */
export class IaaS extends Business {
  // IaaS-specific metrics and capabilities
}

/**
 * PaaS DO - Platform as a Service foundation
 */
export class PaaS extends Business {
  // PaaS-specific metrics and capabilities
}

/**
 * SaS DO - Services as Software foundation
 */
export class SaS extends Business {
  // SaS-specific metrics and capabilities
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * DO type that includes both class and function signatures
 */
export type DOType = typeof DOWithMobility & {
  (config: DOFactoryConfig): typeof DOWithMobility
}

// Re-export the DO as the correct type
export default DO as DOType
