/**
 * Pipe - Request-Response Middleware Pipeline
 *
 * A composable middleware pipeline for stateless request-response operations.
 * Used by HTTP-based compat layers (Stripe, SendGrid, Sentry, etc.)
 */

import type {
  PipeInstance,
  Processor,
  PipeMiddleware,
  BeforeHook,
  AfterHook,
  ErrorHandler,
  RetryPolicy,
  CircuitConfig,
  BatchedPipe,
} from './types'

// Re-export all types for consumers
export type {
  PipeInstance,
  Processor,
  PipeMiddleware,
  BeforeHook,
  AfterHook,
  ErrorHandler,
  RetryPolicy,
  CircuitConfig,
  BatchedPipe,
}

/**
 * Custom error for timeout
 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timeout: operation exceeded ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

/**
 * Custom error for circuit breaker
 */
export class CircuitBreakerError extends Error {
  constructor() {
    super('Circuit breaker is open')
    this.name = 'CircuitBreakerError'
  }
}

/**
 * Circuit breaker state
 */
type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Internal state for a Pipe instance
 */
interface PipeState<TIn, TOut> {
  processor: Processor<TIn, TOut>
  middlewares: PipeMiddleware<TIn, TOut>[]
  beforeHooks: BeforeHook<TIn>[]
  afterHooks: AfterHook<TOut>[]
  errorHandlers: ErrorHandler[]
  retryPolicy?: RetryPolicy
  timeoutMs?: number
  circuitConfig?: CircuitConfig
  // Circuit breaker state (shared across calls)
  circuitState: CircuitState
  failureCount: number
  lastFailureTime: number
}

/**
 * Utility to sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Creates a promise that rejects after a timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new TimeoutError(ms))
    }, ms)

    promise
      .then((result) => {
        clearTimeout(timeoutId)
        resolve(result)
      })
      .catch((error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
  })
}

/**
 * Creates a new Pipe instance with the given processor function
 */
export function Pipe<TIn, TOut>(processor: Processor<TIn, TOut>): PipeInstance<TIn, TOut> {
  const state: PipeState<TIn, TOut> = {
    processor,
    middlewares: [],
    beforeHooks: [],
    afterHooks: [],
    errorHandlers: [],
    // Circuit breaker initial state
    circuitState: 'closed',
    failureCount: 0,
    lastFailureTime: 0,
  }

  /**
   * Compose middleware chain around the processor
   */
  function composeMiddleware(input: TIn): Promise<TOut> {
    let index = 0

    const next = async (currentInput: TIn): Promise<TOut> => {
      if (index < state.middlewares.length) {
        const middleware = state.middlewares[index++]
        return middleware(currentInput, next)
      }
      // All middleware executed, call the processor
      return state.processor(currentInput)
    }

    return next(input)
  }

  /**
   * Call all error handlers
   */
  async function handleError(error: Error): Promise<void> {
    for (const handler of state.errorHandlers) {
      await handler(error)
    }
  }

  /**
   * Check and update circuit breaker state
   */
  function checkCircuit(): void {
    if (!state.circuitConfig) return

    if (state.circuitState === 'open') {
      const timeSinceFailure = Date.now() - state.lastFailureTime
      if (timeSinceFailure >= state.circuitConfig.resetTimeMs) {
        // Transition to half-open
        state.circuitState = 'half-open'
      } else {
        throw new CircuitBreakerError()
      }
    }
  }

  /**
   * Record a successful operation
   */
  function recordSuccess(): void {
    if (!state.circuitConfig) return

    if (state.circuitState === 'half-open') {
      // Success in half-open means we can close the circuit
      state.circuitState = 'closed'
      state.failureCount = 0
    }
  }

  /**
   * Record a failed operation
   */
  function recordFailure(): void {
    if (!state.circuitConfig) return

    state.failureCount++
    state.lastFailureTime = Date.now()

    if (state.circuitState === 'half-open') {
      // Failure in half-open reopens the circuit
      state.circuitState = 'open'
    } else if (state.failureCount >= state.circuitConfig.threshold) {
      // Threshold reached, open the circuit
      state.circuitState = 'open'
    }
  }

  /**
   * Execute the core pipeline (before hooks -> middleware -> processor -> after hooks)
   */
  async function executePipeline(input: TIn): Promise<TOut> {
    // Apply before hooks in order
    let transformedInput = input
    for (const hook of state.beforeHooks) {
      transformedInput = await hook(transformedInput)
    }

    // Execute middleware chain with processor
    let result = await composeMiddleware(transformedInput)

    // Apply after hooks in order
    for (const hook of state.afterHooks) {
      result = await hook(result)
    }

    return result
  }

  /**
   * Execute with retry logic
   */
  async function executeWithRetry(input: TIn): Promise<TOut> {
    const policy = state.retryPolicy

    if (!policy) {
      return executePipeline(input)
    }

    let lastError: Error | undefined
    let attempt = 0

    while (attempt < policy.maxAttempts) {
      attempt++

      try {
        return await executePipeline(input)
      } catch (error) {
        lastError = error as Error

        // Check if we should retry this error
        if (policy.retryOn && !policy.retryOn(lastError)) {
          throw lastError
        }

        // If this was our last attempt, don't delay
        if (attempt >= policy.maxAttempts) {
          break
        }

        // Calculate delay with exponential backoff
        if (policy.delayMs) {
          const multiplier = policy.backoffMultiplier ?? 1
          let delay = policy.delayMs * Math.pow(multiplier, attempt - 1)

          // Cap at maxDelayMs if specified
          if (policy.maxDelayMs) {
            delay = Math.min(delay, policy.maxDelayMs)
          }

          await sleep(delay)
        }
      }
    }

    throw lastError
  }

  /**
   * Execute with timeout
   */
  async function executeWithTimeout(input: TIn): Promise<TOut> {
    const execution = executeWithRetry(input)

    if (state.timeoutMs) {
      return withTimeout(execution, state.timeoutMs)
    }

    return execution
  }

  /**
   * Execute with circuit breaker
   */
  async function executeWithCircuitBreaker(input: TIn): Promise<TOut> {
    // Check circuit state
    checkCircuit()

    try {
      const result = await executeWithTimeout(input)
      recordSuccess()
      return result
    } catch (error) {
      recordFailure()
      throw error
    }
  }

  const instance: PipeInstance<TIn, TOut> = {
    async process(input: TIn): Promise<TOut> {
      try {
        return await executeWithCircuitBreaker(input)
      } catch (error) {
        await handleError(error as Error)
        throw error
      }
    },

    use(middleware: PipeMiddleware<TIn, TOut>) {
      state.middlewares.push(middleware)
      return this
    },

    before(hook: BeforeHook<TIn>) {
      state.beforeHooks.push(hook)
      return this
    },

    after(hook: AfterHook<TOut>) {
      state.afterHooks.push(hook)
      return this
    },

    onError(handler: ErrorHandler) {
      state.errorHandlers.push(handler)
      return this
    },

    retry(policy: RetryPolicy) {
      state.retryPolicy = policy
      return this
    },

    timeout(ms: number) {
      state.timeoutMs = ms
      return this
    },

    batch(size: number): BatchedPipe<TIn[], TOut[]> {
      const pipe = this

      return {
        async process(inputs: TIn[]): Promise<TOut[]> {
          if (inputs.length === 0) {
            return []
          }

          const results: TOut[] = []

          // Process in batches
          for (let i = 0; i < inputs.length; i += size) {
            const batch = inputs.slice(i, i + size)

            // Process batch items concurrently
            const batchResults = await Promise.all(batch.map((input) => pipe.process(input)))

            results.push(...batchResults)
          }

          return results
        },
      }
    },

    circuitBreaker(config: CircuitConfig) {
      state.circuitConfig = config
      return this
    },
  }

  return instance
}
