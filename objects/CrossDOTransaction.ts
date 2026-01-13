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
 * - Automatic compensation on failure (reverse order)
 * - Retry with exponential backoff
 * - Timeout support per step
 * - Idempotency key support
 */
export class CrossDOSaga<TInput = void, TOutput = void> {
  private steps: SagaStep[] = []
  private idempotencyStore: IdempotencyKeyManager

  constructor(options?: { idempotencyStore?: IdempotencyKeyManager }) {
    this.idempotencyStore = options?.idempotencyStore ?? new IdempotencyKeyManager()
  }

  /**
   * Add a step to the saga
   */
  addStep<TStepInput, TStepOutput>(step: SagaStep<TStepInput, TStepOutput>): this {
    this.steps.push(step as SagaStep)
    return this
  }

  /**
   * Execute the saga
   */
  async execute(
    input: TInput,
    options?: SagaExecutionOptions
  ): Promise<SagaResult<TOutput>> {
    const startTime = Date.now()
    const idempotencyKey = options?.idempotencyKey

    // Check idempotency key
    if (idempotencyKey) {
      const existingResult = await this.idempotencyStore.get<SagaResult<TOutput>>(idempotencyKey)
      if (existingResult) {
        return existingResult
      }
    }

    const completedSteps: SagaStepResult[] = []
    const compensationErrors: Error[] = []
    let currentInput: unknown = input
    let sagaError: Error | undefined

    try {
      // Execute steps sequentially
      for (const step of this.steps) {
        const stepResult = await this.executeStep(step, currentInput)
        completedSteps.push(stepResult)

        if (!stepResult.success) {
          sagaError = stepResult.error
          break
        }

        currentInput = stepResult.result
      }
    } catch (error) {
      sagaError = error instanceof Error ? error : new Error(String(error))
    }

    // If there was an error, run compensations
    let compensated = false
    if (sagaError) {
      // Get steps that completed successfully (excluding the failed step)
      const stepsToCompensate = completedSteps
        .filter(s => s.success)
        .reverse()

      for (const stepResult of stepsToCompensate) {
        const step = this.steps.find(s => s.name === stepResult.name)
        if (step?.compensate && stepResult.result !== undefined) {
          try {
            await step.compensate(stepResult.result, sagaError)
            stepResult.compensated = true
            compensated = true
          } catch (compError) {
            compensationErrors.push(
              compError instanceof Error ? compError : new Error(String(compError))
            )
            if (options?.continueCompensationOnError === false) {
              break
            }
          }
        }
      }
    }

    const result: SagaResult<TOutput> = {
      success: !sagaError,
      result: sagaError ? undefined : (currentInput as TOutput),
      error: sagaError,
      steps: completedSteps,
      compensated,
      compensationErrors: compensationErrors.length > 0 ? compensationErrors : undefined,
      duration: Date.now() - startTime,
    }

    // Store result for idempotency
    if (idempotencyKey) {
      await this.idempotencyStore.set(idempotencyKey, result)
    }

    return result
  }

  /**
   * Execute a single step with retry and timeout support
   */
  private async executeStep(
    step: SagaStep,
    input: unknown
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
          await new Promise(r => setTimeout(r, delay))
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
 * TwoPhaseCommit - 2PC coordinator for atomic multi-DO operations
 *
 * Implements the two-phase commit protocol for situations where
 * stronger consistency guarantees are needed than saga provides.
 *
 * Phases:
 * 1. Prepare - All participants validate and acquire locks
 * 2. Commit - All participants make changes permanent
 * 3. Rollback - If any prepare/commit fails, all participants rollback
 *
 * Note: 2PC can block if the coordinator fails between prepare and commit.
 * For long-running transactions, prefer the saga pattern.
 */
export class TwoPhaseCommit {
  private participants: TwoPhaseParticipant[] = []
  private timeout: number

  constructor(options?: { timeout?: number }) {
    this.timeout = options?.timeout ?? 30000
  }

  /**
   * Add a participant to the 2PC
   */
  addParticipant(participant: TwoPhaseParticipant): this {
    this.participants.push(participant)
    return this
  }

  /**
   * Execute the two-phase commit
   */
  async execute(): Promise<TwoPhaseResult> {
    const participantResults = new Map<string, ParticipantResult>()

    // Initialize results
    for (const p of this.participants) {
      participantResults.set(p.id, { prepared: false, committed: false })
    }

    // Phase 1: Prepare
    let allPrepared = true
    for (const participant of this.participants) {
      try {
        const prepared = await participant.prepare()
        const result = participantResults.get(participant.id)!
        result.prepared = prepared

        if (!prepared) {
          allPrepared = false
          break
        }
      } catch (error) {
        const result = participantResults.get(participant.id)!
        result.error = error instanceof Error ? error : new Error(String(error))
        allPrepared = false
        break
      }
    }

    // If prepare failed, rollback all prepared participants
    if (!allPrepared) {
      await this.rollbackAll(participantResults)
      return {
        success: false,
        phase: 'rollback',
        participantResults,
        error: new TwoPhaseCommitError('Prepare phase failed', 'prepare'),
      }
    }

    // Phase 2: Commit
    let allCommitted = true
    let commitError: Error | undefined
    for (const participant of this.participants) {
      try {
        await participant.commit()
        const result = participantResults.get(participant.id)!
        result.committed = true
      } catch (error) {
        commitError = error instanceof Error ? error : new Error(String(error))
        const result = participantResults.get(participant.id)!
        result.error = commitError
        allCommitted = false
        break
      }
    }

    // If commit failed, rollback all
    if (!allCommitted) {
      await this.rollbackAll(participantResults)
      return {
        success: false,
        phase: 'rollback',
        participantResults,
        error: commitError ?? new TwoPhaseCommitError('Commit phase failed', 'commit'),
      }
    }

    return {
      success: true,
      phase: 'complete',
      participantResults,
    }
  }

  /**
   * Rollback all participants
   */
  private async rollbackAll(
    participantResults: Map<string, ParticipantResult>
  ): Promise<void> {
    for (const participant of this.participants) {
      const result = participantResults.get(participant.id)!
      // Only rollback participants that were prepared
      if (result.prepared) {
        try {
          await participant.rollback()
        } catch (error) {
          // Log but don't throw - best effort rollback
          result.error = result.error ?? (error instanceof Error ? error : new Error(String(error)))
        }
      }
    }
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
export function create2PC(options?: { timeout?: number }): TwoPhaseCommit {
  return new TwoPhaseCommit(options)
}
