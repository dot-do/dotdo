// Types for DataPipeline primitive

/**
 * Transform function that converts input to output
 */
export type Transform<TIn = unknown, TOut = unknown> = (input: TIn) => TOut | Promise<TOut>

/**
 * Filter predicate that determines if an item should pass through
 */
export type FilterPredicate<T = unknown> = (item: T) => boolean | Promise<boolean>

/**
 * Validation function that checks if data meets requirements
 */
export type Validator<T = unknown> = (item: T) => boolean | Promise<boolean>

/**
 * Schema for validation (Zod-style interface)
 */
export interface Schema<T = unknown> {
  parse(data: unknown): T
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: Error }
}

/**
 * Pipeline stage configuration
 */
export interface Stage<TIn = unknown, TOut = unknown> {
  name: string
  type: 'transform' | 'filter' | 'validate' | 'tap'
  transform?: Transform<TIn, TOut>
  filter?: FilterPredicate<TIn>
  validate?: Validator<TIn>
  tap?: (item: TIn) => void | Promise<void>
  condition?: (item: TIn) => boolean | Promise<boolean>
}

/**
 * Error handling strategy
 */
export type ErrorStrategy = 'fail' | 'skip' | 'retry'

/**
 * Error handler configuration
 */
export interface ErrorHandler {
  strategy: ErrorStrategy
  maxRetries?: number
  retryDelay?: number
  onError?: (error: Error, item: unknown, stage: string) => void
}

/**
 * Batch processing configuration
 */
export interface BatchConfig {
  size: number
  parallel?: number
  continueOnError?: boolean
}

/**
 * Stream processing configuration
 */
export interface StreamConfig {
  highWaterMark?: number
  backpressure?: boolean
  bufferSize?: number
}

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  name?: string
  errorHandler?: ErrorHandler
  batch?: BatchConfig
  stream?: StreamConfig
}

/**
 * Metrics for a single stage
 */
export interface StageMetrics {
  name: string
  processed: number
  passed: number
  failed: number
  filtered: number
  duration: number
}

/**
 * Overall pipeline metrics
 */
export interface PipelineMetrics {
  totalProcessed: number
  totalPassed: number
  totalFailed: number
  totalFiltered: number
  totalDuration: number
  stages: StageMetrics[]
  startTime?: number
  endTime?: number
}

/**
 * Error information for failed items
 */
export interface PipelineError {
  item: unknown
  stage: string
  error: Error
  timestamp: number
  retryCount?: number
}

/**
 * Result of pipeline processing
 */
export interface PipelineResult<T = unknown> {
  data: T[]
  errors: PipelineError[]
  metrics: PipelineMetrics
  success: boolean
}

/**
 * Single item result
 */
export interface ItemResult<T = unknown> {
  data: T | null
  error: PipelineError | null
  filtered: boolean
  success: boolean
}

/**
 * Pipeline builder options
 */
export interface PipelineBuilderOptions {
  name?: string
  errorHandler?: ErrorHandler
}

/**
 * Async iterable source for streaming
 */
export type AsyncIterableSource<T> = AsyncIterable<T> | Iterable<T>
