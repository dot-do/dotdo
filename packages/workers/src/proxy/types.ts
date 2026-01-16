/**
 * Type definitions for proxy module
 *
 * @module @dotdo/workers/proxy
 */

/**
 * Options for creating a pipelined proxy
 */
export interface PipelinedProxyOptions {
  /** Target DO stub */
  stub: unknown
  /** Timeout in milliseconds */
  timeout?: number
  /** Whether to batch requests */
  batch?: boolean
}

/**
 * Pipeline execution result
 */
export interface PipelineResult<T = unknown> {
  /** The result value */
  value: T
  /** Whether this was a batched request */
  batched: boolean
  /** Execution duration in ms */
  duration: number
}

/**
 * Batch request options
 */
export interface BatchOptions {
  /** Maximum batch size */
  maxSize?: number
  /** Maximum wait time before flushing */
  maxWaitMs?: number
}
