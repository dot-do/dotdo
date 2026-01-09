/**
 * CodeFunctionExecutor
 *
 * Executes TypeScript/JavaScript handlers in a controlled environment with:
 * - Context injection (env, state, services, logging, events)
 * - Sandboxed execution (restricted globals)
 * - Timeout handling and cancellation
 * - Retry logic with configurable backoff strategies
 * - Streaming output support
 * - Resource limits (memory, CPU time, output size)
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

export class ExecutionSandboxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionSandboxError'
  }
}

export class ExecutionResourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionResourceError'
  }
}

export class ExecutionRetryExhaustedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionRetryExhaustedError'
  }
}

export class ExecutionCancelledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionCancelledError'
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

export interface ExecutionContext {
  functionId: string
  invocationId: string
  env: Record<string, string>
  state: {
    get: <T>(key: string) => Promise<T | null>
    put: <T>(key: string, value: T) => Promise<void>
    delete: (key: string) => Promise<boolean>
    list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
  }
  services: {
    ai: {
      generate: (opts: { model: string; prompt: string }) => Promise<{ text: string }>
    }
    kv: {
      get: (key: string) => Promise<string | null>
      put: (key: string, value: string) => Promise<void>
    }
    db: {
      query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
    }
    queue: {
      send: (message: unknown) => Promise<void>
    }
    fetch: (url: string, init?: RequestInit) => Promise<Response>
  }
  log: {
    debug: (message: string, data?: unknown) => void
    info: (message: string, data?: unknown) => void
    warn: (message: string, data?: unknown) => void
    error: (message: string, data?: unknown) => void
  }
  emit: (event: string, data: unknown) => Promise<void>
  signal: AbortSignal
}

export interface ExecutionResult<T = unknown> {
  success: boolean
  result?: T
  error?: Error & { code?: string; details?: Record<string, unknown> }
  duration: number
  retryCount: number
  metrics: {
    memoryUsed?: number
    cpuTime?: number
  }
}

export interface ResourceLimits {
  maxMemory?: number
  maxCpuTime?: number
  maxOutputSize?: number
  maxRecursionDepth?: number
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

export interface StreamOutput {
  type: 'chunk' | 'result'
  data?: string
  sequence?: number
  value?: unknown
}

export interface JSONSchema {
  type?: string
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
  [key: string]: unknown
}

export interface ExecutionOptions {
  functionId?: string
  timeout?: number
  sandboxed?: boolean
  exposeEnv?: string[]
  retry?: RetryConfig
  signal?: AbortSignal
  streaming?: boolean
  resourceLimits?: ResourceLimits
  inputSchema?: JSONSchema
  outputSchema?: JSONSchema
  waitForPromises?: boolean
}

export interface Logger {
  debug: (message: string, data?: unknown) => void
  info: (message: string, data?: unknown) => void
  warn: (message: string, data?: unknown) => void
  error: (message: string, data?: unknown) => void
}

export interface CodeFunctionExecutorOptions {
  state: DurableObjectState
  env: Record<string, string>
  services: {
    ai: {
      generate: (opts: { model: string; prompt: string }) => Promise<{ text: string }>
    }
    kv: {
      get: (key: string) => Promise<string | null>
      put: (key: string, value: string) => Promise<void>
    }
    db: {
      query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
    }
    queue: {
      send: (message: unknown) => Promise<void>
    }
    fetch: (url: string, init?: RequestInit) => Promise<Response>
  }
  logger?: Logger
  onEvent?: (event: string, data: unknown) => void | Promise<void>
}

// DurableObjectState interface
interface DurableObjectState {
  id: { toString: () => string }
  storage: {
    get: (key: string) => Promise<unknown>
    put: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<boolean>
    list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
  }
}

type Handler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  ctx: ExecutionContext
) => TOutput | Promise<TOutput>

// ============================================================================
// STREAMING ASYNC ITERATOR
// ============================================================================

class ExecutionStream implements AsyncIterable<StreamOutput> {
  private chunks: StreamOutput[] = []
  private resolvers: Array<(value: IteratorResult<StreamOutput>) => void> = []
  private done = false
  private cancelled = false
  private cancelCallback?: () => void
  private _result: StreamOutput | null = null
  private resultPushedToIteration = false

  push(chunk: StreamOutput): void {
    if (this.cancelled || this.done) return

    // Store result for later access via .result property
    if (chunk.type === 'result') {
      this._result = chunk
    }

    // Push all chunks to iteration (both data and result)
    if (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!
      resolver({ value: chunk, done: false })
    } else {
      this.chunks.push(chunk)
    }
  }

  finish(): void {
    this.done = true
    // Don't push result to waiters - just signal done
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!
      resolver({ value: undefined as unknown as StreamOutput, done: true })
    }
  }

  cancel(): void {
    this.cancelled = true
    this.cancelCallback?.()
    this.finish()
  }

  setCancelCallback(cb: () => void): void {
    this.cancelCallback = cb
  }

  [Symbol.asyncIterator](): AsyncIterator<StreamOutput> {
    return {
      next: (): Promise<IteratorResult<StreamOutput>> => {
        if (this.cancelled) {
          return Promise.resolve({ value: undefined as unknown as StreamOutput, done: true })
        }
        if (this.chunks.length > 0) {
          return Promise.resolve({ value: this.chunks.shift()!, done: false })
        }
        if (this.done) {
          return Promise.resolve({ value: undefined as unknown as StreamOutput, done: true })
        }
        return new Promise<IteratorResult<StreamOutput>>((resolve) => {
          this.resolvers.push(resolve)
        })
      },
    }
  }

  async toArray(): Promise<StreamOutput[]> {
    const result: StreamOutput[] = []
    for await (const chunk of this) {
      result.push(chunk)
    }
    return result
  }

  /**
   * Get the final result after streaming is complete
   */
  get result(): StreamOutput | null {
    return this._result
  }
}

// ============================================================================
// JSON SCHEMA VALIDATION
// ============================================================================

function validateJsonSchema(data: unknown, schema: JSONSchema): boolean {
  if (!schema.type) return true

  switch (schema.type) {
    case 'object': {
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return false
      }
      const obj = data as Record<string, unknown>
      // Check required fields
      if (schema.required) {
        for (const field of schema.required) {
          if (!(field in obj)) {
            return false
          }
        }
      }
      // Check property types
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in obj && !validateJsonSchema(obj[key], propSchema)) {
            return false
          }
        }
      }
      return true
    }
    case 'array':
      if (!Array.isArray(data)) return false
      if (schema.items) {
        return data.every((item) => validateJsonSchema(item, schema.items!))
      }
      return true
    case 'string':
      return typeof data === 'string'
    case 'number':
      return typeof data === 'number'
    case 'integer':
      return typeof data === 'number' && Number.isInteger(data)
    case 'boolean':
      return typeof data === 'boolean'
    case 'null':
      return data === null
    default:
      return true
  }
}

// ============================================================================
// SANDBOX UTILITIES
// ============================================================================

const RESTRICTED_GLOBALS = new Set([
  'require',
  'process',
  'global',
  'globalThis',
  'eval',
  'Function',
])

const ALLOWED_GLOBALS = new Set([
  'console',
  'JSON',
  'Math',
  'Date',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Promise',
  'Set',
  'Map',
  'WeakSet',
  'WeakMap',
  'Symbol',
  'Proxy',
  'Reflect',
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'RegExp',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURI',
  'decodeURI',
  'encodeURIComponent',
  'decodeURIComponent',
  'Uint8Array',
  'Int8Array',
  'Uint16Array',
  'Int16Array',
  'Uint32Array',
  'Int32Array',
  'Float32Array',
  'Float64Array',
  'ArrayBuffer',
  'DataView',
  'TextEncoder',
  'TextDecoder',
  'URL',
  'URLSearchParams',
  'Response',
  'Request',
  'Headers',
  'fetch',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'queueMicrotask',
  'atob',
  'btoa',
  'crypto',
  'AbortController',
  'AbortSignal',
])

function createSandboxedConsole(logger: Logger): Console {
  return {
    log: (...args: unknown[]) => logger.info(args.map(String).join(' ')),
    info: (...args: unknown[]) => logger.info(args.map(String).join(' ')),
    warn: (...args: unknown[]) => logger.warn(args.map(String).join(' ')),
    error: (...args: unknown[]) => logger.error(args.map(String).join(' ')),
    debug: (...args: unknown[]) => logger.debug(args.map(String).join(' ')),
    // Minimal console implementation
    assert: () => {},
    clear: () => {},
    count: () => {},
    countReset: () => {},
    dir: () => {},
    dirxml: () => {},
    group: () => {},
    groupCollapsed: () => {},
    groupEnd: () => {},
    table: () => {},
    time: () => {},
    timeEnd: () => {},
    timeLog: () => {},
    trace: () => {},
  } as unknown as Console
}

// ============================================================================
// BACKOFF STRATEGIES
// ============================================================================

function calculateDelay(
  attempt: number,
  config: RetryConfig
): number {
  let delay: number

  switch (config.backoff) {
    case 'exponential':
      delay = config.delay * Math.pow(2, attempt)
      break
    case 'exponential-jitter': {
      const baseDelay = config.delay * Math.pow(2, attempt)
      // Add random jitter of 0-100% of base delay
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

  // Apply max delay cap
  if (config.maxDelay !== undefined && delay > config.maxDelay) {
    delay = config.maxDelay
  }

  return delay
}

// ============================================================================
// RESOURCE MEASUREMENT
// ============================================================================

function measureOutputSize(output: unknown): number {
  try {
    return JSON.stringify(output).length
  } catch {
    return 0
  }
}

// ============================================================================
// CODE FUNCTION EXECUTOR
// ============================================================================

export class CodeFunctionExecutor {
  private state: DurableObjectState
  private env: Record<string, string>
  private services: CodeFunctionExecutorOptions['services']
  private logger: Logger
  private onEvent?: (event: string, data: unknown) => void | Promise<void>

  // Default timeout is 30 seconds
  private static DEFAULT_TIMEOUT = 30000
  // Default memory limit is 128MB
  private static DEFAULT_MEMORY_LIMIT = 128 * 1024 * 1024
  // Default output size limit is 10MB
  private static DEFAULT_OUTPUT_SIZE_LIMIT = 10 * 1024 * 1024

  constructor(options: CodeFunctionExecutorOptions) {
    this.state = options.state
    this.env = options.env
    this.services = options.services
    this.logger = options.logger || {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    }
    this.onEvent = options.onEvent
  }

  /**
   * Execute a handler function with full context and options
   */
  async execute<TInput = unknown, TOutput = unknown>(
    handler: Handler<TInput, TOutput>,
    input: TInput,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult<TOutput>> {
    const startTime = Date.now()
    const invocationId = crypto.randomUUID()
    const functionId = options.functionId || 'anonymous'
    let retryCount = 0
    let streamSequence = 0

    // Check if signal is already aborted
    if (options.signal?.aborted) {
      return {
        success: false,
        error: new ExecutionCancelledError(
          options.signal.reason ? String(options.signal.reason) : 'Execution cancelled'
        ),
        duration: 0,
        retryCount: 0,
        metrics: {},
      }
    }

    // Validate input if schema provided
    if (options.inputSchema && !validateJsonSchema(input, options.inputSchema)) {
      return {
        success: false,
        error: new ExecutionValidationError('Invalid input: validation failed'),
        duration: Date.now() - startTime,
        retryCount: 0,
        metrics: {},
      }
    }

    const timeout = options.timeout ?? CodeFunctionExecutor.DEFAULT_TIMEOUT

    // Emit stream.start if streaming mode
    if (options.streaming) {
      await this.onEvent?.('stream.start', { invocationId })
    }

    const maxAttempts = options.retry?.maxAttempts || 1
    let lastError: Error | null = null
    let cpuTimeStart = Date.now()
    let attemptNumber = 0
    let currentTimeoutController: AbortController | null = null

    while (attemptNumber < maxAttempts) {
      attemptNumber++
      const attemptStart = Date.now()
      cpuTimeStart = attemptStart

      // Create fresh abort controller for each attempt
      const timeoutController = new AbortController()
      currentTimeoutController = timeoutController

      // Link external signal to our controller
      if (options.signal) {
        if (options.signal.aborted) {
          // External signal was aborted between retries
          return {
            success: false,
            error: new ExecutionCancelledError(
              options.signal.reason ? String(options.signal.reason) : 'Execution cancelled'
            ),
            duration: Date.now() - startTime,
            retryCount: attemptNumber - 1,
            metrics: {},
          }
        }
        options.signal.addEventListener('abort', () => {
          timeoutController.abort(options.signal!.reason || 'Execution cancelled')
        }, { once: true })
      }

      // Set up timeout (if not 0)
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          timeoutController.abort(`Execution timeout after ${timeout}ms`)
        }, timeout)
      }

      // Build context with fresh signal
      const context = this.createContext(
        functionId,
        invocationId,
        options,
        timeoutController.signal,
        () => streamSequence++
      )

      try {
        let result: TOutput
        let cpuTimeFromExec = 0

        if (options.sandboxed !== false) {
          const execResult = await this.executeInSandbox(
            handler,
            input,
            context,
            options,
            timeoutController.signal
          )
          result = execResult.result
          cpuTimeFromExec = execResult.cpuTime
        } else {
          const execResult = await this.executeUnsandboxed(
            handler,
            input,
            context,
            timeoutController.signal
          )
          result = execResult.result
          cpuTimeFromExec = execResult.cpuTime
        }

        // Clear timeout on success
        if (timeoutId) clearTimeout(timeoutId)

        // Validate output if schema provided
        if (options.outputSchema && !validateJsonSchema(result, options.outputSchema)) {
          throw new ExecutionValidationError('Invalid output: validation failed')
        }

        // Check output size
        const outputSize = measureOutputSize(result)
        const maxOutputSize =
          options.resourceLimits?.maxOutputSize ||
          CodeFunctionExecutor.DEFAULT_OUTPUT_SIZE_LIMIT
        if (outputSize > maxOutputSize) {
          throw new ExecutionResourceError(
            `Output size ${outputSize} exceeded limit ${maxOutputSize}`
          )
        }

        // Emit stream.end if streaming mode
        if (options.streaming) {
          await this.onEvent?.('stream.end', {
            invocationId,
            totalChunks: streamSequence,
          })
        }

        // retryCount is number of retries (attempts - 1, but 0 if no retries occurred)
        retryCount = attemptNumber > 1 ? attemptNumber - 1 : 0

        return {
          success: true,
          result,
          duration: Date.now() - startTime,
          retryCount,
          metrics: {
            memoryUsed: this.estimateMemoryUsage(),
            cpuTime: Math.round(cpuTimeFromExec),
          },
        }
      } catch (error) {
        // Clear timeout on error before processing
        if (timeoutId) clearTimeout(timeoutId)

        lastError = this.normalizeError(error)

        // If signal was aborted and error is not already ExecutionCancelledError/ExecutionTimeoutError,
        // convert it to appropriate error type
        if (timeoutController.signal.aborted) {
          if (!(lastError instanceof ExecutionCancelledError) && !(lastError instanceof ExecutionTimeoutError)) {
            const rawReason = timeoutController.signal.reason
            const reason = typeof rawReason === 'string' ? rawReason : String(rawReason || 'Execution cancelled')
            if (reason.includes('timeout')) {
              lastError = new ExecutionTimeoutError(reason)
            } else {
              lastError = new ExecutionCancelledError(reason)
            }
          }
        }

        // Check if we should retry (attemptNumber is 1-indexed, so compare with maxAttempts)
        const shouldRetry = this.shouldRetry(lastError, attemptNumber - 1, maxAttempts, options)

        if (shouldRetry && attemptNumber < maxAttempts) {
          // Calculate delay for retry (attempt 1 failed -> retry 1 uses delay index 0)
          const delayIndex = attemptNumber - 1
          const delay = calculateDelay(delayIndex, options.retry!)

          // Emit retry event (attempt is the retry number, 1-indexed)
          await this.onEvent?.('function.retry', {
            attempt: attemptNumber,
            error: lastError.message,
            delay,
          })

          // Call onRetry callback
          options.retry?.onRetry?.({
            attempt: attemptNumber,
            delay,
            error: lastError,
          })

          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }

        break
      }
    }

    // Set retryCount: 0 if no retry config, otherwise total attempts - 1 (since first isn't a retry)
    // But if we failed on first attempt with retries configured, retryCount = attempts made
    if (!options.retry) {
      retryCount = 0
    } else {
      retryCount = attemptNumber
    }

    // Wrap error if retries exhausted (all maxAttempts were used)
    if (options.retry && attemptNumber >= maxAttempts && maxAttempts > 1) {
      lastError = new ExecutionRetryExhaustedError(
        `All ${maxAttempts} retry attempts exhausted. Last error: ${lastError?.message}`
      )
    }

    // Emit error event
    await this.onEvent?.('function.error', {
      functionId,
      invocationId,
      error: lastError?.message || 'Unknown error',
      input,
    })

    const cpuTime = Date.now() - cpuTimeStart

    return {
      success: false,
      error: lastError || new Error('Unknown error'),
      duration: Date.now() - startTime,
      retryCount,
      metrics: {
        memoryUsed: this.estimateMemoryUsage(),
        cpuTime,
      },
    }
  }

  /**
   * Execute a handler and return a streaming async iterator
   */
  async executeStreaming<TInput = unknown, TOutput = unknown>(
    handler: Handler<TInput, TOutput>,
    input: TInput,
    options: ExecutionOptions = {}
  ): Promise<ExecutionStream> {
    const stream = new ExecutionStream()
    let streamSequence = 0

    // Create execution context with streaming emit
    const invocationId = crypto.randomUUID()
    const functionId = options.functionId || 'anonymous'
    const timeoutController = new AbortController()

    // Set up cancel callback
    stream.setCancelCallback(() => {
      timeoutController.abort('Stream cancelled')
    })

    const context = this.createContext(
      functionId,
      invocationId,
      { ...options, streaming: true },
      timeoutController.signal,
      () => streamSequence++,
      (event, data) => {
        if (event === 'stream.chunk') {
          stream.push({
            type: 'chunk',
            data: (data as { data: string }).data,
            sequence: (data as { sequence: number }).sequence,
          })
        }
      }
    )

    // Execute in background and push results to stream
    ;(async () => {
      try {
        const execResult = await this.executeInSandbox(
          handler,
          input,
          context,
          options,
          timeoutController.signal
        )

        stream.push({
          type: 'result',
          value: execResult.result,
        })
      } catch (error) {
        // Handle error in stream - just finish
      } finally {
        stream.finish()
      }
    })()

    return stream
  }

  /**
   * Create execution context for handler
   */
  private createContext(
    functionId: string,
    invocationId: string,
    options: ExecutionOptions,
    signal: AbortSignal,
    getSequence: () => number,
    streamEmit?: (event: string, data: unknown) => void
  ): ExecutionContext {
    // Filter env vars if exposeEnv is specified
    let exposedEnv: Record<string, string>
    if (options.exposeEnv) {
      exposedEnv = {}
      for (const key of options.exposeEnv) {
        if (key in this.env) {
          exposedEnv[key] = this.env[key]
        }
      }
    } else {
      exposedEnv = { ...this.env }
    }

    // Make env read-only
    const readOnlyEnv = new Proxy(exposedEnv, {
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false,
    })

    // Create state wrapper
    const stateWrapper = {
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

    // Create emit function that handles both events and streaming
    const emit = async (event: string, data: unknown): Promise<void> => {
      // Add sequence number for stream chunks
      if (event === 'stream.chunk') {
        const sequence = getSequence()
        const dataWithSequence = { ...(data as Record<string, unknown>), sequence }
        streamEmit?.(event, dataWithSequence)
        await this.onEvent?.(event, dataWithSequence)
      } else {
        await this.onEvent?.(event, data)
      }
    }

    return {
      functionId,
      invocationId,
      env: readOnlyEnv,
      state: stateWrapper,
      services: this.services,
      log: {
        debug: (message: string, data?: unknown) => {
          if (data !== undefined) {
            this.logger.debug(message, data)
          } else {
            this.logger.debug(message)
          }
        },
        info: (message: string, data?: unknown) => {
          if (data !== undefined) {
            this.logger.info(message, data)
          } else {
            this.logger.info(message)
          }
        },
        warn: (message: string, data?: unknown) => {
          if (data !== undefined) {
            this.logger.warn(message, data)
          } else {
            this.logger.warn(message)
          }
        },
        error: (message: string, data?: unknown) => {
          if (data !== undefined) {
            this.logger.error(message, data)
          } else {
            this.logger.error(message)
          }
        },
      },
      emit,
      signal,
    }
  }

  /**
   * Execute handler in sandboxed environment
   */
  private async executeInSandbox<TInput, TOutput>(
    handler: Handler<TInput, TOutput>,
    input: TInput,
    context: ExecutionContext,
    options: ExecutionOptions,
    signal: AbortSignal
  ): Promise<TOutput> {
    // Check memory limit before execution
    const maxMemory =
      options.resourceLimits?.maxMemory || CodeFunctionExecutor.DEFAULT_MEMORY_LIMIT

    // Track CPU time using a timing mechanism
    const maxCpuTime = options.resourceLimits?.maxCpuTime
    let cpuTimeAccumulated = 0
    let lastCpuCheckTime = performance.now()
    let cpuCheckInterval: ReturnType<typeof setInterval> | undefined
    let cpuLimitExceeded = false

    // Function to check and update CPU time
    const checkCpuTime = () => {
      const now = performance.now()
      const elapsed = now - lastCpuCheckTime
      cpuTimeAccumulated += elapsed
      lastCpuCheckTime = now

      if (maxCpuTime && cpuTimeAccumulated > maxCpuTime) {
        cpuLimitExceeded = true
        throw new ExecutionResourceError(
          `CPU time ${Math.round(cpuTimeAccumulated)}ms exceeded limit ${maxCpuTime}ms`
        )
      }
    }

    if (maxCpuTime) {
      // Check CPU time periodically - for async code this helps track actual execution
      cpuCheckInterval = setInterval(() => {
        try {
          checkCpuTime()
        } catch (e) {
          // Error thrown in interval - need to abort
          if (cpuLimitExceeded) {
            // The abort will be handled by the Promise.race
          }
        }
      }, 5)
    }

    // Store CPU time in context for retrieval
    ;(context as ExecutionContext & { _cpuTimeStart: number })._cpuTimeStart = performance.now()

    try {
      // Convert handler to string to check for sandbox violations
      const handlerSource = handler.toString()

      // Check for restricted access patterns in handler source
      for (const restricted of RESTRICTED_GLOBALS) {
        // Match standalone references (not as object property)
        const pattern = new RegExp(`\\b${restricted}\\b(?!\\s*:)`)
        if (pattern.test(handlerSource)) {
          throw new ExecutionSandboxError(
            `Access to '${restricted}' is not allowed in sandboxed mode`
          )
        }
      }

      // Check for prototype pollution attempts
      if (
        handlerSource.includes('__proto__') ||
        handlerSource.includes('Object.prototype') ||
        /\.\s*prototype\s*\./.test(handlerSource) ||
        /\[\s*['"]prototype['"]\s*\]/.test(handlerSource)
      ) {
        throw new ExecutionSandboxError(
          'Prototype modification is not allowed in sandboxed mode'
        )
      }

      // Replace console with sandboxed version in context
      const sandboxedConsole = createSandboxedConsole(this.logger)

      // Check if signal is already aborted before execution
      if (signal.aborted) {
        const rawReason = signal.reason
        const reason = typeof rawReason === 'string' ? rawReason : String(rawReason || 'Execution cancelled')
        if (reason.includes('timeout')) {
          throw new ExecutionTimeoutError(reason)
        } else {
          throw new ExecutionCancelledError(reason)
        }
      }

      // Track execution start time for CPU time calculation
      const execStartTime = performance.now()
      let syncEndTime = 0

      // Execute with Promise.race for timeout and cancellation
      const result = await Promise.race([
        (async () => {
          // Intercept console calls by wrapping handler execution
          const originalConsole = globalThis.console
          try {
            ;(globalThis as { console: Console }).console = sandboxedConsole

            // Call handler and immediately capture sync execution time
            const handlerResult = handler(input, context)

            // If handler returns immediately (sync), syncEndTime captures real CPU time
            // If handler returns a promise, we track time up to the first await
            syncEndTime = performance.now()

            // Await the result (for async handlers, this is where time is spent in awaits)
            const resolved = await Promise.resolve(handlerResult)

            // After execution completes, calculate total elapsed
            const totalElapsed = performance.now() - execStartTime
            const initialSyncTime = syncEndTime - execStartTime

            // For CPU time: if totalElapsed >> initialSyncTime, handler was async with waits
            // Use initial sync time as approximation of CPU time
            // Add a small amount for async completion overhead
            const estimatedCpuTime = Math.min(initialSyncTime + 10, totalElapsed)

            // Store for return
            cpuTimeAccumulated = estimatedCpuTime

            // Check CPU limit using estimated CPU time
            if (maxCpuTime && estimatedCpuTime > maxCpuTime) {
              throw new ExecutionResourceError(
                `CPU time ${Math.round(estimatedCpuTime)}ms exceeded limit ${maxCpuTime}ms`
              )
            }

            return resolved
          } finally {
            ;(globalThis as { console: Console }).console = originalConsole
          }
        })(),
        new Promise<never>((_, reject) => {
          const handleAbort = () => {
            const rawReason = signal.reason
            const reason = typeof rawReason === 'string' ? rawReason : String(rawReason || 'Execution cancelled')
            if (reason.includes('timeout')) {
              reject(new ExecutionTimeoutError(reason))
            } else {
              reject(new ExecutionCancelledError(reason))
            }
          }
          if (signal.aborted) {
            handleAbort()
            return
          }
          signal.addEventListener('abort', handleAbort)
        }),
      ])

      // Store final CPU time for metrics
      cpuTimeAccumulated = performance.now() - execStartTime

      // Check memory usage estimate
      const memUsed = this.estimateMemoryUsage()
      if (memUsed > maxMemory) {
        throw new ExecutionResourceError(
          `Memory usage estimated at ${memUsed} exceeded limit ${maxMemory}`
        )
      }

      return { result, cpuTime: cpuTimeAccumulated }
    } finally {
      if (cpuCheckInterval) {
        clearInterval(cpuCheckInterval)
      }
    }
  }

  /**
   * Execute handler without sandbox restrictions
   */
  private async executeUnsandboxed<TInput, TOutput>(
    handler: Handler<TInput, TOutput>,
    input: TInput,
    context: ExecutionContext,
    signal: AbortSignal
  ): Promise<{ result: TOutput; cpuTime: number }> {
    const startTime = performance.now()

    // Call handler and capture sync execution time
    const handlerResult = handler(input, context)
    const syncEndTime = performance.now()

    const result = await Promise.race([
      Promise.resolve(handlerResult),
      new Promise<never>((_, reject) => {
        const handleAbort = () => {
          const rawReason = signal.reason
          const reason = typeof rawReason === 'string' ? rawReason : String(rawReason || 'Execution cancelled')
          if (reason.includes('timeout')) {
            reject(new ExecutionTimeoutError(reason))
          } else {
            reject(new ExecutionCancelledError(reason))
          }
        }
        if (signal.aborted) {
          handleAbort()
          return
        }
        signal.addEventListener('abort', handleAbort)
      }),
    ])

    const totalElapsed = performance.now() - startTime
    const initialSyncTime = syncEndTime - startTime
    const cpuTime = Math.min(initialSyncTime + 10, totalElapsed)

    return { result, cpuTime }
  }

  /**
   * Check if we should retry after an error
   */
  private shouldRetry(
    error: Error,
    _currentAttemptIndex: number,
    _maxAttempts: number,
    options: ExecutionOptions
  ): boolean {
    // No retry config = no retries
    if (!options.retry) return false

    // Check if timeout error and retryOnTimeout is false
    if (error instanceof ExecutionTimeoutError) {
      if (options.retry.retryOnTimeout === false) return false
    }

    // Check custom retry condition
    if (options.retry.retryIf) {
      return options.retry.retryIf(error)
    }

    return true
  }

  /**
   * Normalize error to ensure it has required properties
   */
  private normalizeError(error: unknown): Error {
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
      const message =
        typeof obj.message === 'string'
          ? obj.message
          : JSON.stringify(error)
      const err = new Error(message)
      // Copy additional properties
      if (typeof obj.code === 'string') {
        (err as Error & { code: string }).code = obj.code
      }
      return err
    }
    return new Error(String(error))
  }

  /**
   * Estimate current memory usage
   */
  private estimateMemoryUsage(): number {
    // In a real implementation, this would use performance.memory or similar
    // For now, return a rough estimate based on heap info if available
    if (
      typeof globalThis !== 'undefined' &&
      'performance' in globalThis &&
      (globalThis.performance as { memory?: { usedJSHeapSize: number } }).memory
    ) {
      return (globalThis.performance as { memory: { usedJSHeapSize: number } })
        .memory.usedJSHeapSize
    }
    // Return a nominal value for environments without memory API
    return 1024 * 1024 // 1MB placeholder
  }
}

export default CodeFunctionExecutor
