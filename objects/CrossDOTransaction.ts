/**
 * Cross-DO Transaction Safety Primitives
 *
 * Provides transaction safety patterns for coordinating operations across
 * multiple Durable Objects in Cloudflare Workers.
 *
 * Key Patterns:
 * 1. CrossDOSaga - Saga pattern with compensating transactions
 * 2. TwoPhaseCommit - 2PC for atomic multi-DO operations
 * 3. IdempotencyKeyManager - Prevents duplicate execution
 * 4. crossDOCallWithTimeout - Timeout wrapper for cross-DO calls
 *
 * Design Principles:
 * - DOs are single-threaded, so local operations are already atomic
 * - Cross-DO calls are async and can fail independently
 * - Sagas provide eventual consistency with compensation on failure
 * - 2PC provides stronger consistency for critical atomic operations
 * - Idempotency keys prevent duplicate execution on retry
 *
 * Performance Optimizations:
 * - Batched prepare messages for 2PC (parallel preparation)
 * - Priority-based saga compensation ordering
 * - Built-in metrics/tracing for observability
 * - Connection pooling hints for cross-DO call latency reduction
 *
 * @example
 * ```typescript
 * import { CrossDOSaga, TwoPhaseCommit, IdempotencyKeyManager } from './CrossDOTransaction'
 *
 * // Saga for checkout flow
 * const checkout = new CrossDOSaga<Order, Shipment>()
 *   .addStep({
 *     name: 'reserveInventory',
 *     targetDO: 'InventoryDO',
 *     execute: async (order) => inventoryDO.reserve(order),
 *     compensate: async (reservation) => inventoryDO.release(reservation),
 *   })
 *   .addStep({
 *     name: 'processPayment',
 *     targetDO: 'PaymentDO',
 *     execute: async (reservation) => paymentDO.charge(reservation),
 *     compensate: async (payment) => paymentDO.refund(payment),
 *   })
 *
 * const result = await checkout.execute(order, { idempotencyKey: order.id })
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Transaction metrics for observability
 */
export interface TransactionMetrics {
  /** Transaction ID for correlation */
  txId: string
  /** Transaction type */
  type: 'saga' | '2pc'
  /** Start timestamp (ms since epoch) */
  startTime: number
  /** End timestamp (ms since epoch) */
  endTime?: number
  /** Total duration in ms */
  duration?: number
  /** Whether transaction succeeded */
  success?: boolean
  /** Number of steps/participants */
  stepCount: number
  /** Steps that were executed */
  stepsExecuted: number
  /** Steps that were compensated */
  stepsCompensated: number
  /** Per-step metrics */
  stepMetrics: StepMetrics[]
  /** Error if failed */
  error?: string
}

/**
 * Metrics for a single step/participant
 */
export interface StepMetrics {
  /** Step name */
  name: string
  /** Target DO (if applicable) */
  targetDO?: string
  /** Phase (execute/compensate for saga, prepare/commit/rollback for 2pc) */
  phase: 'execute' | 'compensate' | 'prepare' | 'commit' | 'rollback'
  /** Start timestamp */
  startTime: number
  /** Duration in ms */
  duration: number
  /** Whether step succeeded */
  success: boolean
  /** Retry attempt number (1-based) */
  attempt?: number
  /** Error message if failed */
  error?: string
}

/**
 * Trace context for distributed tracing
 */
export interface TraceContext {
  /** Trace ID - propagate across all DOs in a transaction */
  traceId: string
  /** Span ID - unique for each operation */
  spanId: string
  /** Parent span ID */
  parentSpanId?: string
  /** Sampling decision */
  sampled?: boolean
}

/**
 * Tracer interface for pluggable tracing backends
 */
export interface TransactionTracer {
  /** Start a new span */
  startSpan(name: string, context?: TraceContext): TraceContext
  /** End a span */
  endSpan(context: TraceContext, success: boolean, error?: Error): void
  /** Record metrics */
  recordMetrics(metrics: TransactionMetrics): void
}

/**
 * Represents a step in a cross-DO saga
 */
export interface SagaStep<TInput = unknown, TOutput = unknown> {
  /** Unique name for this step */
  name: string
  /** Target DO for this step (optional - local steps have no target) */
  targetDO?: string
  /** Execute the forward action */
  execute: (input: TInput) => Promise<TOutput>
  /** Compensate (undo) this step if a later step fails */
  compensate?: (result: TOutput, error: Error) => Promise<void>
  /** Timeout for this step in ms */
  timeout?: number
  /** Retry configuration */
  retry?: {
    maxAttempts?: number
    backoffMs?: number
  }
  /** Compensation priority (higher = compensate first). Default is step order. */
  compensationPriority?: number
  /** Whether this step can be executed in parallel with others */
  parallel?: boolean
}

/**
 * Result of a single saga step
 */
export interface SagaStepResult<T = unknown> {
  name: string
  success: boolean
  result?: T
  error?: Error
  compensated: boolean
  duration: number
}

/**
 * Result of a saga execution
 */
export interface SagaResult<T = unknown> {
  success: boolean
  result?: T
  error?: Error
  steps: SagaStepResult[]
  compensated: boolean
  compensationErrors?: Error[]
  duration: number
  /** Transaction metrics for observability */
  metrics?: TransactionMetrics
  /** Trace context for distributed tracing */
  traceContext?: TraceContext
}

/**
 * Options for saga execution
 */
export interface SagaExecutionOptions {
  /** Idempotency key to prevent duplicate execution */
  idempotencyKey?: string
  /** Overall timeout for the saga in ms */
  timeout?: number
  /** Continue compensation even if some compensations fail */
  continueCompensationOnError?: boolean
  /** Custom tracer for distributed tracing */
  tracer?: TransactionTracer
  /** Parent trace context for correlation */
  traceContext?: TraceContext
  /** Enable metrics collection (default: true) */
  collectMetrics?: boolean
}

/**
 * Two-Phase Commit participant interface
 */
export interface TwoPhaseParticipant {
  /** Unique identifier for this participant */
  id: string
  /** Prepare phase - acquire locks and validate */
  prepare: () => Promise<boolean>
  /** Commit phase - make changes permanent */
  commit: () => Promise<void>
  /** Rollback phase - release locks and undo */
  rollback: () => Promise<void>
}

/**
 * Result of participant in 2PC
 */
export interface ParticipantResult {
  prepared: boolean
  committed: boolean
  error?: Error
}

/**
 * Two-Phase Commit result
 */
export interface TwoPhaseResult {
  success: boolean
  phase: 'prepare' | 'commit' | 'rollback' | 'complete'
  participantResults: Map<string, ParticipantResult>
  error?: Error
  /** Transaction metrics for observability */
  metrics?: TransactionMetrics
  /** Duration in ms */
  duration: number
}

/**
 * Idempotency store interface
 */
export interface IdempotencyStore {
  has(key: string): Promise<boolean>
  set(key: string, result: unknown, ttlMs?: number): Promise<void>
  get<T>(key: string): Promise<T | undefined>
  delete(key: string): Promise<boolean>
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

/**
 * Error thrown when a saga step times out
 */
export class SagaTimeoutError extends Error {
  constructor(
    message: string,
    public readonly stepName?: string,
    public readonly targetDO?: string
  ) {
    super(message)
    this.name = 'SagaTimeoutError'
  }
}

/**
 * Error thrown when a cross-DO call times out
 */
export class CrossDOTimeoutError extends Error {
  constructor(
    message: string,
    public readonly targetDO?: string,
    public readonly timeoutMs?: number
  ) {
    super(message)
    this.name = 'CrossDOTimeoutError'
  }
}

/**
 * Error thrown during 2PC execution
 */
export class TwoPhaseCommitError extends Error {
  constructor(
    message: string,
    public readonly phase: 'prepare' | 'commit' | 'rollback',
    public readonly participantId?: string
  ) {
    super(message)
    this.name = 'TwoPhaseCommitError'
  }
}

// ============================================================================
// TRACING AND METRICS UTILITIES
// ============================================================================

/**
 * Generate a random ID for traces/spans
 */
function generateId(): string {
  const chars = '0123456789abcdef'
  let id = ''
  for (let i = 0; i < 16; i++) {
    id += chars[Math.floor(Math.random() * 16)]
  }
  return id
}

/**
 * Generate a new trace context
 */
export function createTraceContext(parentContext?: TraceContext): TraceContext {
  return {
    traceId: parentContext?.traceId ?? generateId() + generateId(),
    spanId: generateId(),
    parentSpanId: parentContext?.spanId,
    sampled: parentContext?.sampled ?? true,
  }
}

/**
 * No-op tracer that does nothing (default implementation)
 */
export class NoopTracer implements TransactionTracer {
  startSpan(name: string, context?: TraceContext): TraceContext {
    return createTraceContext(context)
  }

  endSpan(_context: TraceContext, _success: boolean, _error?: Error): void {
    // No-op
  }

  recordMetrics(_metrics: TransactionMetrics): void {
    // No-op
  }
}

/**
 * Console tracer for debugging - logs all spans and metrics
 */
export class ConsoleTracer implements TransactionTracer {
  private prefix: string

  constructor(options?: { prefix?: string }) {
    this.prefix = options?.prefix ?? '[CrossDO]'
  }

  startSpan(name: string, context?: TraceContext): TraceContext {
    const ctx = createTraceContext(context)
    console.log(
      `${this.prefix} START span=${name} traceId=${ctx.traceId} spanId=${ctx.spanId} parent=${ctx.parentSpanId ?? 'none'}`
    )
    return ctx
  }

  endSpan(context: TraceContext, success: boolean, error?: Error): void {
    console.log(
      `${this.prefix} END spanId=${context.spanId} success=${success}${error ? ` error=${error.message}` : ''}`
    )
  }

  recordMetrics(metrics: TransactionMetrics): void {
    console.log(
      `${this.prefix} METRICS txId=${metrics.txId} type=${metrics.type} duration=${metrics.duration}ms ` +
        `success=${metrics.success} steps=${metrics.stepsExecuted}/${metrics.stepCount} compensated=${metrics.stepsCompensated}`
    )
    for (const step of metrics.stepMetrics) {
      console.log(
        `${this.prefix}   - ${step.name}[${step.phase}] ${step.duration}ms success=${step.success}${step.error ? ` error=${step.error}` : ''}`
      )
    }
  }
}

/**
 * Metrics collector that stores metrics in memory for later retrieval
 */
export class MetricsCollector implements TransactionTracer {
  private metrics: TransactionMetrics[] = []
  private maxSize: number

  constructor(options?: { maxSize?: number }) {
    this.maxSize = options?.maxSize ?? 1000
  }

  startSpan(name: string, context?: TraceContext): TraceContext {
    return createTraceContext(context)
  }

  endSpan(_context: TraceContext, _success: boolean, _error?: Error): void {
    // No-op - metrics are recorded at the end
  }

  recordMetrics(metrics: TransactionMetrics): void {
    this.metrics.push(metrics)
    // Evict old metrics if over limit
    if (this.metrics.length > this.maxSize) {
      this.metrics.shift()
    }
  }

  /**
   * Get all collected metrics
   */
  getMetrics(): TransactionMetrics[] {
    return [...this.metrics]
  }

  /**
   * Get metrics summary
   */
  getSummary(): {
    total: number
    successful: number
    failed: number
    avgDuration: number
    avgStepsExecuted: number
    avgStepsCompensated: number
  } {
    if (this.metrics.length === 0) {
      return {
        total: 0,
        successful: 0,
        failed: 0,
        avgDuration: 0,
        avgStepsExecuted: 0,
        avgStepsCompensated: 0,
      }
    }

    const successful = this.metrics.filter((m) => m.success).length
    const totalDuration = this.metrics.reduce((sum, m) => sum + (m.duration ?? 0), 0)
    const totalStepsExecuted = this.metrics.reduce((sum, m) => sum + m.stepsExecuted, 0)
    const totalStepsCompensated = this.metrics.reduce((sum, m) => sum + m.stepsCompensated, 0)

    return {
      total: this.metrics.length,
      successful,
      failed: this.metrics.length - successful,
      avgDuration: totalDuration / this.metrics.length,
      avgStepsExecuted: totalStepsExecuted / this.metrics.length,
      avgStepsCompensated: totalStepsCompensated / this.metrics.length,
    }
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = []
  }
}

// ============================================================================
// CROSS-DO SAGA IMPLEMENTATION
// ============================================================================

/**
 * CrossDOSaga - Saga coordinator for cross-DO operations
 *
 * Implements the saga pattern for distributed transactions across multiple
 * Durable Objects. Each step can have a compensation action that undoes
 * its effects if a later step fails.
 *
 * Features:
 * - Sequential step execution
 * - Automatic compensation on failure (priority-based ordering)
 * - Retry with exponential backoff
 * - Timeout support per step
 * - Idempotency key support
 * - Built-in metrics collection and distributed tracing
 */
export class CrossDOSaga<TInput = void, TOutput = void> {
  private steps: SagaStep[] = []
  private idempotencyStore: IdempotencyKeyManager
  private defaultTracer: TransactionTracer = new NoopTracer()

  constructor(options?: { idempotencyStore?: IdempotencyKeyManager; tracer?: TransactionTracer }) {
    this.idempotencyStore = options?.idempotencyStore ?? new IdempotencyKeyManager()
    if (options?.tracer) {
      this.defaultTracer = options.tracer
    }
  }

  /**
   * Add a step to the saga
   */
  addStep<TStepInput, TStepOutput>(step: SagaStep<TStepInput, TStepOutput>): this {
    this.steps.push(step as SagaStep)
    return this
  }

  /**
   * Execute the saga with full observability
   */
  async execute(
    input: TInput,
    options?: SagaExecutionOptions
  ): Promise<SagaResult<TOutput>> {
    const startTime = Date.now()
    const idempotencyKey = options?.idempotencyKey
    const tracer = options?.tracer ?? this.defaultTracer
    const collectMetrics = options?.collectMetrics !== false

    // Generate transaction ID and trace context
    const txId = idempotencyKey ?? generateIdempotencyKey('saga')
    const rootContext = tracer.startSpan(`saga:${txId}`, options?.traceContext)

    // Check idempotency key
    if (idempotencyKey) {
      const existingResult = await this.idempotencyStore.get<SagaResult<TOutput>>(idempotencyKey)
      if (existingResult) {
        tracer.endSpan(rootContext, existingResult.success)
        return existingResult
      }
    }

    const completedSteps: SagaStepResult[] = []
    const compensationErrors: Error[] = []
    const stepMetrics: StepMetrics[] = []
    let currentInput: unknown = input
    let sagaError: Error | undefined
    let stepsExecuted = 0

    try {
      // Execute steps sequentially
      for (const step of this.steps) {
        const stepContext = tracer.startSpan(`saga:step:${step.name}`, rootContext)
        const stepStartTime = Date.now()

        const stepResult = await this.executeStep(step, currentInput, tracer, stepContext)
        completedSteps.push(stepResult)
        stepsExecuted++

        // Collect step metrics
        if (collectMetrics) {
          stepMetrics.push({
            name: step.name,
            targetDO: step.targetDO,
            phase: 'execute',
            startTime: stepStartTime,
            duration: stepResult.duration,
            success: stepResult.success,
            error: stepResult.error?.message,
          })
        }

        tracer.endSpan(stepContext, stepResult.success, stepResult.error)

        if (!stepResult.success) {
          sagaError = stepResult.error
          break
        }

        currentInput = stepResult.result
      }
    } catch (error) {
      sagaError = error instanceof Error ? error : new Error(String(error))
    }

    // If there was an error, run compensations with priority-based ordering
    let compensated = false
    let stepsCompensated = 0
    if (sagaError) {
      // Get steps that completed successfully (excluding the failed step)
      // Sort by compensation priority (higher priority first), then by reverse execution order
      const stepsToCompensate = completedSteps
        .filter((s) => s.success)
        .map((stepResult, index) => ({
          stepResult,
          step: this.steps.find((s) => s.name === stepResult.name)!,
          originalIndex: index,
        }))
        .sort((a, b) => {
          // If both have explicit priorities, use them
          if (a.step.compensationPriority !== undefined && b.step.compensationPriority !== undefined) {
            return b.step.compensationPriority - a.step.compensationPriority // Higher priority first
          }
          // If only one has priority, prioritized step goes first
          if (a.step.compensationPriority !== undefined) return -1
          if (b.step.compensationPriority !== undefined) return 1
          // Default: reverse execution order (higher index compensates first)
          return b.originalIndex - a.originalIndex
        })

      for (const { stepResult, step } of stepsToCompensate) {
        if (step?.compensate && stepResult.result !== undefined) {
          const compContext = tracer.startSpan(`saga:compensate:${step.name}`, rootContext)
          const compStartTime = Date.now()
          let compSuccess = false

          try {
            await step.compensate(stepResult.result, sagaError)
            stepResult.compensated = true
            compensated = true
            stepsCompensated++
            compSuccess = true
          } catch (compError) {
            const err = compError instanceof Error ? compError : new Error(String(compError))
            compensationErrors.push(err)
            if (options?.continueCompensationOnError === false) {
              tracer.endSpan(compContext, false, err)
              break
            }
          }

          // Collect compensation metrics
          if (collectMetrics) {
            stepMetrics.push({
              name: step.name,
              targetDO: step.targetDO,
              phase: 'compensate',
              startTime: compStartTime,
              duration: Date.now() - compStartTime,
              success: compSuccess,
              error: compSuccess ? undefined : compensationErrors[compensationErrors.length - 1]?.message,
            })
          }

          tracer.endSpan(compContext, compSuccess)
        }
      }
    }

    const endTime = Date.now()
    const duration = endTime - startTime

    // Build metrics
    const metrics: TransactionMetrics | undefined = collectMetrics
      ? {
          txId,
          type: 'saga',
          startTime,
          endTime,
          duration,
          success: !sagaError,
          stepCount: this.steps.length,
          stepsExecuted,
          stepsCompensated,
          stepMetrics,
          error: sagaError?.message,
        }
      : undefined

    // Record metrics
    if (metrics) {
      tracer.recordMetrics(metrics)
    }

    const result: SagaResult<TOutput> = {
      success: !sagaError,
      result: sagaError ? undefined : (currentInput as TOutput),
      error: sagaError,
      steps: completedSteps,
      compensated,
      compensationErrors: compensationErrors.length > 0 ? compensationErrors : undefined,
      duration,
      metrics,
      traceContext: rootContext,
    }

    // Store result for idempotency
    if (idempotencyKey) {
      await this.idempotencyStore.set(idempotencyKey, result)
    }

    tracer.endSpan(rootContext, result.success, sagaError)
    return result
  }

  /**
   * Execute a single step with retry and timeout support
   */
  private async executeStep(
    step: SagaStep,
    input: unknown,
    _tracer?: TransactionTracer,
    _context?: TraceContext
  ): Promise<SagaStepResult> {
    const startTime = Date.now()
    const maxAttempts = step.retry?.maxAttempts ?? 1
    const backoffMs = step.retry?.backoffMs ?? 100

    let lastError: Error | undefined
    let result: unknown

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (step.timeout) {
          result = await this.executeWithTimeout(
            () => step.execute(input),
            step.timeout,
            step.name,
            step.targetDO
          )
        } else {
          result = await step.execute(input)
        }

        return {
          name: step.name,
          success: true,
          result,
          compensated: false,
          duration: Date.now() - startTime,
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (attempt < maxAttempts) {
          // Exponential backoff
          const delay = backoffMs * Math.pow(2, attempt - 1)
          await new Promise((r) => setTimeout(r, delay))
        }
      }
    }

    return {
      name: step.name,
      success: false,
      error: lastError,
      compensated: false,
      duration: Date.now() - startTime,
    }
  }

  /**
   * Execute a function with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    stepName: string,
    targetDO?: string
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new SagaTimeoutError(
          `Step '${stepName}' timed out after ${timeoutMs}ms`,
          stepName,
          targetDO
        ))
      }, timeoutMs)
    })

    try {
      return await Promise.race([fn(), timeoutPromise])
    } finally {
      clearTimeout(timeoutId!)
    }
  }
}

// ============================================================================
// TWO-PHASE COMMIT IMPLEMENTATION
// ============================================================================

/**
 * Options for 2PC execution
 */
export interface TwoPhaseCommitOptions {
  /** Timeout for operations in ms */
  timeout?: number
  /** Whether to use parallel prepare (batched) - default: true for performance */
  parallelPrepare?: boolean
  /** Custom tracer for distributed tracing */
  tracer?: TransactionTracer
  /** Parent trace context for correlation */
  traceContext?: TraceContext
  /** Enable metrics collection (default: true) */
  collectMetrics?: boolean
}

/**
 * TwoPhaseCommit - 2PC coordinator for atomic multi-DO operations
 *
 * Implements the two-phase commit protocol for situations where
 * stronger consistency guarantees are needed than saga provides.
 *
 * Phases:
 * 1. Prepare - All participants validate and acquire locks (batched/parallel by default)
 * 2. Commit - All participants make changes permanent
 * 3. Rollback - If any prepare/commit fails, all participants rollback
 *
 * Performance Optimizations:
 * - Batched parallel prepare messages (configurable)
 * - Built-in metrics collection
 * - Distributed tracing support
 *
 * Note: 2PC can block if the coordinator fails between prepare and commit.
 * For long-running transactions, prefer the saga pattern.
 */
export class TwoPhaseCommit {
  private participants: TwoPhaseParticipant[] = []
  private timeout: number
  private parallelPrepare: boolean
  private defaultTracer: TransactionTracer = new NoopTracer()

  constructor(options?: TwoPhaseCommitOptions) {
    this.timeout = options?.timeout ?? 30000
    this.parallelPrepare = options?.parallelPrepare !== false // Default to true
    if (options?.tracer) {
      this.defaultTracer = options.tracer
    }
  }

  /**
   * Add a participant to the 2PC
   */
  addParticipant(participant: TwoPhaseParticipant): this {
    this.participants.push(participant)
    return this
  }

  /**
   * Execute the two-phase commit with full observability
   */
  async execute(options?: TwoPhaseCommitOptions): Promise<TwoPhaseResult> {
    const startTime = Date.now()
    const tracer = options?.tracer ?? this.defaultTracer
    const collectMetrics = options?.collectMetrics !== false
    const useParallelPrepare = options?.parallelPrepare ?? this.parallelPrepare

    // Generate transaction ID and trace context
    const txId = generateIdempotencyKey('2pc')
    const rootContext = tracer.startSpan(`2pc:${txId}`, options?.traceContext)

    const participantResults = new Map<string, ParticipantResult>()
    const stepMetrics: StepMetrics[] = []

    // Initialize results
    for (const p of this.participants) {
      participantResults.set(p.id, { prepared: false, committed: false })
    }

    // Phase 1: Prepare (batched/parallel or sequential)
    let allPrepared = true
    let prepareError: Error | undefined
    const prepareStartTime = Date.now()

    if (useParallelPrepare) {
      // Batched parallel prepare for reduced latency
      const prepareResults = await Promise.allSettled(
        this.participants.map(async (participant) => {
          const stepStart = Date.now()
          try {
            const prepared = await participant.prepare()
            if (collectMetrics) {
              stepMetrics.push({
                name: participant.id,
                phase: 'prepare',
                startTime: stepStart,
                duration: Date.now() - stepStart,
                success: prepared,
              })
            }
            return { id: participant.id, prepared }
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error))
            if (collectMetrics) {
              stepMetrics.push({
                name: participant.id,
                phase: 'prepare',
                startTime: stepStart,
                duration: Date.now() - stepStart,
                success: false,
                error: err.message,
              })
            }
            throw err
          }
        })
      )

      // Process results
      for (let i = 0; i < prepareResults.length; i++) {
        const participant = this.participants[i]
        const prepareResult = prepareResults[i]
        const result = participantResults.get(participant.id)!

        if (prepareResult.status === 'fulfilled') {
          result.prepared = prepareResult.value.prepared
          if (!prepareResult.value.prepared) {
            allPrepared = false
          }
        } else {
          result.error = prepareResult.reason
          allPrepared = false
          prepareError = prepareResult.reason
        }
      }
    } else {
      // Sequential prepare (original behavior)
      for (const participant of this.participants) {
        const stepStart = Date.now()
        try {
          const prepared = await participant.prepare()
          const result = participantResults.get(participant.id)!
          result.prepared = prepared

          if (collectMetrics) {
            stepMetrics.push({
              name: participant.id,
              phase: 'prepare',
              startTime: stepStart,
              duration: Date.now() - stepStart,
              success: prepared,
            })
          }

          if (!prepared) {
            allPrepared = false
            break
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          const result = participantResults.get(participant.id)!
          result.error = err
          prepareError = err
          allPrepared = false

          if (collectMetrics) {
            stepMetrics.push({
              name: participant.id,
              phase: 'prepare',
              startTime: stepStart,
              duration: Date.now() - stepStart,
              success: false,
              error: err.message,
            })
          }
          break
        }
      }
    }

    // If prepare failed, rollback all prepared participants
    if (!allPrepared) {
      await this.rollbackAll(participantResults, stepMetrics, collectMetrics)
      const duration = Date.now() - startTime
      const metrics = collectMetrics
        ? this.buildMetrics(txId, startTime, duration, false, stepMetrics, prepareError?.message)
        : undefined
      if (metrics) {
        tracer.recordMetrics(metrics)
      }
      tracer.endSpan(rootContext, false, prepareError)
      return {
        success: false,
        phase: 'rollback',
        participantResults,
        error: prepareError ?? new TwoPhaseCommitError('Prepare phase failed', 'prepare'),
        metrics,
        duration,
      }
    }

    // Phase 2: Commit
    let allCommitted = true
    let commitError: Error | undefined
    for (const participant of this.participants) {
      const stepStart = Date.now()
      try {
        await participant.commit()
        const result = participantResults.get(participant.id)!
        result.committed = true

        if (collectMetrics) {
          stepMetrics.push({
            name: participant.id,
            phase: 'commit',
            startTime: stepStart,
            duration: Date.now() - stepStart,
            success: true,
          })
        }
      } catch (error) {
        commitError = error instanceof Error ? error : new Error(String(error))
        const result = participantResults.get(participant.id)!
        result.error = commitError
        allCommitted = false

        if (collectMetrics) {
          stepMetrics.push({
            name: participant.id,
            phase: 'commit',
            startTime: stepStart,
            duration: Date.now() - stepStart,
            success: false,
            error: commitError.message,
          })
        }
        break
      }
    }

    // If commit failed, rollback all
    if (!allCommitted) {
      await this.rollbackAll(participantResults, stepMetrics, collectMetrics)
      const duration = Date.now() - startTime
      const metrics = collectMetrics
        ? this.buildMetrics(txId, startTime, duration, false, stepMetrics, commitError?.message)
        : undefined
      if (metrics) {
        tracer.recordMetrics(metrics)
      }
      tracer.endSpan(rootContext, false, commitError)
      return {
        success: false,
        phase: 'rollback',
        participantResults,
        error: commitError ?? new TwoPhaseCommitError('Commit phase failed', 'commit'),
        metrics,
        duration,
      }
    }

    const duration = Date.now() - startTime
    const metrics = collectMetrics
      ? this.buildMetrics(txId, startTime, duration, true, stepMetrics)
      : undefined
    if (metrics) {
      tracer.recordMetrics(metrics)
    }
    tracer.endSpan(rootContext, true)

    return {
      success: true,
      phase: 'complete',
      participantResults,
      metrics,
      duration,
    }
  }

  /**
   * Build metrics object for 2PC
   */
  private buildMetrics(
    txId: string,
    startTime: number,
    duration: number,
    success: boolean,
    stepMetrics: StepMetrics[],
    error?: string
  ): TransactionMetrics {
    const prepareSteps = stepMetrics.filter((s) => s.phase === 'prepare')
    const commitSteps = stepMetrics.filter((s) => s.phase === 'commit')
    const rollbackSteps = stepMetrics.filter((s) => s.phase === 'rollback')

    return {
      txId,
      type: '2pc',
      startTime,
      endTime: startTime + duration,
      duration,
      success,
      stepCount: this.participants.length,
      stepsExecuted: prepareSteps.length + commitSteps.length,
      stepsCompensated: rollbackSteps.length,
      stepMetrics,
      error,
    }
  }

  /**
   * Rollback all participants with metrics collection
   */
  private async rollbackAll(
    participantResults: Map<string, ParticipantResult>,
    stepMetrics?: StepMetrics[],
    collectMetrics?: boolean
  ): Promise<void> {
    // Parallel rollback for better performance
    await Promise.allSettled(
      this.participants.map(async (participant) => {
        const result = participantResults.get(participant.id)!
        // Only rollback participants that were prepared
        if (result.prepared) {
          const stepStart = Date.now()
          try {
            await participant.rollback()
            if (collectMetrics && stepMetrics) {
              stepMetrics.push({
                name: participant.id,
                phase: 'rollback',
                startTime: stepStart,
                duration: Date.now() - stepStart,
                success: true,
              })
            }
          } catch (error) {
            // Log but don't throw - best effort rollback
            const err = error instanceof Error ? error : new Error(String(error))
            result.error = result.error ?? err
            if (collectMetrics && stepMetrics) {
              stepMetrics.push({
                name: participant.id,
                phase: 'rollback',
                startTime: stepStart,
                duration: Date.now() - stepStart,
                success: false,
                error: err.message,
              })
            }
          }
        }
      })
    )
  }
}

// ============================================================================
// IDEMPOTENCY KEY MANAGER
// ============================================================================

/**
 * IdempotencyKeyManager - Tracks idempotency keys to prevent duplicate execution
 *
 * Features:
 * - In-memory storage (for DO-scoped idempotency)
 * - TTL support for key expiration
 * - Result storage and retrieval
 *
 * For cross-DO idempotency, use DO storage instead of in-memory.
 */
export class IdempotencyKeyManager implements IdempotencyStore {
  private store = new Map<string, { result: unknown; expiresAt?: number }>()

  /**
   * Check if a key exists and is not expired
   */
  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key)
    if (!entry) return false

    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return false
    }

    return true
  }

  /**
   * Store a result with optional TTL
   */
  async set(key: string, result: unknown, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      result,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    })
  }

  /**
   * Get a stored result
   */
  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key)
    if (!entry) return undefined

    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }

    return entry.result as T
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<boolean> {
    return this.store.delete(key)
  }

  /**
   * Clear all keys
   */
  async clear(): Promise<void> {
    this.store.clear()
  }

  /**
   * Get all keys (for debugging)
   */
  keys(): string[] {
    return Array.from(this.store.keys())
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Wrap a cross-DO call with a timeout
 *
 * @param call - The async function to call
 * @param timeoutMs - Timeout in milliseconds
 * @param targetDO - Optional target DO name for error context
 * @returns The result of the call
 * @throws CrossDOTimeoutError if the call times out
 *
 * @example
 * ```typescript
 * const result = await crossDOCallWithTimeout(
 *   () => inventoryDO.reserve(items),
 *   5000,
 *   'InventoryDO'
 * )
 * ```
 */
export async function crossDOCallWithTimeout<T>(
  call: () => Promise<T>,
  timeoutMs: number,
  targetDO?: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new CrossDOTimeoutError(
        `Cross-DO call${targetDO ? ` to ${targetDO}` : ''} timed out after ${timeoutMs}ms`,
        targetDO,
        timeoutMs
      ))
    }, timeoutMs)
  })

  try {
    return await Promise.race([call(), timeoutPromise])
  } finally {
    clearTimeout(timeoutId!)
  }
}

/**
 * Generate a unique idempotency key
 */
export function generateIdempotencyKey(prefix?: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`
}

/**
 * Create a saga builder with fluent API
 */
export function createSaga<TInput = void, TOutput = void>(): CrossDOSaga<TInput, TOutput> {
  return new CrossDOSaga<TInput, TOutput>()
}

/**
 * Create a 2PC coordinator
 */
export function create2PC(options?: TwoPhaseCommitOptions): TwoPhaseCommit {
  return new TwoPhaseCommit(options)
}

// ============================================================================
// CROSS-DO CALL OPTIMIZATION UTILITIES
// ============================================================================

/**
 * Options for batch cross-DO calls
 */
export interface BatchCallOptions {
  /** Timeout for each call in ms */
  timeoutMs?: number
  /** Maximum concurrency (default: unlimited) */
  maxConcurrency?: number
  /** Whether to stop on first error (default: false) */
  stopOnError?: boolean
}

/**
 * Result of a batch cross-DO call
 */
export interface BatchCallResult<T> {
  results: Array<{ success: boolean; result?: T; error?: Error; index: number }>
  duration: number
  successCount: number
  errorCount: number
}

/**
 * Execute multiple cross-DO calls in parallel with optional concurrency limit
 *
 * This is optimized for reducing cross-DO call latency by:
 * 1. Batching calls together
 * 2. Executing in parallel (with optional concurrency limit)
 * 3. Using Promise.allSettled to handle partial failures
 *
 * @example
 * ```typescript
 * const results = await batchCrossDOCalls([
 *   () => inventoryDO.reserve(items),
 *   () => paymentDO.authorize(amount),
 *   () => shippingDO.estimate(address),
 * ], { timeoutMs: 5000, maxConcurrency: 10 })
 * ```
 */
export async function batchCrossDOCalls<T>(
  calls: Array<() => Promise<T>>,
  options?: BatchCallOptions
): Promise<BatchCallResult<T>> {
  const startTime = Date.now()
  const timeoutMs = options?.timeoutMs
  const maxConcurrency = options?.maxConcurrency
  const stopOnError = options?.stopOnError ?? false

  // If no concurrency limit, run all in parallel
  if (!maxConcurrency || maxConcurrency >= calls.length) {
    const results = await Promise.allSettled(
      calls.map(async (call, index) => {
        const result = timeoutMs
          ? await crossDOCallWithTimeout(call, timeoutMs)
          : await call()
        return { result, index }
      })
    )

    const processedResults = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return { success: true, result: result.value.result, index }
      } else {
        return {
          success: false,
          error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
          index,
        }
      }
    })

    return {
      results: processedResults,
      duration: Date.now() - startTime,
      successCount: processedResults.filter((r) => r.success).length,
      errorCount: processedResults.filter((r) => !r.success).length,
    }
  }

  // With concurrency limit, process in batches
  const results: Array<{ success: boolean; result?: T; error?: Error; index: number }> = []
  let stopped = false

  for (let i = 0; i < calls.length && !stopped; i += maxConcurrency) {
    const batch = calls.slice(i, i + maxConcurrency)
    const batchResults = await Promise.allSettled(
      batch.map(async (call, batchIndex) => {
        const index = i + batchIndex
        const result = timeoutMs
          ? await crossDOCallWithTimeout(call, timeoutMs)
          : await call()
        return { result, index }
      })
    )

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j]
      const index = i + j

      if (result.status === 'fulfilled') {
        results.push({ success: true, result: result.value.result, index })
      } else {
        const error = result.reason instanceof Error ? result.reason : new Error(String(result.reason))
        results.push({ success: false, error, index })
        if (stopOnError) {
          stopped = true
          break
        }
      }
    }
  }

  return {
    results,
    duration: Date.now() - startTime,
    successCount: results.filter((r) => r.success).length,
    errorCount: results.filter((r) => !r.success).length,
  }
}

/**
 * Execute a cross-DO call with automatic retry and exponential backoff
 */
export async function crossDOCallWithRetry<T>(
  call: () => Promise<T>,
  options?: {
    maxAttempts?: number
    backoffMs?: number
    timeoutMs?: number
    targetDO?: string
  }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3
  const backoffMs = options?.backoffMs ?? 100
  const timeoutMs = options?.timeoutMs
  const targetDO = options?.targetDO

  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (timeoutMs) {
        return await crossDOCallWithTimeout(call, timeoutMs, targetDO)
      }
      return await call()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < maxAttempts) {
        // Exponential backoff with jitter
        const delay = backoffMs * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }

  throw lastError
}
