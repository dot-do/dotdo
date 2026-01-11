/**
 * Partition Scanner for Distributed Query Layer (Data Worker)
 *
 * The scanner is responsible for:
 * 1. Fetching Parquet partition data from R2
 * 2. Loading data into DuckDB via registerBuffer
 * 3. Executing partial queries with filter pushdown
 * 4. Returning partial aggregates for merging
 *
 * Memory budget: 84MB (128MB - 34MB DuckDB - 10MB overhead)
 *
 * @module packages/duckdb-worker/src/distributed/scanner
 */

import type {
  WorkerTask,
  WorkerResult,
  WorkerStats,
  PartialResult,
  PartialAggregate,
  ColumnMeta,
  R2Bucket,
  AggregateFunction,
} from './types.js'
import { DistributedQueryError } from './types.js'

// ============================================================================
// Scanner Configuration
// ============================================================================

interface ScannerConfig {
  /** R2 bucket for data access */
  r2Bucket: R2Bucket

  /** Memory budget per worker in bytes */
  memoryBudgetBytes: number

  /** DuckDB instance factory (for testing) */
  createDuckDB?: () => Promise<DuckDBLike>
}

/**
 * Minimal DuckDB interface for scanner
 */
interface DuckDBLike {
  exec(sql: string): Promise<void>
  query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[]; columns: ColumnInfo[] }>
  registerFileBuffer(name: string, buffer: ArrayBuffer | Uint8Array): void
  close(): Promise<void>
}

interface ColumnInfo {
  name: string
  type: string
}

// ============================================================================
// Partition Scanner Implementation
// ============================================================================

/**
 * Partition Scanner for executing queries on individual partitions
 *
 * Each scanner instance handles one partition at a time within
 * the memory budget constraints of a Cloudflare Worker.
 */
export class PartitionScanner {
  private readonly config: ScannerConfig

  constructor(config: ScannerConfig) {
    this.config = config
  }

  /**
   * Execute a worker task on a partition
   */
  async execute(task: WorkerTask): Promise<WorkerResult> {
    const startTime = performance.now()
    const stats: WorkerStats = {
      fetchTimeMs: 0,
      queryTimeMs: 0,
      totalTimeMs: 0,
      bytesRead: 0,
      rowsProcessed: 0,
    }

    try {
      // Check memory budget
      if (task.partition.sizeBytes > task.memoryBudgetBytes) {
        throw new DistributedQueryError(
          `Partition size (${task.partition.sizeBytes} bytes) exceeds memory budget (${task.memoryBudgetBytes} bytes)`,
          'WORKER_OOM'
        )
      }

      // Fetch partition data from R2
      const fetchStart = performance.now()
      const parquetData = await this.fetchPartition(task.partition.path)
      stats.fetchTimeMs = performance.now() - fetchStart
      stats.bytesRead = parquetData.byteLength

      // Execute query on partition
      const queryStart = performance.now()
      const data = await this.executeQuery(task, parquetData)
      stats.queryTimeMs = performance.now() - queryStart
      stats.rowsProcessed = task.partition.rowCount

      stats.totalTimeMs = performance.now() - startTime

      return {
        taskId: task.taskId,
        success: true,
        data,
        stats,
      }
    } catch (error) {
      stats.totalTimeMs = performance.now() - startTime

      return {
        taskId: task.taskId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stats,
      }
    }
  }

  /**
   * Fetch partition data from R2
   */
  private async fetchPartition(path: string): Promise<ArrayBuffer> {
    const object = await this.config.r2Bucket.get(path)

    if (!object) {
      throw new DistributedQueryError(
        `Partition file not found: ${path}`,
        'PARTITION_FETCH_ERROR'
      )
    }

    return object.arrayBuffer()
  }

  /**
   * Execute query on partition data using DuckDB
   */
  private async executeQuery(task: WorkerTask, parquetData: ArrayBuffer): Promise<PartialResult> {
    // Create DuckDB instance
    const db = await this.createDuckDB()

    try {
      // Register the Parquet file
      db.registerFileBuffer('partition_data.parquet', new Uint8Array(parquetData))

      // Create a view for the Parquet file
      await db.exec(`CREATE VIEW partition_data AS SELECT * FROM read_parquet('partition_data.parquet')`)

      // Execute the query
      const result = await db.query(task.sql)

      // Convert result to partial result format
      return this.toPartialResult(result, task)
    } finally {
      await db.close()
    }
  }

  /**
   * Create DuckDB instance
   */
  private async createDuckDB(): Promise<DuckDBLike> {
    if (this.config.createDuckDB) {
      return this.config.createDuckDB()
    }

    // Dynamic import to avoid circular dependencies
    const { createDuckDB } = await import('../index.js')
    return createDuckDB({ maxMemory: `${Math.floor(this.config.memoryBudgetBytes / (1024 * 1024))}MB` })
  }

  /**
   * Convert query result to partial result format
   */
  private toPartialResult(
    result: { rows: Record<string, unknown>[]; columns: ColumnInfo[] },
    task: WorkerTask
  ): PartialResult {
    const { pushdownOps } = task
    const hasAggregates = pushdownOps.aggregates.length > 0
    const hasGroupBy = pushdownOps.groupBy.length > 0

    const columns: ColumnMeta[] = result.columns.map((c) => ({
      name: c.name,
      type: c.type,
    }))

    // If no aggregates, just return rows
    if (!hasAggregates) {
      return {
        rows: result.rows,
        aggregates: new Map(),
        columns,
        rowCount: result.rows.length,
      }
    }

    // Process aggregates
    const aggregates = new Map<string, PartialAggregate[]>()

    for (const row of result.rows) {
      // Generate group key
      let groupKey = '__global__'
      if (hasGroupBy) {
        const groupValues: Record<string, unknown> = {}
        for (const col of pushdownOps.groupBy) {
          groupValues[col] = row[col]
        }
        groupKey = JSON.stringify(groupValues)
      }

      // Extract aggregate values
      const partialAggs: PartialAggregate[] = []
      for (const agg of pushdownOps.aggregates) {
        const value = row[agg.alias]

        const partialAgg: PartialAggregate = {
          fn: agg.fn,
          alias: agg.alias,
          value,
        }

        // For AVG, we need the count for proper weighted merging
        if (agg.fn === 'AVG') {
          const countAlias = `${agg.alias}_count`
          partialAgg.count = (row[countAlias] as number) || 0
        }

        partialAggs.push(partialAgg)
      }

      aggregates.set(groupKey, partialAggs)
    }

    return {
      rows: hasGroupBy ? [] : result.rows,
      aggregates,
      columns,
      rowCount: result.rows.length,
    }
  }
}

// ============================================================================
// Mock Scanner for Testing
// ============================================================================

/**
 * Mock scanner for testing without actual DuckDB
 *
 * Generates synthetic results based on partition metadata
 */
export class MockPartitionScanner extends PartitionScanner {
  constructor(config: Omit<ScannerConfig, 'createDuckDB'>) {
    super({
      ...config,
      createDuckDB: async () => createMockDuckDB(),
    })
  }
}

/**
 * Create a mock DuckDB instance for testing
 */
function createMockDuckDB(): DuckDBLike {
  const files = new Map<string, Uint8Array>()
  let closed = false

  return {
    async exec(_sql: string): Promise<void> {
      if (closed) throw new Error('Database is closed')
      // No-op for mock
    },

    async query<T = Record<string, unknown>>(
      sql: string
    ): Promise<{ rows: T[]; columns: ColumnInfo[] }> {
      if (closed) throw new Error('Database is closed')

      // Generate mock results based on query structure
      const hasSum = sql.toUpperCase().includes('SUM(')
      const hasCount = sql.toUpperCase().includes('COUNT(')
      const hasAvg = sql.toUpperCase().includes('AVG(')
      const hasMin = sql.toUpperCase().includes('MIN(')
      const hasMax = sql.toUpperCase().includes('MAX(')
      const hasGroupBy = sql.toUpperCase().includes('GROUP BY')

      const columns: ColumnInfo[] = []
      const row: Record<string, unknown> = {}

      if (hasGroupBy) {
        // Extract group by column
        const groupMatch = sql.match(/GROUP BY\s+([a-zA-Z_][a-zA-Z0-9_]*)/i)
        if (groupMatch) {
          columns.push({ name: groupMatch[1], type: 'VARCHAR' })
          row[groupMatch[1]] = 'mock_value'
        }
      }

      if (hasSum) {
        columns.push({ name: 'total', type: 'DOUBLE' })
        row.total = 1000 + Math.random() * 1000
      }

      if (hasCount) {
        columns.push({ name: 'cnt', type: 'BIGINT' })
        row.cnt = 100 + Math.floor(Math.random() * 100)
      }

      if (hasAvg) {
        columns.push({ name: 'avg_val', type: 'DOUBLE' })
        columns.push({ name: 'avg_val_count', type: 'BIGINT' })
        row.avg_val = 10 + Math.random() * 10
        row.avg_val_count = 100
      }

      if (hasMin) {
        columns.push({ name: 'min_val', type: 'DOUBLE' })
        row.min_val = Math.random() * 100
      }

      if (hasMax) {
        columns.push({ name: 'max_val', type: 'DOUBLE' })
        row.max_val = 100 + Math.random() * 100
      }

      return { rows: [row as T], columns }
    },

    registerFileBuffer(name: string, buffer: ArrayBuffer | Uint8Array): void {
      if (closed) throw new Error('Database is closed')
      const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
      files.set(name, data)
    },

    async close(): Promise<void> {
      closed = true
      files.clear()
    },
  }
}
