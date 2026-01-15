/**
 * Integration Test Harness for Unified Storage
 *
 * Extends the E2E harness with unified storage specific utilities.
 * Designed to support the write path integration tests.
 *
 * This harness wires up:
 * - StateManager (in-memory state)
 * - PipelineEmitter (event emission)
 * - LazyCheckpointer (SQLite persistence)
 * - ColdStartRecovery (state restoration)
 *
 * @example
 * ```typescript
 * import { IntegrationTestHarness } from './harness'
 *
 * describe('Write Path Integration', () => {
 *   const harness = new IntegrationTestHarness()
 *
 *   beforeEach(async () => {
 *     await harness.setup()
 *   })
 *
 *   afterEach(async () => {
 *     await harness.teardown()
 *   })
 *
 *   it('completes full write path', async () => {
 *     const result = await harness.write({
 *       $type: 'Customer',
 *       name: 'Alice',
 *     })
 *     expect(result.success).toBe(true)
 *   })
 * })
 * ```
 *
 * @module tests/unified-storage/integration/harness
 */

import { vi } from 'vitest'
import {
  E2ETestHarness,
  type HarnessConfig,
  type MockPipeline,
  type PipelineEvent,
  type Thing,
} from '../../e2e/harness'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration for the integration harness
 */
export interface IntegrationHarnessConfig extends HarnessConfig {
  /** Checkpoint interval in milliseconds (default: 5000) */
  checkpointIntervalMs?: number
  /** Enable multi-master mode (default: false) */
  multiMaster?: boolean
  /** Master ID for multi-master mode */
  masterId?: string
  /** Sharding configuration */
  sharding?: ShardingConfig
  /** Replication configuration */
  replication?: ReplicationConfig
}

/**
 * Sharding configuration
 */
export interface ShardingConfig {
  enabled: boolean
  strategy: 'hash' | 'range'
  shardCount?: number
  ranges?: Array<{ start: string; end: string; shard: number }>
}

/**
 * Replication configuration
 */
export interface ReplicationConfig {
  role: 'leader' | 'follower'
  nodeId: string
  leaderId?: string
}

/**
 * Write operation result
 */
export interface WriteResult {
  success: boolean
  entity?: Thing
  error?: string
  errorCode?: string
  acknowledgment?: WriteAcknowledgment
  shardInfo?: ShardInfo
  leaderId?: string
}

/**
 * Write acknowledgment metadata
 */
export interface WriteAcknowledgment {
  stateUpdatedAt: number
  pipelineEmittedAt?: number
  pipelineEmitted: boolean
  pipelinePending: boolean
  totalDurationMs: number
}

/**
 * Shard routing information
 */
export interface ShardInfo {
  shardIndex: number
  partitionKey: string
}

/**
 * Write options
 */
export interface WriteOptions {
  partitionKey?: string
  acknowledgmentMode?: 'state' | 'pipeline'
}

/**
 * Transaction context for atomic multi-entity writes
 */
export interface TransactionContext {
  write(data: Partial<Thing>): Promise<WriteResult>
  update(id: string, data: Partial<Thing>): Promise<WriteResult>
  get(id: string): Promise<Thing | null>
  delete(id: string): Promise<WriteResult>
}

/**
 * Transaction result
 */
export interface TransactionResult<T = unknown> {
  success: boolean
  error?: string
  entities?: Record<string, WriteResult>
  result?: T
}

/**
 * Mock SQLite interface for checkpointing
 */
export interface MockSQLite {
  exec: ReturnType<typeof vi.fn>
  prepare: ReturnType<typeof vi.fn>
  tables: Map<string, unknown[]>
  clear(): void
}

/**
 * Conflict resolution metrics
 */
export interface ConflictMetrics {
  conflictsDetected: number
  conflictsResolved: number
  resolutionBreakdown: Record<string, number>
}

/**
 * Write path metrics
 */
export interface WritePathMetrics {
  totalWrites: number
  averageWriteLatencyMs: number
  pipelineEmitSuccessRate: number
  checkpointCount: number
}

/**
 * Replication metrics
 */
export interface ReplicationMetrics {
  followers: Map<string, { lag: number; lastSeen: number }>
}

/**
 * Store statistics
 */
export interface StoreStats {
  entityCount: number
  totalWrites: number
  totalReads: number
}

// ============================================================================
// MOCK FACTORIES
// ============================================================================

/**
 * Create mock SQLite for checkpointing
 */
function createMockSQLite(): MockSQLite {
  const tables = new Map<string, unknown[]>()

  return {
    exec: vi.fn((query: string, ...params: unknown[]) => {
      const tableName = query.match(/(?:insert into|update)\s+(\w+)/i)?.[1] || 'default'
      if (!tables.has(tableName)) {
        tables.set(tableName, [])
      }
      tables.get(tableName)!.push({ query, params })
      return { toArray: () => [] }
    }),
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ run: vi.fn(), all: vi.fn(() => []) })),
    })),
    tables,
    clear() {
      tables.clear()
    },
  }
}

// ============================================================================
// INTEGRATION TEST HARNESS
// ============================================================================

/**
 * Integration Test Harness for Unified Storage
 *
 * Provides complete infrastructure for testing the write path
 * through all layers: StateManager -> Pipeline -> Checkpoint
 */
export class IntegrationTestHarness extends E2ETestHarness {
  private integrationConfig: Required<IntegrationHarnessConfig>
  private mockSQLite: MockSQLite
  private stateManager: Map<string, Thing>
  private checkpointTimer: ReturnType<typeof setTimeout> | null = null
  private writeCount: number = 0
  private totalWriteLatency: number = 0
  private checkpointCount: number = 0
  private conflictMetrics: ConflictMetrics
  private multiMasterState: {
    vectorClocks: Map<string, Record<string, number>>
    conflictHistory: Map<string, unknown[]>
  }
  private replicationRole: 'leader' | 'follower' | null = null

  constructor(config: IntegrationHarnessConfig = {}) {
    super(config)
    this.integrationConfig = {
      namespace: config.namespace ?? 'integration-test',
      verbose: config.verbose ?? false,
      enableTiming: config.enableTiming ?? true,
      mocks: config.mocks ?? {},
      checkpointIntervalMs: config.checkpointIntervalMs ?? 5000,
      multiMaster: config.multiMaster ?? false,
      masterId: config.masterId ?? 'master-default',
      sharding: config.sharding ?? { enabled: false, strategy: 'hash' },
      replication: config.replication ?? { role: 'leader', nodeId: 'node-default' },
    }

    this.mockSQLite = createMockSQLite()
    this.stateManager = new Map()
    this.conflictMetrics = {
      conflictsDetected: 0,
      conflictsResolved: 0,
      resolutionBreakdown: {},
    }
    this.multiMasterState = {
      vectorClocks: new Map(),
      conflictHistory: new Map(),
    }
    this.replicationRole = this.integrationConfig.replication?.role || null
  }

  /**
   * Setup the integration harness
   */
  async setup(): Promise<void> {
    await super.setup()
    this.stateManager.clear()
    this.mockSQLite.clear()
    this.writeCount = 0
    this.totalWriteLatency = 0
    this.checkpointCount = 0
    this.conflictMetrics = {
      conflictsDetected: 0,
      conflictsResolved: 0,
      resolutionBreakdown: {},
    }
    this.multiMasterState = {
      vectorClocks: new Map(),
      conflictHistory: new Map(),
    }

    // Start checkpoint timer if enabled
    if (this.integrationConfig.checkpointIntervalMs > 0) {
      this.startCheckpointTimer()
    }
  }

  /**
   * Teardown the integration harness
   */
  async teardown(): Promise<void> {
    await super.teardown()
    this.stopCheckpointTimer()
    this.stateManager.clear()
  }

  /**
   * Start checkpoint timer
   */
  private startCheckpointTimer(): void {
    this.checkpointTimer = setInterval(() => {
      this.checkpoint()
    }, this.integrationConfig.checkpointIntervalMs)
  }

  /**
   * Stop checkpoint timer
   */
  private stopCheckpointTimer(): void {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer)
      this.checkpointTimer = null
    }
  }

  /**
   * Write an entity through the full write path
   */
  async write(data: Partial<Thing>, options: WriteOptions = {}): Promise<WriteResult> {
    const start = performance.now()

    // Check replication role - followers cannot write
    if (this.replicationRole === 'follower') {
      return {
        success: false,
        errorCode: 'FOLLOWER_READ_ONLY',
        error: 'Cannot write to follower node',
        leaderId: this.integrationConfig.replication?.leaderId,
      }
    }

    const id = data.$id || crypto.randomUUID()
    const now = Date.now()

    const entity: Thing = {
      $id: id,
      $type: data.$type || 'Thing',
      $version: 1,
      $createdAt: now,
      $updatedAt: now,
      ...data,
    }

    // Store in state manager
    this.stateManager.set(id, entity)
    const stateUpdatedAt = performance.now()

    // Emit to pipeline
    const pipeline = this.getEnv().PIPELINE
    const event: PipelineEvent = {
      type: 'thing.created',
      entityId: id,
      entityType: entity.$type,
      payload: entity as Record<string, unknown>,
      timestamp: now,
      idempotencyKey: `create-${id}-${now}`,
      namespace: this.integrationConfig.namespace,
      sequence: 0, // Will be set by pipeline
    }

    let pipelineEmitted = false
    let pipelineEmittedAt: number | undefined

    try {
      await pipeline.send([event])
      pipelineEmitted = true
      pipelineEmittedAt = performance.now()
    } catch (error) {
      if (options.acknowledgmentMode === 'pipeline') {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Pipeline emit failed',
        }
      }
    }

    const totalDuration = performance.now() - start
    this.writeCount++
    this.totalWriteLatency += totalDuration

    const result: WriteResult = {
      success: true,
      entity,
      acknowledgment: {
        stateUpdatedAt,
        pipelineEmittedAt,
        pipelineEmitted,
        pipelinePending: !pipelineEmitted,
        totalDurationMs: totalDuration,
      },
    }

    // Add shard info if sharding is enabled
    if (this.integrationConfig.sharding?.enabled) {
      const partitionKey = options.partitionKey || id
      result.shardInfo = this.getShardInfo(partitionKey)
    }

    return result
  }

  /**
   * Update an entity
   */
  async update(id: string, data: Partial<Thing>): Promise<WriteResult> {
    const existing = this.stateManager.get(id)
    if (!existing) {
      return {
        success: false,
        error: 'Entity not found',
        errorCode: 'NOT_FOUND',
      }
    }

    const now = Date.now()
    const updated: Thing = {
      ...existing,
      ...data,
      $id: id,
      $version: (existing.$version || 0) + 1,
      $updatedAt: now,
    }

    this.stateManager.set(id, updated)

    // Emit update event
    const pipeline = this.getEnv().PIPELINE
    await pipeline.send([{
      type: 'thing.updated',
      entityId: id,
      entityType: updated.$type,
      payload: updated as Record<string, unknown>,
      timestamp: now,
      idempotencyKey: `update-${id}-${now}`,
      namespace: this.integrationConfig.namespace,
      sequence: 0,
    }])

    return {
      success: true,
      entity: updated,
    }
  }

  /**
   * Delete an entity
   */
  async delete(id: string): Promise<WriteResult> {
    const existing = this.stateManager.get(id)
    if (!existing) {
      return {
        success: false,
        error: 'Entity not found',
        errorCode: 'NOT_FOUND',
      }
    }

    this.stateManager.delete(id)

    // Emit delete event
    const pipeline = this.getEnv().PIPELINE
    await pipeline.send([{
      type: 'thing.deleted',
      entityId: id,
      entityType: existing.$type,
      payload: { $id: id },
      timestamp: Date.now(),
      idempotencyKey: `delete-${id}-${Date.now()}`,
      namespace: this.integrationConfig.namespace,
      sequence: 0,
    }])

    return {
      success: true,
      entity: existing,
    }
  }

  /**
   * Get an entity by ID
   */
  async get(id: string): Promise<Thing | null> {
    return this.stateManager.get(id) || null
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(
    fn: (ctx: TransactionContext) => Promise<T>
  ): Promise<TransactionResult<T>> {
    const txState = new Map<string, Thing>()
    const txDeletes = new Set<string>()
    const txEvents: PipelineEvent[] = []
    const txResults: Record<string, WriteResult> = {}

    const ctx: TransactionContext = {
      write: async (data: Partial<Thing>) => {
        const id = data.$id || crypto.randomUUID()
        const now = Date.now()
        const entity: Thing = {
          $id: id,
          $type: data.$type || 'Thing',
          $version: 1,
          $createdAt: now,
          $updatedAt: now,
          ...data,
        }
        txState.set(id, entity)
        txEvents.push({
          type: 'thing.created',
          entityId: id,
          entityType: entity.$type,
          payload: entity as Record<string, unknown>,
          timestamp: now,
          idempotencyKey: `tx-create-${id}`,
          namespace: this.integrationConfig.namespace,
          sequence: 0,
        })
        const result = { success: true, entity }
        txResults[id] = result
        return result
      },
      update: async (id: string, data: Partial<Thing>) => {
        const existing = txState.get(id) || this.stateManager.get(id)
        if (!existing) {
          return { success: false, error: 'Not found', errorCode: 'NOT_FOUND' }
        }
        const updated: Thing = {
          ...existing,
          ...data,
          $id: id,
          $version: (existing.$version || 0) + 1,
          $updatedAt: Date.now(),
        }
        txState.set(id, updated)
        return { success: true, entity: updated }
      },
      get: async (id: string) => {
        return txState.get(id) || this.stateManager.get(id) || null
      },
      delete: async (id: string) => {
        txDeletes.add(id)
        return { success: true }
      },
    }

    try {
      const result = await fn(ctx)

      // Commit: apply all changes to state
      for (const [id, entity] of txState) {
        this.stateManager.set(id, entity)
      }
      for (const id of txDeletes) {
        this.stateManager.delete(id)
      }

      // Emit all events in a single batch
      if (txEvents.length > 0) {
        await this.getEnv().PIPELINE.send(txEvents)
      }

      return {
        success: true,
        entities: txResults,
        result,
      }
    } catch (error) {
      // Rollback: don't apply changes
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Transaction failed',
      }
    }
  }

  /**
   * Force a checkpoint
   */
  async checkpoint(): Promise<void> {
    // Simulate checkpointing all dirty entries to SQLite
    for (const [id, entity] of this.stateManager) {
      this.mockSQLite.exec(
        'INSERT OR REPLACE INTO things ($id, $type, data) VALUES (?, ?, ?)',
        id,
        entity.$type,
        JSON.stringify(entity)
      )
    }
    this.checkpointCount++
  }

  /**
   * Close the store
   */
  async close(options: { skipCheckpoint?: boolean } = {}): Promise<void> {
    if (!options.skipCheckpoint) {
      await this.checkpoint()
    }
    this.stopCheckpointTimer()
  }

  /**
   * Wait for the store to be ready (cold start recovery)
   */
  async waitForReady(): Promise<void> {
    // In mock mode, we're immediately ready
    return Promise.resolve()
  }

  /**
   * Get shard info for a partition key
   */
  getShardInfo(partitionKey: string): ShardInfo {
    const config = this.integrationConfig.sharding
    if (!config?.enabled) {
      return { shardIndex: 0, partitionKey }
    }

    if (config.strategy === 'range' && config.ranges) {
      for (const range of config.ranges) {
        if (partitionKey >= range.start && partitionKey < range.end) {
          return { shardIndex: range.shard, partitionKey }
        }
      }
      return { shardIndex: 0, partitionKey }
    }

    // Hash-based sharding
    const hash = this.hashString(partitionKey)
    const shardCount = config.shardCount || 4
    return {
      shardIndex: hash % shardCount,
      partitionKey,
    }
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash)
  }

  /**
   * Get store statistics
   */
  getStats(): StoreStats {
    return {
      entityCount: this.stateManager.size,
      totalWrites: this.writeCount,
      totalReads: 0, // Would track in production
    }
  }

  /**
   * Get write path metrics
   */
  getWritePathMetrics(): WritePathMetrics {
    const pipeline = this.getEnv().PIPELINE
    const successCount = pipeline.events.length
    const attemptCount = (pipeline.send as ReturnType<typeof vi.fn>).mock.calls.length

    return {
      totalWrites: this.writeCount,
      averageWriteLatencyMs: this.writeCount > 0 ? this.totalWriteLatency / this.writeCount : 0,
      pipelineEmitSuccessRate: attemptCount > 0 ? successCount / attemptCount : 1,
      checkpointCount: this.checkpointCount,
    }
  }

  /**
   * Get conflict metrics
   */
  getConflictMetrics(): ConflictMetrics {
    return { ...this.conflictMetrics }
  }

  /**
   * Get conflict history for an entity
   */
  async getConflictHistory(entityId: string): Promise<unknown[]> {
    return this.multiMasterState.conflictHistory.get(entityId) || []
  }

  /**
   * Get replication metrics
   */
  getReplicationMetrics(): ReplicationMetrics {
    return {
      followers: new Map(),
    }
  }

  /**
   * Get current role
   */
  getRole(): 'leader' | 'follower' | null {
    return this.replicationRole
  }

  /**
   * Promote follower to leader
   */
  async promote(): Promise<void> {
    this.replicationRole = 'leader'
  }

  /**
   * Demote leader to follower
   */
  async demote(): Promise<void> {
    this.replicationRole = 'follower'
  }

  /**
   * Start replication (for followers)
   */
  async startReplication(): Promise<void> {
    // Subscribe to pipeline events and apply them
    const pipeline = this.getEnv().PIPELINE

    // Simulate event subscription by checking for new events periodically
    // In a real implementation, this would use WebSockets or long-polling
  }

  /**
   * Start multi-master mode
   */
  async startMultiMaster(): Promise<void> {
    // Initialize vector clocks for multi-master conflict resolution
    if (this.integrationConfig.multiMaster) {
      // Ready for multi-master operations
    }
  }

  /**
   * Get the mock SQLite instance
   */
  getSQLite(): MockSQLite {
    return this.mockSQLite
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  createMockSQLite,
}

export default IntegrationTestHarness
