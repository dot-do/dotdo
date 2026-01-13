/**
 * @module workflows/runtime
 *
 * Workflow Runtime - Durable Execution Engine for dotdo Workflows
 *
 * This module provides the runtime execution engine for workflows, implementing
 * step persistence, replay for durability, and configurable retry policies.
 * It supports three execution modes with different durability guarantees.
 *
 * ## Execution Modes
 *
 * The runtime supports three distinct execution modes, matching the workflow
 * context DSL (`$.send`, `$.try`, `$.do`):
 *
 * | Mode | Blocking | Durable | Retries | Use Case |
 * |------|----------|---------|---------|----------|
 * | `send` | No | No | No | Fire-and-forget notifications |
 * | `try` | Yes | No | No | Quick operations, fallible |
 * | `do` | Yes | Yes | Yes | Critical operations |
 *
 * @example Three durability levels
 * ```typescript
 * const runtime = createWorkflowRuntime({ storage })
 *
 * // Fire-and-forget - returns immediately
 * runtime.send('notification.sent', { userId, message })
 *
 * // Single attempt - may fail
 * const result = await runtime.try('Cache.get', key)
 *
 * // Durable with retries - persisted, replayed on restart
 * const order = await runtime.do('Order.create', orderData)
 * ```
 *
 * ## Step Persistence
 *
 * In `do` mode, each step is persisted with its result, enabling:
 * - **Replay**: If a workflow restarts, completed steps return cached results
 * - **Exactly-once**: Steps are executed exactly once even across restarts
 * - **Audit trail**: Step history is retained for debugging
 *
 * @example Step replay
 * ```typescript
 * // First execution - runs the step
 * const result1 = await runtime.do('Payment.charge', { amount: 100 })
 *
 * // Workflow restarts...
 *
 * // Same step ID - returns cached result (no re-execution)
 * const result2 = await runtime.do('Payment.charge', { amount: 100 })
 * // result1 === result2 (same cached result)
 * ```
 *
 * ## Retry Policies
 *
 * The `do` mode uses exponential backoff with configurable parameters:
 *
 * @example Custom retry policy
 * ```typescript
 * const runtime = createWorkflowRuntime({
 *   storage,
 *   retryPolicy: {
 *     maxAttempts: 5,
 *     initialDelayMs: 500,
 *     maxDelayMs: 30000,
 *     backoffMultiplier: 2,
 *     jitter: true  // Adds randomness to prevent thundering herd
 *   }
 * })
 * ```
 *
 * ## Storage Interface
 *
 * The runtime requires a storage implementation for persisting step results:
 *
 * @example Custom storage
 * ```typescript
 * class SqliteStepStorage implements StepStorage {
 *   async get(stepId: string) { ... }
 *   async set(stepId: string, result: StepResult) { ... }
 *   async delete(stepId: string) { ... }
 *   async list() { ... }
 * }
 *
 * const runtime = createWorkflowRuntime({
 *   storage: new SqliteStepStorage()
 * })
 * ```
 *
 * ## Lifecycle Callbacks
 *
 * Monitor step execution with optional callbacks:
 *
 * @example Observability
 * ```typescript
 * const runtime = createWorkflowRuntime({
 *   storage,
 *   onStepStart: (stepId, pipeline) => {
 *     console.log(`Starting step: ${stepId}`)
 *   },
 *   onStepComplete: (stepId, result) => {
 *     metrics.recordSuccess(stepId)
 *   },
 *   onStepError: (stepId, error, attempt) => {
 *     logger.error(`Step ${stepId} failed (attempt ${attempt}):`, error)
 *   }
 * })
 * ```
 *
 * @see {@link createWorkflowRuntime} - Create a runtime instance
 * @see {@link createTestRuntime} - Create a runtime for testing
 * @see {@link DurableWorkflowRuntime} - The runtime class
 * @see {@link StepStorage} - Storage interface
 * @see {@link RetryPolicy} - Retry configuration
 */

import type { Pipeline, WorkflowRuntime } from './proxy'
import { resolveHandler } from './domain'

// ============================================================================
// Types
// ============================================================================

/**
 * Step execution result stored for replay
 */
export interface StepResult {
  stepId: string
  status: 'pending' | 'completed' | 'failed'
  result?: unknown
  error?: string
  attempts: number
  createdAt: number
  completedAt?: number
}

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  /** Maximum number of retry attempts */
  maxAttempts: number
  /** Initial delay in milliseconds */
  initialDelayMs: number
  /** Maximum delay in milliseconds */
  maxDelayMs: number
  /** Backoff multiplier (exponential backoff) */
  backoffMultiplier: number
  /** Whether to add jitter to delays */
  jitter: boolean
}

/**
 * Storage interface for step persistence
 */
export interface StepStorage {
  get(stepId: string): Promise<StepResult | undefined>
  set(stepId: string, result: StepResult): Promise<void>
  delete(stepId: string): Promise<void>
  list(): Promise<StepResult[]>
}

/**
 * Execution mode determines durability guarantees
 */
export type ExecutionMode = 'send' | 'try' | 'do'

/**
 * Options for creating a workflow runtime
 */
export interface RuntimeOptions {
  /** Storage for step persistence (required for durable execution) */
  storage?: StepStorage
  /** Default retry policy for 'do' mode */
  retryPolicy?: Partial<RetryPolicy>
  /** Callback when step execution starts */
  onStepStart?: (stepId: string, pipeline: Pipeline) => void
  /** Callback when step execution completes */
  onStepComplete?: (stepId: string, result: unknown) => void
  /** Callback when step execution fails */
  onStepError?: (stepId: string, error: Error, attempt: number) => void
}

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
}

// ============================================================================
// In-Memory Storage Implementation
// ============================================================================

/**
 * Simple in-memory storage for step results.
 *
 * Provides a Map-based implementation of StepStorage for testing
 * or non-persistent workflows. Data is lost when the process exits.
 *
 * @example Testing usage
 * ```typescript
 * const storage = new InMemoryStepStorage()
 * const runtime = createWorkflowRuntime({ storage })
 *
 * // Run tests...
 *
 * // Clear between tests
 * storage.clear()
 * ```
 *
 * @example Inspecting stored steps
 * ```typescript
 * const storage = new InMemoryStepStorage()
 * const runtime = createWorkflowRuntime({ storage })
 *
 * await runtime.do('Order.create', orderData)
 *
 * // Check what was stored
 * const steps = await storage.list()
 * console.log(steps)
 * // [{ stepId: 'Order.create:...', status: 'completed', result: {...} }]
 * ```
 */
export class InMemoryStepStorage implements StepStorage {
  private store = new Map<string, StepResult>()

  async get(stepId: string): Promise<StepResult | undefined> {
    return this.store.get(stepId)
  }

  async set(stepId: string, result: StepResult): Promise<void> {
    this.store.set(stepId, result)
  }

  async delete(stepId: string): Promise<void> {
    this.store.delete(stepId)
  }

  async list(): Promise<StepResult[]> {
    return Array.from(this.store.values())
  }

  /** Clear all stored results (for testing) */
  clear(): void {
    this.store.clear()
  }
}

// ============================================================================
// Core Runtime Implementation
// ============================================================================

/**
 * Workflow Runtime with durable execution capabilities.
 *
 * Implements the WorkflowRuntime interface with full support for
 * step persistence, replay, and configurable retry policies.
 *
 * @example Basic usage
 * ```typescript
 * const runtime = new DurableWorkflowRuntime({
 *   storage: new InMemoryStepStorage(),
 *   retryPolicy: { maxAttempts: 3 }
 * })
 *
 * // Execute steps
 * runtime.send('event', data)           // Fire-and-forget
 * await runtime.try('Cache.get', key)   // Single attempt
 * await runtime.do('Order.create', order) // Durable with retries
 * ```
 *
 * @example In a Durable Object
 * ```typescript
 * class OrderWorkflow extends DurableObject {
 *   private runtime: DurableWorkflowRuntime
 *
 *   constructor(ctx: DurableObjectState, env: Env) {
 *     super(ctx, env)
 *     this.runtime = new DurableWorkflowRuntime({
 *       storage: new DOStepStorage(ctx.storage)
 *     })
 *   }
 *
 *   async processOrder(order: Order) {
 *     // These steps are durable - survive DO hibernation
 *     await this.runtime.do('Inventory.reserve', order.items)
 *     await this.runtime.do('Payment.charge', order.payment)
 *     await this.runtime.do('Shipping.create', order.address)
 *   }
 * }
 * ```
 */
export class DurableWorkflowRuntime implements WorkflowRuntime {
  private storage: StepStorage
  private retryPolicy: RetryPolicy
  private options: RuntimeOptions

  constructor(options: RuntimeOptions = {}) {
    this.storage = options.storage ?? new InMemoryStepStorage()
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retryPolicy }
    this.options = options
  }

  /**
   * Execute a step with the specified durability mode
   *
   * @param stepId - Unique identifier for this step (hash of path + context)
   * @param pipeline - Pipeline info (path, context, runtime ref)
   * @param args - Arguments passed to the method
   * @param mode - Execution mode ('send', 'try', 'do')
   */
  async executeStep<T>(stepId: string, pipeline: Pipeline, args: unknown[], mode: ExecutionMode = 'do'): Promise<T> {
    // Notify step start
    this.options.onStepStart?.(stepId, pipeline)

    switch (mode) {
      case 'send':
        return this.executeFireAndForget<T>(stepId, pipeline, args)
      case 'try':
        return this.executeQuick<T>(stepId, pipeline, args)
      case 'do':
        return this.executeDurable<T>(stepId, pipeline, args)
      default:
        throw new Error(`Unknown execution mode: ${mode}`)
    }
  }

  /**
   * Fire-and-forget execution (non-blocking, non-durable)
   * Returns immediately without waiting for result
   */
  private async executeFireAndForget<T>(stepId: string, pipeline: Pipeline, args: unknown[]): Promise<T> {
    // Queue for async execution, don't await
    setImmediate(() => {
      this.invokeHandler(pipeline, args).catch((error) => {
        this.options.onStepError?.(stepId, error, 1)
      })
    })

    // Return undefined immediately - caller doesn't wait
    return undefined as T
  }

  /**
   * Quick execution (blocking, non-durable)
   * Single attempt, no retries, no persistence
   */
  private async executeQuick<T>(stepId: string, pipeline: Pipeline, args: unknown[]): Promise<T> {
    try {
      const result = await this.invokeHandler<T>(pipeline, args)
      this.options.onStepComplete?.(stepId, result)
      return result
    } catch (error) {
      this.options.onStepError?.(stepId, error as Error, 1)
      throw error
    }
  }

  /**
   * Durable execution (blocking, durable, with retries)
   * Persists results, supports replay, retries on failure
   */
  private async executeDurable<T>(stepId: string, pipeline: Pipeline, args: unknown[]): Promise<T> {
    // Check for existing completed result (replay)
    const existing = await this.storage.get(stepId)
    if (existing?.status === 'completed') {
      this.options.onStepComplete?.(stepId, existing.result)
      return existing.result as T
    }

    // Create or update step record
    const stepResult: StepResult = existing ?? {
      stepId,
      status: 'pending',
      attempts: 0,
      createdAt: Date.now(),
    }

    // Execute with retries
    let lastError: Error | undefined

    for (let attempt = 1; attempt <= this.retryPolicy.maxAttempts; attempt++) {
      stepResult.attempts = attempt

      try {
        const result = await this.invokeHandler<T>(pipeline, args)

        // Success - persist and return
        stepResult.status = 'completed'
        stepResult.result = result
        stepResult.completedAt = Date.now()
        await this.storage.set(stepId, stepResult)

        this.options.onStepComplete?.(stepId, result)
        return result
      } catch (error) {
        lastError = error as Error
        this.options.onStepError?.(stepId, lastError, attempt)

        // Update failed status
        stepResult.status = 'failed'
        stepResult.error = lastError.message
        await this.storage.set(stepId, stepResult)

        // Wait before retry (unless this is the last attempt)
        if (attempt < this.retryPolicy.maxAttempts) {
          const delay = this.calculateDelay(attempt)
          await this.sleep(delay)
        }
      }
    }

    // All retries exhausted
    throw new WorkflowStepError(`Step ${stepId} failed after ${this.retryPolicy.maxAttempts} attempts`, lastError, stepId, stepResult.attempts)
  }

  /**
   * Invoke the actual handler for a pipeline
   */
  private async invokeHandler<T>(pipeline: Pipeline, args: unknown[]): Promise<T> {
    const handler = resolveHandler(pipeline.path)

    if (!handler) {
      throw new HandlerNotFoundError(pipeline.path)
    }

    // Create a minimal $ proxy for nested calls
    const $ = this

    // Invoke handler with context, args, and $ reference
    const result = await handler.fn(pipeline.context, args[0], $)
    return result as T
  }

  /**
   * Calculate delay for retry with exponential backoff and optional jitter
   */
  private calculateDelay(attempt: number): number {
    // Exponential backoff: initialDelay * (multiplier ^ (attempt - 1))
    let delay = this.retryPolicy.initialDelayMs * Math.pow(this.retryPolicy.backoffMultiplier, attempt - 1)

    // Cap at max delay
    delay = Math.min(delay, this.retryPolicy.maxDelayMs)

    // Add jitter (0-25% of delay)
    if (this.retryPolicy.jitter) {
      const jitterRange = delay * 0.25
      delay += Math.random() * jitterRange
    }

    return Math.floor(delay)
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // =========================================================================
  // Public API for execution modes (matches WorkflowContext interface)
  // =========================================================================

  /**
   * Fire-and-forget event emission (non-blocking, non-durable)
   */
  send(event: string, data: unknown): void {
    // Queue event for processing
    setImmediate(() => {
      // In a full implementation, this would dispatch to event handlers
      // For now, just log the event
      console.debug(`[send] ${event}`, data)
    })
  }

  /**
   * Quick attempt without durability (blocking, non-durable)
   */
  async try<T>(action: string, data: unknown): Promise<T> {
    // Parse action as domain.method
    const [domain, method] = action.split('.')
    if (!domain || !method) {
      throw new Error(`Invalid action format: ${action}. Expected "Domain.method"`)
    }

    const handler = resolveHandler([domain, method])
    if (!handler) {
      throw new HandlerNotFoundError([domain, method])
    }

    return handler.fn(data, undefined, this) as T
  }

  /**
   * Durable execution with retries (blocking, durable)
   */
  async do<T>(action: string, data: unknown): Promise<T> {
    // Parse action as domain.method
    const [domain, method] = action.split('.')
    if (!domain || !method) {
      throw new Error(`Invalid action format: ${action}. Expected "Domain.method"`)
    }

    // Generate step ID from action and data
    const stepId = `${action}:${JSON.stringify(data)}`

    const pipeline: Pipeline = {
      path: [domain, method],
      context: data,
      contextHash: stepId,
      runtime: this,
    }

    return this.executeDurable<T>(stepId, pipeline, [])
  }
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when a handler is not found in the registry
 */
export class HandlerNotFoundError extends Error {
  constructor(public path: string[]) {
    super(`Handler not found: ${path.join('.')}`)
    this.name = 'HandlerNotFoundError'
  }
}

/**
 * Error thrown when a workflow step fails after all retries
 */
export class WorkflowStepError extends Error {
  constructor(
    message: string,
    public cause: Error | undefined,
    public stepId: string,
    public attempts: number,
  ) {
    super(message)
    this.name = 'WorkflowStepError'
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new workflow runtime with the specified options.
 *
 * This is the primary factory function for creating workflow runtimes.
 * It provides sensible defaults while allowing full customization.
 *
 * @param options - Runtime configuration options
 * @returns A configured DurableWorkflowRuntime instance
 *
 * @example Basic creation
 * ```typescript
 * const runtime = createWorkflowRuntime()
 * // Uses in-memory storage and default retry policy
 * ```
 *
 * @example With custom storage
 * ```typescript
 * const runtime = createWorkflowRuntime({
 *   storage: new SqliteStepStorage(db)
 * })
 * ```
 *
 * @example With observability
 * ```typescript
 * const runtime = createWorkflowRuntime({
 *   storage,
 *   onStepStart: (stepId) => span.start(stepId),
 *   onStepComplete: (stepId, result) => span.end(stepId),
 *   onStepError: (stepId, error, attempt) => {
 *     span.recordError(stepId, error)
 *     if (attempt === 3) alertOps(stepId, error)
 *   }
 * })
 * ```
 */
export function createWorkflowRuntime(options: RuntimeOptions = {}): DurableWorkflowRuntime {
  return new DurableWorkflowRuntime(options)
}

/**
 * Create a simple runtime for testing (in-memory, no retries).
 *
 * Provides a pre-configured runtime suitable for unit tests:
 * - In-memory storage (no persistence)
 * - Single attempt (no retries)
 * - No delays between attempts
 *
 * @returns A test-optimized DurableWorkflowRuntime instance
 *
 * @example Unit test usage
 * ```typescript
 * describe('OrderWorkflow', () => {
 *   let runtime: DurableWorkflowRuntime
 *
 *   beforeEach(() => {
 *     runtime = createTestRuntime()
 *   })
 *
 *   it('creates orders', async () => {
 *     const result = await runtime.do('Order.create', orderData)
 *     expect(result.id).toBeDefined()
 *   })
 *
 *   it('fails fast without retries', async () => {
 *     await expect(runtime.do('Failing.action', {}))
 *       .rejects.toThrow()
 *   })
 * })
 * ```
 */
export function createTestRuntime(): DurableWorkflowRuntime {
  return new DurableWorkflowRuntime({
    storage: new InMemoryStepStorage(),
    retryPolicy: {
      maxAttempts: 1,
      initialDelayMs: 0,
      maxDelayMs: 0,
      backoffMultiplier: 1,
      jitter: false,
    },
  })
}

export default createWorkflowRuntime
