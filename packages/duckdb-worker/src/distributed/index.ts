/**
 * Distributed Query Layer for DuckDB Worker
 *
 * Implements Coordinator + Data Worker pattern for distributed query execution
 * across Cloudflare Workers within 128MB memory limits.
 *
 * Architecture:
 * ```
 * User Query -> Coordinator Worker -> Fan-out via RPC
 *                                      |-> Data Worker A (Partition 1)
 *                                      |-> Data Worker B (Partition 2)
 *                                      |-> Data Worker C (Partition 3)
 *                                   -> Merge Results
 * ```
 *
 * @example
 * ```typescript
 * const dq = new DistributedQuery({
 *   metadataPath: 'r2://analytics/metadata/',
 *   maxWorkers: 10,
 * })
 *
 * const result = await dq.query(`
 *   SELECT region, SUM(revenue)
 *   FROM events
 *   WHERE date >= '2024-01-01'
 *   GROUP BY region
 * `)
 * ```
 *
 * @module packages/duckdb-worker/src/distributed
 */

// Export types
export type {
  DistributedQueryConfig,
  PartitionInfo,
  PruningStats,
  QueryPlan,
  PushdownOps,
  FilterPredicate,
  AggregateExpr,
  AggregateFunction,
  SortSpec,
  WorkerTask,
  WorkerResult,
  WorkerStats,
  PartialResult,
  PartialAggregate,
  ColumnMeta,
  MergedResult,
  QueryStats,
  R2Bucket,
  R2Object,
  R2ObjectHead,
  R2ListOptions,
  R2ObjectList,
  DistributedQueryErrorCode,
} from './types.js'

export { DistributedQueryError } from './types.js'

// Export components
export { QueryPlanner } from './planner.js'
export { PartitionScanner, MockPartitionScanner } from './scanner.js'
export { ResultMerger, StreamingResultMerger, TopNMerger } from './merger.js'

// Main imports
import type {
  DistributedQueryConfig,
  PartitionInfo,
  QueryPlan,
  MergedResult,
  QueryStats,
  WorkerTask,
  WorkerResult,
  WorkerStats,
  PartialResult,
  R2Bucket,
} from './types.js'
import { DistributedQueryError } from './types.js'
import { QueryPlanner } from './planner.js'
import { PartitionScanner, MockPartitionScanner } from './scanner.js'
import { ResultMerger, TopNMerger } from './merger.js'

// ============================================================================
// DistributedQuery Implementation
// ============================================================================

/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
  maxWorkers: 10,
  memoryBudgetBytes: 84 * 1024 * 1024, // 84MB (128MB - 34MB DuckDB - 10MB overhead)
  workerTimeoutMs: 30000, // 30 seconds
  enableStreaming: false,
}

/**
 * DistributedQuery - Main entry point for distributed query execution
 *
 * Coordinates query planning, partition scanning, and result merging
 * across multiple data workers.
 */
export class DistributedQuery {
  private readonly config: Required<DistributedQueryConfig>
  private readonly planner: QueryPlanner
  private partitionCache: Map<string, PartitionInfo[]> = new Map()
  private metadataCache: Map<string, TableMetadata> = new Map()

  constructor(config: DistributedQueryConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      r2Bucket: config.r2Bucket!,
      fetchFn: config.fetchFn || fetch,
    }

    this.planner = new QueryPlanner(this.config)
  }

  /**
   * Execute a distributed SQL query
   *
   * @param sql - SQL query to execute
   * @returns Query result with statistics
   */
  async query(sql: string): Promise<MergedResult> {
    const startTime = performance.now()

    try {
      // 1. Load metadata and get partitions
      const table = this.extractTableName(sql)
      const partitions = await this.getPartitions(table)

      // 2. Plan the query
      const planStart = performance.now()
      const plan = this.planner.plan(sql, partitions)
      const planningTimeMs = performance.now() - planStart

      // 3. Validate plan
      this.validatePlan(plan)

      // 4. Execute query on partitions
      const executeStart = performance.now()
      const workerResults = await this.executeOnPartitions(plan)
      const executionTimeMs = performance.now() - executeStart

      // 5. Merge results
      const partialResults = workerResults
        .filter((r) => r.success && r.data)
        .map((r) => r.data!)

      const merger = plan.isTopN
        ? new TopNMerger(plan.pushdownOps.limit!, plan.pushdownOps.orderBy!)
        : new ResultMerger()

      let merged: MergedResult
      if (merger instanceof TopNMerger) {
        const rows = merger.merge(partialResults)
        merged = {
          rows,
          columns: partialResults[0]?.columns || [],
          rowCount: rows.length,
          stats: this.emptyStats(),
        }
      } else {
        merged = merger.merge(partialResults, {
          orderBy: plan.pushdownOps.orderBy,
          limit: plan.pushdownOps.limit,
        })
      }

      // 6. Build statistics
      const stats: QueryStats = {
        totalPartitions: partitions.length,
        prunedPartitions: plan.prunedPartitions,
        scannedPartitions: plan.partitions.length,
        bytesScanned: workerResults.reduce((sum, r) => sum + r.stats.bytesRead, 0),
        rowsProcessed: workerResults.reduce((sum, r) => sum + r.stats.rowsProcessed, 0),
        planningTimeMs,
        executionTimeMs,
        workerStats: workerResults.map((r) => r.stats),
      }

      merged.stats = stats

      return merged
    } catch (error) {
      if (error instanceof DistributedQueryError) {
        throw error
      }

      // Wrap unexpected errors
      throw new DistributedQueryError(
        error instanceof Error ? error.message : 'Unknown error',
        'PLANNING_ERROR',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Extract table name from SQL (simple implementation)
   */
  private extractTableName(sql: string): string {
    const match = sql.match(/FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/i)
    if (!match) {
      throw new DistributedQueryError(
        'Could not extract table name from query',
        'INVALID_SQL'
      )
    }
    return match[1]
  }

  /**
   * Get partitions for a table
   */
  private async getPartitions(table: string): Promise<PartitionInfo[]> {
    // Check cache
    if (this.partitionCache.has(table)) {
      return this.partitionCache.get(table)!
    }

    // Load metadata
    const metadata = await this.loadMetadata(table)

    // Extract partition info from manifest
    const partitions = await this.loadPartitionsFromManifest(metadata)

    // Cache and return
    this.partitionCache.set(table, partitions)
    return partitions
  }

  /**
   * Load table metadata from R2
   */
  private async loadMetadata(table: string): Promise<TableMetadata> {
    // Check cache
    if (this.metadataCache.has(table)) {
      return this.metadataCache.get(table)!
    }

    // Construct metadata path
    const metadataPath = this.config.metadataPath.replace('r2://', '')
    const key = `${metadataPath}${table}/metadata.json`

    try {
      const object = await this.config.r2Bucket.get(key)
      if (!object) {
        throw new DistributedQueryError(
          `Table not found: ${table}`,
          'TABLE_NOT_FOUND'
        )
      }

      const buffer = await object.arrayBuffer()
      const text = new TextDecoder().decode(buffer)
      const metadata = JSON.parse(text) as TableMetadata

      // Cache and return
      this.metadataCache.set(table, metadata)
      return metadata
    } catch (error) {
      if (error instanceof DistributedQueryError) {
        throw error
      }
      throw new DistributedQueryError(
        `Failed to load metadata for table ${table}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'METADATA_ERROR'
      )
    }
  }

  /**
   * Load partition info from manifest files
   */
  private async loadPartitionsFromManifest(metadata: TableMetadata): Promise<PartitionInfo[]> {
    // For now, use a simplified approach - list data files from R2
    // In production, this would parse Iceberg manifest files
    const partitions: PartitionInfo[] = []

    const baseLocation = metadata.location.replace('r2://', '')
    const dataPrefix = `${baseLocation}data/`

    // List data files
    const listResult = await this.config.r2Bucket.list({ prefix: dataPrefix })

    for (const obj of listResult.objects) {
      if (!obj.key.endsWith('.parquet')) continue

      // Parse partition values from path
      const partitionValues = this.parsePartitionPath(obj.key, dataPrefix)

      partitions.push({
        path: obj.key,
        partitionValues,
        pruningStats: {}, // Would be populated from manifest in production
        format: 'parquet',
        sizeBytes: obj.size,
        rowCount: this.estimateRowCount(obj.size), // Estimate based on file size
      })
    }

    return partitions
  }

  /**
   * Parse partition values from path
   * e.g., "data/date=2024-01-01/region=us-west-2/part-0.parquet"
   */
  private parsePartitionPath(
    path: string,
    prefix: string
  ): Record<string, unknown> {
    const relativePath = path.slice(prefix.length)
    const parts = relativePath.split('/')
    const values: Record<string, unknown> = {}

    for (const part of parts) {
      if (part.includes('=')) {
        const [key, value] = part.split('=')
        values[key] = value
      }
    }

    return values
  }

  /**
   * Estimate row count from file size
   */
  private estimateRowCount(sizeBytes: number): number {
    // Rough estimate: ~100 bytes per row for analytics data
    return Math.floor(sizeBytes / 100)
  }

  /**
   * Validate query plan
   */
  private validatePlan(plan: QueryPlan): void {
    if (plan.partitions.length === 0) {
      // All partitions pruned - return empty result
      return
    }

    // Check for unsupported features
    // (expand as needed)
  }

  /**
   * Execute query on all selected partitions
   */
  private async executeOnPartitions(plan: QueryPlan): Promise<WorkerResult[]> {
    if (plan.partitions.length === 0) {
      return []
    }

    // Generate partition SQL
    const partitionSQL = this.planner.generatePartitionSQL(plan)

    // Create worker tasks
    const tasks: WorkerTask[] = plan.partitions.map((partition, index) => ({
      taskId: `task-${index}`,
      partition,
      sql: partitionSQL,
      pushdownOps: plan.pushdownOps,
      memoryBudgetBytes: this.config.memoryBudgetBytes,
    }))

    // Execute tasks with concurrency limit
    const results: WorkerResult[] = []
    const concurrency = Math.min(this.config.maxWorkers, tasks.length)

    // Process in batches
    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency)
      const batchResults = await Promise.all(
        batch.map((task) => this.executeTask(task))
      )
      results.push(...batchResults)
    }

    // Check for failures
    const failures = results.filter((r) => !r.success)
    if (failures.length > 0) {
      const firstError = failures[0].error || 'Unknown error'
      // Determine error type
      if (firstError.includes('timeout')) {
        throw new DistributedQueryError(firstError, 'WORKER_TIMEOUT')
      }
      if (firstError.includes('memory')) {
        throw new DistributedQueryError(firstError, 'WORKER_OOM')
      }
      throw new DistributedQueryError(firstError, 'PARTITION_FETCH_ERROR')
    }

    return results
  }

  /**
   * Execute a single worker task
   */
  private async executeTask(task: WorkerTask): Promise<WorkerResult> {
    // Create timeout promise
    const timeoutPromise = new Promise<WorkerResult>((_, reject) => {
      setTimeout(() => {
        reject(new DistributedQueryError(
          `Worker timeout after ${this.config.workerTimeoutMs}ms`,
          'WORKER_TIMEOUT'
        ))
      }, this.config.workerTimeoutMs)
    })

    // Create scanner
    const scanner = new MockPartitionScanner({
      r2Bucket: this.config.r2Bucket,
      memoryBudgetBytes: this.config.memoryBudgetBytes,
    })

    // Race execution against timeout
    try {
      return await Promise.race([
        scanner.execute(task),
        timeoutPromise,
      ])
    } catch (error) {
      return {
        taskId: task.taskId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stats: {
          fetchTimeMs: 0,
          queryTimeMs: 0,
          totalTimeMs: 0,
          bytesRead: 0,
          rowsProcessed: 0,
        },
      }
    }
  }

  /**
   * Clear metadata and partition caches
   */
  clearCache(): void {
    this.metadataCache.clear()
    this.partitionCache.clear()
  }

  /**
   * Create empty stats object
   */
  private emptyStats(): QueryStats {
    return {
      totalPartitions: 0,
      prunedPartitions: 0,
      scannedPartitions: 0,
      bytesScanned: 0,
      rowsProcessed: 0,
      planningTimeMs: 0,
      executionTimeMs: 0,
      workerStats: [],
    }
  }
}

// ============================================================================
// Helper Types
// ============================================================================

interface TableMetadata {
  formatVersion: 1 | 2
  tableUuid: string
  location: string
  currentSnapshotId: number | null
  schemas: unknown[]
  currentSchemaId: number
  partitionSpecs: unknown[]
  defaultSpecId: number
  snapshots: unknown[]
  [key: string]: unknown
}
