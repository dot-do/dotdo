/**
 * @module db/schema/cascade/parallel-generator
 *
 * ParallelBatchGenerator - Generates entities concurrently in parallel batches.
 *
 * This generator enables parallel entity generation for scale-out cascade
 * execution. It splits work into batches and processes them concurrently,
 * supporting DO distribution for massive parallelism.
 */

export interface ParallelBatchConfig {
  batchSize: number
  parallelism: number
  failureMode?: 'abort' | 'partial' // How to handle batch failures
}

export interface BatchGenerateOptions {
  type: string
  count: number
  parentIds: string[]
  simulateFailures?: number // Number of batches to simulate as failures (for testing)
}

export interface GeneratedEntity {
  id: string
  type: string
  parentId?: string
  data: Record<string, unknown>
  createdAt: Date
}

export interface BatchError {
  batchIndex: number
  error: Error
}

export interface ParallelBatchResult {
  entities: GeneratedEntity[]
  errors: BatchError[]
  metrics: {
    parallelism: number
    batchSize: number
    batchesProcessed: number
    successfulBatches: number
    failedBatches: number
    durationMs: number
    entitiesPerSecond: number
  }
}

/**
 * ParallelBatchGenerator - Generates entities in parallel batches
 */
export class ParallelBatchGenerator {
  private config: ParallelBatchConfig

  constructor(config: ParallelBatchConfig) {
    this.config = {
      failureMode: 'partial',
      ...config,
    }
  }

  /**
   * Generate a batch of entities in parallel
   */
  async generateBatch(options: BatchGenerateOptions): Promise<ParallelBatchResult> {
    const startTime = Date.now()
    const { type, count, parentIds, simulateFailures = 0 } = options
    const { batchSize, parallelism, failureMode } = this.config

    // Calculate number of batches
    const totalBatches = Math.ceil(count / batchSize)
    const entities: GeneratedEntity[] = []
    const errors: BatchError[] = []

    // Process batches in parallel groups
    let batchIndex = 0
    let failuresRemaining = simulateFailures

    while (batchIndex < totalBatches) {
      // Get next group of batches to process in parallel
      const batchPromises: Promise<GeneratedEntity[]>[] = []
      const batchIndices: number[] = []

      for (let i = 0; i < parallelism && batchIndex < totalBatches; i++, batchIndex++) {
        const currentBatchIndex = batchIndex
        const startIndex = currentBatchIndex * batchSize
        const endIndex = Math.min(startIndex + batchSize, count)
        const batchCount = endIndex - startIndex

        // Check if this batch should simulate failure
        const shouldFail = failuresRemaining > 0

        batchIndices.push(currentBatchIndex)
        batchPromises.push(
          this.processBatch({
            batchIndex: currentBatchIndex,
            type,
            count: batchCount,
            parentIds,
            shouldFail,
          })
        )

        if (shouldFail) {
          failuresRemaining--
        }
      }

      // Wait for parallel group to complete
      const results = await Promise.allSettled(batchPromises)

      // Process results
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        const batchIdx = batchIndices[i]

        if (result.status === 'fulfilled') {
          entities.push(...result.value)
        } else {
          const error: BatchError = {
            batchIndex: batchIdx,
            error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
          }
          errors.push(error)

          // If abort mode and we have an error, stop processing
          if (failureMode === 'abort') {
            const durationMs = Date.now() - startTime
            return {
              entities,
              errors,
              metrics: {
                parallelism,
                batchSize,
                batchesProcessed: batchIdx + 1,
                successfulBatches: entities.length > 0 ? Math.ceil(entities.length / batchSize) : 0,
                failedBatches: errors.length,
                durationMs,
                entitiesPerSecond: durationMs > 0 ? (entities.length / durationMs) * 1000 : 0,
              },
            }
          }
        }
      }
    }

    const durationMs = Date.now() - startTime

    return {
      entities,
      errors,
      metrics: {
        parallelism,
        batchSize,
        batchesProcessed: totalBatches,
        successfulBatches: totalBatches - errors.length,
        failedBatches: errors.length,
        durationMs,
        entitiesPerSecond: durationMs > 0 ? (entities.length / durationMs) * 1000 : entities.length * 1000,
      },
    }
  }

  /**
   * Process a single batch of entities
   */
  private async processBatch(options: {
    batchIndex: number
    type: string
    count: number
    parentIds: string[]
    shouldFail: boolean
  }): Promise<GeneratedEntity[]> {
    const { batchIndex, type, count, parentIds, shouldFail } = options

    // Simulate failure if requested
    if (shouldFail) {
      throw new Error(`Batch ${batchIndex} failed (simulated)`)
    }

    // Generate entities for this batch
    const entities: GeneratedEntity[] = []
    for (let i = 0; i < count; i++) {
      const parentId = parentIds[i % parentIds.length]
      const entity: GeneratedEntity = {
        id: `${type.toLowerCase()}-batch${batchIndex}-${i}`,
        type,
        parentId,
        data: {
          name: `${type} ${batchIndex}-${i}`,
          batchIndex,
          index: i,
        },
        createdAt: new Date(),
      }
      entities.push(entity)
    }

    // Simulate some async work
    await new Promise((resolve) => setTimeout(resolve, 1))

    return entities
  }
}

export default ParallelBatchGenerator
