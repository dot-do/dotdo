/**
 * Saga / Compensation Pattern Implementation for Temporal Compat Layer
 *
 * Sagas provide a way to maintain data consistency across distributed services
 * without using distributed transactions. Each step has a compensation that
 * can undo its effects if a later step fails.
 *
 * This implementation supports:
 * - Sequential saga execution
 * - Parallel saga steps
 * - Compensation on failure (rollback)
 * - Compensation on timeout
 * - Partial compensation (only undo completed steps)
 * - Retry policies per step
 * - Saga state persistence for recovery
 *
 * @see https://microservices.io/patterns/data/saga.html
 * @see Temporal's saga pattern: https://docs.temporal.io/workflows#saga-pattern
 */

import {
  createActivityDeduplicationContext,
  createWorkflowHistoryStore,
  type ActivityDeduplicationContext,
  type WorkflowHistoryStore,
} from './unified-primitives'

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a saga step execution
 */
export interface SagaStepResult<T = unknown> {
  stepName: string
  success: boolean
  result?: T
  error?: Error
  startedAt: number
  completedAt: number
  compensated: boolean
}

/**
 * Saga step definition
 */
export interface SagaStep<TInput = unknown, TOutput = unknown> {
  /** Unique name for this step */
  name: string

  /**
   * Execute the forward action.
   * @param input - Input from previous step or saga input
   * @returns The step result
   */
  execute: (input: TInput) => Promise<TOutput>

  /**
   * Compensate (undo) this step if a later step fails.
   * @param result - The result from the execute phase
   * @param error - The error that caused the compensation
   */
  compensate?: (result: TOutput, error: Error) => Promise<void>

  /**
   * Optional retry policy for this step.
   */
  retry?: {
    maxAttempts?: number
    initialInterval?: number
    backoffCoefficient?: number
    maxInterval?: number
  }

  /**
   * Timeout for this step in milliseconds.
   */
  timeout?: number
}

/**
 * Saga execution options
 */
export interface SagaOptions {
  /** Unique identifier for this saga execution */
  sagaId?: string

  /** Maximum time for the entire saga in milliseconds */
  timeout?: number

  /**
   * Whether to run compensations in parallel.
   * Default: false (sequential, reverse order)
   */
  parallelCompensation?: boolean

  /**
   * Whether to continue compensation if one fails.
   * Default: true
   */
  continueCompensationOnError?: boolean

  /**
   * Activity deduplication context for exactly-once execution.
   */
  activityContext?: ActivityDeduplicationContext

  /**
   * History store for persistence and recovery.
   */
  historyStore?: WorkflowHistoryStore
}

/**
 * Saga execution result
 */
export interface SagaResult<T = unknown> {
  /** Whether the saga completed successfully */
  success: boolean

  /** The final result if successful */
  result?: T

  /** The error if failed */
  error?: Error

  /** Results of all steps */
  steps: SagaStepResult[]

  /** Whether compensations were run */
  compensated: boolean

  /** Any errors during compensation */
  compensationErrors?: Error[]

  /** Total execution time in milliseconds */
  duration: number
}

/**
 * Saga state for persistence
 */
export interface SagaState {
  sagaId: string
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'COMPENSATING' | 'COMPENSATED'
  currentStepIndex: number
  completedSteps: SagaStepResult[]
  startedAt: number
  completedAt?: number
  error?: string
}

// ============================================================================
// Saga Builder
// ============================================================================

/**
 * Builder for creating saga definitions with a fluent API.
 */
export class SagaBuilder<TInput = void, TOutput = void> {
  private steps: SagaStep<unknown, unknown>[] = []

  /**
   * Add a step to the saga.
   *
   * @example
   * ```typescript
   * const saga = new SagaBuilder()
   *   .addStep({
   *     name: 'reserveInventory',
   *     execute: async (orderId) => {
   *       return await inventoryService.reserve(orderId)
   *     },
   *     compensate: async (reservation) => {
   *       await inventoryService.release(reservation.id)
   *     },
   *   })
   *   .addStep({
   *     name: 'processPayment',
   *     execute: async (reservation) => {
   *       return await paymentService.charge(reservation.amount)
   *     },
   *     compensate: async (payment) => {
   *       await paymentService.refund(payment.id)
   *     },
   *   })
   *   .build()
   * ```
   */
  addStep<TStepInput, TStepOutput>(
    step: SagaStep<TStepInput, TStepOutput>
  ): SagaBuilder<TInput, TStepOutput> {
    this.steps.push(step as SagaStep<unknown, unknown>)
    return this as unknown as SagaBuilder<TInput, TStepOutput>
  }

  /**
   * Build the saga definition.
   */
  build(): Saga<TInput, TOutput> {
    return new Saga<TInput, TOutput>([...this.steps])
  }
}

// ============================================================================
// Saga Executor
// ============================================================================

/**
 * Saga instance that can be executed.
 */
export class Saga<TInput = void, TOutput = void> {
  constructor(private readonly steps: SagaStep<unknown, unknown>[]) {}

  /**
   * Execute the saga with the given input.
   */
  async execute(input: TInput, options: SagaOptions = {}): Promise<SagaResult<TOutput>> {
    const sagaId = options.sagaId ?? `saga-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const startedAt = Date.now()
    const completedSteps: SagaStepResult[] = []
    const compensationErrors: Error[] = []

    // Create or use provided deduplication context
    const activityContext = options.activityContext ?? createActivityDeduplicationContext(sagaId)
    const historyStore = options.historyStore ?? createWorkflowHistoryStore(sagaId)

    // Record saga start
    await historyStore.appendEvent({
      eventType: 'WORKFLOW_STARTED',
      attributes: { sagaId, input },
    })

    let currentInput: unknown = input
    let sagaError: Error | null = null
    let finalResult: TOutput | undefined

    try {
      // Execute steps in order
      for (let i = 0; i < this.steps.length; i++) {
        const step = this.steps[i]
        if (!step) continue // Type guard for noUncheckedIndexedAccess

        const stepStartedAt = Date.now()

        try {
          // Execute with deduplication
          const result = await this.executeStep(
            step,
            currentInput,
            i,
            activityContext,
            historyStore,
            options.timeout
          )

          const stepResult: SagaStepResult = {
            stepName: step.name,
            success: true,
            result,
            startedAt: stepStartedAt,
            completedAt: Date.now(),
            compensated: false,
          }

          completedSteps.push(stepResult)
          currentInput = result

          // Record step completion
          await historyStore.appendEvent({
            eventType: 'ACTIVITY_COMPLETED',
            attributes: { stepName: step.name, stepIndex: i, result },
          })
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))

          const stepResult: SagaStepResult = {
            stepName: step.name,
            success: false,
            error: err,
            startedAt: stepStartedAt,
            completedAt: Date.now(),
            compensated: false,
          }

          completedSteps.push(stepResult)
          sagaError = err

          // Record step failure
          await historyStore.appendEvent({
            eventType: 'ACTIVITY_FAILED',
            attributes: { stepName: step.name, stepIndex: i, error: err.message },
          })

          break
        }
      }

      // If all steps succeeded, capture the final result
      if (!sagaError) {
        finalResult = currentInput as TOutput

        await historyStore.appendEvent({
          eventType: 'WORKFLOW_COMPLETED',
          attributes: { sagaId, result: finalResult },
        })
      }
    } catch (error) {
      sagaError = error instanceof Error ? error : new Error(String(error))
    }

    // Compensation phase if there was an error
    if (sagaError) {
      await historyStore.appendEvent({
        eventType: 'WORKFLOW_FAILED',
        attributes: { sagaId, error: sagaError.message },
      })

      // Run compensations in reverse order
      const stepsToCompensate = completedSteps
        .slice(0, -1) // Exclude the failed step (it didn't complete)
        .filter(s => s.success)
        .reverse()

      if (options.parallelCompensation) {
        // Run all compensations in parallel
        const compensationPromises = stepsToCompensate.map(async (stepResult, reverseIndex) => {
          const originalIndex = completedSteps.length - 2 - reverseIndex
          const step = this.steps[originalIndex]
          if (!step) return // Type guard

          if (step.compensate && stepResult.result !== undefined) {
            try {
              await step.compensate(stepResult.result, sagaError!)
              stepResult.compensated = true
            } catch (compError) {
              const err = compError instanceof Error ? compError : new Error(String(compError))
              compensationErrors.push(err)

              if (!options.continueCompensationOnError) {
                throw err
              }
            }
          }
        })

        await Promise.allSettled(compensationPromises)
      } else {
        // Run compensations sequentially in reverse order
        for (let i = stepsToCompensate.length - 1; i >= 0; i--) {
          const stepResult = stepsToCompensate[stepsToCompensate.length - 1 - i]
          if (!stepResult) continue // Type guard

          const originalIndex = completedSteps.findIndex(s => s.stepName === stepResult.stepName)
          const step = this.steps[originalIndex]
          if (!step) continue // Type guard

          if (step.compensate && stepResult.result !== undefined) {
            try {
              await activityContext.executeOnce(
                `compensate:${step.name}`,
                async () => {
                  await step.compensate!(stepResult.result, sagaError!)
                }
              )
              stepResult.compensated = true

              await historyStore.appendEvent({
                eventType: 'ACTIVITY_COMPLETED',
                attributes: { stepName: `compensate:${step.name}`, compensated: true },
              })
            } catch (compError) {
              const err = compError instanceof Error ? compError : new Error(String(compError))
              compensationErrors.push(err)

              await historyStore.appendEvent({
                eventType: 'ACTIVITY_FAILED',
                attributes: { stepName: `compensate:${step.name}`, error: err.message },
              })

              if (options.continueCompensationOnError === false) {
                break
              }
            }
          }
        }
      }
    }

    const duration = Date.now() - startedAt

    return {
      success: !sagaError,
      result: finalResult,
      error: sagaError ?? undefined,
      steps: completedSteps,
      compensated: sagaError !== null && completedSteps.some(s => s.compensated),
      compensationErrors: compensationErrors.length > 0 ? compensationErrors : undefined,
      duration,
    }
  }

  /**
   * Execute a single step with retry and timeout support.
   */
  private async executeStep(
    step: SagaStep<unknown, unknown>,
    input: unknown,
    stepIndex: number,
    activityContext: ActivityDeduplicationContext,
    historyStore: WorkflowHistoryStore,
    sagaTimeout?: number
  ): Promise<unknown> {
    const retry = step.retry ?? { maxAttempts: 1 }
    const maxAttempts = retry.maxAttempts ?? 1
    let lastError: Error | null = null

    // Record step start
    await historyStore.appendEvent({
      eventType: 'ACTIVITY_STARTED',
      attributes: { stepName: step.name, stepIndex },
    })

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Use deduplication for idempotent execution
        const activityId = `${step.name}:attempt:${attempt}`

        const result = await activityContext.executeOnce(activityId, async () => {
          // Apply timeout if specified
          if (step.timeout || sagaTimeout) {
            const timeout = step.timeout ?? sagaTimeout!
            return this.withTimeout(step.execute(input), timeout, step.name)
          }
          return step.execute(input)
        })

        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (attempt < maxAttempts) {
          // Wait before retry with exponential backoff
          const initialInterval = retry.initialInterval ?? 1000
          const backoffCoefficient = retry.backoffCoefficient ?? 2
          const maxInterval = retry.maxInterval ?? 30000

          const delay = Math.min(
            initialInterval * Math.pow(backoffCoefficient, attempt - 1),
            maxInterval
          )

          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError ?? new Error(`Step ${step.name} failed after ${maxAttempts} attempts`)
  }

  /**
   * Wrap a promise with a timeout.
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, stepName: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new SagaTimeoutError(`Step ${stepName} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    try {
      return await Promise.race([promise, timeoutPromise])
    } finally {
      clearTimeout(timeoutId!)
    }
  }
}

// ============================================================================
// Parallel Saga Support
// ============================================================================

/**
 * Parallel step definition for executing multiple steps concurrently.
 */
export interface ParallelSagaSteps<TInput = unknown, TOutput extends unknown[] = unknown[]> {
  name: string
  steps: SagaStep<TInput, unknown>[]
  compensate?: (results: TOutput, error: Error) => Promise<void>
}

/**
 * Create a parallel saga step that executes multiple steps concurrently.
 *
 * @example
 * ```typescript
 * const saga = new SagaBuilder()
 *   .addStep(parallel({
 *     name: 'parallelReservations',
 *     steps: [
 *       { name: 'reserveInventory', execute: reserveInventory, compensate: releaseInventory },
 *       { name: 'reserveShipping', execute: reserveShipping, compensate: cancelShipping },
 *       { name: 'validateCoupon', execute: validateCoupon },
 *     ],
 *   }))
 *   .build()
 * ```
 */
export function parallel<TInput, TOutput extends unknown[]>(
  config: ParallelSagaSteps<TInput, TOutput>
): SagaStep<TInput, TOutput> {
  return {
    name: config.name,
    async execute(input: TInput): Promise<TOutput> {
      const results = await Promise.all(
        config.steps.map(step => step.execute(input))
      )
      return results as TOutput
    },
    async compensate(results: TOutput, error: Error): Promise<void> {
      if (config.compensate) {
        await config.compensate(results, error)
        return
      }

      // Default: compensate each step in reverse order
      for (let i = config.steps.length - 1; i >= 0; i--) {
        const step = config.steps[i]
        if (!step) continue // Type guard
        if (step.compensate && results[i] !== undefined) {
          await step.compensate(results[i], error)
        }
      }
    },
  }
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when a saga step times out.
 */
export class SagaTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SagaTimeoutError'
  }
}

/**
 * Error thrown when saga compensation fails.
 */
export class SagaCompensationError extends Error {
  constructor(
    message: string,
    public readonly originalError: Error,
    public readonly compensationErrors: Error[]
  ) {
    super(message)
    this.name = 'SagaCompensationError'
  }
}

// ============================================================================
// Distributed Saga Coordinator
// ============================================================================

/**
 * Coordinator for distributed sagas across multiple services.
 * Uses event sourcing for saga state management.
 */
export interface DistributedSagaCoordinator {
  /**
   * Start a new distributed saga.
   */
  start<TInput, TOutput>(
    sagaDefinition: Saga<TInput, TOutput>,
    input: TInput,
    options?: SagaOptions
  ): Promise<SagaHandle<TOutput>>

  /**
   * Resume a saga from a checkpoint.
   */
  resume<TOutput>(sagaId: string): Promise<SagaHandle<TOutput>>

  /**
   * Get the current state of a saga.
   */
  getState(sagaId: string): Promise<SagaState | null>

  /**
   * List all active sagas.
   */
  listActive(): Promise<SagaState[]>
}

/**
 * Handle for a running saga.
 */
export interface SagaHandle<TOutput> {
  sagaId: string
  result(): Promise<SagaResult<TOutput>>
  getState(): Promise<SagaState>
  abort(reason?: string): Promise<void>
}

/**
 * Create a distributed saga coordinator.
 */
export function createDistributedSagaCoordinator(): DistributedSagaCoordinator {
  const sagas = new Map<string, {
    saga: Saga<unknown, unknown>
    state: SagaState
    resultPromise: Promise<SagaResult<unknown>>
    resolve: (result: SagaResult<unknown>) => void
    reject: (error: Error) => void
  }>()

  // Helper function to create a saga handle
  function createHandle<TOutput>(sagaId: string): SagaHandle<TOutput> {
    return {
      sagaId,
      async result(): Promise<SagaResult<TOutput>> {
        const entry = sagas.get(sagaId)
        if (!entry) {
          throw new Error(`Saga ${sagaId} not found`)
        }
        return entry.resultPromise as Promise<SagaResult<TOutput>>
      },
      async getState(): Promise<SagaState> {
        const entry = sagas.get(sagaId)
        if (!entry) {
          throw new Error(`Saga ${sagaId} not found`)
        }
        return { ...entry.state }
      },
      async abort(reason?: string): Promise<void> {
        const entry = sagas.get(sagaId)
        if (!entry) {
          throw new Error(`Saga ${sagaId} not found`)
        }
        entry.state.status = 'FAILED'
        entry.state.error = reason ?? 'Saga aborted'
        entry.state.completedAt = Date.now()
        entry.reject(new Error(reason ?? 'Saga aborted'))
      },
    }
  }

  return {
    async start<TInput, TOutput>(
      sagaDefinition: Saga<TInput, TOutput>,
      input: TInput,
      options: SagaOptions = {}
    ): Promise<SagaHandle<TOutput>> {
      const sagaId = options.sagaId ?? `saga-${Date.now()}-${Math.random().toString(36).slice(2)}`

      const state: SagaState = {
        sagaId,
        status: 'RUNNING',
        currentStepIndex: 0,
        completedSteps: [],
        startedAt: Date.now(),
      }

      let resolve: (result: SagaResult<unknown>) => void
      let reject: (error: Error) => void

      const resultPromise = new Promise<SagaResult<unknown>>((res, rej) => {
        resolve = res
        reject = rej
      })

      sagas.set(sagaId, {
        saga: sagaDefinition as unknown as Saga<unknown, unknown>,
        state,
        resultPromise,
        resolve: resolve!,
        reject: reject!,
      })

      // Execute saga in background
      sagaDefinition.execute(input, { ...options, sagaId })
        .then(result => {
          state.status = result.success ? 'COMPLETED' : 'COMPENSATED'
          state.completedAt = Date.now()
          state.completedSteps = result.steps
          resolve!(result as SagaResult<unknown>)
        })
        .catch(error => {
          state.status = 'FAILED'
          state.completedAt = Date.now()
          state.error = error.message
          reject!(error)
        })

      return createHandle<TOutput>(sagaId)
    },

    async resume<TOutput>(sagaId: string): Promise<SagaHandle<TOutput>> {
      const entry = sagas.get(sagaId)
      if (!entry) {
        throw new Error(`Saga ${sagaId} not found`)
      }
      return createHandle<TOutput>(sagaId)
    },

    async getState(sagaId: string): Promise<SagaState | null> {
      const entry = sagas.get(sagaId)
      return entry?.state ?? null
    },

    async listActive(): Promise<SagaState[]> {
      const active: SagaState[] = []
      for (const [, entry] of sagas) {
        if (entry.state.status === 'RUNNING' || entry.state.status === 'COMPENSATING') {
          active.push({ ...entry.state })
        }
      }
      return active
    },
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create and execute a saga in one call.
 *
 * @example
 * ```typescript
 * const result = await runSaga(
 *   [
 *     {
 *       name: 'step1',
 *       execute: async () => 'done',
 *       compensate: async () => console.log('compensating step1'),
 *     },
 *   ],
 *   undefined, // input
 *   { timeout: 5000 }
 * )
 * ```
 */
export async function runSaga<TInput, TOutput>(
  steps: SagaStep<unknown, unknown>[],
  input: TInput,
  options?: SagaOptions
): Promise<SagaResult<TOutput>> {
  const saga = new Saga<TInput, TOutput>(steps)
  return saga.execute(input, options)
}

/**
 * Create a saga step with automatic retry on transient errors.
 */
export function withRetry<TInput, TOutput>(
  step: SagaStep<TInput, TOutput>,
  retryOptions: {
    maxAttempts?: number
    initialInterval?: number
    backoffCoefficient?: number
    maxInterval?: number
    retryableErrors?: (new (...args: unknown[]) => Error)[]
  }
): SagaStep<TInput, TOutput> {
  return {
    ...step,
    retry: {
      maxAttempts: retryOptions.maxAttempts ?? 3,
      initialInterval: retryOptions.initialInterval ?? 1000,
      backoffCoefficient: retryOptions.backoffCoefficient ?? 2,
      maxInterval: retryOptions.maxInterval ?? 30000,
    },
  }
}

/**
 * Create a saga step with a timeout.
 */
export function withTimeout<TInput, TOutput>(
  step: SagaStep<TInput, TOutput>,
  timeoutMs: number
): SagaStep<TInput, TOutput> {
  return {
    ...step,
    timeout: timeoutMs,
  }
}
