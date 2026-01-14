/**
 * Pipe Type Definitions
 *
 * Core types for the request-response middleware pipeline.
 */

/** Processor function that transforms input to output */
export type Processor<TIn, TOut> = (input: TIn) => TOut | Promise<TOut>

/** Middleware that can modify input/output */
export type PipeMiddleware<TIn, TOut> = (
  input: TIn,
  next: (input: TIn) => Promise<TOut>
) => Promise<TOut>

/** Before hook - can modify or validate input */
export type BeforeHook<TIn> = (input: TIn) => TIn | Promise<TIn>

/** After hook - can modify or validate output */
export type AfterHook<TOut> = (output: TOut) => TOut | Promise<TOut>

/** Error handler */
export type ErrorHandler = (error: Error) => void | Promise<void>

/** Retry policy configuration */
export interface RetryPolicy {
  /** Maximum number of retry attempts */
  maxAttempts: number
  /** Base delay in milliseconds between retries */
  delayMs?: number
  /** Backoff multiplier for exponential backoff */
  backoffMultiplier?: number
  /** Maximum delay in milliseconds */
  maxDelayMs?: number
  /** Whether to retry on specific error types */
  retryOn?: (error: Error) => boolean
}

/** Circuit breaker configuration */
export interface CircuitConfig {
  /** Number of failures before opening circuit */
  threshold: number
  /** Time in milliseconds to wait before trying again */
  resetTimeMs: number
  /** Optional: time window in ms to count failures */
  windowMs?: number
}

/** Batched pipe interface for grouped operations */
export interface BatchedPipe<TIn extends any[], TOut extends any[]> {
  process(inputs: TIn): Promise<TOut>
}

/** Main Pipe instance interface */
export interface PipeInstance<TIn, TOut> {
  /** Process input through the pipeline */
  process(input: TIn): Promise<TOut>

  /** Add middleware to the pipeline */
  use(middleware: PipeMiddleware<TIn, TOut>): this

  /** Add before hook to transform input */
  before(hook: BeforeHook<TIn>): this

  /** Add after hook to transform output */
  after(hook: AfterHook<TOut>): this

  /** Add error handler */
  onError(handler: ErrorHandler): this

  /** Configure retry policy */
  retry(policy: RetryPolicy): this

  /** Set timeout in milliseconds */
  timeout(ms: number): this

  /** Create batched version of this pipe */
  batch(size: number): BatchedPipe<TIn[], TOut[]>

  /** Configure circuit breaker */
  circuitBreaker(config: CircuitConfig): this
}
