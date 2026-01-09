/**
 * BaseFunctionExecutor
 *
 * Abstract base class that extracts common execution patterns from:
 * - CodeFunctionExecutor
 * - GenerativeFunctionExecutor
 * - AgenticFunctionExecutor
 * - HumanFunctionExecutor
 *
 * Provides shared functionality for:
 * - Retry logic with configurable backoff strategies
 * - Event emission
 * - State management
 * - Logging
 * - Metrics tracking
 * - Middleware pipeline
 */

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class ExecutionTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionTimeoutError'
  }
}

export class ExecutionCancelledError extends Error {
  constructor(message: string = 'Execution cancelled') {
    super(message)
    this.name = 'ExecutionCancelledError'
  }
}

export class ExecutionRetryExhaustedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionRetryExhaustedError'
  }
}

export class ExecutionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionValidationError'
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface Logger {
  debug: (message: string, data?: unknown) => void
  info: (message: string, data?: unknown) => void
  warn: (message: string, data?: unknown) => void
  error: (message: string, data?: unknown) => void
}

export interface DurableObjectState {
  id: { toString: () => string }
  storage: {
    get: (key: string) => Promise<unknown>
    put: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<boolean>
    list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
  }
}

export interface StateWrapper {
  get: <T>(key: string) => Promise<T | null>
  put: <T>(key: string, value: T) => Promise<void>
  delete: (key: string) => Promise<boolean>
  list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
}

export interface RetryConfig {
  maxAttempts: number
  delay: number
  backoff?: 'fixed' | 'exponential' | 'exponential-jitter' | 'linear'
  increment?: number
  maxDelay?: number
  retryIf?: (error: Error) => boolean
  retryOnTimeout?: boolean
  onRetry?: (info: { attempt: number; delay: number; error: Error }) => void
}

export interface ExecutionMetrics {
  duration: number
  retryCount: number
  memoryUsed?: number
  cpuTime?: number
  tokensUsed?: number
  [key: string]: number | undefined
}

export interface BaseExecutionResult<T = unknown> {
  success: boolean
  result?: T
  error?: Error
  duration: number
  retryCount: number
  metrics: ExecutionMetrics
}

export type EventHandler = (event: string, data: unknown) => void | Promise<void>

// ============================================================================
// MIDDLEWARE TYPES
// ============================================================================

export interface MiddlewareContext<TInput = unknown> {
  functionId: string
  invocationId: string
  functionType: FunctionType
  input: TInput
  startTime: number
  metadata: Record<string, unknown>
}

export type MiddlewareNext<TOutput = unknown> = () => Promise<TOutput>

export type ExecutionMiddleware<TInput = unknown, TOutput = unknown> = (
  ctx: MiddlewareContext<TInput>,
  next: MiddlewareNext<TOutput>
) => Promise<TOutput>

// ============================================================================
// FUNCTION TYPE DISCRIMINATED UNION
// ============================================================================

export type FunctionType = 'code' | 'generative' | 'agentic' | 'human'

export interface BaseFunctionConfig {
  name: string
  description?: string
  timeout?: number
  retries?: RetryConfig
}

export interface CodeFunctionConfig extends BaseFunctionConfig {
  type: 'code'
  handler: (input: unknown, ctx: unknown) => unknown | Promise<unknown>
  sandboxed?: boolean
}

export interface GenerativeFunctionConfig extends BaseFunctionConfig {
  type: 'generative'
  model: string
  prompt: string | ((input: unknown) => string)
  temperature?: number
  maxTokens?: number
  schema?: Record<string, unknown>
}

export interface AgenticFunctionConfig extends BaseFunctionConfig {
  type: 'agentic'
  model: string
  tools: string[]
  goal: string
  maxIterations?: number
  systemPrompt?: string
}

export interface HumanFunctionConfig extends BaseFunctionConfig {
  type: 'human'
  channel: string
  prompt: string | ((input: unknown) => string)
  actions?: string[]
  form?: Record<string, unknown>
}

export type FunctionConfig =
  | CodeFunctionConfig
  | GenerativeFunctionConfig
  | AgenticFunctionConfig
  | HumanFunctionConfig

// Type guards for discriminated unions
export function isCodeFunction(config: FunctionConfig): config is CodeFunctionConfig {
  return config.type === 'code'
}

export function isGenerativeFunction(config: FunctionConfig): config is GenerativeFunctionConfig {
  return config.type === 'generative'
}

export function isAgenticFunction(config: FunctionConfig): config is AgenticFunctionConfig {
  return config.type === 'agentic'
}

export function isHumanFunction(config: FunctionConfig): config is HumanFunctionConfig {
  return config.type === 'human'
}

// ============================================================================
// BASE EXECUTOR OPTIONS
// ============================================================================

export interface BaseExecutorOptions {
  state: DurableObjectState
  env: Record<string, unknown>
  logger?: Logger
  onEvent?: EventHandler
  middleware?: ExecutionMiddleware[]
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function generateInvocationId(): string {
  return crypto.randomUUID()
}

export function calculateDelay(attempt: number, config: RetryConfig): number {
  let delay: number

  switch (config.backoff) {
    case 'exponential':
      delay = config.delay * Math.pow(2, attempt)
      break
    case 'exponential-jitter': {
      const baseDelay = config.delay * Math.pow(2, attempt)
      delay = baseDelay * (0.5 + Math.random())
      break
    }
    case 'linear':
      delay = config.delay + (config.increment || 0) * attempt
      break
    case 'fixed':
    default:
      delay = config.delay
      break
  }

  if (config.maxDelay !== undefined && delay > config.maxDelay) {
    delay = config.maxDelay
  }

  return delay
}

export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  if (error === null) {
    return new Error('null error thrown')
  }
  if (error === undefined) {
    return new Error('undefined error thrown')
  }
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>
    const message = typeof obj.message === 'string' ? obj.message : JSON.stringify(error)
    return new Error(message)
  }
  return new Error(String(error))
}

// ============================================================================
// BASE FUNCTION EXECUTOR
// ============================================================================

export abstract class BaseFunctionExecutor<TOptions extends BaseExecutorOptions> {
  protected state: DurableObjectState
  protected env: Record<string, unknown>
  protected logger: Logger
  protected onEvent?: EventHandler
  protected middleware: ExecutionMiddleware[]

  // Default timeout is 30 seconds
  protected static DEFAULT_TIMEOUT = 30000

  constructor(options: TOptions) {
    this.state = options.state
    this.env = options.env
    this.logger = options.logger || {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    }
    this.onEvent = options.onEvent
    this.middleware = options.middleware || []
  }

  // ============================================================================
  // ABSTRACT METHODS - Must be implemented by subclasses
  // ============================================================================

  /**
   * Get the function type for this executor
   */
  abstract getFunctionType(): FunctionType

  /**
   * Execute the core function logic (without middleware)
   */
  protected abstract executeCore<TInput, TOutput>(
    input: TInput,
    options: Record<string, unknown>
  ): Promise<TOutput>

  // ============================================================================
  // SHARED METHODS
  // ============================================================================

  /**
   * Create a state wrapper for accessing DO storage
   */
  protected createStateWrapper(): StateWrapper {
    return {
      get: async <T>(key: string): Promise<T | null> => {
        const value = await this.state.storage.get(key)
        return (value as T) ?? null
      },
      put: async <T>(key: string, value: T): Promise<void> => {
        await this.state.storage.put(key, value)
      },
      delete: async (key: string): Promise<boolean> => {
        return this.state.storage.delete(key)
      },
      list: async (opts?: { prefix?: string }): Promise<Map<string, unknown>> => {
        return this.state.storage.list(opts)
      },
    }
  }

  /**
   * Emit an event through the event handler
   */
  protected async emit(event: string, data: unknown): Promise<void> {
    if (this.onEvent) {
      await this.onEvent(event, data)
    }
  }

  /**
   * Execute a function with retry logic
   */
  protected async executeWithRetry<T>(
    fn: () => Promise<T>,
    config: RetryConfig,
    signal?: AbortSignal
  ): Promise<{ result: T; retryCount: number }> {
    let lastError: Error | null = null
    let retryCount = 0

    for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
      // Check cancellation
      if (signal?.aborted) {
        throw new ExecutionCancelledError()
      }

      try {
        const result = await fn()
        return { result, retryCount }
      } catch (error) {
        lastError = normalizeError(error)

        // Check if we should retry
        if (attempt < config.maxAttempts - 1) {
          // Check custom retry condition
          if (config.retryIf && !config.retryIf(lastError)) {
            break
          }

          // Check if timeout error and retryOnTimeout is false
          if (lastError instanceof ExecutionTimeoutError && config.retryOnTimeout === false) {
            break
          }

          retryCount++
          const delay = calculateDelay(attempt, config)

          // Emit retry event
          await this.emit('function.retry', {
            attempt: attempt + 1,
            error: lastError.message,
            delay,
          })

          // Call onRetry callback
          config.onRetry?.({
            attempt: attempt + 1,
            delay,
            error: lastError,
          })

          await sleep(delay)
        }
      }
    }

    // All retries exhausted
    if (config.maxAttempts > 1) {
      throw new ExecutionRetryExhaustedError(
        `All ${config.maxAttempts} retry attempts exhausted. Last error: ${lastError?.message}`
      )
    }

    throw lastError || new Error('Unknown error')
  }

  /**
   * Execute with timeout
   */
  protected async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    signal?: AbortSignal
  ): Promise<T> {
    const controller = new AbortController()

    // Link external signal
    if (signal) {
      signal.addEventListener('abort', () => {
        controller.abort(signal.reason || 'Execution cancelled')
      })
    }

    // Set up timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        controller.abort(`Execution timed out after ${timeout}ms`)
      }, timeout)
    }

    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          const handleAbort = () => {
            const rawReason = controller.signal.reason
            const reason = typeof rawReason === 'string' ? rawReason : String(rawReason || 'Execution cancelled')
            if (reason.includes('timed out')) {
              reject(new ExecutionTimeoutError(reason))
            } else {
              reject(new ExecutionCancelledError(reason))
            }
          }

          if (controller.signal.aborted) {
            handleAbort()
            return
          }
          controller.signal.addEventListener('abort', handleAbort)
        }),
      ])
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  /**
   * Apply middleware pipeline
   */
  protected async applyMiddleware<TInput, TOutput>(
    ctx: MiddlewareContext<TInput>,
    coreFn: () => Promise<TOutput>
  ): Promise<TOutput> {
    if (this.middleware.length === 0) {
      return coreFn()
    }

    // Build middleware chain
    let index = -1

    const dispatch = async (i: number): Promise<TOutput> => {
      if (i <= index) {
        throw new Error('next() called multiple times')
      }
      index = i

      if (i >= this.middleware.length) {
        return coreFn()
      }

      const middleware = this.middleware[i] as ExecutionMiddleware<TInput, TOutput>
      return middleware(ctx, () => dispatch(i + 1))
    }

    return dispatch(0)
  }

  /**
   * Add middleware to the executor
   */
  public use(middleware: ExecutionMiddleware): this {
    this.middleware.push(middleware)
    return this
  }

  /**
   * Create execution context for middleware
   */
  protected createMiddlewareContext<TInput>(
    functionId: string,
    invocationId: string,
    input: TInput,
    metadata: Record<string, unknown> = {}
  ): MiddlewareContext<TInput> {
    return {
      functionId,
      invocationId,
      functionType: this.getFunctionType(),
      input,
      startTime: Date.now(),
      metadata,
    }
  }

  /**
   * Interpolate template variables in a string
   */
  protected interpolateTemplate(
    template: string,
    variables: Record<string, unknown>
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = variables[key]
      return value !== undefined ? String(value) : `{{${key}}}`
    })
  }

  /**
   * Estimate current memory usage
   */
  protected estimateMemoryUsage(): number {
    if (
      typeof globalThis !== 'undefined' &&
      'performance' in globalThis &&
      (globalThis.performance as { memory?: { usedJSHeapSize: number } }).memory
    ) {
      return (globalThis.performance as { memory: { usedJSHeapSize: number } })
        .memory.usedJSHeapSize
    }
    return 1024 * 1024 // 1MB placeholder
  }

  /**
   * Get DO ID as string
   */
  protected getDOId(): string {
    return this.state.id.toString()
  }
}

export default BaseFunctionExecutor
