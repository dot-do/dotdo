/**
 * DataPipeline - A comprehensive data pipeline primitive for dotdo
 *
 * Features:
 * - Stage-based data processing (transform, filter, validate, tap)
 * - Batch processing with parallel execution
 * - Stream processing with backpressure support
 * - Error handling strategies (fail, skip, retry)
 * - Metrics collection and monitoring
 * - Pipeline composition
 * - Conditional stage execution
 *
 * @example
 * ```typescript
 * const pipeline = new DataPipeline()
 * pipeline.map((x) => x * 2)
 * pipeline.filter((x) => x > 10)
 *
 * const result = await pipeline.batch([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
 * // result.data = [12, 14, 16, 18, 20]
 * ```
 */

export * from './types'

import type {
  Stage,
  Transform,
  FilterPredicate,
  Validator,
  Schema,
  PipelineConfig,
  ErrorHandler,
  BatchConfig,
  StreamConfig,
  PipelineMetrics,
  PipelineError,
  PipelineResult,
  ItemResult,
  StageMetrics,
  AsyncIterableSource,
  PipelineBuilderOptions,
} from './types'

// ============================================================================
// ErrorCollector
// ============================================================================

/**
 * Collects and manages pipeline errors
 */
export class ErrorCollector {
  private errors: PipelineError[] = []

  /**
   * Add an error to the collection
   */
  add(error: Error, item: unknown, stage: string, retryCount?: number): void {
    this.errors.push({
      item,
      stage,
      error,
      timestamp: Date.now(),
      retryCount,
    })
  }

  /**
   * Get all collected errors
   */
  getErrors(): PipelineError[] {
    return [...this.errors]
  }

  /**
   * Get error count
   */
  get count(): number {
    return this.errors.length
  }

  /**
   * Clear all collected errors
   */
  clear(): void {
    this.errors = []
  }
}

// ============================================================================
// MetricsCollector
// ============================================================================

/**
 * Collects pipeline execution metrics
 */
export class MetricsCollector {
  private stageMetrics: Map<string, StageMetrics> = new Map()
  private stageOrder: string[] = []
  private startTime: number = 0
  private endTime: number = 0
  private stageStartTimes: Map<string, number> = new Map()

  /**
   * Start overall metrics collection
   */
  start(): void {
    this.startTime = Date.now()
  }

  /**
   * End overall metrics collection
   */
  end(): void {
    this.endTime = Date.now()
  }

  /**
   * Start metrics for a stage
   */
  startStage(name: string): void {
    if (!this.stageMetrics.has(name)) {
      this.stageMetrics.set(name, {
        name,
        processed: 0,
        passed: 0,
        failed: 0,
        filtered: 0,
        duration: 0,
      })
      this.stageOrder.push(name)
    }
    this.stageStartTimes.set(name, Date.now())
  }

  /**
   * End metrics for a stage
   */
  endStage(name: string): void {
    const startTime = this.stageStartTimes.get(name)
    const metrics = this.stageMetrics.get(name)
    if (startTime && metrics) {
      metrics.duration += Date.now() - startTime
    }
  }

  /**
   * Record a processed item for a stage
   */
  recordProcessed(name: string): void {
    const metrics = this.stageMetrics.get(name)
    if (metrics) {
      metrics.processed++
    }
  }

  /**
   * Record a passed item for a stage
   */
  recordPassed(name: string): void {
    const metrics = this.stageMetrics.get(name)
    if (metrics) {
      metrics.passed++
    }
  }

  /**
   * Record a failed item for a stage
   */
  recordFailed(name: string): void {
    const metrics = this.stageMetrics.get(name)
    if (metrics) {
      metrics.failed++
    }
  }

  /**
   * Record a filtered item for a stage
   */
  recordFiltered(name: string): void {
    const metrics = this.stageMetrics.get(name)
    if (metrics) {
      metrics.filtered++
    }
  }

  /**
   * Get all collected metrics
   */
  getMetrics(): PipelineMetrics {
    const stages = this.stageOrder.map((name) => this.stageMetrics.get(name)!)

    let totalProcessed = 0
    let totalPassed = 0
    let totalFailed = 0
    let totalFiltered = 0

    for (const stage of stages) {
      totalProcessed += stage.processed
      totalPassed += stage.passed
      totalFailed += stage.failed
      totalFiltered += stage.filtered
    }

    return {
      totalProcessed,
      totalPassed,
      totalFailed,
      totalFiltered,
      totalDuration: this.endTime ? this.endTime - this.startTime : Date.now() - this.startTime,
      stages,
      startTime: this.startTime || undefined,
      endTime: this.endTime || undefined,
    }
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.stageMetrics.clear()
    this.stageOrder = []
    this.startTime = 0
    this.endTime = 0
    this.stageStartTimes.clear()
  }
}

// ============================================================================
// RetryHandler
// ============================================================================

/**
 * Handles retry logic for failed operations
 */
export class RetryHandler {
  private readonly maxRetries: number
  private readonly delay: number
  private _lastRetryCount: number = 0

  constructor(options: { maxRetries: number; delay?: number }) {
    this.maxRetries = options.maxRetries
    this.delay = options.delay ?? 0
  }

  /**
   * Execute an operation with retry logic
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined
    this._lastRetryCount = 0

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this._lastRetryCount = attempt
        return await fn()
      } catch (error) {
        lastError = error as Error
        if (attempt < this.maxRetries && this.delay > 0) {
          await new Promise((r) => setTimeout(r, this.delay))
        }
      }
    }

    throw lastError
  }

  /**
   * Get the retry count from the last execution
   */
  get lastRetryCount(): number {
    return this._lastRetryCount
  }
}

// ============================================================================
// BatchProcessor
// ============================================================================

/**
 * Processes items in batches with optional parallel execution
 */
export class BatchProcessor {
  private readonly size: number
  private readonly parallel: number

  constructor(config: BatchConfig) {
    this.size = config.size
    this.parallel = config.parallel ?? 1
  }

  /**
   * Process items in chunks
   */
  async process<T, R>(
    items: T[],
    processor: (batch: T[]) => Promise<R[]>
  ): Promise<R[]> {
    const chunks: T[][] = []
    for (let i = 0; i < items.length; i += this.size) {
      chunks.push(items.slice(i, i + this.size))
    }

    const results: R[] = []

    // Process chunks with parallelism
    for (let i = 0; i < chunks.length; i += this.parallel) {
      const parallelChunks = chunks.slice(i, i + this.parallel)
      const parallelResults = await Promise.all(
        parallelChunks.map((chunk) => processor(chunk))
      )
      for (const chunkResult of parallelResults) {
        results.push(...chunkResult)
      }
    }

    return results
  }
}

// ============================================================================
// StreamProcessor
// ============================================================================

/**
 * Processes items from async iterables with backpressure support
 */
export class StreamProcessor {
  private readonly highWaterMark: number

  constructor(config?: StreamConfig) {
    this.highWaterMark = config?.highWaterMark ?? 16
  }

  /**
   * Process items from a source with a transform function
   */
  async *process<T, R>(
    source: AsyncIterableSource<T>,
    transform: Transform<T, R>
  ): AsyncGenerator<R> {
    const iterator = Symbol.asyncIterator in source
      ? (source as AsyncIterable<T>)[Symbol.asyncIterator]()
      : (source as Iterable<T>)[Symbol.iterator]()

    while (true) {
      const { value, done } = await (iterator as AsyncIterator<T>).next()
      if (done) break
      yield (await transform(value)) as R
    }
  }
}

// ============================================================================
// DataPipeline
// ============================================================================

/**
 * Main data pipeline class for processing data through stages
 */
export class DataPipeline<TIn = unknown, TOut = unknown> {
  private stages: Stage[] = []
  private config: PipelineConfig
  private metricsCollector: MetricsCollector = new MetricsCollector()
  private errorCollector: ErrorCollector = new ErrorCollector()
  public readonly name: string

  constructor(config?: PipelineConfig) {
    this.config = config ?? {}
    this.name = config?.name ?? 'pipeline'
  }

  /**
   * Add a processing stage to the pipeline
   */
  addStage<T, R>(stage: Stage<T, R>): this {
    this.stages.push(stage as Stage)
    return this
  }

  /**
   * Add a transform stage using the map helper
   */
  map<T, R>(transform: Transform<T, R>): this {
    return this.addStage({
      name: `map-${this.stages.length}`,
      type: 'transform',
      transform: transform as Transform,
    })
  }

  /**
   * Add a filter stage
   */
  filter<T>(predicate: FilterPredicate<T>): this {
    return this.addStage({
      name: `filter-${this.stages.length}`,
      type: 'filter',
      filter: predicate as FilterPredicate,
    })
  }

  /**
   * Add a validation stage
   */
  validate<T>(schemaOrValidator: Schema<T> | Validator<T>): this {
    const validator: Validator =
      typeof schemaOrValidator === 'function'
        ? schemaOrValidator
        : (item: unknown) => {
            const result = (schemaOrValidator as Schema).safeParse(item)
            return result.success
          }

    return this.addStage({
      name: `validate-${this.stages.length}`,
      type: 'validate',
      validate: validator,
    })
  }

  /**
   * Process a single item through the pipeline
   */
  async process(item: TIn): Promise<ItemResult<TOut>> {
    const errorHandler = this.config.errorHandler ?? { strategy: 'fail' }
    let currentValue: unknown = item
    let filtered = false

    for (const stage of this.stages) {
      try {
        // Check condition if present
        if (stage.condition) {
          const shouldExecute = await stage.condition(currentValue)
          if (!shouldExecute) {
            continue // Skip this stage but continue processing
          }
        }

        switch (stage.type) {
          case 'transform':
            if (stage.transform) {
              currentValue = await stage.transform(currentValue)
            }
            break

          case 'filter':
            if (stage.filter) {
              const passes = await stage.filter(currentValue)
              if (!passes) {
                filtered = true
                return {
                  data: null,
                  error: null,
                  filtered: true,
                  success: true,
                }
              }
            }
            break

          case 'validate':
            if (stage.validate) {
              const valid = await stage.validate(currentValue)
              if (!valid) {
                const error: PipelineError = {
                  item,
                  stage: stage.name,
                  error: new Error(`Validation failed at stage: ${stage.name}`),
                  timestamp: Date.now(),
                }
                return {
                  data: null,
                  error,
                  filtered: false,
                  success: false,
                }
              }
            }
            break

          case 'tap':
            if (stage.tap) {
              await stage.tap(currentValue)
            }
            break
        }
      } catch (e) {
        const error = e as Error

        // Handle retry strategy
        if (errorHandler.strategy === 'retry' && errorHandler.maxRetries) {
          // The first attempt already failed, so we have maxRetries - 1 more attempts
          const remainingRetries = errorHandler.maxRetries - 1
          let lastError = error
          let totalAttempts = 1

          for (let retry = 0; retry < remainingRetries; retry++) {
            if (errorHandler.retryDelay && errorHandler.retryDelay > 0) {
              await new Promise((r) => setTimeout(r, errorHandler.retryDelay))
            }

            try {
              totalAttempts++
              // Re-run just the failing stage
              if (stage.type === 'transform' && stage.transform) {
                currentValue = await stage.transform(currentValue)
              }
              // Success - break out of retry loop and continue pipeline
              lastError = null as unknown as Error
              break
            } catch (retryError) {
              lastError = retryError as Error
            }
          }

          if (lastError) {
            const pipelineError: PipelineError = {
              item,
              stage: stage.name,
              error: lastError,
              timestamp: Date.now(),
              retryCount: totalAttempts,
            }

            if (errorHandler.onError) {
              errorHandler.onError(lastError, item, stage.name)
            }

            return {
              data: null,
              error: pipelineError,
              filtered: false,
              success: false,
            }
          }

          // Success after retry - continue to next stage
          continue
        }

        const pipelineError: PipelineError = {
          item,
          stage: stage.name,
          error,
          timestamp: Date.now(),
        }

        if (errorHandler.onError) {
          errorHandler.onError(error, item, stage.name)
        }

        return {
          data: null,
          error: pipelineError,
          filtered: false,
          success: false,
        }
      }
    }

    return {
      data: currentValue as TOut,
      error: null,
      filtered,
      success: true,
    }
  }

  /**
   * Process multiple items in a batch
   */
  async batch(items: TIn[]): Promise<PipelineResult<TOut>> {
    const errorHandler = this.config.errorHandler ?? { strategy: 'skip' }
    const batchConfig = this.config.batch ?? { size: items.length, parallel: 1 }

    this.metricsCollector.reset()
    this.errorCollector.clear()
    this.metricsCollector.start()

    // Initialize stage metrics
    for (const stage of this.stages) {
      this.metricsCollector.startStage(stage.name)
    }

    const results: TOut[] = []
    const errors: PipelineError[] = []
    let shouldStop = false

    // Process with parallelism
    const parallel = batchConfig.parallel ?? 1
    const processItem = async (item: TIn): Promise<ItemResult<TOut> | null> => {
      if (shouldStop) return null

      let currentValue: unknown = item

      for (const stage of this.stages) {
        if (shouldStop) return null

        this.metricsCollector.recordProcessed(stage.name)

        try {
          // Check condition if present
          if (stage.condition) {
            const shouldExecute = await stage.condition(currentValue)
            if (!shouldExecute) {
              this.metricsCollector.recordPassed(stage.name)
              continue
            }
          }

          switch (stage.type) {
            case 'transform':
              if (stage.transform) {
                currentValue = await stage.transform(currentValue)
              }
              this.metricsCollector.recordPassed(stage.name)
              break

            case 'filter':
              if (stage.filter) {
                const passes = await stage.filter(currentValue)
                if (!passes) {
                  this.metricsCollector.recordFiltered(stage.name)
                  return { data: null, error: null, filtered: true, success: true }
                }
              }
              this.metricsCollector.recordPassed(stage.name)
              break

            case 'validate':
              if (stage.validate) {
                const valid = await stage.validate(currentValue)
                if (!valid) {
                  this.metricsCollector.recordFailed(stage.name)
                  const error: PipelineError = {
                    item,
                    stage: stage.name,
                    error: new Error(`Validation failed at stage: ${stage.name}`),
                    timestamp: Date.now(),
                  }

                  if (errorHandler.strategy === 'fail') {
                    shouldStop = true
                  }

                  if (errorHandler.onError) {
                    errorHandler.onError(error.error, item, stage.name)
                  }

                  return { data: null, error, filtered: false, success: false }
                }
              }
              this.metricsCollector.recordPassed(stage.name)
              break

            case 'tap':
              if (stage.tap) {
                await stage.tap(currentValue)
              }
              this.metricsCollector.recordPassed(stage.name)
              break
          }
        } catch (e) {
          const error = e as Error
          this.metricsCollector.recordFailed(stage.name)

          const pipelineError: PipelineError = {
            item,
            stage: stage.name,
            error,
            timestamp: Date.now(),
          }

          if (errorHandler.strategy === 'fail') {
            shouldStop = true
          }

          if (errorHandler.onError) {
            errorHandler.onError(error, item, stage.name)
          }

          return { data: null, error: pipelineError, filtered: false, success: false }
        }
      }

      return { data: currentValue as TOut, error: null, filtered: false, success: true }
    }

    // Process items with parallelism
    for (let i = 0; i < items.length; i += parallel) {
      if (shouldStop) break

      const batch = items.slice(i, i + parallel)
      const batchResults = await Promise.all(batch.map(processItem))

      for (const result of batchResults) {
        if (result === null) continue

        if (result.success && !result.filtered) {
          results.push(result.data as TOut)
        } else if (result.error) {
          errors.push(result.error)
        }
      }
    }

    // End stage metrics
    for (const stage of this.stages) {
      this.metricsCollector.endStage(stage.name)
    }

    this.metricsCollector.end()

    const metrics = this.metricsCollector.getMetrics()
    metrics.totalPassed = results.length
    metrics.totalFailed = errors.length

    return {
      data: results,
      errors,
      metrics,
      success: errors.length === 0 || errorHandler.strategy !== 'fail',
    }
  }

  /**
   * Process items from a stream/iterable
   */
  async *stream(source: AsyncIterableSource<TIn>): AsyncGenerator<TOut> {
    this.metricsCollector.reset()
    this.metricsCollector.start()
    this.metricsCollector.startStage('stream')

    const iterator = Symbol.asyncIterator in source
      ? (source as AsyncIterable<TIn>)[Symbol.asyncIterator]()
      : (source as Iterable<TIn>)[Symbol.iterator]()

    while (true) {
      const { value, done } = await (iterator as AsyncIterator<TIn>).next()
      if (done) break

      const result = await this.process(value)
      this.metricsCollector.recordProcessed('stream')
      if (result.success && !result.filtered && result.data !== null) {
        yield result.data
      }
    }

    this.metricsCollector.endStage('stream')
    this.metricsCollector.end()
  }

  /**
   * Get current metrics
   */
  getMetrics(): PipelineMetrics {
    return this.metricsCollector.getMetrics()
  }

  /**
   * Compose this pipeline with another
   */
  compose<TNext>(other: DataPipeline<TOut, TNext>): DataPipeline<TIn, TNext> {
    const composed = new DataPipeline<TIn, TNext>({
      ...this.config,
    })

    // Copy stages from both pipelines
    for (const stage of this.stages) {
      composed.addStage(stage)
    }
    for (const stage of other.stages) {
      composed.addStage(stage)
    }

    return composed
  }
}

// ============================================================================
// PipelineBuilder
// ============================================================================

/**
 * Fluent builder for creating pipelines
 */
export class PipelineBuilder<TIn = unknown, TOut = unknown> {
  private pipeline: DataPipeline<TIn, TOut>

  constructor(options?: PipelineBuilderOptions) {
    this.pipeline = new DataPipeline<TIn, TOut>({
      name: options?.name,
      errorHandler: options?.errorHandler,
    })
  }

  /**
   * Add a transform stage
   */
  map<R>(transform: Transform<TOut, R>): PipelineBuilder<TIn, R> {
    this.pipeline.map(transform as Transform)
    return this as unknown as PipelineBuilder<TIn, R>
  }

  /**
   * Add a filter stage
   */
  filter(predicate: FilterPredicate<TOut>): PipelineBuilder<TIn, TOut> {
    this.pipeline.filter(predicate as FilterPredicate)
    return this
  }

  /**
   * Add a validation stage
   */
  validate(schemaOrValidator: Schema<TOut> | Validator<TOut>): PipelineBuilder<TIn, TOut> {
    this.pipeline.validate(schemaOrValidator)
    return this
  }

  /**
   * Build the pipeline
   */
  build(): DataPipeline<TIn, TOut> {
    return this.pipeline
  }
}
