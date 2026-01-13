/**
 * ParallelScanCoordinator - Coordinates parallel scans across multiple data sources
 *
 * Features:
 * - Parallel scan execution with configurable concurrency
 * - Backpressure handling with buffer limits
 * - Cancellation support with cleanup
 * - Partial failure handling
 * - Execution statistics collection
 * - Streaming results with interleaving
 *
 * @see dotdo-f6ccw
 * @module db/primitives/federated-query/scan-coordinator
 */

import type { Catalog, QueryFragment, SourceAdapter } from './index'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * A scan task representing a single source query
 */
export interface ScanTask {
  /** Source name in the catalog */
  source: string
  /** Query fragment to execute */
  query: QueryFragment
}

/**
 * Backpressure configuration
 */
export interface BackpressureConfig {
  /** Maximum rows to buffer before applying backpressure */
  maxBufferSize?: number
  /** Maximum memory in MB across all buffers */
  maxMemoryMB?: number
  /** Callback when backpressure is applied */
  onPressure?: (source: string, bufferedRows: number) => void
}

/**
 * Options for scan coordination
 */
export interface ScanOptions {
  /** Maximum concurrent scans (unlimited if not specified) */
  maxConcurrency?: number
  /** Backpressure configuration */
  backpressure?: BackpressureConfig
  /** Cancellation token for early termination */
  cancellationToken?: CancellationToken
  /** Continue on error and return partial results */
  continueOnError?: boolean
  /** Return partial results on cancellation instead of throwing */
  continueOnCancel?: boolean
  /** Collect execution statistics */
  collectStats?: boolean
}

/**
 * Streaming scan options
 */
export interface StreamScanOptions extends ScanOptions {
  /** Batch size for streaming results */
  batchSize?: number
}

/**
 * Execution statistics for a single scan
 */
export interface ScanStats {
  /** Execution time in milliseconds */
  executionTimeMs: number
  /** Number of rows returned */
  rowCount: number
}

/**
 * Result of a single scan task
 */
export interface ScanResult {
  /** Source name */
  source: string
  /** Result rows */
  rows: Record<string, unknown>[]
  /** Error if scan failed */
  error?: Error
  /** Whether scan was cancelled */
  cancelled?: boolean
  /** Execution statistics (if collectStats enabled) */
  stats?: ScanStats
}

/**
 * Aggregate scan statistics
 */
export interface AggregateStats {
  /** Total execution time in milliseconds */
  totalTimeMs: number
  /** Number of sources scanned */
  sourcesScanned: number
  /** Total rows returned across all sources */
  totalRows: number
}

/**
 * Result of scanWithStats method
 */
export interface ScanWithStatsResult {
  /** Results from each source */
  results: ScanResult[]
  /** Aggregate statistics */
  stats: AggregateStats
}

/**
 * Streaming batch result
 */
export interface StreamBatch {
  /** Source name */
  source: string
  /** Batch of rows */
  rows: Record<string, unknown>[]
  /** Batch index for this source */
  batchIndex: number
}

// =============================================================================
// CANCELLATION TOKEN
// =============================================================================

/**
 * CancellationToken - Allows cooperative cancellation of async operations
 */
export class CancellationToken {
  private _cancelled = false
  private _listeners: Array<() => void> = []

  /**
   * Check if cancellation has been requested
   */
  get isCancelled(): boolean {
    return this._cancelled
  }

  /**
   * Request cancellation
   */
  cancel(): void {
    if (this._cancelled) return
    this._cancelled = true
    for (const listener of this._listeners) {
      try {
        listener()
      } catch {
        // Ignore listener errors
      }
    }
    this._listeners = []
  }

  /**
   * Register a callback to be called when cancellation is requested
   */
  onCancel(listener: () => void): void {
    if (this._cancelled) {
      listener()
    } else {
      this._listeners.push(listener)
    }
  }

  /**
   * Throw if cancellation has been requested
   */
  throwIfCancelled(): void {
    if (this._cancelled) {
      throw new Error('Scan cancelled')
    }
  }
}

// =============================================================================
// SCAN COORDINATOR
// =============================================================================

/**
 * ScanCoordinator - Coordinates parallel scans across multiple data sources
 */
export class ScanCoordinator {
  constructor(private catalog: Catalog) {}

  /**
   * Execute scan tasks in parallel with coordination
   */
  async scan(tasks: ScanTask[], options: ScanOptions = {}): Promise<ScanResult[]> {
    const {
      maxConcurrency,
      backpressure,
      cancellationToken,
      continueOnError = false,
      continueOnCancel = false,
      collectStats = false,
    } = options

    // Check for pre-cancelled token
    if (cancellationToken?.isCancelled) {
      throw new Error('Scan cancelled')
    }

    const results: ScanResult[] = new Array(tasks.length)

    // Buffer tracking for backpressure
    let totalBufferedRows = 0
    let totalBufferedBytes = 0

    // Track which tasks are still pending (for cancellation marking)
    const pending = new Set<number>(tasks.map((_, i) => i))

    // Execute with concurrency control
    if (maxConcurrency && maxConcurrency > 0) {
      // Limited concurrency using proper semaphore pattern
      // Key: we track active count separately, decremented only after task fully completes
      let activeCount = 0
      const completionQueue: Array<() => void> = []
      const executing = new Set<Promise<void>>()
      let taskIndex = 0
      let firstError: Error | null = null

      const executeTask = async (index: number): Promise<void> => {
        const task = tasks[index]!
        try {
          const result = await this.executeSingleScan(
            task,
            cancellationToken,
            collectStats,
            backpressure,
            continueOnError,
            () => totalBufferedRows,
            () => totalBufferedBytes,
            (rows, bytes) => {
              totalBufferedRows += rows
              totalBufferedBytes += bytes
            }
          )

          results[index] = result
          pending.delete(index)

          if (result.error && !continueOnError && !firstError) {
            firstError = result.error
          }
        } finally {
          // Decrement active count and signal completion
          activeCount--
          const resolve = completionQueue.shift()
          if (resolve) resolve()
        }
      }

      // Helper to wait for a slot to free up
      const waitForSlot = async (): Promise<void> => {
        if (activeCount < maxConcurrency) {
          return
        }
        await new Promise<void>((resolve) => {
          completionQueue.push(resolve)
        })
        // Small delay to ensure previous task's cleanup is complete
        // This prevents timing races where next task starts before previous logs end time
        await new Promise((resolve) => setTimeout(resolve, 1))
      }

      while (taskIndex < tasks.length) {
        // Check cancellation
        if (cancellationToken?.isCancelled) {
          if (!continueOnCancel) {
            throw new Error('Scan cancelled')
          }
          // Mark remaining not-yet-started tasks as cancelled
          for (let i = taskIndex; i < tasks.length; i++) {
            if (!results[i]) {
              results[i] = { source: tasks[i]!.source, rows: [], cancelled: true }
              pending.delete(i)
            }
          }
          break
        }

        // Check for error in fail-fast mode
        if (firstError && !continueOnError) {
          // Wait for in-flight tasks to complete before throwing
          await Promise.all(executing)
          throw firstError
        }

        // Wait for a slot to be available
        await waitForSlot()

        // Start next task
        activeCount++
        const currentIndex = taskIndex++
        const promise = executeTask(currentIndex)
        executing.add(promise)
        promise.finally(() => executing.delete(promise))
      }

      // Wait for remaining tasks
      await Promise.all(executing)

      // Mark any in-flight tasks that were cancelled
      if (cancellationToken?.isCancelled && continueOnCancel) {
        for (const index of pending) {
          if (!results[index]) {
            results[index] = { source: tasks[index]!.source, rows: [], cancelled: true }
          }
        }
      }

      // Throw first error if in fail-fast mode
      if (firstError && !continueOnError) {
        throw firstError
      }
    } else {
      // Unlimited concurrency - execute all in parallel
      const promises = tasks.map((task, index) =>
        this.executeSingleScan(
          task,
          cancellationToken,
          collectStats,
          backpressure,
          continueOnError,
          () => totalBufferedRows,
          () => totalBufferedBytes,
          (rows, bytes) => {
            totalBufferedRows += rows
            totalBufferedBytes += bytes
          }
        ).then((result) => {
          results[index] = result
          pending.delete(index)
          // Throw immediately if error and not continuing
          if (result.error && !continueOnError) {
            throw result.error
          }
          return result
        })
      )

      if (continueOnError) {
        await Promise.allSettled(promises)
      } else {
        // Fail fast on first error
        try {
          await Promise.all(promises)
        } catch (e) {
          // Check if it was cancellation
          if (cancellationToken?.isCancelled && continueOnCancel) {
            // Fill in any missing results as cancelled
            for (const index of pending) {
              if (!results[index]) {
                results[index] = { source: tasks[index]!.source, rows: [], cancelled: true }
              }
            }
          } else {
            throw e
          }
        }
      }
    }

    // Final cancellation check - mark any pending as cancelled if continueOnCancel
    if (cancellationToken?.isCancelled) {
      if (continueOnCancel) {
        for (const index of pending) {
          if (!results[index]) {
            results[index] = { source: tasks[index]!.source, rows: [], cancelled: true }
          }
        }
      } else {
        throw new Error('Scan cancelled')
      }
    }

    return results
  }

  /**
   * Execute scans and return aggregate statistics
   */
  async scanWithStats(
    tasks: ScanTask[],
    options: ScanOptions = {}
  ): Promise<ScanWithStatsResult> {
    const startTime = performance.now()
    const results = await this.scan(tasks, { ...options, collectStats: true })
    const endTime = performance.now()

    const stats: AggregateStats = {
      totalTimeMs: endTime - startTime,
      sourcesScanned: results.filter((r) => !r.error && !r.cancelled).length,
      totalRows: results.reduce((sum, r) => sum + r.rows.length, 0),
    }

    return { results, stats }
  }

  /**
   * Stream scan results from multiple sources
   */
  async *streamScan(
    tasks: ScanTask[],
    options: StreamScanOptions = {}
  ): AsyncGenerator<StreamBatch, void, unknown> {
    const { batchSize = 100, cancellationToken } = options

    // Check for pre-cancelled token
    cancellationToken?.throwIfCancelled()

    // Create async iterators for each source
    const iterators: Array<{
      source: string
      iterator: AsyncIterator<Record<string, unknown>[], void, unknown>
      batchIndex: number
      done: boolean
    }> = []

    for (const task of tasks) {
      const adapter = this.catalog.getAdapter(task.source)
      if (!adapter) {
        throw new Error(`No adapter for source ${task.source}`)
      }

      const stream = adapter.stream({ ...task.query, batchSize })
      iterators.push({
        source: task.source,
        iterator: stream[Symbol.asyncIterator](),
        batchIndex: 0,
        done: false,
      })
    }

    // Round-robin through sources until all are exhausted
    while (iterators.some((it) => !it.done)) {
      // Check cancellation
      if (cancellationToken?.isCancelled) {
        throw new Error('Scan cancelled')
      }

      // Poll each non-done iterator
      const polls = iterators
        .filter((it) => !it.done)
        .map(async (it) => {
          try {
            const { value, done } = await it.iterator.next()
            if (done || !value) {
              it.done = true
              return null
            }
            const batch: StreamBatch = {
              source: it.source,
              rows: value,
              batchIndex: it.batchIndex++,
            }
            return batch
          } catch (error) {
            it.done = true
            throw error
          }
        })

      // Wait for first batch to complete (interleaving)
      const results = await Promise.all(polls)
      for (const batch of results) {
        if (batch) {
          yield batch
        }
      }
    }
  }

  /**
   * Execute a single scan task
   */
  private async executeSingleScan(
    task: ScanTask,
    cancellationToken: CancellationToken | undefined,
    collectStats: boolean,
    backpressure: BackpressureConfig | undefined,
    continueOnError: boolean,
    getBufferedRows: () => number,
    getBufferedBytes: () => number,
    updateBuffers: (rows: number, bytes: number) => void
  ): Promise<ScanResult> {
    const startTime = performance.now()

    try {
      // Check cancellation before starting
      if (cancellationToken?.isCancelled) {
        return { source: task.source, rows: [], cancelled: true }
      }

      const adapter = this.catalog.getAdapter(task.source)
      if (!adapter) {
        throw new Error(`No adapter for source ${task.source}`)
      }

      // Apply backpressure if configured
      if (backpressure) {
        await this.waitForBackpressure(
          task.source,
          backpressure,
          getBufferedRows,
          getBufferedBytes
        )
      }

      const queryResult = await adapter.execute(task.query)
      const rows = queryResult.rows

      // Check cancellation after long-running query
      if (cancellationToken?.isCancelled) {
        return { source: task.source, rows: [], cancelled: true }
      }

      // Update buffer tracking
      const bytesEstimate = this.estimateBytes(rows)
      updateBuffers(rows.length, bytesEstimate)

      // Trigger backpressure callback if limits exceeded
      if (backpressure) {
        const bufferedRows = getBufferedRows()
        const bufferedBytes = getBufferedBytes()

        if (backpressure.maxBufferSize && bufferedRows > backpressure.maxBufferSize) {
          backpressure.onPressure?.(task.source, bufferedRows)
        }
        if (backpressure.maxMemoryMB && bufferedBytes > backpressure.maxMemoryMB * 1024 * 1024) {
          backpressure.onPressure?.(task.source, bufferedRows)
        }
      }

      const endTime = performance.now()

      const result: ScanResult = {
        source: task.source,
        rows,
      }

      if (collectStats) {
        result.stats = {
          executionTimeMs: endTime - startTime,
          rowCount: rows.length,
        }
      }

      return result
    } catch (error) {
      const err = error as Error
      const wrappedError = new Error(`${task.source}: ${err.message}`)
      // Return result with error - the caller decides whether to throw
      return {
        source: task.source,
        rows: [],
        error: wrappedError,
      }
    }
  }

  /**
   * Wait for backpressure to clear if buffers are full
   */
  private async waitForBackpressure(
    source: string,
    config: BackpressureConfig,
    getBufferedRows: () => number,
    getBufferedBytes: () => number
  ): Promise<void> {
    const { maxBufferSize, maxMemoryMB } = config

    // Simple backpressure - wait briefly if buffers are getting full
    let waitIterations = 0
    const maxWait = 100 // Max 100 iterations

    while (waitIterations < maxWait) {
      const bufferedRows = getBufferedRows()
      const bufferedBytes = getBufferedBytes()

      const rowsExceeded = maxBufferSize && bufferedRows > maxBufferSize * 0.9
      const memoryExceeded = maxMemoryMB && bufferedBytes > maxMemoryMB * 1024 * 1024 * 0.9

      if (!rowsExceeded && !memoryExceeded) {
        break
      }

      // Wait a bit for consumer to catch up
      await new Promise((resolve) => setTimeout(resolve, 10))
      waitIterations++
    }
  }

  /**
   * Estimate memory size of rows in bytes
   */
  private estimateBytes(rows: Record<string, unknown>[]): number {
    // Rough estimate: JSON stringify length * 2 (for UTF-16)
    if (rows.length === 0) return 0

    // Sample first few rows
    const sampleSize = Math.min(10, rows.length)
    let totalSampleBytes = 0

    for (let i = 0; i < sampleSize; i++) {
      totalSampleBytes += JSON.stringify(rows[i]).length * 2
    }

    const avgBytesPerRow = totalSampleBytes / sampleSize
    return Math.ceil(avgBytesPerRow * rows.length)
  }
}
