/**
 * Pipeline Batcher - Accumulates pipelined RPC calls and batches them into single network requests
 *
 * Key insight: Multiple pipelined calls should batch into one request:
 * ```typescript
 * const user = api.User(id)           // Not sent yet
 * const orders = user.orders()        // Not sent yet
 * const profile = user.profile        // Not sent yet
 * const [o, p] = await Promise.all([orders, profile])  // ONE request
 * ```
 *
 * @see do-8nd - GREEN: Implement pipeline transport batching
 * @see do-aby - True Cap'n Web Pipelining epic
 */

// ============================================================================
// TYPES
// ============================================================================

export type PipelineStep =
  | { type: 'property'; name: string }
  | { type: 'method'; name: string; args: unknown[] }

export interface BatchRequest {
  id: string
  target: string[]
  pipeline: PipelineStep[]
}

export interface BatchResponse {
  id: string
  index: number
  result?: unknown
  error?: string
}

export type TransportFunction = (requests: BatchRequest[]) => Promise<BatchResponse[]>

export interface BatchConfig {
  transport: TransportFunction
  maxBatchSize?: number
  flushInterval?: number
  generateId?: () => string
}

// ============================================================================
// PIPELINED STUB
// ============================================================================

const TARGET_SYMBOL = Symbol.for('target')

interface PendingRequest {
  id: string
  target: string[]
  pipeline: PipelineStep[]
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  promise: Promise<unknown>
}

/**
 * Creates a callable proxy that handles method invocations properly.
 * When an operation is "finalized" (property access or method call that
 * creates a terminal node), it is eagerly registered with the batcher.
 *
 * Key design: When extending a stub (e.g., stub.profile -> stub.profile.email),
 * the parent's pending request is cancelled and replaced with the extended one.
 * This ensures only "terminal" stubs count toward pendingCount.
 */
function createCallableStub(
  batcher: PipelineBatcher,
  target: string[],
  pipeline: PipelineStep[] = [],
  pendingRequest?: PendingRequest
): unknown {
  // Use a function as the base so it can be called
  const fn = function () {} as unknown as Record<string | symbol, unknown>

  return new Proxy(fn, {
    get(_target, prop) {
      // Handle symbol access
      if (prop === TARGET_SYMBOL) {
        return target
      }

      // Handle 'then' for Promise resolution - this triggers the flush
      if (prop === 'then') {
        return (onFulfilled?: (value: unknown) => unknown, onRejected?: (error: Error) => unknown) => {
          // Use existing pending request or register a new one
          const req = pendingRequest ?? batcher.registerPipeline(target, pipeline)
          // Trigger flush when .then is accessed (demand-driven)
          batcher.scheduleFlush()
          return req.promise.then(onFulfilled, onRejected)
        }
      }

      // Handle 'catch' for Promise rejection handling
      if (prop === 'catch') {
        return (onRejected?: (error: Error) => unknown) => {
          const req = pendingRequest ?? batcher.registerPipeline(target, pipeline)
          return req.promise.catch(onRejected)
        }
      }

      // Handle 'finally'
      if (prop === 'finally') {
        return (onFinally?: () => void) => {
          const req = pendingRequest ?? batcher.registerPipeline(target, pipeline)
          return req.promise.finally(onFinally)
        }
      }

      // Property access - create new pipeline and register it eagerly
      if (typeof prop === 'string') {
        const newPipeline = [
          ...pipeline,
          { type: 'property' as const, name: prop },
        ]
        // If parent has a pending request, update it in place instead of cancel + new
        if (pendingRequest) {
          batcher.updatePendingRequest(pendingRequest.id, newPipeline)
          return createCallableStub(batcher, target, newPipeline, pendingRequest)
        }
        // Register eagerly when we access a property (first access on this chain)
        const req = batcher.registerPipeline(target, newPipeline)
        return createCallableStub(batcher, target, newPipeline, req)
      }

      return undefined
    },

    apply(_target, _thisArg, args) {
      // Method call - convert the last property to a method call
      if (pipeline.length > 0) {
        const lastStep = pipeline[pipeline.length - 1]
        if (lastStep.type === 'property') {
          const newPipeline = [
            ...pipeline.slice(0, -1),
            { type: 'method' as const, name: lastStep.name, args },
          ]
          // If parent has a pending request, update it in place
          if (pendingRequest) {
            batcher.updatePendingRequest(pendingRequest.id, newPipeline)
            return createCallableStub(batcher, target, newPipeline, pendingRequest)
          }
          // Register eagerly when we call a method
          const req = batcher.registerPipeline(target, newPipeline)
          return createCallableStub(batcher, target, newPipeline, req)
        }
      }
      return createCallableStub(batcher, target, pipeline, pendingRequest)
    },
  })
}

// ============================================================================
// PIPELINE BATCHER
// ============================================================================

export class PipelineBatcher {
  private _config: Required<BatchConfig>
  private _pending: PendingRequest[] = []
  private _idCounter = 0
  private _flushScheduled = false
  private _flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(config: BatchConfig) {
    this._config = {
      transport: config.transport,
      maxBatchSize: config.maxBatchSize ?? Infinity,
      flushInterval: config.flushInterval ?? 0,
      generateId: config.generateId ?? (() => `req-${this._idCounter++}`),
    }
  }

  /**
   * Get the current configuration
   */
  get config(): Readonly<{ maxBatchSize: number; flushInterval: number }> {
    return {
      maxBatchSize: this._config.maxBatchSize,
      flushInterval: this._config.flushInterval,
    }
  }

  /**
   * Get the number of pending requests
   */
  get pendingCount(): number {
    return this._pending.length
  }

  /**
   * Create a stub for a target that accumulates pipeline operations
   */
  createStub(target: string[]): unknown {
    return createCallableStub(this, target, [])
  }

  /**
   * Register a pipeline operation and return a PendingRequest with the promise.
   * If flushInterval > 0, schedules a timer-based flush.
   * If flushInterval == 0, flush is demand-driven when .then is accessed.
   */
  registerPipeline(target: string[], pipeline: PipelineStep[]): PendingRequest {
    let resolve: (value: unknown) => void
    let reject: (error: Error) => void

    const promise = new Promise<unknown>((res, rej) => {
      resolve = res
      reject = rej
    })

    const id = this._config.generateId()
    const pendingReq: PendingRequest = {
      id,
      target,
      pipeline,
      resolve: resolve!,
      reject: reject!,
      promise,
    }

    this._pending.push(pendingReq)

    // If flushInterval > 0, schedule timer-based flush
    if (this._config.flushInterval > 0) {
      this._scheduleIntervalFlush()
    }
    // If flushInterval == 0, flush is demand-driven (scheduled when .then is accessed)

    return pendingReq
  }

  /**
   * Schedule an immediate flush (public method for demand-driven flushing).
   * Always uses queueMicrotask regardless of flushInterval setting.
   */
  scheduleFlush(): void {
    if (this._flushScheduled) {
      return
    }

    this._flushScheduled = true
    // Clear any pending interval timer since we're flushing immediately
    this._clearTimer()

    // Always use queueMicrotask for demand-driven flush
    queueMicrotask(() => {
      this._executeFlush()
    })
  }

  /**
   * Schedule interval-based flush (only for flushInterval > 0)
   */
  private _scheduleIntervalFlush(): void {
    if (this._flushTimer !== null) {
      return // Already scheduled
    }
    this._flushTimer = setTimeout(() => {
      this._executeFlush()
    }, this._config.flushInterval)
  }

  /**
   * Update a pending request's pipeline (used when extending a chain)
   */
  updatePendingRequest(id: string, pipeline: PipelineStep[]): void {
    const req = this._pending.find((r) => r.id === id)
    if (req) {
      req.pipeline = pipeline
    }
  }

  /**
   * Cancel a pending request (used when extending a chain)
   */
  cancelPendingRequest(id: string): void {
    const index = this._pending.findIndex((req) => req.id === id)
    if (index !== -1) {
      this._pending.splice(index, 1)
    }
  }

  /**
   * Schedule a batch flush
   */
  private _scheduleFlush(): void {
    if (this._flushScheduled) {
      return
    }

    this._flushScheduled = true

    if (this._config.flushInterval > 0) {
      // Use setTimeout for interval-based flushing
      this._flushTimer = setTimeout(() => {
        this._executeFlush()
      }, this._config.flushInterval)
    } else {
      // Use queueMicrotask for immediate batching
      queueMicrotask(() => {
        this._executeFlush()
      })
    }
  }

  /**
   * Execute the batch flush
   */
  private async _executeFlush(): Promise<void> {
    this._flushScheduled = false
    this._clearTimer()

    if (this._pending.length === 0) {
      return
    }

    // Take pending requests and clear the batch
    const pending = this._pending
    this._pending = []

    // Split into chunks based on maxBatchSize
    const chunks = this._splitIntoChunks(pending, this._config.maxBatchSize)

    // Process each chunk
    for (const chunk of chunks) {
      await this._processBatch(chunk)
    }
  }

  /**
   * Process a single batch of requests
   */
  private async _processBatch(batch: PendingRequest[]): Promise<void> {
    const requests: BatchRequest[] = batch.map((req) => ({
      id: req.id,
      target: req.target,
      pipeline: req.pipeline,
    }))

    try {
      const responses = await this._config.transport(requests)

      // Map responses back to their promises
      const responseMap = new Map<string, BatchResponse>()
      for (const response of responses) {
        responseMap.set(response.id, response)
      }

      // Resolve or reject each pending promise
      for (const req of batch) {
        const response = responseMap.get(req.id)
        if (!response) {
          req.reject(new Error(`No response for request ${req.id}`))
        } else if (response.error) {
          req.reject(new Error(response.error))
        } else {
          req.resolve(response.result)
        }
      }
    } catch (error) {
      // Transport-level error - reject all promises
      for (const req of batch) {
        req.reject(error as Error)
      }
    }
  }

  /**
   * Split an array into chunks of a given size
   */
  private _splitIntoChunks<T>(array: T[], chunkSize: number): T[][] {
    if (chunkSize === Infinity || chunkSize >= array.length) {
      return [array]
    }

    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize))
    }
    return chunks
  }

  /**
   * Clear the flush timer if set
   */
  private _clearTimer(): void {
    if (this._flushTimer !== null) {
      clearTimeout(this._flushTimer)
      this._flushTimer = null
    }
  }

  /**
   * Manually flush all pending requests
   */
  async flush(): Promise<void> {
    this._clearTimer()
    this._flushScheduled = false
    await this._executeFlush()
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createPipelineBatcher(config: BatchConfig): PipelineBatcher {
  return new PipelineBatcher(config)
}
