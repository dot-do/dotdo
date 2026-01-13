/**
 * BatchUpserter - Efficient batch upsert operations for sync
 *
 * Provides batched upsert operations with:
 * - Configurable batch sizes
 * - Parallelism control
 * - Progress reporting
 * - Partial failure handling
 * - Aggregate results
 *
 * @module db/sync/batch-upserter
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * A record to be upserted
 */
export interface SyncRecord {
  /** Unique identifier for the record (primary key) */
  id: string
  /** Data payload for the record */
  data: Record<string, unknown>
}

/**
 * Progress information during batch upsert
 */
export interface BatchProgress {
  /** Number of completed batches */
  completedBatches: number
  /** Total number of batches */
  totalBatches: number
  /** Number of records processed so far */
  processedRecords: number
  /** Total number of records */
  totalRecords: number
  /** Number of successful upserts */
  successCount: number
  /** Number of failed upserts */
  failureCount: number
  /** Percentage complete (0-100) */
  percentComplete: number
}

/**
 * Options for batch upsert operation
 */
export interface BatchUpsertOptions {
  /** Number of records per batch (default: 100) */
  batchSize?: number
  /** Maximum concurrent batches (default: 1) */
  parallelism?: number
  /** Callback for progress updates */
  onProgress?: (progress: BatchProgress) => void
}

/**
 * Failure information for a single record
 */
export interface RecordFailure {
  /** ID of the failed record */
  id: string
  /** Error message */
  error: string
}

/**
 * Result of a batch upsert operation
 */
export interface UpsertResult {
  /** Total number of records processed */
  totalProcessed: number
  /** Number of successful upserts */
  successCount: number
  /** Number of failed upserts */
  failureCount: number
  /** Number of batches processed */
  batchCount: number
  /** IDs of successfully upserted records */
  successIds: string[]
  /** Details of failed records */
  failures: RecordFailure[]
  /** Duration in milliseconds */
  durationMs: number
  /** Start time */
  startedAt: Date
  /** Completion time */
  completedAt: Date
  /** Records processed per second */
  recordsPerSecond: number
}

/**
 * Destination adapter interface for upsert operations
 */
export interface Destination {
  /** Name of the destination */
  name: string
  /**
   * Upsert a batch of records
   * @param records - Records to upsert
   * @returns Result with success and failed record IDs
   */
  upsert(records: SyncRecord[]): Promise<{
    success: string[]
    failed: Array<{ id: string; error: string }>
  }>
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Default batch size if not specified
 */
const DEFAULT_BATCH_SIZE = 100

/**
 * Default parallelism if not specified
 */
const DEFAULT_PARALLELISM = 1

/**
 * Split an array into chunks of specified size
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

/**
 * BatchUpserter - Performs efficient batch upsert operations
 *
 * @example
 * ```typescript
 * const upserter = new BatchUpserter()
 *
 * const result = await upserter.upsert(records, destination, {
 *   batchSize: 100,
 *   parallelism: 3,
 *   onProgress: (progress) => {
 *     console.log(`${progress.percentComplete}% complete`)
 *   }
 * })
 *
 * console.log(`Success: ${result.successCount}, Failed: ${result.failureCount}`)
 * ```
 */
export class BatchUpserter {
  /**
   * Perform batch upsert of records to destination
   *
   * @param records - Records to upsert
   * @param destination - Target destination adapter
   * @param options - Batch upsert options
   * @returns Aggregate result of the operation
   */
  async upsert(
    records: SyncRecord[],
    destination: Destination,
    options: BatchUpsertOptions = {}
  ): Promise<UpsertResult> {
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
    const parallelism = options.parallelism ?? DEFAULT_PARALLELISM
    const onProgress = options.onProgress

    // Validate options
    if (batchSize <= 0) {
      throw new Error('batchSize must be greater than 0')
    }
    if (parallelism <= 0) {
      throw new Error('parallelism must be greater than 0')
    }

    const startedAt = new Date()

    // Handle empty records
    if (records.length === 0) {
      const completedAt = new Date()
      return {
        totalProcessed: 0,
        successCount: 0,
        failureCount: 0,
        batchCount: 0,
        successIds: [],
        failures: [],
        durationMs: completedAt.getTime() - startedAt.getTime(),
        startedAt,
        completedAt,
        recordsPerSecond: 0,
      }
    }

    // Split records into batches
    const batches = chunkArray(records, batchSize)
    const totalBatches = batches.length
    const totalRecords = records.length

    // Aggregate results
    const allSuccessIds: string[] = []
    const allFailures: RecordFailure[] = []
    let completedBatches = 0
    let processedRecords = 0

    // Process batches with parallelism control
    const processBatch = async (batch: SyncRecord[], batchIndex: number): Promise<void> => {
      try {
        const result = await destination.upsert(batch)

        // Collect successes
        allSuccessIds.push(...result.success)

        // Collect failures
        for (const failure of result.failed) {
          allFailures.push({ id: failure.id, error: failure.error })
        }
      } catch (error) {
        // If destination throws, mark all records in batch as failed
        const errorMessage = error instanceof Error ? error.message : String(error)
        for (const record of batch) {
          allFailures.push({ id: record.id, error: errorMessage })
        }
      }

      // Update progress
      completedBatches++
      processedRecords += batch.length

      if (onProgress) {
        const progress: BatchProgress = {
          completedBatches,
          totalBatches,
          processedRecords,
          totalRecords,
          successCount: allSuccessIds.length,
          failureCount: allFailures.length,
          percentComplete: Math.round((completedBatches / totalBatches) * 100),
        }
        onProgress(progress)
      }
    }

    // Execute with parallelism control
    if (parallelism === 1) {
      // Sequential execution
      for (let i = 0; i < batches.length; i++) {
        await processBatch(batches[i], i)
      }
    } else {
      // Parallel execution with semaphore
      let running = 0
      let nextIndex = 0
      const waitQueue: Array<() => void> = []

      const runNext = async (): Promise<void> => {
        while (nextIndex < batches.length) {
          // Wait if at parallelism limit
          if (running >= parallelism) {
            await new Promise<void>((resolve) => {
              waitQueue.push(resolve)
            })
          }

          if (nextIndex >= batches.length) break

          const batchIndex = nextIndex++
          running++

          // Run batch and then release slot
          processBatch(batches[batchIndex], batchIndex).then(() => {
            running--
            const next = waitQueue.shift()
            if (next) next()
          })
        }
      }

      // Start processing
      await runNext()

      // Wait for all remaining batches to complete
      while (running > 0) {
        await new Promise<void>((resolve) => {
          waitQueue.push(resolve)
        })
      }
    }

    const completedAt = new Date()
    const durationMs = completedAt.getTime() - startedAt.getTime()
    const recordsPerSecond = durationMs > 0 ? (totalRecords / durationMs) * 1000 : 0

    return {
      totalProcessed: totalRecords,
      successCount: allSuccessIds.length,
      failureCount: allFailures.length,
      batchCount: totalBatches,
      successIds: allSuccessIds,
      failures: allFailures,
      durationMs,
      startedAt,
      completedAt,
      recordsPerSecond,
    }
  }
}
