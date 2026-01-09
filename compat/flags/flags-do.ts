/**
 * Feature Flags DO Integration
 *
 * Durable Object implementation for feature flags storage with:
 * - SQLite persistence
 * - Sharding and routing
 * - Evaluation caching
 * - Segment resolution
 * - Targeting rule evaluation
 * - Streaming updates
 *
 * @module @dotdo/compat/flags/do-integration
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Flag value types supported
 */
type FlagValue = boolean | string | number | object | null

/**
 * Flag variation with value and metadata
 */
interface FlagVariation<T = FlagValue> {
  value: T
  label?: string
  weight?: number
}

/**
 * Targeting clause for rule evaluation
 */
interface TargetingClause {
  contextKind?: string
  attribute: string
  operator: 'in' | 'startsWith' | 'endsWith' | 'matches' | 'contains' |
            'lessThan' | 'lessThanOrEqual' | 'greaterThan' | 'greaterThanOrEqual' |
            'semVerEqual' | 'semVerLessThan' | 'semVerGreaterThan'
  values: unknown[]
  negate?: boolean
}

/**
 * Rollout configuration for percentage-based flag delivery
 */
interface Rollout<T = FlagValue> {
  variations: Array<{ value: T; weight: number }>
  bucketBy?: string
  seed?: number
}

/**
 * Targeting rule with clauses and variation/rollout
 */
interface TargetingRule<T = FlagValue> {
  id: string
  description?: string
  clauses: TargetingClause[]
  variation?: T
  rollout?: Rollout<T>
}

/**
 * Prerequisite flag dependency
 */
interface Prerequisite {
  key: string
  variation: unknown
}

/**
 * Segment definition for targeting groups of users
 */
interface Segment {
  key: string
  name?: string
  description?: string
  included: string[]
  excluded: string[]
  rules?: TargetingRule<boolean>[]
  createdAt: string
  updatedAt: string
}

/**
 * Complete flag definition stored in DO
 */
interface FlagDefinition<T = FlagValue> {
  key: string
  defaultValue: T
  description?: string
  variations?: FlagVariation<T>[]
  targeting?: TargetingRule<T>[]
  prerequisites?: Prerequisite[]
  tags?: string[]
  temporary?: boolean
  enabled?: boolean
  version: number
  createdAt: string
  updatedAt: string
}

/**
 * Stored flag with DO metadata
 */
interface StoredFlag<T = FlagValue> extends FlagDefinition<T> {
  _id: string
  _storedAt: string
  _shardIndex: number
}

/**
 * Evaluation context for flag resolution
 */
interface EvaluationContext {
  targetingKey?: string
  [key: string]: unknown
}

/**
 * Cached evaluation result
 */
interface CachedEvaluation<T = FlagValue> {
  flagKey: string
  contextHash: string
  value: T
  reason: string
  variant?: number
  cachedAt: string
  expiresAt: string
}

/**
 * Flag change event for streaming
 */
interface FlagChangeEvent<T = FlagValue> {
  type: 'flag_created' | 'flag_updated' | 'flag_deleted' | 'flag_enabled' | 'flag_disabled'
  flagKey: string
  oldValue?: FlagDefinition<T>
  newValue?: FlagDefinition<T>
  timestamp: string
  version: number
}

/**
 * Flags DO configuration
 */
interface FlagsDOConfig {
  shardCount: number
  shardKey: 'prefix' | 'hash'
  cacheTTLSeconds: number
  enableStreaming: boolean
}

/**
 * Shard routing result
 */
interface ShardRoutingResult {
  shardIndex: number
  doId: string
  ns: string
}

/**
 * Flag query options
 */
interface FlagQueryOptions {
  prefix?: string
  tags?: string[]
  enabled?: boolean
  temporary?: boolean
  limit?: number
  offset?: number
}

/**
 * Flag query result
 */
interface FlagQueryResult<T = FlagValue> {
  flags: StoredFlag<T>[]
  total: number
  meta: {
    shardsQueried: number
    duration: number
  }
}

/**
 * Storage statistics
 */
interface FlagStorageStats {
  totalFlags: number
  enabledFlags: number
  disabledFlags: number
  temporaryFlags: number
  totalSegments: number
  cacheEntries: number
  sizeBytes: number
}

/**
 * Edge cache configuration
 */
interface EdgeCacheConfig {
  enabled: boolean
  ttlSeconds: number
  staleWhileRevalidateSeconds: number
  tags: string[]
}

/**
 * Audit log entry
 */
interface AuditLogEntry {
  id: string
  timestamp: string
  action: 'create' | 'update' | 'delete' | 'enable' | 'disable' | 'rollback'
  flagKey: string
  userId?: string
  metadata?: Record<string, unknown>
  previousVersion?: number
  newVersion?: number
  changes?: Record<string, { old: unknown; new: unknown }>
}

/**
 * Flag snapshot for rollback
 */
interface FlagSnapshot {
  id: string
  flagKey: string
  version: number
  snapshot: StoredFlag
  timestamp: string
  reason?: string
}

/**
 * Shard information
 */
interface ShardInfo {
  shardIndex: number
  totalShards: number
  shardKey: string
  registryId: string
}

/**
 * Streaming subscription
 */
interface StreamSubscription {
  id: string
  flagKeys: string[] | '*'
  callback: (event: FlagChangeEvent) => void
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Get current ISO timestamp
 */
function now(): string {
  return new Date().toISOString()
}

/**
 * Hash a string for consistent bucketing
 */
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

/**
 * Get shard index from key
 */
function getShardIndex(key: string, shardCount: number, shardKey: 'prefix' | 'hash'): number {
  if (shardKey === 'prefix') {
    // Get prefix (everything before first dash)
    const prefix = key.split('-')[0] || key
    return hashString(prefix) % shardCount
  }
  return hashString(key) % shardCount
}

/**
 * Hash evaluation context for caching
 */
function hashContext(context: EvaluationContext): string {
  return JSON.stringify(context, Object.keys(context).sort())
}

/**
 * Get bucket value for rollouts (0-100000)
 */
function getBucket(key: string, seed?: number): number {
  const seedStr = seed !== undefined ? String(seed) : ''
  const hash = hashString(`${seedStr}${key}`)
  return hash % 100000
}

/**
 * Evaluate a single clause against context
 */
function evaluateClause(clause: TargetingClause, context: EvaluationContext): boolean {
  const value = context[clause.attribute]

  let matches = false

  switch (clause.operator) {
    case 'in':
      matches = clause.values.some(v => v === value)
      break
    case 'startsWith':
      matches = typeof value === 'string' &&
        clause.values.some(v => typeof v === 'string' && value.startsWith(v))
      break
    case 'endsWith':
      matches = typeof value === 'string' &&
        clause.values.some(v => typeof v === 'string' && value.endsWith(v))
      break
    case 'contains':
      matches = typeof value === 'string' &&
        clause.values.some(v => typeof v === 'string' && value.includes(v))
      break
    case 'matches':
      matches = typeof value === 'string' &&
        clause.values.some(v => {
          if (typeof v === 'string') {
            try {
              return new RegExp(v).test(value)
            } catch {
              return false
            }
          }
          return false
        })
      break
    case 'lessThan':
      matches = typeof value === 'number' &&
        clause.values.some(v => typeof v === 'number' && value < v)
      break
    case 'lessThanOrEqual':
      matches = typeof value === 'number' &&
        clause.values.some(v => typeof v === 'number' && value <= v)
      break
    case 'greaterThan':
      matches = typeof value === 'number' &&
        clause.values.some(v => typeof v === 'number' && value > v)
      break
    case 'greaterThanOrEqual':
      matches = typeof value === 'number' &&
        clause.values.some(v => typeof v === 'number' && value >= v)
      break
    default:
      matches = false
  }

  return clause.negate ? !matches : matches
}

/**
 * Check if targeting rule matches context
 */
function matchesTargeting(rule: TargetingRule, context: EvaluationContext): boolean {
  // All clauses must match (AND logic)
  for (const clause of rule.clauses) {
    if (!(clause.attribute in context)) {
      if (!clause.negate) {
        return false
      }
    }

    if (!evaluateClause(clause, context)) {
      return false
    }
  }

  return true
}

// ============================================================================
// FLAGS DO CLASS
// ============================================================================

/**
 * Flags Durable Object for feature flag storage
 */
export class FlagsDO {
  private ctx: DurableObjectState
  private env: unknown
  private config: FlagsDOConfig
  private flags: Map<string, StoredFlag> = new Map()
  private segments: Map<string, Segment> = new Map()
  private evaluationCache: Map<string, CachedEvaluation> = new Map()
  private changeEvents: FlagChangeEvent[] = []
  private subscriptions: Map<string, StreamSubscription> = new Map()
  private auditLog: AuditLogEntry[] = []
  private snapshots: Map<string, FlagSnapshot[]> = new Map()
  private edgeCacheConfig: EdgeCacheConfig
  private shardIndex?: number
  private initialized = false

  constructor(ctx: DurableObjectState, env: unknown) {
    this.ctx = ctx
    this.env = env
    this.config = {
      shardCount: 1,
      shardKey: 'prefix',
      cacheTTLSeconds: 300,
      enableStreaming: true,
    }
    this.edgeCacheConfig = {
      enabled: true,
      ttlSeconds: 60,
      staleWhileRevalidateSeconds: 300,
      tags: ['flags'],
    }
  }

  /**
   * Initialize from storage
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return

    // Load config from storage
    const storedConfig = await this.ctx.storage.get<FlagsDOConfig>('config')
    if (storedConfig) {
      this.config = storedConfig
    }

    // Load flags from storage
    const flagsMap = await this.ctx.storage.list<StoredFlag>({ prefix: 'flag:' })
    for (const [key, value] of flagsMap) {
      const flagKey = key.replace('flag:', '')
      this.flags.set(flagKey, value)
    }

    // Load segments from storage
    const segmentsMap = await this.ctx.storage.list<Segment>({ prefix: 'segment:' })
    for (const [key, value] of segmentsMap) {
      const segmentKey = key.replace('segment:', '')
      this.segments.set(segmentKey, value)
    }

    // Load cache from storage
    const cacheMap = await this.ctx.storage.list<CachedEvaluation>({ prefix: 'cache:' })
    for (const [key, value] of cacheMap) {
      this.evaluationCache.set(key.replace('cache:', ''), value)
    }

    // Load change events (keep last 1000)
    const eventsData = await this.ctx.storage.get<FlagChangeEvent[]>('changeEvents')
    if (eventsData) {
      this.changeEvents = eventsData.slice(-1000)
    }

    // Load audit log (keep last 5000)
    const auditData = await this.ctx.storage.get<AuditLogEntry[]>('auditLog')
    if (auditData) {
      this.auditLog = auditData.slice(-5000)
    }

    // Load snapshots from storage
    const snapshotsMap = await this.ctx.storage.list<FlagSnapshot[]>({ prefix: 'snapshot:' })
    for (const [key, value] of snapshotsMap) {
      const flagKey = key.replace('snapshot:', '')
      this.snapshots.set(flagKey, value)
    }

    // Load edge cache config
    const edgeCacheData = await this.ctx.storage.get<EdgeCacheConfig>('edgeCacheConfig')
    if (edgeCacheData) {
      this.edgeCacheConfig = edgeCacheData
    }

    this.initialized = true
  }

  /**
   * Save flag to storage
   */
  private async saveFlag(flag: StoredFlag): Promise<void> {
    this.flags.set(flag.key, flag)
    await this.ctx.storage.put(`flag:${flag.key}`, flag)
  }

  /**
   * Delete flag from storage
   */
  private async removeFlag(key: string): Promise<boolean> {
    if (!this.flags.has(key)) return false
    this.flags.delete(key)
    await this.ctx.storage.delete(`flag:${key}`)
    return true
  }

  /**
   * Save segment to storage
   */
  private async saveSegment(segment: Segment): Promise<void> {
    this.segments.set(segment.key, segment)
    await this.ctx.storage.put(`segment:${segment.key}`, segment)
  }

  /**
   * Delete segment from storage
   */
  private async removeSegment(key: string): Promise<boolean> {
    if (!this.segments.has(key)) return false
    this.segments.delete(key)
    await this.ctx.storage.delete(`segment:${key}`)
    return true
  }

  /**
   * Save cache entry to storage
   */
  private async saveCacheEntry(key: string, entry: CachedEvaluation): Promise<void> {
    this.evaluationCache.set(key, entry)
    await this.ctx.storage.put(`cache:${key}`, entry)
  }

  /**
   * Delete cache entry from storage
   */
  private async removeCacheEntry(key: string): Promise<void> {
    this.evaluationCache.delete(key)
    await this.ctx.storage.delete(`cache:${key}`)
  }

  /**
   * Add change event
   */
  private async addChangeEvent(event: FlagChangeEvent): Promise<void> {
    this.changeEvents.push(event)
    // Keep only last 1000 events
    if (this.changeEvents.length > 1000) {
      this.changeEvents = this.changeEvents.slice(-1000)
    }
    await this.ctx.storage.put('changeEvents', this.changeEvents)

    // Notify subscriptions
    this.notifySubscribers(event)
  }

  /**
   * Notify subscribers of change event
   */
  private notifySubscribers(event: FlagChangeEvent): void {
    for (const subscription of this.subscriptions.values()) {
      const matches = subscription.flagKeys === '*' ||
        subscription.flagKeys.includes(event.flagKey)
      if (matches) {
        try {
          subscription.callback(event)
        } catch {
          // Ignore callback errors
        }
      }
    }
  }

  // ==========================================================================
  // FLAG CRUD OPERATIONS
  // ==========================================================================

  /**
   * Create a new flag
   */
  async createFlag<T = FlagValue>(
    flag: Omit<FlagDefinition<T>, 'version' | 'createdAt' | 'updatedAt'>
  ): Promise<StoredFlag<T>> {
    await this.initialize()

    // Check for duplicate
    if (this.flags.has(flag.key)) {
      throw new Error(`Flag with key '${flag.key}' already exists`)
    }

    const timestamp = now()
    const storedFlag: StoredFlag<T> = {
      ...flag,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      _id: generateId(),
      _storedAt: timestamp,
      _shardIndex: getShardIndex(flag.key, this.config.shardCount, this.config.shardKey),
    }

    await this.saveFlag(storedFlag as StoredFlag)

    // Emit change event
    await this.addChangeEvent({
      type: 'flag_created',
      flagKey: flag.key,
      newValue: storedFlag as FlagDefinition,
      timestamp,
      version: 1,
    })

    return storedFlag
  }

  /**
   * Get a flag by key
   */
  async getFlag<T = FlagValue>(key: string): Promise<StoredFlag<T> | null> {
    await this.initialize()
    return (this.flags.get(key) as StoredFlag<T>) || null
  }

  /**
   * Update a flag
   */
  async updateFlag<T = FlagValue>(
    key: string,
    updates: Partial<FlagDefinition<T>>
  ): Promise<StoredFlag<T>> {
    await this.initialize()

    const existing = this.flags.get(key)
    if (!existing) {
      throw new Error(`Flag with key '${key}' not found`)
    }

    const oldValue = { ...existing } as FlagDefinition<T>
    const timestamp = now()
    const updatedFlag: StoredFlag<T> = {
      ...existing,
      ...updates,
      key, // Key cannot be changed
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: timestamp,
      _id: existing._id,
      _storedAt: existing._storedAt,
      _shardIndex: existing._shardIndex,
    } as StoredFlag<T>

    await this.saveFlag(updatedFlag as StoredFlag)

    // Emit change event
    await this.addChangeEvent({
      type: 'flag_updated',
      flagKey: key,
      oldValue,
      newValue: updatedFlag as FlagDefinition,
      timestamp,
      version: updatedFlag.version,
    })

    return updatedFlag
  }

  /**
   * Delete a flag
   */
  async deleteFlag(key: string): Promise<boolean> {
    await this.initialize()

    const existing = this.flags.get(key)
    if (!existing) {
      return false
    }

    const deleted = await this.removeFlag(key)

    if (deleted) {
      // Emit change event
      await this.addChangeEvent({
        type: 'flag_deleted',
        flagKey: key,
        oldValue: existing as FlagDefinition,
        timestamp: now(),
        version: existing.version,
      })
    }

    return deleted
  }

  /**
   * List flags with optional filters
   */
  async listFlags<T = FlagValue>(options: FlagQueryOptions = {}): Promise<FlagQueryResult<T>> {
    await this.initialize()

    const startTime = Date.now()
    let flags = Array.from(this.flags.values()) as StoredFlag<T>[]

    // Apply filters
    if (options.prefix) {
      flags = flags.filter(f => f.key.startsWith(options.prefix!))
    }

    if (options.tags && options.tags.length > 0) {
      flags = flags.filter(f =>
        f.tags && options.tags!.some(tag => f.tags!.includes(tag))
      )
    }

    if (options.enabled !== undefined) {
      flags = flags.filter(f => f.enabled === options.enabled)
    }

    if (options.temporary !== undefined) {
      flags = flags.filter(f => f.temporary === options.temporary)
    }

    const total = flags.length

    // Apply pagination
    const offset = options.offset || 0
    const limit = options.limit || flags.length
    flags = flags.slice(offset, offset + limit)

    // Determine shards queried
    let shardsQueried = 1
    if (this.config.shardCount > 1 && !options.prefix) {
      // If no prefix filter, all shards would be queried
      shardsQueried = this.config.shardCount
    }

    return {
      flags,
      total,
      meta: {
        shardsQueried,
        duration: Date.now() - startTime,
      },
    }
  }

  /**
   * Enable a flag
   */
  async enableFlag(key: string): Promise<StoredFlag> {
    await this.initialize()

    const existing = this.flags.get(key)
    if (!existing) {
      throw new Error(`Flag with key '${key}' not found`)
    }

    const timestamp = now()
    const updated = await this.updateFlag(key, { enabled: true })

    // Emit enable event
    await this.addChangeEvent({
      type: 'flag_enabled',
      flagKey: key,
      oldValue: existing as FlagDefinition,
      newValue: updated as FlagDefinition,
      timestamp,
      version: updated.version,
    })

    return updated
  }

  /**
   * Disable a flag
   */
  async disableFlag(key: string): Promise<StoredFlag> {
    await this.initialize()

    const existing = this.flags.get(key)
    if (!existing) {
      throw new Error(`Flag with key '${key}' not found`)
    }

    const timestamp = now()
    const updated = await this.updateFlag(key, { enabled: false })

    // Emit disable event
    await this.addChangeEvent({
      type: 'flag_disabled',
      flagKey: key,
      oldValue: existing as FlagDefinition,
      newValue: updated as FlagDefinition,
      timestamp,
      version: updated.version,
    })

    return updated
  }

  // ==========================================================================
  // SHARDING OPERATIONS
  // ==========================================================================

  /**
   * Route a flag key to a shard
   */
  async routeFlag(key: string): Promise<ShardRoutingResult> {
    await this.initialize()

    const shardIndex = getShardIndex(key, this.config.shardCount, this.config.shardKey)

    return {
      shardIndex,
      doId: `shard-${shardIndex}`,
      ns: `flags-shard-${shardIndex}`,
    }
  }

  /**
   * Check if this DO is sharded
   */
  async isSharded(): Promise<boolean> {
    await this.initialize()
    return this.config.shardCount > 1
  }

  /**
   * Get shard information
   */
  async getShardInfo(): Promise<ShardInfo | null> {
    await this.initialize()

    if (this.config.shardCount <= 1) {
      return null
    }

    return {
      shardIndex: this.shardIndex || 0,
      totalShards: this.config.shardCount,
      shardKey: this.config.shardKey,
      registryId: this.ctx.id.toString(),
    }
  }

  // ==========================================================================
  // EVALUATION CACHING
  // ==========================================================================

  /**
   * Cache an evaluation result
   */
  async cacheEvaluation<T = FlagValue>(
    flagKey: string,
    context: EvaluationContext,
    value: T,
    reason: string,
    variant?: number
  ): Promise<CachedEvaluation<T>> {
    await this.initialize()

    const contextHash = hashContext(context)
    const cachedAt = now()
    const expiresAt = new Date(Date.now() + this.config.cacheTTLSeconds * 1000).toISOString()

    const entry: CachedEvaluation<T> = {
      flagKey,
      contextHash,
      value,
      reason,
      variant,
      cachedAt,
      expiresAt,
    }

    const cacheKey = `${flagKey}:${contextHash}`
    await this.saveCacheEntry(cacheKey, entry as CachedEvaluation)

    return entry
  }

  /**
   * Get cached evaluation
   */
  async getCachedEvaluation<T = FlagValue>(
    flagKey: string,
    context: EvaluationContext
  ): Promise<CachedEvaluation<T> | null> {
    await this.initialize()

    const contextHash = hashContext(context)
    const cacheKey = `${flagKey}:${contextHash}`
    const entry = this.evaluationCache.get(cacheKey)

    if (!entry) {
      return null
    }

    // Check expiration
    if (new Date(entry.expiresAt).getTime() < Date.now()) {
      await this.removeCacheEntry(cacheKey)
      return null
    }

    return entry as CachedEvaluation<T>
  }

  /**
   * Invalidate cache
   */
  async invalidateCache(flagKey?: string): Promise<number> {
    await this.initialize()

    let count = 0

    if (flagKey) {
      // Invalidate cache for specific flag
      for (const key of this.evaluationCache.keys()) {
        if (key.startsWith(`${flagKey}:`)) {
          await this.removeCacheEntry(key)
          count++
        }
      }
    } else {
      // Invalidate all cache
      count = this.evaluationCache.size
      for (const key of this.evaluationCache.keys()) {
        await this.removeCacheEntry(key)
      }
    }

    return count
  }

  // ==========================================================================
  // SEGMENT OPERATIONS
  // ==========================================================================

  /**
   * Create a segment
   */
  async createSegment(
    segment: Omit<Segment, 'createdAt' | 'updatedAt'>
  ): Promise<Segment> {
    await this.initialize()

    if (this.segments.has(segment.key)) {
      throw new Error(`Segment with key '${segment.key}' already exists`)
    }

    const timestamp = now()
    const stored: Segment = {
      ...segment,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    await this.saveSegment(stored)
    return stored
  }

  /**
   * Get a segment by key
   */
  async getSegment(key: string): Promise<Segment | null> {
    await this.initialize()
    return this.segments.get(key) || null
  }

  /**
   * Update a segment
   */
  async updateSegment(
    key: string,
    updates: Partial<Segment>
  ): Promise<Segment> {
    await this.initialize()

    const existing = this.segments.get(key)
    if (!existing) {
      throw new Error(`Segment with key '${key}' not found`)
    }

    const updated: Segment = {
      ...existing,
      ...updates,
      key, // Key cannot be changed
      createdAt: existing.createdAt,
      updatedAt: now(),
    }

    await this.saveSegment(updated)
    return updated
  }

  /**
   * Delete a segment
   */
  async deleteSegment(key: string): Promise<boolean> {
    await this.initialize()
    return await this.removeSegment(key)
  }

  /**
   * List all segments
   */
  async listSegments(): Promise<Segment[]> {
    await this.initialize()
    return Array.from(this.segments.values())
  }

  /**
   * Resolve if a context is in a segment
   */
  async resolveSegment(segmentKey: string, context: EvaluationContext): Promise<boolean> {
    await this.initialize()

    const segment = this.segments.get(segmentKey)
    if (!segment) {
      throw new Error(`Segment with key '${segmentKey}' not found`)
    }

    const targetingKey = context.targetingKey

    // Check exclusion first (takes precedence)
    if (targetingKey && segment.excluded.includes(targetingKey)) {
      return false
    }

    // Check explicit inclusion
    if (targetingKey && segment.included.includes(targetingKey)) {
      return true
    }

    // Check rules
    if (segment.rules && segment.rules.length > 0) {
      for (const rule of segment.rules) {
        if (rule.clauses.length === 0 || matchesTargeting(rule, context)) {
          return rule.variation === true
        }
      }
    }

    // Not in segment
    return false
  }

  // ==========================================================================
  // TARGETING RULE OPERATIONS
  // ==========================================================================

  /**
   * Evaluate targeting rules for a flag
   */
  async evaluateTargeting<T = FlagValue>(
    flagKey: string,
    context: EvaluationContext
  ): Promise<{ value: T; reason: string; variant?: number }> {
    await this.initialize()

    const flag = this.flags.get(flagKey)
    if (!flag) {
      throw new Error(`Flag with key '${flagKey}' not found`)
    }

    // Check if disabled
    if (flag.enabled === false) {
      return {
        value: flag.defaultValue as T,
        reason: 'DISABLED',
      }
    }

    // No targeting rules - return default
    if (!flag.targeting || flag.targeting.length === 0) {
      return {
        value: flag.defaultValue as T,
        reason: 'DEFAULT',
      }
    }

    // Evaluate rules in order
    for (const rule of flag.targeting) {
      const clausesMatch = rule.clauses.length === 0 || matchesTargeting(rule, context)

      if (clausesMatch) {
        // Check for rollout
        if (rule.rollout) {
          const bucketBy = rule.rollout.bucketBy || 'targetingKey'
          const bucketValue = context[bucketBy]

          if (bucketValue === undefined || bucketValue === null) {
            return {
              value: flag.defaultValue as T,
              reason: 'ERROR',
            }
          }

          const bucket = getBucket(String(bucketValue), rule.rollout.seed)

          let cumulative = 0
          for (let i = 0; i < rule.rollout.variations.length; i++) {
            const rolloutVar = rule.rollout.variations[i]
            cumulative += rolloutVar.weight * 1000 // Convert to 0-100000 range
            if (bucket < cumulative) {
              return {
                value: rolloutVar.value as T,
                reason: 'SPLIT',
                variant: i,
              }
            }
          }

          // Fallback to last variation
          const last = rule.rollout.variations[rule.rollout.variations.length - 1]
          return {
            value: last.value as T,
            reason: 'SPLIT',
            variant: rule.rollout.variations.length - 1,
          }
        }

        // Fixed variation
        if (rule.variation !== undefined) {
          return {
            value: rule.variation as T,
            reason: 'TARGETING_MATCH',
          }
        }
      }
    }

    // No rules matched
    return {
      value: flag.defaultValue as T,
      reason: 'DEFAULT',
    }
  }

  /**
   * Add a targeting rule to a flag
   */
  async addTargetingRule<T = FlagValue>(
    flagKey: string,
    rule: TargetingRule<T>
  ): Promise<StoredFlag<T>> {
    await this.initialize()

    const flag = this.flags.get(flagKey)
    if (!flag) {
      throw new Error(`Flag with key '${flagKey}' not found`)
    }

    const targeting = [...(flag.targeting || []), rule]
    return this.updateFlag<T>(flagKey, { targeting: targeting as TargetingRule<T>[] })
  }

  /**
   * Remove a targeting rule from a flag
   */
  async removeTargetingRule(flagKey: string, ruleId: string): Promise<StoredFlag> {
    await this.initialize()

    const flag = this.flags.get(flagKey)
    if (!flag) {
      throw new Error(`Flag with key '${flagKey}' not found`)
    }

    const targeting = (flag.targeting || []).filter(r => r.id !== ruleId)
    return this.updateFlag(flagKey, { targeting })
  }

  /**
   * Reorder targeting rules
   */
  async reorderTargetingRules(flagKey: string, ruleIds: string[]): Promise<StoredFlag> {
    await this.initialize()

    const flag = this.flags.get(flagKey)
    if (!flag) {
      throw new Error(`Flag with key '${flagKey}' not found`)
    }

    const rulesMap = new Map((flag.targeting || []).map(r => [r.id, r]))
    const reordered = ruleIds.map(id => rulesMap.get(id)).filter(Boolean) as TargetingRule[]

    return this.updateFlag(flagKey, { targeting: reordered })
  }

  // ==========================================================================
  // STREAMING OPERATIONS
  // ==========================================================================

  /**
   * Subscribe to flag changes
   */
  async subscribe(
    subscription: Omit<StreamSubscription, 'id'>
  ): Promise<StreamSubscription> {
    await this.initialize()

    const id = generateId()
    const sub: StreamSubscription = {
      id,
      ...subscription,
    }

    this.subscriptions.set(id, sub)
    return sub
  }

  /**
   * Unsubscribe from flag changes
   */
  async unsubscribe(subscriptionId: string): Promise<boolean> {
    await this.initialize()

    if (!this.subscriptions.has(subscriptionId)) {
      return false
    }

    this.subscriptions.delete(subscriptionId)
    return true
  }

  /**
   * Get changes since a timestamp
   */
  async getChangesSince(timestamp: string): Promise<FlagChangeEvent[]> {
    await this.initialize()

    const since = new Date(timestamp).getTime()
    return this.changeEvents.filter(e => new Date(e.timestamp).getTime() > since)
  }

  /**
   * Stream changes as a ReadableStream
   */
  async streamChanges(since?: string): Promise<ReadableStream<FlagChangeEvent>> {
    await this.initialize()

    const events = since ? await this.getChangesSince(since) : this.changeEvents.slice()
    const self = this

    return new ReadableStream<FlagChangeEvent>({
      start(controller) {
        // Send existing events
        for (const event of events) {
          controller.enqueue(event)
        }
      },
      pull(controller) {
        // Subscribe to new events
        const subscription: StreamSubscription = {
          id: generateId(),
          flagKeys: '*',
          callback: (event) => {
            controller.enqueue(event)
          },
        }
        self.subscriptions.set(subscription.id, subscription)
      },
      cancel() {
        // Cleanup handled by GC
      },
    })
  }

  // ==========================================================================
  // AUDIT LOG OPERATIONS
  // ==========================================================================

  /**
   * Add audit log entry
   */
  private async addAuditLogEntry(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<AuditLogEntry> {
    const fullEntry: AuditLogEntry = {
      id: generateId(),
      timestamp: now(),
      ...entry,
    }

    this.auditLog.push(fullEntry)
    // Keep only last 5000 entries
    if (this.auditLog.length > 5000) {
      this.auditLog = this.auditLog.slice(-5000)
    }
    await this.ctx.storage.put('auditLog', this.auditLog)

    return fullEntry
  }

  /**
   * Get audit log entries
   */
  async getAuditLog(options: {
    flagKey?: string
    action?: AuditLogEntry['action']
    since?: string
    limit?: number
    offset?: number
  } = {}): Promise<{ entries: AuditLogEntry[]; total: number }> {
    await this.initialize()

    let entries = [...this.auditLog]

    // Apply filters
    if (options.flagKey) {
      entries = entries.filter(e => e.flagKey === options.flagKey)
    }
    if (options.action) {
      entries = entries.filter(e => e.action === options.action)
    }
    if (options.since) {
      const sinceTime = new Date(options.since).getTime()
      entries = entries.filter(e => new Date(e.timestamp).getTime() > sinceTime)
    }

    // Sort by timestamp descending (most recent first)
    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    const total = entries.length

    // Apply pagination
    const offset = options.offset || 0
    const limit = options.limit || entries.length
    entries = entries.slice(offset, offset + limit)

    return { entries, total }
  }

  // ==========================================================================
  // SNAPSHOT AND ROLLBACK OPERATIONS
  // ==========================================================================

  /**
   * Create snapshot of a flag for rollback
   */
  private async createSnapshot(flag: StoredFlag, reason?: string): Promise<FlagSnapshot> {
    const snapshot: FlagSnapshot = {
      id: generateId(),
      flagKey: flag.key,
      version: flag.version,
      snapshot: { ...flag },
      timestamp: now(),
      reason,
    }

    const flagSnapshots = this.snapshots.get(flag.key) || []
    flagSnapshots.push(snapshot)

    // Keep only last 50 snapshots per flag
    const trimmedSnapshots = flagSnapshots.slice(-50)
    this.snapshots.set(flag.key, trimmedSnapshots)
    await this.ctx.storage.put(`snapshot:${flag.key}`, trimmedSnapshots)

    return snapshot
  }

  /**
   * Get snapshots for a flag
   */
  async getSnapshots(flagKey: string): Promise<FlagSnapshot[]> {
    await this.initialize()
    return this.snapshots.get(flagKey) || []
  }

  /**
   * Get a specific snapshot by version
   */
  async getSnapshotByVersion(flagKey: string, version: number): Promise<FlagSnapshot | null> {
    await this.initialize()
    const snapshots = this.snapshots.get(flagKey) || []
    return snapshots.find(s => s.version === version) || null
  }

  /**
   * Rollback a flag to a previous version
   */
  async rollbackFlag(flagKey: string, targetVersion: number, userId?: string): Promise<StoredFlag> {
    await this.initialize()

    const currentFlag = this.flags.get(flagKey)
    if (!currentFlag) {
      throw new Error(`Flag with key '${flagKey}' not found`)
    }

    const targetSnapshot = await this.getSnapshotByVersion(flagKey, targetVersion)
    if (!targetSnapshot) {
      throw new Error(`Snapshot for version ${targetVersion} of flag '${flagKey}' not found`)
    }

    // Create snapshot of current state before rollback
    await this.createSnapshot(currentFlag, `Pre-rollback snapshot (rolling back to version ${targetVersion})`)

    const timestamp = now()
    const restoredFlag: StoredFlag = {
      ...targetSnapshot.snapshot,
      version: currentFlag.version + 1, // Increment version
      updatedAt: timestamp,
    }

    await this.saveFlag(restoredFlag)

    // Add audit log entry
    await this.addAuditLogEntry({
      action: 'rollback',
      flagKey,
      userId,
      previousVersion: currentFlag.version,
      newVersion: restoredFlag.version,
      metadata: {
        targetVersion,
        snapshotId: targetSnapshot.id,
      },
    })

    // Emit change event
    await this.addChangeEvent({
      type: 'flag_updated',
      flagKey,
      oldValue: currentFlag as FlagDefinition,
      newValue: restoredFlag as FlagDefinition,
      timestamp,
      version: restoredFlag.version,
    })

    // Invalidate edge cache for this flag
    await this.invalidateEdgeCache(flagKey)

    return restoredFlag
  }

  // ==========================================================================
  // EDGE CACHING OPERATIONS
  // ==========================================================================

  /**
   * Configure edge caching
   */
  async configureEdgeCache(config: Partial<EdgeCacheConfig>): Promise<EdgeCacheConfig> {
    await this.initialize()

    this.edgeCacheConfig = {
      ...this.edgeCacheConfig,
      ...config,
    }

    await this.ctx.storage.put('edgeCacheConfig', this.edgeCacheConfig)
    return this.edgeCacheConfig
  }

  /**
   * Get edge cache configuration
   */
  async getEdgeCacheConfig(): Promise<EdgeCacheConfig> {
    await this.initialize()
    return this.edgeCacheConfig
  }

  /**
   * Get flag value with edge caching
   */
  async getCachedFlag<T = FlagValue>(key: string, request?: Request): Promise<{
    flag: StoredFlag<T> | null
    cached: boolean
    cacheAge?: number
  }> {
    await this.initialize()

    // Check if edge caching is enabled and we have a request (needed for cache API)
    if (!this.edgeCacheConfig.enabled || !request) {
      const flag = await this.getFlag<T>(key)
      return { flag, cached: false }
    }

    // Try to get from edge cache
    const cacheKey = new Request(`https://flags.internal/${key}`, { method: 'GET' })
    const cache = (caches as unknown as { default: Cache }).default

    try {
      const cachedResponse = await cache.match(cacheKey)

      if (cachedResponse) {
        const data = await cachedResponse.json() as StoredFlag<T>
        const cacheDate = cachedResponse.headers.get('date')
        const cacheAge = cacheDate ? Math.floor((Date.now() - new Date(cacheDate).getTime()) / 1000) : undefined

        return {
          flag: data,
          cached: true,
          cacheAge,
        }
      }
    } catch {
      // Cache API not available, fall through
    }

    // Fetch from DO storage
    const flag = await this.getFlag<T>(key)

    if (flag) {
      // Store in edge cache
      try {
        const response = new Response(JSON.stringify(flag), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${this.edgeCacheConfig.ttlSeconds}, stale-while-revalidate=${this.edgeCacheConfig.staleWhileRevalidateSeconds}`,
            'Cache-Tag': this.edgeCacheConfig.tags.join(','),
            'Date': new Date().toUTCString(),
          },
        })
        await cache.put(cacheKey, response)
      } catch {
        // Cache API not available, ignore
      }
    }

    return { flag, cached: false }
  }

  /**
   * Invalidate edge cache for a flag
   */
  async invalidateEdgeCache(flagKey?: string): Promise<void> {
    if (!this.edgeCacheConfig.enabled) return

    const cache = (caches as unknown as { default: Cache }).default

    try {
      if (flagKey) {
        const cacheKey = new Request(`https://flags.internal/${flagKey}`, { method: 'GET' })
        await cache.delete(cacheKey)
      } else {
        // Invalidate all flags - would need to track all cached keys
        // For now, we'll just clear individual flags as they're updated
      }
    } catch {
      // Cache API not available, ignore
    }
  }

  // ==========================================================================
  // SSE STREAMING (LaunchDarkly-style)
  // ==========================================================================

  /**
   * Create SSE stream for flag changes
   * Returns a Response object suitable for SSE clients
   */
  async createSSEStream(options: {
    flagKeys?: string[]
    since?: string
    heartbeatIntervalMs?: number
  } = {}): Promise<Response> {
    await this.initialize()

    const { flagKeys, since, heartbeatIntervalMs = 30000 } = options
    const self = this
    let subscriptionId: string | null = null
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()

        // Send initial event with current flag states if requested
        if (since) {
          const events = await self.getChangesSince(since)
          for (const event of events) {
            const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
            controller.enqueue(encoder.encode(data))
          }
        }

        // Send initial connection event
        const connectEvent = `event: connected\ndata: ${JSON.stringify({ timestamp: now() })}\n\n`
        controller.enqueue(encoder.encode(connectEvent))

        // Subscribe to changes
        const subscription = await self.subscribe({
          flagKeys: flagKeys || '*',
          callback: (event) => {
            const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
            controller.enqueue(encoder.encode(data))
          },
        })
        subscriptionId = subscription.id

        // Setup heartbeat
        heartbeatInterval = setInterval(() => {
          const heartbeat = `:heartbeat ${Date.now()}\n\n`
          try {
            controller.enqueue(encoder.encode(heartbeat))
          } catch {
            // Stream closed, cleanup
            if (heartbeatInterval) clearInterval(heartbeatInterval)
            if (subscriptionId) self.unsubscribe(subscriptionId)
          }
        }, heartbeatIntervalMs)
      },

      cancel() {
        if (heartbeatInterval) clearInterval(heartbeatInterval)
        if (subscriptionId) self.unsubscribe(subscriptionId)
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      },
    })
  }

  /**
   * Handle HTTP fetch request (for SSE and other endpoints)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // SSE streaming endpoint
    if (path === '/stream' || path === '/sse') {
      const flagKeys = url.searchParams.get('flags')?.split(',').filter(Boolean)
      const since = url.searchParams.get('since') || undefined

      return this.createSSEStream({
        flagKeys: flagKeys?.length ? flagKeys : undefined,
        since,
      })
    }

    // Flag evaluation with edge caching
    if (path.startsWith('/flags/')) {
      const flagKey = path.replace('/flags/', '')
      const { flag, cached, cacheAge } = await this.getCachedFlag(flagKey, request)

      if (!flag) {
        return new Response(JSON.stringify({ error: 'Flag not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify(flag), {
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': cached ? 'HIT' : 'MISS',
          ...(cacheAge !== undefined && { 'X-Cache-Age': String(cacheAge) }),
        },
      })
    }

    // Audit log endpoint
    if (path === '/audit') {
      const flagKey = url.searchParams.get('flag') || undefined
      const action = url.searchParams.get('action') as AuditLogEntry['action'] | undefined
      const since = url.searchParams.get('since') || undefined
      const limit = parseInt(url.searchParams.get('limit') || '100', 10)
      const offset = parseInt(url.searchParams.get('offset') || '0', 10)

      const result = await this.getAuditLog({ flagKey, action, since, limit, offset })

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Snapshots endpoint
    if (path.startsWith('/snapshots/')) {
      const flagKey = path.replace('/snapshots/', '')
      const snapshots = await this.getSnapshots(flagKey)

      return new Response(JSON.stringify(snapshots), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Rollback endpoint
    if (path.startsWith('/rollback/') && request.method === 'POST') {
      const flagKey = path.replace('/rollback/', '')
      const body = await request.json() as { version: number; userId?: string }

      try {
        const flag = await this.rollbackFlag(flagKey, body.version, body.userId)
        return new Response(JSON.stringify(flag), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response('Not Found', { status: 404 })
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<FlagStorageStats> {
    await this.initialize()

    const flags = Array.from(this.flags.values())

    let sizeBytes = 0
    for (const flag of flags) {
      sizeBytes += JSON.stringify(flag).length
    }
    for (const segment of this.segments.values()) {
      sizeBytes += JSON.stringify(segment).length
    }
    for (const cache of this.evaluationCache.values()) {
      sizeBytes += JSON.stringify(cache).length
    }

    return {
      totalFlags: flags.length,
      enabledFlags: flags.filter(f => f.enabled === true).length,
      disabledFlags: flags.filter(f => f.enabled === false).length,
      temporaryFlags: flags.filter(f => f.temporary === true).length,
      totalSegments: this.segments.size,
      cacheEntries: this.evaluationCache.size,
      sizeBytes,
    }
  }
}

// Export types for external use
export type {
  FlagValue,
  FlagVariation,
  TargetingClause,
  Rollout,
  TargetingRule,
  Prerequisite,
  Segment,
  FlagDefinition,
  StoredFlag,
  EvaluationContext,
  CachedEvaluation,
  FlagChangeEvent,
  FlagsDOConfig,
  ShardRoutingResult,
  FlagQueryOptions,
  FlagQueryResult,
  FlagStorageStats,
  ShardInfo,
  StreamSubscription,
}
