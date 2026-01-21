/**
 * Saga Pattern - Cross-DO Transaction Coordination
 *
 * Implements the Saga pattern for managing distributed transactions across
 * multiple Durable Objects. Each saga consists of a sequence of steps,
 * where each step has an execute action and a compensating action.
 *
 * If any step fails, all previously completed steps are compensated
 * (rolled back) in reverse order.
 *
 * @example
 * ```ts
 * const orderSaga = createSaga<OrderContext>({
 *   name: 'create-order',
 *   steps: [
 *     {
 *       name: 'reserve-inventory',
 *       execute: async (ctx) => {
 *         await $.Inventory(ctx.productId).reserve(ctx.quantity)
 *         return { ...ctx, inventoryReserved: true }
 *       },
 *       compensate: async (ctx) => {
 *         await $.Inventory(ctx.productId).release(ctx.quantity)
 *       },
 *     },
 *     {
 *       name: 'charge-payment',
 *       execute: async (ctx) => {
 *         await $.Payment(ctx.customerId).charge(ctx.amount)
 *         return { ...ctx, paymentCharged: true }
 *       },
 *       compensate: async (ctx) => {
 *         await $.Payment(ctx.customerId).refund(ctx.amount)
 *       },
 *     },
 *   ],
 * })
 *
 * const result = await executeSaga(orderSaga, { productId: 'p-1', quantity: 5, ... })
 * ```
 *
 * @module do/workflow/saga
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A single step in a saga with execute and compensate actions.
 */
export interface SagaStep<T> {
  /** Unique name for the step */
  name: string
  /**
   * Execute the step action.
   * Returns the updated context to pass to the next step.
   */
  execute: (context: T) => Promise<T>
  /**
   * Compensate (rollback) the step.
   * Called with the context at the time of failure.
   */
  compensate: (context: T) => Promise<void>
  /** Optional timeout in milliseconds for the step */
  timeout?: number
  /** Optional number of retries before giving up */
  retries?: number
  /** Optional delay between retries in milliseconds */
  retryDelay?: number
}

/**
 * Configuration for creating a saga.
 */
export interface SagaConfig<T> {
  /** Unique name for the saga */
  name: string
  /** Ordered sequence of steps to execute */
  steps: SagaStep<T>[]
  /** Optional callback when a step completes successfully */
  onStepComplete?: (step: string, duration: number) => void
  /** Optional callback when a step is compensated */
  onCompensate?: (step: string) => void
}

/**
 * A saga definition with steps and metadata.
 */
export interface Saga<T> {
  /** Unique name for the saga */
  name: string
  /** Ordered sequence of steps to execute */
  steps: SagaStep<T>[]
  /** Optional callback when a step completes successfully */
  onStepComplete?: (step: string, duration: number) => void
  /** Optional callback when a step is compensated */
  onCompensate?: (step: string) => void
}

/**
 * Status of a saga execution.
 */
export type SagaStatus = 'pending' | 'running' | 'completed' | 'compensated' | 'compensation_failed'

/**
 * Error that occurred during compensation.
 */
export interface CompensationError {
  /** Step that failed to compensate */
  step: string
  /** The error that occurred */
  error: Error
}

/**
 * Result of saga execution.
 */
export interface SagaResult<T> {
  /** Unique ID for this saga execution */
  sagaId: string
  /** Name of the saga */
  sagaName: string
  /** Final status of the saga */
  status: SagaStatus
  /** Final context after execution (or at failure point) */
  context: T
  /** Steps that completed successfully */
  completedSteps: string[]
  /** Step that failed (if any) */
  failedStep?: string
  /** Error that caused failure (if any) */
  error?: SagaError
  /** Errors that occurred during compensation (if any) */
  compensationErrors?: CompensationError[]
  /** Timestamp when saga started */
  startedAt: number
  /** Timestamp when saga completed */
  completedAt?: number
  /** Duration in milliseconds */
  duration?: number
  /**
   * Export the result to a persistable state object.
   */
  toState(): SagaState<T>
}

/**
 * Persistable state of a saga execution.
 * Can be stored and used for manual compensation later.
 */
export interface SagaState<T> {
  /** Name of the saga */
  sagaName: string
  /** Status of the saga */
  status: SagaStatus
  /** Steps that completed */
  completedSteps: string[]
  /** Context at the time of persistence */
  context: T
  /** Timestamp when started */
  startedAt: number
  /** Timestamp when completed */
  completedAt?: number
  /** Error message if failed */
  errorMessage?: string
  /** Failed step name if any */
  failedStep?: string
}

/**
 * Error thrown during saga execution.
 */
export class SagaError extends Error {
  /** Name of the saga */
  readonly saga: string
  /** Step that failed */
  readonly step: string
  /** Original error */
  readonly cause: Error

  constructor(saga: string, step: string, cause: Error) {
    super(`Saga "${saga}" failed at step "${step}": ${cause.message}`)
    this.name = 'SagaError'
    this.saga = saga
    this.step = step
    this.cause = cause
  }
}

// ============================================================================
// SAGA CREATION
// ============================================================================

/**
 * Create a new saga from configuration.
 *
 * @param config - Saga configuration with name and steps
 * @returns A saga definition that can be executed
 * @throws Error if configuration is invalid
 *
 * @example
 * ```ts
 * const saga = createSaga<MyContext>({
 *   name: 'my-saga',
 *   steps: [
 *     { name: 'step-1', execute: ..., compensate: ... },
 *     { name: 'step-2', execute: ..., compensate: ... },
 *   ],
 * })
 * ```
 */
export function createSaga<T>(config: SagaConfig<T>): Saga<T> {
  // Validate: at least one step required
  if (!config.steps || config.steps.length === 0) {
    throw new Error('Saga must have at least one step')
  }

  // Validate: unique step names
  const stepNames = new Set<string>()
  for (const step of config.steps) {
    if (stepNames.has(step.name)) {
      throw new Error(`Duplicate step name: ${step.name}`)
    }
    stepNames.add(step.name)
  }

  return {
    name: config.name,
    steps: config.steps,
    onStepComplete: config.onStepComplete,
    onCompensate: config.onCompensate,
  }
}

// ============================================================================
// SAGA EXECUTION
// ============================================================================

/**
 * Generate a unique saga execution ID.
 */
function generateSagaId(): string {
  return `saga-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Execute a step with optional timeout.
 */
async function executeStepWithTimeout<T>(
  step: SagaStep<T>,
  context: T
): Promise<T> {
  const { execute, timeout } = step

  if (timeout === undefined) {
    return execute(context)
  }

  return Promise.race([
    execute(context),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Step "${step.name}" timed out after ${timeout}ms`)), timeout)
    ),
  ])
}

/**
 * Execute a step with retries.
 */
async function executeStepWithRetry<T>(
  step: SagaStep<T>,
  context: T
): Promise<T> {
  const { retries = 0, retryDelay = 100 } = step
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await executeStepWithTimeout(step, context)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, retryDelay))
      }
    }
  }

  throw lastError
}

/**
 * Execute all compensation steps in reverse order.
 */
async function executeCompensations<T>(
  saga: Saga<T>,
  completedSteps: string[],
  context: T
): Promise<CompensationError[]> {
  const errors: CompensationError[] = []

  // Compensate in reverse order
  for (let i = completedSteps.length - 1; i >= 0; i--) {
    const stepName = completedSteps[i]
    const step = saga.steps.find((s) => s.name === stepName)

    if (step) {
      try {
        await step.compensate(context)
        saga.onCompensate?.(stepName)
      } catch (error) {
        errors.push({
          step: stepName,
          error: error instanceof Error ? error : new Error(String(error)),
        })
      }
    }
  }

  return errors
}

/**
 * Execute a saga with the given initial context.
 *
 * The saga will execute each step in order, passing the updated context
 * between steps. If any step fails, all previously completed steps will
 * be compensated in reverse order.
 *
 * @param saga - The saga to execute
 * @param initialContext - The initial context to start with
 * @returns Result of the saga execution
 *
 * @example
 * ```ts
 * const result = await executeSaga(orderSaga, {
 *   orderId: 'ord-123',
 *   customerId: 'cust-456',
 *   items: ['item-1'],
 *   total: 100,
 * })
 *
 * if (result.status === 'completed') {
 *   console.log('Order created successfully')
 * } else if (result.status === 'compensated') {
 *   console.log(`Order failed at step: ${result.failedStep}`)
 * }
 * ```
 */
export async function executeSaga<T>(
  saga: Saga<T>,
  initialContext: T
): Promise<SagaResult<T>> {
  const sagaId = generateSagaId()
  const startedAt = Date.now()
  const completedSteps: string[] = []
  let context = initialContext
  let failedStep: string | undefined
  let error: SagaError | undefined
  let compensationErrors: CompensationError[] | undefined

  // Execute steps in order
  for (const step of saga.steps) {
    const stepStartTime = Date.now()

    try {
      context = await executeStepWithRetry(step, context)
      completedSteps.push(step.name)

      const stepDuration = Date.now() - stepStartTime
      saga.onStepComplete?.(step.name, stepDuration)
    } catch (err) {
      // Step failed - record and initiate compensation
      failedStep = step.name
      error = new SagaError(
        saga.name,
        step.name,
        err instanceof Error ? err : new Error(String(err))
      )

      // Compensate all completed steps
      compensationErrors = await executeCompensations(saga, completedSteps, context)
      break
    }
  }

  const completedAt = Date.now()
  const duration = completedAt - startedAt

  // Determine final status
  let status: SagaStatus
  if (!failedStep) {
    status = 'completed'
  } else if (compensationErrors && compensationErrors.length > 0) {
    status = 'compensation_failed'
  } else {
    status = 'compensated'
  }

  return {
    sagaId,
    sagaName: saga.name,
    status,
    context,
    completedSteps,
    failedStep,
    error,
    compensationErrors: compensationErrors && compensationErrors.length > 0 ? compensationErrors : undefined,
    startedAt,
    completedAt,
    duration,
    toState(): SagaState<T> {
      return {
        sagaName: saga.name,
        status,
        completedSteps,
        context,
        startedAt,
        completedAt,
        errorMessage: error?.message,
        failedStep,
      }
    },
  }
}

/**
 * Manually compensate a saga from a saved state.
 *
 * This is useful for scenarios where you need to rollback a saga
 * after it has been persisted (e.g., after a system restart or
 * for administrative purposes).
 *
 * @param saga - The saga definition
 * @param state - The saved state of the saga execution
 * @returns Array of compensation errors (empty if all succeeded)
 *
 * @example
 * ```ts
 * // Load saved saga state from storage
 * const savedState = await storage.get('saga:order-123')
 *
 * // Compensate the saga
 * const errors = await compensateSaga(orderSaga, savedState)
 * if (errors.length > 0) {
 *   console.error('Some compensations failed:', errors)
 * }
 * ```
 */
export async function compensateSaga<T>(
  saga: Saga<T>,
  state: SagaState<T>
): Promise<CompensationError[]> {
  return executeCompensations(saga, state.completedSteps, state.context)
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

/**
 * Check if a saga result indicates success.
 */
export function isSagaSuccess<T>(result: SagaResult<T>): boolean {
  return result.status === 'completed'
}

/**
 * Check if a saga result indicates failure with successful compensation.
 */
export function isSagaCompensated<T>(result: SagaResult<T>): boolean {
  return result.status === 'compensated'
}

/**
 * Check if a saga result indicates failure with failed compensation.
 */
export function isSagaCompensationFailed<T>(result: SagaResult<T>): boolean {
  return result.status === 'compensation_failed'
}
