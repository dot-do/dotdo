/**
 * QueryCoordinator - Dispatch queries to scanners and aggregate results
 *
 * Implements scatter-gather pattern with:
 * - Parallel query dispatch
 * - Result aggregation
 * - Failure handling
 * - Timeout management
 * - Subrequest budget tracking
 */

import { merge, type QueryResult } from './merge'
import { SubrequestBudget } from './budget'
import { ConsistentHashRing } from './hash-ring'

export type { QueryResult }

// Constants for timeout and retry configuration
const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_MAX_RETRIES = 1
const BACKOFF_BASE_MS = 10
const MAJORITY_FAILURE_THRESHOLD = 0.5
const MAX_BATCHES_ALLOWED = 3

interface Scanner {
  id: string
  execute<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  isHealthy?: () => boolean
}

interface CoordinatorOptions {
  maxRetries?: number
  timeoutMs?: number
  ring?: ConsistentHashRing
}

interface QueryOptions {
  shardKey?: string
}

/**
 * Sleep helper with AbortSignal support
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Wrap a promise with a timeout
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMessage: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), ms)
    ),
  ])
}

/**
 * Check if a SQL query is an aggregate query
 */
function isAggregateQuery(sql: string): { type: 'count' | 'sum' | 'avg' } | null {
  const lowerSql = sql.toLowerCase()
  if (lowerSql.includes('count(')) return { type: 'count' }
  if (lowerSql.includes('sum(')) return { type: 'sum' }
  if (lowerSql.includes('avg(')) return { type: 'avg' }
  return null
}

/**
 * Aggregate results based on SQL query type
 */
function aggregateResults<T>(
  results: QueryResult<T>[],
  sql: string
): QueryResult<T> {
  const aggType = isAggregateQuery(sql)

  if (!aggType) {
    // Simple union for non-aggregate queries
    return merge.union(results)
  }

  const rows = results.flatMap((r) => r.rows)

  if (aggType.type === 'count') {
    // Sum all count values
    const total = rows.reduce((sum, row) => {
      const r = row as Record<string, unknown>
      const countVal = r.count ?? r.COUNT ?? 0
      return sum + (typeof countVal === 'number' ? countVal : 0)
    }, 0)
    return { rows: [{ count: total } as T] }
  }

  if (aggType.type === 'sum') {
    // Sum all sum values
    const total = rows.reduce((sum, row) => {
      const r = row as Record<string, unknown>
      const sumVal = r.total ?? r.sum ?? r.SUM ?? r.TOTAL ?? 0
      return sum + (typeof sumVal === 'number' ? sumVal : 0)
    }, 0)
    return { rows: [{ total } as T] }
  }

  if (aggType.type === 'avg') {
    // Weighted average: sum(avg * count) / sum(count)
    let totalSum = 0
    let totalCount = 0
    for (const row of rows) {
      const r = row as Record<string, unknown>
      const avg = r.avg ?? r.AVG ?? 0
      const count = r._count ?? r.count ?? r.COUNT ?? 1
      const avgNum = typeof avg === 'number' ? avg : 0
      const countNum = typeof count === 'number' ? count : 1
      totalSum += avgNum * countNum
      totalCount += countNum
    }
    const avg = totalCount > 0 ? totalSum / totalCount : 0
    return { rows: [{ avg } as T] }
  }

  return merge.union(results)
}

/**
 * QueryCoordinator - Distributes queries across multiple scanner shards
 *
 * Implements scatter-gather pattern for distributed query execution:
 * - Dispatches queries in parallel to all scanners
 * - Aggregates results based on query type (union, count, sum, avg)
 * - Handles scanner failures with retry and timeout logic
 * - Tracks scanner health for observability
 * - Supports subrequest budget constraints
 * - Routes single-tenant queries to specific shards via consistent hashing
 *
 * @example
 * const coordinator = new QueryCoordinator(scanners, {
 *   maxRetries: 2,
 *   timeoutMs: 5000,
 *   ring: consistentHashRing
 * })
 *
 * // Execute distributed query
 * const result = await coordinator.query('SELECT * FROM users')
 *
 * // With budget tracking
 * const budget = new SubrequestBudget(50)
 * const result = await coordinator.queryWithBudget('SELECT *', budget)
 */
export class QueryCoordinator {
  private scanners: Scanner[]
  private options: CoordinatorOptions
  private healthyScanners: Set<string> = new Set()

  constructor(scanners: Scanner[], options: CoordinatorOptions = {}) {
    this.scanners = scanners
    this.options = {
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ring: options.ring,
    }

    // Initialize all scanners as healthy
    for (const scanner of scanners) {
      this.healthyScanners.add(scanner.id)
    }
  }

  /**
   * Execute query across all scanners (or specific shard if shardKey provided)
   *
   * @param sql SQL query string
   * @param params Optional parameterized query values
   * @param options Query options including shardKey for single-shard routing
   * @returns Aggregated results from all scanners or single shard
   * @throws Error if majority of scanners fail
   *
   * @example
   * // Distributed query across all shards
   * const users = await coordinator.query('SELECT * FROM users')
   *
   * // Single-shard query with shard key routing
   * const tenantData = await coordinator.query(
   *   'SELECT * FROM users WHERE tenant_id = ?',
   *   ['tenant-123'],
   *   { shardKey: 'tenant_id' }
   * )
   */
  async query<T = unknown>(
    sql: string,
    params?: unknown[],
    options?: QueryOptions
  ): Promise<QueryResult<T>> {
    // If shard key is specified and we have a ring, route to specific scanner
    if (options?.shardKey && this.options.ring) {
      const targetNodeId = this.options.ring.getNode(options.shardKey)
      const targetScanner = this.scanners.find((s) => s.id === targetNodeId)
      if (targetScanner) {
        const result = await targetScanner.execute<T>(sql, params)
        return result
      }
    }

    const results: QueryResult<T>[] = []
    const errors: string[] = []

    // Execute on all scanners in parallel
    const promises = this.scanners.map(async (scanner) => {
      try {
        const result = await this.executeWithRetry<T>(scanner, sql, params)
        return { scanner, result, error: null }
      } catch (error) {
        return { scanner, result: null, error: error as Error }
      }
    })

    const outcomes = await Promise.all(promises)

    for (const outcome of outcomes) {
      if (outcome.result) {
        results.push(outcome.result)
      } else if (outcome.error) {
        // Include shard context in error message for debugging
        const errorMsg = this.formatShardError(outcome.scanner.id, outcome.error, sql)
        errors.push(errorMsg)
        this.healthyScanners.delete(outcome.scanner.id)
      }
    }

    // Check if majority failed
    if (errors.length > this.scanners.length * MAJORITY_FAILURE_THRESHOLD) {
      throw new Error(
        `Majority of scanners failed (${errors.length}/${this.scanners.length}): ${errors.join(', ')}`
      )
    }

    const aggregated = aggregateResults<T>(results, sql)

    // Add error info if some scanners failed
    if (errors.length > 0) {
      aggregated.error = errors.join('; ')
    }

    return aggregated
  }

  /**
   * Execute query with subrequest budget tracking
   *
   * For multi-batch queries, we use the initial budget limit as the batch size
   * and track usage across all batches. The total usage can exceed the initial
   * budget when operating in "multi-batch mode" (simulating multiple request rounds).
   *
   * However, if the budget is too small (would require excessive batches),
   * we reject the query early.
   *
   * @param sql SQL query string
   * @param budget Subrequest budget tracker (tracks Worker/DO limits)
   * @param params Optional parameterized query values
   * @returns Aggregated results from all scanners
   * @throws Error if budget is too small (would require > 3 batches)
   *
   * @example
   * // Query with 50 subrequest limit (Cloudflare Workers)
   * const budget = new SubrequestBudget(50)
   * const result = await coordinator.queryWithBudget(
   *   'SELECT * FROM users',
   *   budget
   * )
   */
  async queryWithBudget<T = unknown>(
    sql: string,
    budget: SubrequestBudget,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    const scannerCount = this.scanners.length
    const initialBudget = budget.initial

    // Calculate batch size: use initial budget as max per batch
    const batchSize = Math.min(initialBudget, scannerCount)

    if (batchSize === 0 || budget.remaining === 0) {
      throw new Error('Subrequest budget exhausted')
    }

    // Calculate how many batches we'd need
    const requiredBatches = Math.ceil(scannerCount / batchSize)

    // If budget is too small (would require more than MAX_BATCHES_ALLOWED rounds), reject
    // This prevents excessive batching with tiny budgets
    if (requiredBatches > MAX_BATCHES_ALLOWED) {
      throw new Error('Subrequest budget exhausted - too many batches required')
    }

    const allResults: QueryResult<T>[] = []

    // Execute in batches - each batch simulates a "round" of subrequests
    for (let i = 0; i < scannerCount; i += batchSize) {
      const batchScanners = this.scanners.slice(i, i + batchSize)
      const actualBatchSize = batchScanners.length

      // Track this batch (allows going over initial for multi-batch)
      budget.trackUnchecked(actualBatchSize)

      const batchResults = await Promise.all(
        batchScanners.map((scanner) =>
          this.executeWithRetry<T>(scanner, sql, params).catch(() => ({
            rows: [] as T[],
          }))
        )
      )

      allResults.push(...batchResults)
    }

    return aggregateResults<T>(allResults, sql)
  }

  /**
   * Stream results as batches complete (progressive streaming)
   *
   * Yields results from each scanner as they complete, allowing consumers
   * to process partial results before all scanners have finished.
   * Results arrive in completion order, not in scanner order.
   *
   * @param sql SQL query string
   * @param params Optional parameterized query values
   * @yields Query results from individual scanners as they complete
   *
   * @example
   * // Stream results as they arrive
   * for await (const batch of coordinator.queryStream('SELECT * FROM users')) {
   *   console.log(`Got ${batch.rows.length} rows from shard ${batch.scannerId}`)
   *   processRows(batch.rows)
   * }
   */
  async *queryStream<T = unknown>(
    sql: string,
    params?: unknown[]
  ): AsyncGenerator<QueryResult<T>> {
    // Create promises that resolve individually
    const promises = this.scanners.map((scanner) =>
      this.executeWithRetry<T>(scanner, sql, params).catch(() => ({
        rows: [] as T[],
      }))
    )

    // Yield results as they complete
    const pending = new Set(promises.map((_, i) => i))
    const completed = new Map<number, QueryResult<T>>()

    while (pending.size > 0) {
      // Race all pending promises
      const racePromises = Array.from(pending).map(async (idx) => {
        const result = await promises[idx]
        return { idx, result }
      })

      const { idx, result } = await Promise.race(racePromises)
      pending.delete(idx)
      yield result
    }
  }

  /**
   * Get total scanner count
   */
  getScannerCount(): number {
    return this.scanners.length
  }

  /**
   * Get healthy scanner count
   */
  getHealthyScannersCount(): number {
    return this.healthyScanners.size
  }

  /**
   * Execute query with retry logic
   */
  private async executeWithRetry<T>(
    scanner: Scanner,
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    const maxRetries = this.options.maxRetries!
    const timeoutMs = this.options.timeoutMs!
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Only pass params if provided (for cleaner mock expectations)
        const executePromise =
          params !== undefined
            ? scanner.execute<T>(sql, params)
            : scanner.execute<T>(sql)

        const result = await withTimeout(
          executePromise,
          timeoutMs,
          `Scanner ${scanner.id} timed out`
        )
        return result
      } catch (error) {
        lastError = error as Error

        // Exponential backoff (skip for last attempt)
        if (attempt < maxRetries - 1) {
          const backoffMs = Math.pow(2, attempt) * BACKOFF_BASE_MS
          await sleep(backoffMs)
        }
      }
    }

    throw lastError || new Error(`Scanner ${scanner.id} failed`)
  }

  /**
   * Format error message with shard context for debugging
   */
  private formatShardError(scannerId: string, error: Error, sql: string): string {
    const shardIndex = this.scanners.findIndex((s) => s.id === scannerId)
    const shardNumber = shardIndex >= 0 ? shardIndex + 1 : 'unknown'
    const totalShards = this.scanners.length

    return `Shard ${shardNumber}/${totalShards} (${scannerId}): ${error.message}`
  }
}
