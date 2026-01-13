/**
 * Parallel Cascade Utilities
 *
 * Provides utilities for distributing cascade generation across multiple
 * Durable Objects for massive scale-out scenarios (3.6M+ entities).
 *
 * Key features:
 * - Type-based and entity-based sharding strategies
 * - Hybrid partitioning (types as namespaces, entities sharded within)
 * - Fan-out/fan-in patterns for parallel execution
 * - Result aggregation with partial failure handling
 * - Observability through cascade metrics
 *
 * @module db/schema/resolvers/parallel
 *
 * @example
 * ```typescript
 * import {
 *   ParallelCascadeCoordinator,
 *   createTypeShardingStrategy,
 *   createEntityShardingStrategy,
 * } from 'db/schema/resolvers/parallel'
 *
 * const coordinator = new ParallelCascadeCoordinator({
 *   shardingStrategy: createHybridShardingStrategy({ shardCount: 100 }),
 *   batchSize: 1000,
 *   maxConcurrency: 50,
 * })
 *
 * const result = await coordinator.execute(cascadePlan)
 * ```
 */

import type { Entity, Relationship } from './shared'
import { generateEntityId, generateRelationshipId } from './shared'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Parallelization strategy determines how work is distributed across DOs
 */
export type ParallelismMode = 'full' | 'limited' | 'sequential'

/**
 * Sharding strategy for distributing entities across DOs
 */
export type ShardingStrategy = 'type-based' | 'entity-based' | 'hybrid'

/**
 * A shard represents a partition of the cascade work
 */
export interface CascadeShard {
  id: string
  types: string[]
  entityCount: number
  targetDO: string
}

/**
 * A batch of operations to execute in a single DO
 */
export interface CascadeBatch {
  id: string
  shardId: string
  operations: CascadeOperation[]
  dependencies: string[] // batch IDs this batch depends on
}

/**
 * A single cascade operation (entity generation or relationship creation)
 */
export interface CascadeOperation {
  id: string
  type: 'generate' | 'relate'
  entityType?: string
  fromId?: string
  toId?: string
  verb?: string
  context?: Record<string, unknown>
  timeout?: number
  retryable?: boolean
}

/**
 * Result of executing a cascade batch
 */
export interface BatchResult {
  batchId: string
  shardId: string
  success: boolean
  entities: Entity[]
  relationships: Relationship[]
  errors: BatchError[]
  metrics: BatchMetrics
}

/**
 * Error from batch execution
 */
export interface BatchError {
  operationId: string
  error: Error
  retryable: boolean
  retryCount: number
}

/**
 * Metrics for batch execution
 */
export interface BatchMetrics {
  startTime: number
  endTime: number
  operationCount: number
  successCount: number
  failureCount: number
  avgLatencyMs: number
}

/**
 * Configuration for parallel cascade execution
 */
export interface ParallelCascadeConfig {
  /** Sharding strategy to use */
  shardingStrategy: ShardingStrategy
  /** Number of shards for entity-based and hybrid strategies */
  shardCount?: number
  /** Maximum entities per batch */
  batchSize?: number
  /** Maximum concurrent batches */
  maxConcurrency?: number
  /** Timeout for individual operations (ms) */
  operationTimeout?: number
  /** How to handle partial failures */
  partialFailurePolicy?: 'abort' | 'continue' | 'best-effort'
  /** Circuit breaker configuration */
  circuitBreaker?: {
    enabled: boolean
    threshold: number
    timeout: number
  }
}

/**
 * Plan for executing a parallel cascade
 */
export interface ParallelCascadePlan {
  id: string
  config: ParallelCascadeConfig
  shards: CascadeShard[]
  batches: CascadeBatch[]
  executionOrder: string[][] // batches grouped by execution wave
  totalOperations: number
  estimatedDuration: number
}

/**
 * Result of a parallel cascade execution
 */
export interface ParallelCascadeResult {
  planId: string
  success: boolean
  entities: Map<string, Entity>
  relationships: Relationship[]
  shardResults: Map<string, BatchResult[]>
  metrics: ParallelCascadeMetrics
  errors: CascadeError[]
}

/**
 * Aggregate metrics for parallel cascade
 */
export interface ParallelCascadeMetrics {
  totalDuration: number
  totalEntities: number
  totalRelationships: number
  shardsUsed: number
  batchesExecuted: number
  avgBatchLatency: number
  peakConcurrency: number
  retryCount: number
  failureRate: number
}

/**
 * Error tracking for cascade operations
 */
export interface CascadeError {
  shardId: string
  batchId: string
  operationId: string
  error: Error
  timestamp: number
  fatal: boolean
}

// ============================================================================
// SHARDING STRATEGIES
// ============================================================================

/**
 * Type-based sharding: Each entity type gets dedicated DO(s)
 *
 * Best for:
 * - Schemas with large type variations
 * - Types that have very different generation characteristics
 * - When type-specific caching is beneficial
 */
export function createTypeShardingStrategy(
  types: string[],
  config?: { maxTypesPerShard?: number }
): Map<string, CascadeShard> {
  const shards = new Map<string, CascadeShard>()
  const maxPerShard = config?.maxTypesPerShard ?? 1

  let currentShard: CascadeShard | null = null
  let shardIndex = 0

  for (const type of types) {
    if (!currentShard || currentShard.types.length >= maxPerShard) {
      const shardId = `shard-type-${shardIndex++}`
      currentShard = {
        id: shardId,
        types: [],
        entityCount: 0,
        targetDO: `cascade-${shardId}`,
      }
      shards.set(shardId, currentShard)
    }

    currentShard.types.push(type)
  }

  return shards
}

/**
 * Entity-based sharding: Entities sharded by ID hash across N DOs
 *
 * Best for:
 * - Uniform load distribution
 * - Large entity counts per type
 * - When entity locality doesn't matter
 */
export function createEntityShardingStrategy(config: {
  shardCount: number
  hashFn?: (entityId: string) => number
}): {
  getShard: (entityId: string) => string
  shardIds: string[]
} {
  const { shardCount, hashFn } = config

  // Default hash function using simple string hashing
  const defaultHashFn = (id: string): number => {
    let hash = 0
    for (let i = 0; i < id.length; i++) {
      const char = id.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash)
  }

  const hash = hashFn ?? defaultHashFn
  const shardIds = Array.from(
    { length: shardCount },
    (_, i) => `shard-entity-${i}`
  )

  return {
    getShard: (entityId: string) => {
      const index = hash(entityId) % shardCount
      return shardIds[index]!
    },
    shardIds,
  }
}

/**
 * Hybrid sharding: Types as namespaces, entities sharded within namespace
 *
 * Best for:
 * - Very large cascades (millions of entities)
 * - Mixed workloads
 * - When both type locality and load distribution matter
 */
export function createHybridShardingStrategy(config: {
  shardCount: number
  typePrefixLength?: number
}): {
  getShard: (entityType: string, entityId: string) => string
  shardIds: string[]
} {
  const { shardCount, typePrefixLength = 3 } = config

  const entitySharding = createEntityShardingStrategy({ shardCount })

  // Generate shard IDs with type prefix
  const shardIds: string[] = []
  for (let i = 0; i < shardCount; i++) {
    shardIds.push(`shard-hybrid-${i}`)
  }

  return {
    getShard: (entityType: string, entityId: string) => {
      const typePrefix = entityType.slice(0, typePrefixLength).toLowerCase()
      const baseShard = entitySharding.getShard(entityId)
      return `${typePrefix}-${baseShard}`
    },
    shardIds,
  }
}

// ============================================================================
// BATCH PLANNING
// ============================================================================

/**
 * Plans cascade execution by grouping operations into batches
 */
export class CascadeBatchPlanner {
  private config: ParallelCascadeConfig
  private shards: Map<string, CascadeShard>
  private batches: CascadeBatch[] = []

  constructor(config: ParallelCascadeConfig) {
    this.config = config
    this.shards = new Map()
  }

  /**
   * Plan batches for a set of entity types with estimated counts
   */
  plan(
    typeEstimates: Map<string, number>,
    dependencies: Map<string, string[]>
  ): ParallelCascadePlan {
    const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const types = Array.from(typeEstimates.keys())

    // Create shards based on strategy
    this.shards = this.createShards(types, typeEstimates)

    // Create batches for each shard
    this.batches = this.createBatches(typeEstimates, dependencies)

    // Compute execution order (waves of parallel batches)
    const executionOrder = this.computeExecutionOrder(this.batches, dependencies)

    // Calculate metrics
    const totalOperations = this.batches.reduce(
      (sum, b) => sum + b.operations.length,
      0
    )
    const estimatedDuration = this.estimateDuration(executionOrder)

    return {
      id: planId,
      config: this.config,
      shards: Array.from(this.shards.values()),
      batches: this.batches,
      executionOrder,
      totalOperations,
      estimatedDuration,
    }
  }

  private createShards(
    types: string[],
    estimates: Map<string, number>
  ): Map<string, CascadeShard> {
    const shardCount = this.config.shardCount ?? 10

    switch (this.config.shardingStrategy) {
      case 'type-based':
        return createTypeShardingStrategy(types)

      case 'entity-based': {
        const strategy = createEntityShardingStrategy({ shardCount })
        const shards = new Map<string, CascadeShard>()

        for (const shardId of strategy.shardIds) {
          shards.set(shardId, {
            id: shardId,
            types: [...types], // All types can go to any shard
            entityCount: 0,
            targetDO: `cascade-${shardId}`,
          })
        }

        return shards
      }

      case 'hybrid':
      default: {
        const strategy = createHybridShardingStrategy({ shardCount })
        const shards = new Map<string, CascadeShard>()

        for (const shardId of strategy.shardIds) {
          shards.set(shardId, {
            id: shardId,
            types: [...types],
            entityCount: 0,
            targetDO: `cascade-${shardId}`,
          })
        }

        return shards
      }
    }
  }

  private createBatches(
    typeEstimates: Map<string, number>,
    dependencies: Map<string, string[]>
  ): CascadeBatch[] {
    const batches: CascadeBatch[] = []
    const batchSize = this.config.batchSize ?? 1000

    for (const [type, count] of typeEstimates) {
      const typeDeps = dependencies.get(type) ?? []
      const numBatches = Math.ceil(count / batchSize)

      for (let i = 0; i < numBatches; i++) {
        const batchId = `batch-${type}-${i}`
        const operationCount = Math.min(batchSize, count - i * batchSize)

        const operations: CascadeOperation[] = []
        for (let j = 0; j < operationCount; j++) {
          operations.push({
            id: `op-${type}-${i * batchSize + j}`,
            type: 'generate',
            entityType: type,
            timeout: this.config.operationTimeout ?? 30000,
            retryable: true,
          })
        }

        // Find dependency batches
        const depBatches = batches
          .filter((b) => typeDeps.some((dep) => b.operations[0]?.entityType === dep))
          .map((b) => b.id)

        batches.push({
          id: batchId,
          shardId: this.assignShard(type),
          operations,
          dependencies: depBatches,
        })
      }
    }

    return batches
  }

  private assignShard(type: string): string {
    // Simple round-robin assignment for now
    const shardIds = Array.from(this.shards.keys())
    const hash = type.split('').reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0)
    return shardIds[Math.abs(hash) % shardIds.length]!
  }

  private computeExecutionOrder(
    batches: CascadeBatch[],
    _dependencies: Map<string, string[]>
  ): string[][] {
    const waves: string[][] = []
    const completed = new Set<string>()
    const remaining = new Set(batches.map((b) => b.id))
    const batchMap = new Map(batches.map((b) => [b.id, b]))

    while (remaining.size > 0) {
      const wave: string[] = []

      for (const batchId of remaining) {
        const batch = batchMap.get(batchId)!
        const depsCompleted = batch.dependencies.every((d) => completed.has(d))

        if (depsCompleted) {
          wave.push(batchId)
        }
      }

      if (wave.length === 0 && remaining.size > 0) {
        // Circular dependency - add remaining batches
        wave.push(...remaining)
      }

      for (const batchId of wave) {
        completed.add(batchId)
        remaining.delete(batchId)
      }

      if (wave.length > 0) {
        waves.push(wave)
      }
    }

    return waves
  }

  private estimateDuration(waves: string[][]): number {
    const avgBatchTime = 1000 // 1 second average per batch
    const maxConcurrency = this.config.maxConcurrency ?? 10

    let total = 0
    for (const wave of waves) {
      const parallelBatches = Math.ceil(wave.length / maxConcurrency)
      total += parallelBatches * avgBatchTime
    }

    return total
  }
}

// ============================================================================
// PARALLEL EXECUTOR
// ============================================================================

/**
 * DO invoker interface for executing operations on Durable Objects
 */
export interface DOInvoker {
  invoke(
    targetDO: string,
    batch: CascadeBatch,
    timeout: number
  ): Promise<BatchResult>
}

/**
 * Executes a parallel cascade plan across multiple DOs
 */
export class ParallelCascadeExecutor {
  private config: ParallelCascadeConfig
  private invoker: DOInvoker

  constructor(config: ParallelCascadeConfig, invoker: DOInvoker) {
    this.config = config
    this.invoker = invoker
  }

  /**
   * Execute a parallel cascade plan
   */
  async execute(plan: ParallelCascadePlan): Promise<ParallelCascadeResult> {
    const startTime = Date.now()
    const entities = new Map<string, Entity>()
    const relationships: Relationship[] = []
    const shardResults = new Map<string, BatchResult[]>()
    const errors: CascadeError[] = []

    let batchesExecuted = 0
    let totalLatency = 0
    let peakConcurrency = 0
    let retryCount = 0

    const batchMap = new Map(plan.batches.map((b) => [b.id, b]))

    // Execute waves in order
    for (const wave of plan.executionOrder) {
      const concurrency = Math.min(
        wave.length,
        this.config.maxConcurrency ?? 10
      )
      peakConcurrency = Math.max(peakConcurrency, concurrency)

      // Execute batches in parallel within wave
      const results = await this.executeWave(
        wave.map((id) => batchMap.get(id)!),
        concurrency
      )

      // Aggregate results
      for (const result of results) {
        batchesExecuted++
        totalLatency += result.metrics.endTime - result.metrics.startTime
        retryCount += result.errors.filter((e) => e.retryCount > 0).length

        // Store entities
        for (const entity of result.entities) {
          entities.set(entity.$id, entity)
        }

        // Store relationships
        relationships.push(...result.relationships)

        // Track shard results
        if (!shardResults.has(result.shardId)) {
          shardResults.set(result.shardId, [])
        }
        shardResults.get(result.shardId)!.push(result)

        // Track errors
        for (const err of result.errors) {
          errors.push({
            shardId: result.shardId,
            batchId: result.batchId,
            operationId: err.operationId,
            error: err.error,
            timestamp: Date.now(),
            fatal: !err.retryable,
          })
        }

        // Check partial failure policy
        if (!result.success && this.config.partialFailurePolicy === 'abort') {
          return this.buildResult(
            plan.id,
            false,
            entities,
            relationships,
            shardResults,
            errors,
            startTime,
            batchesExecuted,
            totalLatency,
            peakConcurrency,
            retryCount
          )
        }
      }
    }

    const success = errors.filter((e) => e.fatal).length === 0
    return this.buildResult(
      plan.id,
      success,
      entities,
      relationships,
      shardResults,
      errors,
      startTime,
      batchesExecuted,
      totalLatency,
      peakConcurrency,
      retryCount
    )
  }

  private async executeWave(
    batches: CascadeBatch[],
    concurrency: number
  ): Promise<BatchResult[]> {
    const results: BatchResult[] = []
    const queue = [...batches]
    const inFlight = new Set<Promise<BatchResult>>()

    while (queue.length > 0 || inFlight.size > 0) {
      // Fill up to concurrency limit
      while (inFlight.size < concurrency && queue.length > 0) {
        const batch = queue.shift()!
        const shard = batch.shardId

        const promise = this.executeBatch(batch, shard)
          .then((result) => {
            results.push(result)
            inFlight.delete(promise)
            return result
          })

        inFlight.add(promise)
      }

      // Wait for at least one to complete
      if (inFlight.size > 0) {
        await Promise.race(inFlight)
      }
    }

    return results
  }

  private async executeBatch(
    batch: CascadeBatch,
    shardId: string
  ): Promise<BatchResult> {
    const shard = `cascade-${shardId}`
    const timeout = this.config.operationTimeout ?? 30000

    try {
      return await this.invoker.invoke(shard, batch, timeout)
    } catch (error) {
      // Return error result
      return {
        batchId: batch.id,
        shardId,
        success: false,
        entities: [],
        relationships: [],
        errors: [
          {
            operationId: batch.id,
            error: error instanceof Error ? error : new Error(String(error)),
            retryable: true,
            retryCount: 0,
          },
        ],
        metrics: {
          startTime: Date.now(),
          endTime: Date.now(),
          operationCount: batch.operations.length,
          successCount: 0,
          failureCount: batch.operations.length,
          avgLatencyMs: 0,
        },
      }
    }
  }

  private buildResult(
    planId: string,
    success: boolean,
    entities: Map<string, Entity>,
    relationships: Relationship[],
    shardResults: Map<string, BatchResult[]>,
    errors: CascadeError[],
    startTime: number,
    batchesExecuted: number,
    totalLatency: number,
    peakConcurrency: number,
    retryCount: number
  ): ParallelCascadeResult {
    const totalDuration = Date.now() - startTime
    const totalEntities = entities.size
    const totalRelationships = relationships.length
    const shardsUsed = shardResults.size
    const avgBatchLatency = batchesExecuted > 0 ? totalLatency / batchesExecuted : 0
    const failureRate = batchesExecuted > 0
      ? errors.filter((e) => e.fatal).length / batchesExecuted
      : 0

    return {
      planId,
      success,
      entities,
      relationships,
      shardResults,
      metrics: {
        totalDuration,
        totalEntities,
        totalRelationships,
        shardsUsed,
        batchesExecuted,
        avgBatchLatency,
        peakConcurrency,
        retryCount,
        failureRate,
      },
      errors,
    }
  }
}

// ============================================================================
// COORDINATOR (HIGH-LEVEL API)
// ============================================================================

/**
 * High-level coordinator for parallel cascade operations
 *
 * Combines planning and execution into a single interface.
 *
 * @example
 * ```typescript
 * const coordinator = new ParallelCascadeCoordinator({
 *   shardingStrategy: 'hybrid',
 *   shardCount: 100,
 *   batchSize: 1000,
 *   maxConcurrency: 50,
 *   partialFailurePolicy: 'continue',
 * }, doInvoker)
 *
 * const result = await coordinator.generateCascade({
 *   rootType: 'Startup',
 *   typeEstimates: new Map([
 *     ['Startup', 100],
 *     ['LeanCanvas', 100],
 *     ['Customer', 1000],
 *     ['Feature', 5000],
 *   ]),
 *   dependencies: new Map([
 *     ['LeanCanvas', ['Startup']],
 *     ['Customer', ['Startup']],
 *     ['Feature', ['LeanCanvas']],
 *   ]),
 * })
 * ```
 */
export class ParallelCascadeCoordinator {
  private planner: CascadeBatchPlanner
  private executor: ParallelCascadeExecutor

  constructor(config: ParallelCascadeConfig, invoker: DOInvoker) {
    this.planner = new CascadeBatchPlanner(config)
    this.executor = new ParallelCascadeExecutor(config, invoker)
  }

  /**
   * Plan and execute a parallel cascade
   */
  async generateCascade(request: {
    rootType: string
    typeEstimates: Map<string, number>
    dependencies: Map<string, string[]>
  }): Promise<ParallelCascadeResult> {
    // Plan the cascade
    const plan = this.planner.plan(
      request.typeEstimates,
      request.dependencies
    )

    // Execute the plan
    return this.executor.execute(plan)
  }

  /**
   * Get a dry-run plan without executing
   */
  planCascade(request: {
    typeEstimates: Map<string, number>
    dependencies: Map<string, string[]>
  }): ParallelCascadePlan {
    return this.planner.plan(
      request.typeEstimates,
      request.dependencies
    )
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a parallel cascade coordinator with default settings
 */
export function createParallelCascadeCoordinator(
  invoker: DOInvoker,
  options?: Partial<ParallelCascadeConfig>
): ParallelCascadeCoordinator {
  const config: ParallelCascadeConfig = {
    shardingStrategy: options?.shardingStrategy ?? 'hybrid',
    shardCount: options?.shardCount ?? 100,
    batchSize: options?.batchSize ?? 1000,
    maxConcurrency: options?.maxConcurrency ?? 50,
    operationTimeout: options?.operationTimeout ?? 30000,
    partialFailurePolicy: options?.partialFailurePolicy ?? 'continue',
    circuitBreaker: options?.circuitBreaker ?? {
      enabled: true,
      threshold: 5,
      timeout: 60000,
    },
  }

  return new ParallelCascadeCoordinator(config, invoker)
}

/**
 * Estimate shard count based on entity estimates
 */
export function estimateShardCount(
  typeEstimates: Map<string, number>,
  targetEntitiesPerShard: number = 10000
): number {
  const totalEntities = Array.from(typeEstimates.values()).reduce(
    (sum, count) => sum + count,
    0
  )
  return Math.max(1, Math.ceil(totalEntities / targetEntitiesPerShard))
}

/**
 * Validate a cascade plan for potential issues
 */
export function validateCascadePlan(plan: ParallelCascadePlan): {
  valid: boolean
  warnings: string[]
  errors: string[]
} {
  const warnings: string[] = []
  const errors: string[] = []

  // Check for empty plan
  if (plan.batches.length === 0) {
    errors.push('Plan has no batches to execute')
  }

  // Check for orphan batches (no dependencies but not in first wave)
  const firstWave = new Set(plan.executionOrder[0] ?? [])
  for (const batch of plan.batches) {
    if (batch.dependencies.length === 0 && !firstWave.has(batch.id)) {
      warnings.push(`Batch ${batch.id} has no dependencies but is not in first wave`)
    }
  }

  // Check for large batches
  const batchSize = plan.config.batchSize ?? 1000
  for (const batch of plan.batches) {
    if (batch.operations.length > batchSize * 1.5) {
      warnings.push(`Batch ${batch.id} exceeds recommended size (${batch.operations.length} > ${batchSize})`)
    }
  }

  // Check shard distribution
  const shardCounts = new Map<string, number>()
  for (const batch of plan.batches) {
    const count = shardCounts.get(batch.shardId) ?? 0
    shardCounts.set(batch.shardId, count + batch.operations.length)
  }

  const avgPerShard = plan.totalOperations / plan.shards.length
  for (const [shardId, count] of shardCounts) {
    if (count > avgPerShard * 2) {
      warnings.push(`Shard ${shardId} is overloaded (${count} operations vs ${avgPerShard.toFixed(0)} average)`)
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  }
}
