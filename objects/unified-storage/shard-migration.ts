/**
 * ShardMigration - Handles shard topology changes with zero-downtime
 *
 * Provides:
 * - Adding new shards with automatic rebalancing
 * - Removing shards with data migration
 * - Event replay from Iceberg for data movement
 * - Zero-downtime migration with write buffering
 *
 * @module objects/unified-storage/shard-migration
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Domain event for replay
 */
export interface DomainEvent {
  type: 'thing.created' | 'thing.updated' | 'thing.deleted'
  entityId: string
  entityType: string
  partitionKey: string
  payload: Record<string, unknown>
  ts: number
  version: number
  shardId: string
}

/**
 * Entity stored in a shard
 */
export interface Entity {
  $id: string
  $type: string
  $version: number
  partitionKey: string
  [key: string]: unknown
}

/**
 * Shard information
 */
export interface ShardInfo {
  id: string
  entityCount: number
  memoryBytes: number
  status: 'active' | 'draining' | 'migrating'
}

/**
 * Shard stub interface - represents a Durable Object stub
 */
export interface ShardStub {
  id: string
  applyEvent(event: DomainEvent): Promise<void>
  getEntity(id: string): Promise<Entity | undefined>
  getEntityCount(): Promise<number>
  getMemoryUsage(): Promise<number>
  drainConnections(): Promise<void>
  acceptWrites(): void
  rejectWrites(): void
  isAcceptingWrites(): boolean
}

/**
 * Router interface for shard routing
 */
export interface ShardRouter {
  getShardCount(): number
  getShard(shardId: string): ShardStub | undefined
  getAllShards(): ShardStub[]
  getShardForKey(partitionKey: string): ShardStub | undefined
  addShard(shard: ShardStub): void
  removeShard(shardId: string): ShardStub | undefined
  updateRouting(): void
  getShardStats(): Promise<Array<{ shardId: string; entityCount: number; memoryBytes: number }>>
}

/**
 * Iceberg reader interface
 */
export interface IcebergReader {
  getRecords(options: {
    table: string
    partition?: { shardId?: string; partitionKey?: string }
    orderBy?: string
    after?: number
  }): Promise<DomainEvent[]>
  getPartitionKeys(shardId: string): Promise<string[]>
}

/**
 * Write buffer interface
 */
export interface WriteBuffer {
  add(event: DomainEvent): void
  flush(): Promise<DomainEvent[]>
  size(): number
}

/**
 * Configuration for ShardMigration
 */
export interface ShardMigrationConfig {
  router: ShardRouter
  iceberg: IcebergReader
  timeout?: number
  batchSize?: number
  rollbackOnFailure?: boolean
  onProgress?: (progress: MigrationProgress) => void
  writeBuffer?: WriteBuffer
}

/**
 * Migration plan
 */
export interface MigrationPlan {
  type: 'add' | 'remove' | 'rebalance'
  targetShard?: string
  sourceShard?: string
  partitionKeysToMove: string[]
  dataDestinations: Record<string, string>
  estimatedDuration: number
  movements?: Array<{ partitionKey: string; from: string; to: string }>
  estimatedDataMoved?: number
  totalData?: number
}

/**
 * Migration progress
 */
export interface MigrationProgress {
  phase: 'initializing' | 'replaying' | 'cutover' | 'flushing' | 'complete'
  eventsProcessed: number
  totalEvents: number
  partitionKeysProcessed: number
  totalPartitionKeys: number
  elapsedMs: number
}

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean
  eventsReplayed?: number
  entitiesMigrated?: number
  entitiesMoved?: number
  bufferedWrites?: number
  durationMs: number
  rolledBack?: boolean
  error?: Error
}

/**
 * Plan validation result
 */
export interface PlanValidation {
  valid: boolean
  warnings: string[]
  errors: string[]
}

/**
 * Replay result
 */
export interface ReplayResult {
  eventsReplayed: number
  success: boolean
  errors: Array<{ eventIndex: number; error: Error }>
  error?: Error
}

/**
 * Replay options
 */
export interface ReplayOptions {
  partitionKey: string
  targetShard: ShardStub
  afterTimestamp?: number
  onError?: 'continue' | 'abort'
}

/**
 * Balance analysis
 */
export interface BalanceAnalysis {
  isBalanced: boolean
  imbalanceRatio: number
  hotShards: string[]
  coldShards: string[]
  avgEntityCount: number
  avgMemoryBytes: number
}

/**
 * Rebalance options
 */
export interface RebalanceOptions {
  partitionKeys: string[]
  targetShards: string[]
}

/**
 * Add shard options
 */
export interface AddShardOptions {
  rebalance?: boolean
  partitionKeys?: string[]
}

/**
 * Migration metrics
 */
export interface MigrationMetrics {
  totalMigrations: number
  lastMigrationDuration: number
  eventsReplayedTotal: number
}

// ============================================================================
// EVENT EMITTER
// ============================================================================

type MigrationEventHandler = () => void
type MigrationEventType = 'migration:started' | 'migration:completed' | 'migration:failed'

// ============================================================================
// SHARD MIGRATION CLASS
// ============================================================================

/**
 * ShardMigration handles adding/removing shards and rebalancing data
 */
export class ShardMigration {
  readonly config: Required<Omit<ShardMigrationConfig, 'onProgress' | 'writeBuffer'>> & {
    onProgress?: (progress: MigrationProgress) => void
    writeBuffer?: WriteBuffer
  }

  private router: ShardRouter
  private iceberg: IcebergReader
  private eventHandlers: Map<MigrationEventType, Set<MigrationEventHandler>> = new Map()
  private migratingKeys: Set<string> = new Set()
  private writeBuffer: DomainEvent[] = []
  private externalWriteBuffer?: WriteBuffer
  private _isMigrating = false
  private startTime = 0
  private closed = false

  // Metrics
  private metrics: MigrationMetrics = {
    totalMigrations: 0,
    lastMigrationDuration: 0,
    eventsReplayedTotal: 0,
  }

  constructor(config: ShardMigrationConfig) {
    this.router = config.router
    this.iceberg = config.iceberg
    this.externalWriteBuffer = config.writeBuffer

    this.config = {
      router: config.router,
      iceberg: config.iceberg,
      timeout: config.timeout ?? 60000, // 1 minute default
      batchSize: config.batchSize ?? 100,
      rollbackOnFailure: config.rollbackOnFailure ?? false,
      onProgress: config.onProgress,
      writeBuffer: config.writeBuffer,
    }
  }

  // ==========================================================================
  // EVENT EMITTER METHODS
  // ==========================================================================

  /**
   * Subscribe to migration events
   */
  on(event: MigrationEventType, handler: MigrationEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  /**
   * Unsubscribe from migration events
   */
  off(event: MigrationEventType, handler: MigrationEventHandler): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      handlers.delete(handler)
    }
  }

  private emit(event: MigrationEventType): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler()
        } catch {
          // Ignore handler errors
        }
      }
    }
  }

  // ==========================================================================
  // MIGRATION STATE
  // ==========================================================================

  /**
   * Check if migration is in progress
   */
  isMigrating(): boolean {
    return this._isMigrating
  }

  /**
   * Get migration metrics
   */
  getMetrics(): MigrationMetrics {
    return { ...this.metrics }
  }

  /**
   * Buffer a write during migration
   */
  bufferWrite(event: DomainEvent): void {
    if (this.externalWriteBuffer) {
      this.externalWriteBuffer.add(event)
    } else {
      this.writeBuffer.push(event)
    }
  }

  /**
   * Clean up resources
   */
  async close(): Promise<void> {
    this.closed = true
    this.eventHandlers.clear()
    this.migratingKeys.clear()
    this.writeBuffer = []
  }

  // ==========================================================================
  // ADD SHARD
  // ==========================================================================

  /**
   * Add a new shard to the cluster
   */
  async addShard(shard: ShardStub, options: AddShardOptions = {}): Promise<MigrationResult> {
    this.startTime = performance.now()
    this._isMigrating = true
    this.emit('migration:started')

    let eventsReplayed = 0
    let bufferedWrites = 0

    try {
      // Check for concurrent migrations on same partition keys
      if (options.partitionKeys) {
        for (const key of options.partitionKeys) {
          if (this.migratingKeys.has(key)) {
            throw new Error(`Partition key ${key} is already migrating`)
          }
        }
        // Mark keys as migrating
        for (const key of options.partitionKeys) {
          this.migratingKeys.add(key)
        }
      }

      // Create timeout race
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Migration timeout')), this.config.timeout)
      })

      const migrationPromise = this.doAddShard(shard, options)
      const result = await Promise.race([migrationPromise, timeoutPromise])

      eventsReplayed = result.eventsReplayed

      // Check for errors during migration and rollback if configured
      if (result.hasErrors && this.config.rollbackOnFailure) {
        this.router.removeShard(shard.id)
        this.emit('migration:failed')
        return {
          success: false,
          eventsReplayed,
          bufferedWrites: 0,
          durationMs: performance.now() - this.startTime,
          rolledBack: true,
        }
      }

      // Flush buffered writes
      bufferedWrites = await this.flushWriteBuffer(shard, options.partitionKeys)

      // Update routing
      this.router.updateRouting()

      // Update metrics
      this.metrics.totalMigrations++
      this.metrics.lastMigrationDuration = performance.now() - this.startTime
      this.metrics.eventsReplayedTotal += eventsReplayed

      this.emit('migration:completed')

      return {
        success: true,
        eventsReplayed,
        bufferedWrites,
        durationMs: performance.now() - this.startTime,
      }
    } catch (error) {
      this.emit('migration:failed')

      // Rollback on failure if configured
      if (this.config.rollbackOnFailure) {
        this.router.removeShard(shard.id)
        return {
          success: false,
          eventsReplayed,
          bufferedWrites: 0,
          durationMs: performance.now() - this.startTime,
          rolledBack: true,
        }
      }

      throw error
    } finally {
      // Clear migrating keys
      if (options.partitionKeys) {
        for (const key of options.partitionKeys) {
          this.migratingKeys.delete(key)
        }
      }
      this._isMigrating = false
    }
  }

  private async doAddShard(
    shard: ShardStub,
    options: AddShardOptions
  ): Promise<{ eventsReplayed: number; hasErrors: boolean }> {
    // Add shard to router
    this.router.addShard(shard)

    let eventsReplayed = 0
    let hasErrors = false

    // Rebalance if requested
    if (options.rebalance && options.partitionKeys) {
      for (const partitionKey of options.partitionKeys) {
        const result = await this.replayEvents({
          partitionKey,
          targetShard: shard,
          onError: 'continue',
        })
        eventsReplayed += result.eventsReplayed
        // Check if we had any errors during replay
        if (!result.success || result.errors.length > 0) {
          hasErrors = true
        }
      }
    }

    return { eventsReplayed, hasErrors }
  }

  private async flushWriteBuffer(
    targetShard: ShardStub,
    partitionKeys?: string[]
  ): Promise<number> {
    const keySet = partitionKeys ? new Set(partitionKeys) : null

    let flushed = 0

    // Flush external buffer if present
    if (this.externalWriteBuffer) {
      const events = await this.externalWriteBuffer.flush()
      for (const event of events) {
        if (!keySet || keySet.has(event.partitionKey)) {
          try {
            await targetShard.applyEvent(event)
            flushed++
          } catch {
            // Ignore apply errors during flush
          }
        }
      }
    }

    // Flush internal buffer
    const internalEvents = [...this.writeBuffer]
    this.writeBuffer = []

    for (const event of internalEvents) {
      if (!keySet || keySet.has(event.partitionKey)) {
        try {
          await targetShard.applyEvent(event)
          flushed++
        } catch {
          // Ignore apply errors during flush
        }
      }
    }

    return flushed
  }

  // ==========================================================================
  // REMOVE SHARD
  // ==========================================================================

  /**
   * Remove a shard from the cluster
   */
  async removeShard(shardId: string): Promise<MigrationResult> {
    this.startTime = performance.now()
    this._isMigrating = true
    this.emit('migration:started')

    let entitiesMigrated = 0

    try {
      const shardToRemove = this.router.getShard(shardId)
      if (!shardToRemove) {
        // If shard doesn't exist, it's already removed - return success
        this.emit('migration:completed')
        return {
          success: true,
          entitiesMigrated: 0,
          durationMs: performance.now() - this.startTime,
        }
      }

      // Reject new writes to this shard
      shardToRemove.rejectWrites()

      // Drain connections (don't await - use Promise.resolve to handle sync/async)
      // Note: drainConnections may use setTimeout internally, but we proceed immediately
      // after signaling the drain. In production this would be more coordinated.
      try {
        await Promise.resolve(shardToRemove.drainConnections())
      } catch {
        // Ignore drain errors - shard might already be unavailable
      }

      // Get partition keys from this shard
      const partitionKeys = await this.iceberg.getPartitionKeys(shardId)

      // Migrate each partition key to another shard
      for (const partitionKey of partitionKeys) {
        const targetShard = this.router.getShardForKey(partitionKey)
        if (targetShard && targetShard.id !== shardId) {
          const result = await this.replayEvents({
            partitionKey,
            targetShard,
            onError: 'continue',
          })
          entitiesMigrated += result.eventsReplayed
        }
      }

      // Remove shard from router
      this.router.removeShard(shardId)

      // Update routing
      this.router.updateRouting()

      // Update metrics
      this.metrics.totalMigrations++
      this.metrics.lastMigrationDuration = performance.now() - this.startTime

      this.emit('migration:completed')

      return {
        success: true,
        entitiesMigrated,
        durationMs: performance.now() - this.startTime,
      }
    } catch (error) {
      this.emit('migration:failed')
      throw error
    } finally {
      this._isMigrating = false
    }
  }

  // ==========================================================================
  // REBALANCING
  // ==========================================================================

  /**
   * Analyze cluster balance
   */
  async analyzeBalance(): Promise<BalanceAnalysis> {
    const stats = await this.router.getShardStats()

    if (stats.length === 0) {
      return {
        isBalanced: true,
        imbalanceRatio: 0,
        hotShards: [],
        coldShards: [],
        avgEntityCount: 0,
        avgMemoryBytes: 0,
      }
    }

    // Calculate averages
    const totalEntities = stats.reduce((sum, s) => sum + s.entityCount, 0)
    const totalMemory = stats.reduce((sum, s) => sum + s.memoryBytes, 0)
    const avgEntityCount = totalEntities / stats.length
    const avgMemoryBytes = totalMemory / stats.length

    // Find hot and cold shards (more than 30% deviation from average)
    const hotShards: string[] = []
    const coldShards: string[] = []
    let maxDeviation = 0

    for (const stat of stats) {
      const deviation = avgEntityCount > 0 ? Math.abs(stat.entityCount - avgEntityCount) / avgEntityCount : 0

      if (deviation > maxDeviation) {
        maxDeviation = deviation
      }

      if (stat.entityCount > avgEntityCount * 1.3) {
        hotShards.push(stat.shardId)
      } else if (stat.entityCount < avgEntityCount * 0.7) {
        coldShards.push(stat.shardId)
      }
    }

    return {
      isBalanced: maxDeviation <= 0.3,
      imbalanceRatio: maxDeviation,
      hotShards,
      coldShards,
      avgEntityCount,
      avgMemoryBytes,
    }
  }

  /**
   * Generate a rebalance plan
   */
  async generateRebalancePlan(): Promise<MigrationPlan> {
    const stats = await this.router.getShardStats()
    const analysis = await this.analyzeBalance()

    const movements: Array<{ partitionKey: string; from: string; to: string }> = []
    const partitionKeysToMove: string[] = []
    let estimatedDataMoved = 0
    const totalData = stats.reduce((sum, s) => sum + s.memoryBytes, 0)

    // Calculate movements to balance the cluster
    // We want to minimize data movement while achieving balance
    for (const hotShardId of analysis.hotShards) {
      const hotShard = stats.find((s) => s.shardId === hotShardId)
      if (!hotShard) continue

      // Get partition keys from hot shard
      const keys = await this.iceberg.getPartitionKeys(hotShardId)
      const totalKeysInShard = keys.length

      // Calculate how much excess we need to move
      // Only move the minimum necessary to achieve balance
      const excessEntities = hotShard.entityCount - analysis.avgEntityCount
      const keysToMoveCount = Math.min(
        Math.ceil(excessEntities / Math.max(hotShard.entityCount / totalKeysInShard, 1)),
        Math.ceil(totalKeysInShard * 0.3) // Never move more than 30% of keys from one shard
      )

      // Move some keys to cold shards
      let movedFromThisShard = 0
      for (const coldShardId of analysis.coldShards) {
        if (movedFromThisShard >= keysToMoveCount) break
        if (keys.length === 0) break

        const keyToMove = keys.shift()!
        partitionKeysToMove.push(keyToMove)
        movements.push({
          partitionKey: keyToMove,
          from: hotShardId,
          to: coldShardId,
        })
        movedFromThisShard++

        // Estimate data size per key (evenly distributed approximation)
        const dataPerKey = totalKeysInShard > 0 ? hotShard.memoryBytes / totalKeysInShard : 0
        estimatedDataMoved += dataPerKey
      }
    }

    return {
      type: 'rebalance',
      partitionKeysToMove,
      dataDestinations: Object.fromEntries(movements.map((m) => [m.partitionKey, m.to])),
      estimatedDuration: movements.length * 1000, // Estimate 1s per movement
      movements,
      estimatedDataMoved,
      totalData,
    }
  }

  /**
   * Rebalance data across shards
   */
  async rebalance(options: RebalanceOptions): Promise<MigrationResult> {
    this.startTime = performance.now()
    this._isMigrating = true
    this.emit('migration:started')

    let entitiesMoved = 0

    try {
      // Check for concurrent migrations
      for (const key of options.partitionKeys) {
        if (this.migratingKeys.has(key)) {
          throw new Error(`Partition key ${key} is already migrating or in progress`)
        }
      }

      // Mark keys as migrating
      for (const key of options.partitionKeys) {
        this.migratingKeys.add(key)
      }

      this.reportProgress('initializing', 0, 0, 0, options.partitionKeys.length)

      // Move each partition key to its target shard
      for (let i = 0; i < options.partitionKeys.length; i++) {
        const partitionKey = options.partitionKeys[i]
        const targetShardId = options.targetShards[i % options.targetShards.length]
        const targetShard = this.router.getShard(targetShardId)

        if (!targetShard) {
          continue
        }

        const result = await this.replayEvents({
          partitionKey,
          targetShard,
          onError: 'continue',
        })

        entitiesMoved += result.eventsReplayed

        this.reportProgress('replaying', result.eventsReplayed, result.eventsReplayed, i + 1, options.partitionKeys.length)
      }

      this.reportProgress('complete', entitiesMoved, entitiesMoved, options.partitionKeys.length, options.partitionKeys.length)

      // Update metrics
      this.metrics.totalMigrations++
      this.metrics.lastMigrationDuration = performance.now() - this.startTime
      this.metrics.eventsReplayedTotal += entitiesMoved

      this.emit('migration:completed')

      return {
        success: true,
        entitiesMoved,
        durationMs: performance.now() - this.startTime,
      }
    } catch (error) {
      this.emit('migration:failed')
      throw error
    } finally {
      // Clear migrating keys
      for (const key of options.partitionKeys) {
        this.migratingKeys.delete(key)
      }
      this._isMigrating = false
    }
  }

  // ==========================================================================
  // EVENT REPLAY
  // ==========================================================================

  /**
   * Replay events from Iceberg to a target shard
   */
  async replayEvents(options: ReplayOptions): Promise<ReplayResult> {
    const { partitionKey, targetShard, afterTimestamp, onError = 'abort' } = options
    const errors: Array<{ eventIndex: number; error: Error }> = []

    try {
      // Query events from Iceberg
      const events = await this.iceberg.getRecords({
        table: 'do_events',
        partition: { partitionKey },
        orderBy: 'ts ASC',
        after: afterTimestamp,
      })

      let eventsReplayed = 0

      // Apply events in order
      for (let i = 0; i < events.length; i++) {
        const event = events[i]

        try {
          await targetShard.applyEvent(event)
          eventsReplayed++
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          errors.push({ eventIndex: i, error: err })

          if (onError === 'abort') {
            return {
              eventsReplayed,
              success: false,
              errors,
              error: err,
            }
          }
          // 'continue' - keep going
        }
      }

      return {
        eventsReplayed,
        success: true,
        errors,
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      return {
        eventsReplayed: 0,
        success: false,
        errors,
        error: err,
      }
    }
  }

  // ==========================================================================
  // MIGRATION PLANNING
  // ==========================================================================

  /**
   * Plan adding a new shard
   */
  async planAddShard(newShardId: string): Promise<MigrationPlan> {
    const stats = await this.router.getShardStats()

    // Calculate which partition keys should move to the new shard
    // for balanced distribution
    const shardCount = stats.length + 1
    const keysPerShard = Math.ceil(stats.reduce((sum, s) => sum + s.entityCount, 0) / shardCount)

    const partitionKeysToMove: string[] = []
    const dataDestinations: Record<string, string> = {}

    // Get keys from existing shards to redistribute
    for (const stat of stats) {
      if (stat.entityCount > keysPerShard) {
        const keysToMove = await this.iceberg.getPartitionKeys(stat.shardId)
        const numToMove = Math.min(keysToMove.length, Math.floor((stat.entityCount - keysPerShard) / 10) + 1)

        for (let i = 0; i < numToMove; i++) {
          const key = keysToMove[i]
          partitionKeysToMove.push(key)
          dataDestinations[key] = newShardId
        }
      }
    }

    return {
      type: 'add',
      targetShard: newShardId,
      partitionKeysToMove,
      dataDestinations,
      estimatedDuration: partitionKeysToMove.length * 500, // 500ms per key
    }
  }

  /**
   * Plan removing a shard
   */
  async planRemoveShard(shardId: string): Promise<MigrationPlan> {
    const shardToRemove = this.router.getShard(shardId)
    if (!shardToRemove) {
      throw new Error(`Shard not found: ${shardId}`)
    }

    const partitionKeys = await this.iceberg.getPartitionKeys(shardId)
    const dataDestinations: Record<string, string> = {}

    // Determine destination for each partition key
    const otherShards = this.router.getAllShards().filter((s) => s.id !== shardId)

    for (let i = 0; i < partitionKeys.length; i++) {
      const key = partitionKeys[i]
      const targetShard = otherShards[i % otherShards.length]
      dataDestinations[key] = targetShard.id
    }

    return {
      type: 'remove',
      sourceShard: shardId,
      partitionKeysToMove: partitionKeys,
      dataDestinations,
      estimatedDuration: partitionKeys.length * 500,
    }
  }

  /**
   * Validate a migration plan
   */
  async validatePlan(plan: MigrationPlan): Promise<PlanValidation> {
    const errors: string[] = []
    const warnings: string[] = []

    if (plan.type === 'remove') {
      // Check if source shard exists
      if (plan.sourceShard && !this.router.getShard(plan.sourceShard)) {
        errors.push(`Source shard ${plan.sourceShard} does not exist`)
      }

      // Check if destination shards exist
      for (const [, destShardId] of Object.entries(plan.dataDestinations)) {
        if (!this.router.getShard(destShardId)) {
          errors.push(`Destination shard ${destShardId} does not exist`)
        }
      }
    }

    if (plan.type === 'add') {
      // Check if target shard ID is already in use
      if (plan.targetShard && this.router.getShard(plan.targetShard)) {
        warnings.push(`Target shard ${plan.targetShard} already exists in cluster`)
      }
    }

    if (plan.partitionKeysToMove.length === 0 && plan.type !== 'add') {
      warnings.push('No partition keys to move')
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
    }
  }

  // ==========================================================================
  // PROGRESS REPORTING
  // ==========================================================================

  private reportProgress(
    phase: MigrationProgress['phase'],
    eventsProcessed: number,
    totalEvents: number,
    partitionKeysProcessed: number,
    totalPartitionKeys: number
  ): void {
    if (this.config.onProgress) {
      this.config.onProgress({
        phase,
        eventsProcessed,
        totalEvents,
        partitionKeysProcessed,
        totalPartitionKeys,
        elapsedMs: performance.now() - this.startTime,
      })
    }
  }
}
