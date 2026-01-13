/**
 * AutoShardManager - Automatic sharding with capacity monitoring and migration
 *
 * Handles the 10GB per DO limit by automatically:
 * - Monitoring storage capacity (triggers at 90% threshold)
 * - Creating new shards when capacity is reached
 * - Migrating data to shards in background chunks
 * - Routing requests to appropriate shards
 * - Coordinating cross-shard queries
 *
 * @example
 * ```typescript
 * const autoShard = new AutoShardManager(env.DO, {
 *   key: 'tenant_id',
 *   capacityThreshold: 0.9, // 90%
 *   maxShards: 256,
 *   chunkSize: 1000,
 * })
 *
 * // Check if sharding is needed
 * if (autoShard.shouldShard(currentMetrics)) {
 *   await autoShard.triggerSharding()
 * }
 *
 * // Route requests
 * const stub = await autoShard.route('tenant-123')
 * ```
 */
import type { ShardConfig } from './types'
import { DEFAULT_SHARD_CONFIG } from './types'
import { ShardManager, consistentHash } from './shard'

// ============================================================================
// CONSTANTS
// ============================================================================

const GB = 1024 * 1024 * 1024
const MB = 1024 * 1024
const KB = 1024

/**
 * DO storage limit (10GB)
 */
export const DO_STORAGE_LIMIT = 10 * GB

/**
 * Default capacity threshold (90%)
 */
export const DEFAULT_CAPACITY_THRESHOLD = 0.9

/**
 * Default chunk size for migration (1000 records)
 */
export const DEFAULT_CHUNK_SIZE = 1000

/**
 * Default migration delay between chunks (100ms)
 */
export const DEFAULT_MIGRATION_DELAY_MS = 100

/**
 * Maximum number of shards
 */
export const MAX_SHARDS = 256

// ============================================================================
// TYPES
// ============================================================================

/**
 * Storage capacity metrics
 */
export interface CapacityMetrics {
  /** Current storage used in bytes */
  usedBytes: number
  /** Total storage limit in bytes */
  limitBytes: number
  /** Percentage of storage used (0-100) */
  usagePercent: number
  /** Number of records/things stored */
  recordCount: number
  /** Estimated bytes per record */
  avgRecordSize: number
  /** Timestamp when metrics were collected */
  timestamp: number
}

/**
 * Shard distribution statistics
 */
export interface ShardStats {
  /** Shard index */
  shardId: number
  /** Shard name */
  shardName: string
  /** Storage used in bytes */
  usedBytes: number
  /** Number of records */
  recordCount: number
  /** Usage percentage */
  usagePercent: number
  /** Whether shard is healthy */
  healthy: boolean
  /** Last activity timestamp */
  lastActivity: number
}

/**
 * Migration task state
 */
export interface MigrationTask {
  /** Unique migration ID */
  id: string
  /** Source DO name */
  sourceDO: string
  /** Target shard ID */
  targetShardId: number
  /** Shard key for filtering */
  shardKey: string
  /** Records to migrate */
  totalRecords: number
  /** Records migrated so far */
  migratedRecords: number
  /** Migration status */
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'paused'
  /** Error message if failed */
  error?: string
  /** Started at timestamp */
  startedAt?: number
  /** Completed at timestamp */
  completedAt?: number
  /** Last chunk processed at */
  lastChunkAt?: number
  /** Current offset for resumable migration */
  offset: number
}

/**
 * Auto-shard configuration
 */
export interface AutoShardConfig extends ShardConfig {
  /** Capacity threshold to trigger sharding (0-1, default 0.9) */
  capacityThreshold?: number
  /** Maximum number of shards */
  maxShards?: number
  /** Chunk size for migration */
  chunkSize?: number
  /** Delay between migration chunks in ms */
  migrationDelayMs?: number
  /** Enable automatic sharding */
  autoShard?: boolean
  /** Callback when sharding is triggered */
  onShardTrigger?: (metrics: CapacityMetrics) => void
  /** Callback when migration completes */
  onMigrationComplete?: (task: MigrationTask) => void
  /** Callback for capacity warnings */
  onCapacityWarning?: (metrics: CapacityMetrics) => void
}

/**
 * Load balancer result
 */
export interface LoadBalanceResult {
  /** Selected shard ID */
  shardId: number
  /** Shard stub */
  stub: DurableObjectStub
  /** Whether this was a new shard */
  isNewShard: boolean
  /** Reason for selection */
  reason: 'hash' | 'load_balance' | 'migration'
}

/**
 * Cross-shard query result
 */
export interface CrossShardQueryResult<T = unknown> {
  /** Combined results from all shards */
  results: T[]
  /** Number of shards queried */
  shardsQueried: number
  /** Any errors from individual shards */
  errors: Array<{ shardId: number; error: Error }>
  /** Total time in ms */
  durationMs: number
}

/**
 * Shard key info
 */
export interface ShardKeyInfo {
  /** The shard key field name */
  key: string
  /** Current shard assignment */
  shardId: number
  /** Shard name */
  shardName: string
  /** Whether key has been migrated */
  migrated: boolean
  /** Original shard if migrated */
  originalShardId?: number
}

// ============================================================================
// CAPACITY MONITOR
// ============================================================================

/**
 * CapacityMonitor - Tracks storage usage and detects when sharding is needed
 */
export class CapacityMonitor {
  private metrics: CapacityMetrics | null = null
  private readonly threshold: number
  private readonly onWarning?: (metrics: CapacityMetrics) => void

  constructor(
    threshold: number = DEFAULT_CAPACITY_THRESHOLD,
    onWarning?: (metrics: CapacityMetrics) => void
  ) {
    this.threshold = threshold
    this.onWarning = onWarning
  }

  /**
   * Update metrics with new values
   */
  update(metrics: Omit<CapacityMetrics, 'usagePercent' | 'avgRecordSize' | 'timestamp'>): CapacityMetrics {
    const usagePercent = (metrics.usedBytes / metrics.limitBytes) * 100
    const avgRecordSize = metrics.recordCount > 0 ? metrics.usedBytes / metrics.recordCount : 0

    this.metrics = {
      ...metrics,
      usagePercent,
      avgRecordSize,
      timestamp: Date.now(),
    }

    // Emit warning if approaching threshold
    if (this.isApproachingThreshold() && this.onWarning) {
      this.onWarning(this.metrics)
    }

    return this.metrics
  }

  /**
   * Get current metrics
   */
  getMetrics(): CapacityMetrics | null {
    return this.metrics
  }

  /**
   * Check if storage is approaching threshold (80% of threshold)
   */
  isApproachingThreshold(): boolean {
    if (!this.metrics) return false
    return this.metrics.usagePercent >= (this.threshold * 100 * 0.8)
  }

  /**
   * Check if sharding should be triggered
   */
  shouldShard(): boolean {
    if (!this.metrics) return false
    return this.metrics.usagePercent >= (this.threshold * 100)
  }

  /**
   * Check if storage is critical (>95%)
   */
  isCritical(): boolean {
    if (!this.metrics) return false
    return this.metrics.usagePercent >= 95
  }

  /**
   * Estimate records that can still be stored
   */
  estimateRemainingCapacity(): number {
    if (!this.metrics || this.metrics.avgRecordSize === 0) return 0
    const remainingBytes = this.metrics.limitBytes - this.metrics.usedBytes
    return Math.floor(remainingBytes / this.metrics.avgRecordSize)
  }

  /**
   * Get threshold value
   */
  getThreshold(): number {
    return this.threshold
  }
}

// ============================================================================
// SHARD KEY MANAGER
// ============================================================================

/**
 * ShardKeyManager - Manages shard key assignments and migrations
 */
export class ShardKeyManager {
  private keyAssignments: Map<string, ShardKeyInfo> = new Map()
  private shardKey: string
  private shardCount: number

  constructor(shardKey: string, shardCount: number = 1) {
    this.shardKey = shardKey
    this.shardCount = shardCount
  }

  /**
   * Get shard assignment for a key value
   */
  getShardInfo(keyValue: string): ShardKeyInfo {
    // Check if we have a cached assignment
    const cached = this.keyAssignments.get(keyValue)
    if (cached) {
      return cached
    }

    // Calculate shard using consistent hash
    const shardId = consistentHash(keyValue, this.shardCount)
    const info: ShardKeyInfo = {
      key: this.shardKey,
      shardId,
      shardName: `shard-${shardId}`,
      migrated: false,
    }

    this.keyAssignments.set(keyValue, info)
    return info
  }

  /**
   * Record that a key has been migrated to a new shard
   */
  recordMigration(keyValue: string, newShardId: number): void {
    const current = this.getShardInfo(keyValue)
    const updated: ShardKeyInfo = {
      ...current,
      shardId: newShardId,
      shardName: `shard-${newShardId}`,
      migrated: true,
      originalShardId: current.shardId,
    }
    this.keyAssignments.set(keyValue, updated)
  }

  /**
   * Update shard count (when new shards are added)
   */
  updateShardCount(newCount: number): void {
    this.shardCount = newCount
    // Clear cache to force recalculation
    this.keyAssignments.clear()
  }

  /**
   * Get current shard count
   */
  getShardCount(): number {
    return this.shardCount
  }

  /**
   * Get all key assignments
   */
  getAssignments(): Map<string, ShardKeyInfo> {
    return new Map(this.keyAssignments)
  }

  /**
   * Clear all assignments
   */
  clear(): void {
    this.keyAssignments.clear()
  }
}

// ============================================================================
// MIGRATION MANAGER
// ============================================================================

/**
 * MigrationManager - Handles background data migration between shards
 */
export class MigrationManager {
  private tasks: Map<string, MigrationTask> = new Map()
  private readonly chunkSize: number
  private readonly delayMs: number
  private readonly onComplete?: (task: MigrationTask) => void

  constructor(
    chunkSize: number = DEFAULT_CHUNK_SIZE,
    delayMs: number = DEFAULT_MIGRATION_DELAY_MS,
    onComplete?: (task: MigrationTask) => void
  ) {
    this.chunkSize = chunkSize
    this.delayMs = delayMs
    this.onComplete = onComplete
  }

  /**
   * Create a new migration task
   */
  createTask(
    sourceDO: string,
    targetShardId: number,
    shardKey: string,
    totalRecords: number
  ): MigrationTask {
    const id = `migration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const task: MigrationTask = {
      id,
      sourceDO,
      targetShardId,
      shardKey,
      totalRecords,
      migratedRecords: 0,
      status: 'pending',
      offset: 0,
    }
    this.tasks.set(id, task)
    return task
  }

  /**
   * Start a migration task
   */
  startTask(taskId: string): MigrationTask | undefined {
    const task = this.tasks.get(taskId)
    if (!task) return undefined

    task.status = 'in_progress'
    task.startedAt = Date.now()
    this.tasks.set(taskId, task)
    return task
  }

  /**
   * Process a chunk of migration
   * Returns the records to migrate in this chunk
   */
  getNextChunk(taskId: string): { offset: number; limit: number } | null {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== 'in_progress') return null

    if (task.migratedRecords >= task.totalRecords) {
      return null
    }

    return {
      offset: task.offset,
      limit: Math.min(this.chunkSize, task.totalRecords - task.migratedRecords),
    }
  }

  /**
   * Record chunk completion
   */
  completeChunk(taskId: string, recordsMigrated: number): MigrationTask | undefined {
    const task = this.tasks.get(taskId)
    if (!task) return undefined

    task.migratedRecords += recordsMigrated
    task.offset += recordsMigrated
    task.lastChunkAt = Date.now()

    if (task.migratedRecords >= task.totalRecords) {
      task.status = 'completed'
      task.completedAt = Date.now()
      if (this.onComplete) {
        this.onComplete(task)
      }
    }

    this.tasks.set(taskId, task)
    return task
  }

  /**
   * Fail a migration task
   */
  failTask(taskId: string, error: string): MigrationTask | undefined {
    const task = this.tasks.get(taskId)
    if (!task) return undefined

    task.status = 'failed'
    task.error = error
    this.tasks.set(taskId, task)
    return task
  }

  /**
   * Pause a migration task
   */
  pauseTask(taskId: string): MigrationTask | undefined {
    const task = this.tasks.get(taskId)
    if (!task) return undefined

    task.status = 'paused'
    this.tasks.set(taskId, task)
    return task
  }

  /**
   * Resume a paused migration task
   */
  resumeTask(taskId: string): MigrationTask | undefined {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== 'paused') return undefined

    task.status = 'in_progress'
    this.tasks.set(taskId, task)
    return task
  }

  /**
   * Get a migration task by ID
   */
  getTask(taskId: string): MigrationTask | undefined {
    return this.tasks.get(taskId)
  }

  /**
   * Get all active migrations
   */
  getActiveTasks(): MigrationTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === 'in_progress' || t.status === 'pending'
    )
  }

  /**
   * Get migration progress as percentage
   */
  getProgress(taskId: string): number {
    const task = this.tasks.get(taskId)
    if (!task || task.totalRecords === 0) return 0
    return (task.migratedRecords / task.totalRecords) * 100
  }

  /**
   * Get chunk size
   */
  getChunkSize(): number {
    return this.chunkSize
  }

  /**
   * Get delay between chunks
   */
  getDelayMs(): number {
    return this.delayMs
  }
}

// ============================================================================
// LOAD BALANCER
// ============================================================================

/**
 * LoadBalancer - Routes requests to shards based on load
 */
export class LoadBalancer {
  private shardStats: Map<number, ShardStats> = new Map()
  private namespace: DurableObjectNamespace
  private shardCount: number

  constructor(namespace: DurableObjectNamespace, shardCount: number = 1) {
    this.namespace = namespace
    this.shardCount = shardCount
  }

  /**
   * Update stats for a shard
   */
  updateStats(shardId: number, stats: Omit<ShardStats, 'shardId' | 'shardName'>): void {
    this.shardStats.set(shardId, {
      ...stats,
      shardId,
      shardName: `shard-${shardId}`,
    })
  }

  /**
   * Get stats for a shard
   */
  getStats(shardId: number): ShardStats | undefined {
    return this.shardStats.get(shardId)
  }

  /**
   * Get all shard stats
   */
  getAllStats(): ShardStats[] {
    return Array.from(this.shardStats.values())
  }

  /**
   * Find the least loaded shard
   */
  getLeastLoaded(): number {
    let minUsage = Infinity
    let minShardId = 0

    for (let i = 0; i < this.shardCount; i++) {
      const stats = this.shardStats.get(i)
      const usage = stats?.usagePercent ?? 0

      if (usage < minUsage) {
        minUsage = usage
        minShardId = i
      }
    }

    return minShardId
  }

  /**
   * Route a request to appropriate shard
   */
  async route(keyValue: string, preferLeastLoaded: boolean = false): Promise<LoadBalanceResult> {
    // Calculate hash-based shard
    const hashShardId = consistentHash(keyValue, this.shardCount)

    // Check if we should use load balancing instead
    let selectedShardId = hashShardId
    let reason: 'hash' | 'load_balance' | 'migration' = 'hash'

    if (preferLeastLoaded) {
      const hashStats = this.shardStats.get(hashShardId)
      const leastLoadedId = this.getLeastLoaded()
      const leastStats = this.shardStats.get(leastLoadedId)

      // Use least loaded if hash shard is significantly more loaded
      if (hashStats && leastStats) {
        if (hashStats.usagePercent > 80 && leastStats.usagePercent < 50) {
          selectedShardId = leastLoadedId
          reason = 'load_balance'
        }
      }
    }

    const shardName = `shard-${selectedShardId}`
    const id = this.namespace.idFromName(shardName)
    const stub = this.namespace.get(id)

    return {
      shardId: selectedShardId,
      stub,
      isNewShard: !this.shardStats.has(selectedShardId),
      reason,
    }
  }

  /**
   * Get stub for a specific shard
   */
  getShardStub(shardId: number): DurableObjectStub {
    const shardName = `shard-${shardId}`
    const id = this.namespace.idFromName(shardName)
    return this.namespace.get(id)
  }

  /**
   * Update shard count
   */
  setShardCount(count: number): void {
    this.shardCount = count
  }

  /**
   * Get current shard count
   */
  getShardCount(): number {
    return this.shardCount
  }

  /**
   * Check if all shards are healthy
   */
  isHealthy(): boolean {
    for (let i = 0; i < this.shardCount; i++) {
      const stats = this.shardStats.get(i)
      if (stats && !stats.healthy) {
        return false
      }
    }
    return true
  }

  /**
   * Get unhealthy shards
   */
  getUnhealthyShards(): number[] {
    const unhealthy: number[] = []
    for (let i = 0; i < this.shardCount; i++) {
      const stats = this.shardStats.get(i)
      if (stats && !stats.healthy) {
        unhealthy.push(i)
      }
    }
    return unhealthy
  }
}

// ============================================================================
// AUTO SHARD MANAGER
// ============================================================================

/**
 * AutoShardManager - Combines all components for automatic sharding
 */
export class AutoShardManager {
  private namespace: DurableObjectNamespace
  private config: Required<AutoShardConfig>
  private capacityMonitor: CapacityMonitor
  private keyManager: ShardKeyManager
  private migrationManager: MigrationManager
  private loadBalancer: LoadBalancer
  private shardManager: ShardManager
  private isSharded: boolean = false

  constructor(
    namespace: DurableObjectNamespace,
    config?: Partial<AutoShardConfig>
  ) {
    this.namespace = namespace
    this.config = {
      key: config?.key ?? DEFAULT_SHARD_CONFIG.key,
      count: config?.count ?? DEFAULT_SHARD_CONFIG.count,
      algorithm: config?.algorithm ?? DEFAULT_SHARD_CONFIG.algorithm,
      capacityThreshold: config?.capacityThreshold ?? DEFAULT_CAPACITY_THRESHOLD,
      maxShards: config?.maxShards ?? MAX_SHARDS,
      chunkSize: config?.chunkSize ?? DEFAULT_CHUNK_SIZE,
      migrationDelayMs: config?.migrationDelayMs ?? DEFAULT_MIGRATION_DELAY_MS,
      autoShard: config?.autoShard ?? true,
      onShardTrigger: config?.onShardTrigger ?? (() => {}),
      onMigrationComplete: config?.onMigrationComplete ?? (() => {}),
      onCapacityWarning: config?.onCapacityWarning ?? (() => {}),
    }

    // Initialize components
    this.capacityMonitor = new CapacityMonitor(
      this.config.capacityThreshold,
      this.config.onCapacityWarning
    )
    this.keyManager = new ShardKeyManager(this.config.key, this.config.count)
    this.migrationManager = new MigrationManager(
      this.config.chunkSize,
      this.config.migrationDelayMs,
      this.config.onMigrationComplete
    )
    this.loadBalancer = new LoadBalancer(namespace, this.config.count)
    this.shardManager = new ShardManager(namespace, {
      key: this.config.key,
      count: this.config.count,
      algorithm: this.config.algorithm,
    })
  }

  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================

  /**
   * Get current configuration
   */
  getConfig(): Required<AutoShardConfig> {
    return { ...this.config }
  }

  /**
   * Get shard key name
   */
  getShardKey(): string {
    return this.config.key
  }

  /**
   * Get current shard count
   */
  getShardCount(): number {
    return this.config.count
  }

  /**
   * Check if auto-sharding is enabled
   */
  isAutoShardEnabled(): boolean {
    return this.config.autoShard
  }

  // ==========================================================================
  // CAPACITY MONITORING
  // ==========================================================================

  /**
   * Update capacity metrics
   */
  updateCapacity(usedBytes: number, recordCount: number): CapacityMetrics {
    return this.capacityMonitor.update({
      usedBytes,
      limitBytes: DO_STORAGE_LIMIT,
      recordCount,
    })
  }

  /**
   * Get current capacity metrics
   */
  getCapacityMetrics(): CapacityMetrics | null {
    return this.capacityMonitor.getMetrics()
  }

  /**
   * Check if sharding should be triggered
   */
  shouldTriggerSharding(): boolean {
    return this.config.autoShard && this.capacityMonitor.shouldShard()
  }

  /**
   * Check if capacity is approaching threshold
   */
  isApproachingCapacity(): boolean {
    return this.capacityMonitor.isApproachingThreshold()
  }

  /**
   * Check if capacity is critical
   */
  isCapacityCritical(): boolean {
    return this.capacityMonitor.isCritical()
  }

  // ==========================================================================
  // SHARD ROUTING
  // ==========================================================================

  /**
   * Route a request to the appropriate shard
   */
  async route(keyValue: string): Promise<LoadBalanceResult> {
    if (!this.isSharded || this.config.count <= 1) {
      // Not sharded yet, use main DO
      const id = this.namespace.idFromName('main')
      return {
        shardId: 0,
        stub: this.namespace.get(id),
        isNewShard: false,
        reason: 'hash',
      }
    }

    return this.loadBalancer.route(keyValue)
  }

  /**
   * Get shard info for a key value
   */
  getShardInfo(keyValue: string): ShardKeyInfo {
    return this.keyManager.getShardInfo(keyValue)
  }

  /**
   * Get stub for specific shard
   */
  getShardStub(shardId: number): DurableObjectStub {
    return this.loadBalancer.getShardStub(shardId)
  }

  /**
   * Get all shard stubs
   */
  getAllShardStubs(): DurableObjectStub[] {
    return this.shardManager.getAllShardStubs()
  }

  // ==========================================================================
  // SHARDING OPERATIONS
  // ==========================================================================

  /**
   * Trigger sharding - creates new shards and starts migration
   */
  async triggerSharding(): Promise<{
    newShardCount: number
    migrationTaskId: string
  }> {
    const metrics = this.capacityMonitor.getMetrics()
    if (!metrics) {
      throw new Error('Cannot trigger sharding without capacity metrics')
    }

    // Calculate new shard count
    const currentCount = this.config.count
    const newCount = Math.min(currentCount * 2, this.config.maxShards)

    if (newCount === currentCount) {
      throw new Error(`Already at maximum shard count: ${this.config.maxShards}`)
    }

    // Notify listeners
    this.config.onShardTrigger(metrics)

    // Update configuration
    this.config.count = newCount
    this.keyManager.updateShardCount(newCount)
    this.loadBalancer.setShardCount(newCount)
    this.shardManager = new ShardManager(this.namespace, {
      key: this.config.key,
      count: newCount,
      algorithm: this.config.algorithm,
    })

    // Create migration task
    const task = this.migrationManager.createTask(
      'main',
      newCount - 1, // Target the new shards
      this.config.key,
      metrics.recordCount
    )

    this.isSharded = true

    return {
      newShardCount: newCount,
      migrationTaskId: task.id,
    }
  }

  /**
   * Start migration for a task
   */
  startMigration(taskId: string): MigrationTask | undefined {
    return this.migrationManager.startTask(taskId)
  }

  /**
   * Get next migration chunk
   */
  getNextMigrationChunk(taskId: string): { offset: number; limit: number } | null {
    return this.migrationManager.getNextChunk(taskId)
  }

  /**
   * Complete a migration chunk
   */
  completeMigrationChunk(taskId: string, recordsMigrated: number): MigrationTask | undefined {
    return this.migrationManager.completeChunk(taskId, recordsMigrated)
  }

  /**
   * Get migration progress
   */
  getMigrationProgress(taskId: string): number {
    return this.migrationManager.getProgress(taskId)
  }

  /**
   * Get active migrations
   */
  getActiveMigrations(): MigrationTask[] {
    return this.migrationManager.getActiveTasks()
  }

  // ==========================================================================
  // CROSS-SHARD QUERIES
  // ==========================================================================

  /**
   * Query all shards and combine results
   */
  async queryAll<T = unknown>(
    path: string,
    init?: RequestInit
  ): Promise<CrossShardQueryResult<T>> {
    const startTime = Date.now()
    const results: T[] = []
    const errors: Array<{ shardId: number; error: Error }> = []

    const shardResults = await this.shardManager.queryAll<T>(path, init)

    for (const result of shardResults) {
      if (result.error) {
        errors.push({ shardId: result.shard, error: result.error })
      } else if (result.data) {
        if (Array.isArray(result.data)) {
          results.push(...result.data)
        } else {
          results.push(result.data)
        }
      }
    }

    return {
      results,
      shardsQueried: this.config.count,
      errors,
      durationMs: Date.now() - startTime,
    }
  }

  // ==========================================================================
  // LOAD BALANCING
  // ==========================================================================

  /**
   * Update shard statistics
   */
  updateShardStats(shardId: number, stats: {
    usedBytes: number
    recordCount: number
    healthy: boolean
    lastActivity: number
  }): void {
    const usagePercent = (stats.usedBytes / DO_STORAGE_LIMIT) * 100
    this.loadBalancer.updateStats(shardId, {
      usedBytes: stats.usedBytes,
      recordCount: stats.recordCount,
      usagePercent,
      healthy: stats.healthy,
      lastActivity: stats.lastActivity,
    })
  }

  /**
   * Get statistics for all shards
   */
  getShardStats(): ShardStats[] {
    return this.loadBalancer.getAllStats()
  }

  /**
   * Get the least loaded shard
   */
  getLeastLoadedShard(): number {
    return this.loadBalancer.getLeastLoaded()
  }

  /**
   * Check if all shards are healthy
   */
  isHealthy(): boolean {
    return this.loadBalancer.isHealthy()
  }

  /**
   * Get unhealthy shards
   */
  getUnhealthyShards(): number[] {
    return this.loadBalancer.getUnhealthyShards()
  }

  // ==========================================================================
  // METRICS EXPORT
  // ==========================================================================

  /**
   * Export metrics for observability
   */
  exportMetrics(): {
    capacity: CapacityMetrics | null
    shards: ShardStats[]
    migrations: MigrationTask[]
    config: {
      shardKey: string
      shardCount: number
      capacityThreshold: number
      maxShards: number
      autoShardEnabled: boolean
    }
  } {
    return {
      capacity: this.capacityMonitor.getMetrics(),
      shards: this.loadBalancer.getAllStats(),
      migrations: this.migrationManager.getActiveTasks(),
      config: {
        shardKey: this.config.key,
        shardCount: this.config.count,
        capacityThreshold: this.config.capacityThreshold,
        maxShards: this.config.maxShards,
        autoShardEnabled: this.config.autoShard,
      },
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  CapacityMonitor,
  ShardKeyManager,
  MigrationManager,
  LoadBalancer,
  AutoShardManager,
}
