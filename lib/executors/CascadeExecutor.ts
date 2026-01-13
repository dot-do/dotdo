/**
 * @module lib/executors/CascadeExecutor
 *
 * CascadeExecutor - Cascade execution across multiple executor types.
 *
 * This executor implements the intelligent fallback pattern, trying function types
 * in order of speed and cost, automatically escalating on failure. It is the core
 * orchestrator that enables "Business-as-Code" by seamlessly transitioning between
 * code execution, AI inference, agentic workflows, and human judgment.
 *
 * ## Cascade Order
 *
 * The default cascade follows this hierarchy:
 * 1. **Code** - Fastest, cheapest, deterministic execution
 * 2. **Generative** - Single AI inference call
 * 3. **Agentic** - Multi-step AI with tools
 * 4. **Human** - Guaranteed human judgment (slowest, most expensive)
 *
 * Execution stops on the first successful handler. On failure, it automatically
 * escalates to the next type. The full cascade path is recorded for observability.
 *
 * ## Event Tracking (5W+H)
 *
 * Every cascade result includes a comprehensive event following the 5W+H model:
 * - **WHO**: Actor, source, destination
 * - **WHAT**: Object, type, quantity
 * - **WHEN**: Timestamp, recorded time
 * - **WHERE**: Namespace, location, read point
 * - **WHY**: Verb, disposition, reason
 * - **HOW**: Method (code/generative/agentic/human), cascade path
 *
 * @example Basic Cascade Execution
 * ```typescript
 * import { CascadeExecutor } from 'dotdo/lib/executors'
 *
 * // Create executor with DO context
 * const executor = new CascadeExecutor({
 *   state: this.state,
 *   env: this.env
 * })
 *
 * // Execute with multiple handler types
 * const result = await executor.execute({
 *   input: { orderId: 'ORD-123', action: 'refund' },
 *   handlers: {
 *     // Try code first - deterministic rules
 *     code: async (input, ctx) => {
 *       if (input.action === 'refund' && orderAmount < 100) {
 *         return { approved: true, method: 'auto-approved' }
 *       }
 *       throw new Error('Amount exceeds auto-approval limit')
 *     },
 *
 *     // Fall back to AI for complex cases
 *     generative: async (input, ctx) => {
 *       return await aiService.generate({
 *         prompt: `Analyze refund request for order ${input.orderId}`,
 *         schema: { type: 'object', properties: { approved: { type: 'boolean' } } }
 *       })
 *     },
 *
 *     // Final fallback to human review
 *     human: async (input, ctx) => {
 *       return await humanService.requestApproval({
 *         prompt: `Review refund for ${input.orderId}`,
 *         channel: 'slack',
 *         timeout: 3600000
 *       })
 *     }
 *   }
 * })
 *
 * console.log('Executed via:', result.method) // 'code', 'generative', or 'human'
 * console.log('Cascade steps:', result.cascade.steps)
 * ```
 *
 * @example Type Override (Skip Cascade)
 * ```typescript
 * // Force execution with a specific handler type
 * const result = await executor.execute({
 *   input: { data: 'sensitive-request' },
 *   type: 'human', // Skip code and AI, go directly to human
 *   handlers: {
 *     human: humanHandler
 *   }
 * })
 * ```
 *
 * @example Start from Specific Type
 * ```typescript
 * // Skip code, start from generative
 * const result = await executor.execute({
 *   input: { query: 'complex analysis' },
 *   startFrom: 'generative', // Skip code handler
 *   handlers: {
 *     code: codeHandler,
 *     generative: generativeHandler,
 *     agentic: agenticHandler,
 *     human: humanHandler
 *   }
 * })
 * ```
 *
 * @example Timeout Configuration
 * ```typescript
 * // Global and per-step timeouts
 * const result = await executor.execute({
 *   input: data,
 *   handlers: { ... },
 *   timeout: 60000, // 1 minute total cascade timeout
 *   stepTimeout: 10000, // 10 seconds per step
 *   signal: abortController.signal // External cancellation
 * })
 *
 * if (result.error instanceof CascadeTimeoutError) {
 *   console.log('Cascade timed out at step:', result.cascade.steps.length)
 * }
 * ```
 *
 * @example Event Emission and Callbacks
 * ```typescript
 * // Track cascade progress with callbacks
 * const result = await executor.execute({
 *   input: data,
 *   handlers: { ... },
 *   emitEvents: true, // Emit to env.EVENTS
 *   emitEvent: true, // Emit 5W+H event on success
 *   eventContext: {
 *     actor: 'order-service',
 *     object: 'refund-123',
 *     type: 'Refund',
 *     verb: 'processed',
 *     ns: 'ecommerce'
 *   },
 *   onStepStart: ({ type }) => console.log(`Starting ${type} handler`),
 *   onStepComplete: (step) => {
 *     console.log(`${step.type}: ${step.success ? 'success' : 'failed'} in ${step.duration}ms`)
 *   },
 *   onCascadeComplete: (result) => {
 *     analytics.track('cascade.completed', {
 *       method: result.method,
 *       duration: result.duration
 *     })
 *   }
 * })
 * ```
 *
 * @example Track Skipped Handlers
 * ```typescript
 * // Include skipped handlers in cascade path
 * const result = await executor.execute({
 *   input: data,
 *   handlers: {
 *     generative: generativeHandler,
 *     human: humanHandler
 *     // Note: no code or agentic handlers
 *   },
 *   trackSkipped: true // Include empty slots in steps
 * })
 *
 * // cascade.steps will include entries for code and agentic
 * // with attempted: false
 * ```
 *
 * @example Contextual Data for Handlers
 * ```typescript
 * // Pass extra context to handlers
 * const result = await executor.execute({
 *   input: { orderId: 'ORD-123' },
 *   handlers: { ... },
 *   context: {
 *     userId: 'user-456',
 *     sessionId: 'sess-789',
 *     permissions: ['refund.approve']
 *   },
 *   // Optional metadata for 5W+H event
 *   model: 'claude-sonnet-4-20250514',
 *   tools: ['search', 'calculate'],
 *   channel: 'slack',
 *   branch: 'main'
 * })
 *
 * // Handlers receive context via ctx parameter
 * // ctx.userId, ctx.sessionId, ctx.permissions
 * ```
 *
 * @see {@link CodeFunctionExecutor} for code execution details
 * @see {@link GenerativeFunctionExecutor} for AI generation details
 * @see {@link AgenticFunctionExecutor} for agentic workflow details
 * @see {@link HumanFunctionExecutor} for human approval details
 */

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class CascadeExhaustedError extends Error {
  name = 'CascadeExhaustedError'
  cascade: CascadePath
  errors: Error[]

  constructor(message: string, cascade: CascadePath, errors: Error[]) {
    super(message)
    this.cascade = cascade
    this.errors = errors
  }
}

export class CascadeTimeoutError extends Error {
  name = 'CascadeTimeoutError'
  cascade: CascadePath

  constructor(message: string, cascade: CascadePath) {
    super(message)
    this.cascade = cascade
  }
}

export class CascadeSkippedError extends Error {
  name = 'CascadeSkippedError'

  constructor(message: string = 'No handlers available') {
    super(message)
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type FunctionType = 'code' | 'generative' | 'agentic' | 'human'

export type CodeHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: HandlerContext
) => TOutput | Promise<TOutput>

export type GenerativeHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: HandlerContext
) => TOutput | Promise<TOutput>

export type AgenticHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: HandlerContext
) => TOutput | Promise<TOutput>

export type HumanHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: HandlerContext
) => TOutput | Promise<TOutput>

export interface HandlerContext {
  invocationId: string
  cascade: {
    previousAttempts: CascadeStep[]
  }
  [key: string]: unknown
}

export interface CascadeHandlers {
  code?: CodeHandler
  generative?: GenerativeHandler
  agentic?: AgenticHandler
  human?: HumanHandler
}

export interface CascadeStep {
  type: FunctionType
  attempted: boolean
  success: boolean
  error?: string
  duration: number
  timestamp: Date
}

export interface CascadePath {
  steps: CascadeStep[]
  startedAt: Date
  completedAt: Date
  exhausted: boolean
}

export interface EventContext {
  actor: string
  source?: string
  destination?: string
  object: string
  type: string
  quantity?: number
  ns: string
  location?: string
  readPoint?: string
  verb: string
  disposition?: string
  reason?: string
}

export interface Event5WH {
  // WHO
  actor: string
  source?: string
  destination?: string
  // WHAT
  object: string
  type: string
  quantity?: number
  // WHEN
  timestamp: Date
  recorded: Date
  // WHERE
  ns: string
  location?: string
  readPoint?: string
  // WHY
  verb: string
  disposition?: string
  reason?: string
  // HOW
  method: FunctionType
  branch?: string
  model?: string
  tools?: string[]
  channel?: string
  cascade: CascadePath
  transaction?: string
  context?: Record<string, unknown>
}

export interface CascadeResult<T = unknown> {
  success: boolean
  result?: T
  error?: {
    message: string
    name: string
    stack?: string
  }
  method: FunctionType
  cascade: CascadePath
  duration: number
  event: Event5WH
}

export interface CascadeOptions<TInput = unknown> {
  input: TInput
  handlers: CascadeHandlers
  type?: FunctionType // Explicit type override (skip cascade)
  startFrom?: FunctionType // Start cascade from specific type
  eventContext?: EventContext
  emitEvent?: boolean
  emitEvents?: boolean
  context?: Record<string, unknown>
  timeout?: number // Global cascade timeout
  stepTimeout?: number // Per-step timeout
  signal?: AbortSignal
  model?: string
  tools?: string[]
  channel?: string
  branch?: string
  trackSkipped?: boolean
  onStepStart?: (step: { type: FunctionType }) => void | Promise<void>
  onStepComplete?: (step: CascadeStep) => void | Promise<void>
  onCascadeComplete?: (result: CascadeResult) => void | Promise<void>
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
  waitUntil?: (promise: Promise<unknown>) => void
  blockConcurrencyWhile?: (fn: () => Promise<void>) => Promise<void>
}

interface Env {
  AI?: unknown
  AGENT_RUNNER?: unknown
  NOTIFICATIONS?: unknown
  EVENTS?: {
    emit: (event: unknown) => void
  }
}

export interface CascadeExecutorOptions {
  state: DurableObjectState
  env: Env
  handlers?: CascadeHandlers
}

// Cascade order: Code -> Generative -> Agentic -> Human
const CASCADE_ORDER: FunctionType[] = ['code', 'generative', 'agentic', 'human']

// ============================================================================
// CASCADE EXECUTOR
// ============================================================================

export class CascadeExecutor {
  private state: DurableObjectState
  private env: Env
  private defaultHandlers: CascadeHandlers

  constructor(options: CascadeExecutorOptions) {
    this.state = options.state
    this.env = options.env
    this.defaultHandlers = options.handlers || {}
  }

  /**
   * Execute a cascade, trying handlers in order of cost/complexity
   */
  async execute<TInput = unknown, TOutput = unknown>(
    options: CascadeOptions<TInput>
  ): Promise<CascadeResult<TOutput>> {
    const startTime = Date.now()
    const startedAt = new Date()
    const invocationId = crypto.randomUUID()

    // Use passed handlers if provided, otherwise use defaults
    // This allows tests to pass partial handler sets that completely override defaults
    const handlers = options.handlers || this.defaultHandlers

    // Determine which handlers to try
    let typesToTry: FunctionType[]

    if (options.type) {
      // Explicit type override - only try that one type
      typesToTry = [options.type]
    } else if (options.startFrom) {
      // Start from specific type
      const startIndex = CASCADE_ORDER.indexOf(options.startFrom)
      typesToTry = CASCADE_ORDER.slice(startIndex)
    } else {
      // Full cascade
      typesToTry = [...CASCADE_ORDER]
    }

    // Filter to only available handlers (unless trackSkipped is true)
    const availableTypes = typesToTry.filter((type) => {
      const handler = handlers[type]
      return typeof handler === 'function'
    })

    if (availableTypes.length === 0 && !options.trackSkipped) {
      throw new CascadeSkippedError('No handlers available')
    }

    // Emit cascade.started event if requested
    if (options.emitEvents) {
      this.env.EVENTS?.emit({
        verb: 'cascade.started',
        invocationId,
      })
    }

    const steps: CascadeStep[] = []
    const errors: Error[] = []
    let successfulType: FunctionType | null = null
    let result: TOutput | undefined

    // Set up global timeout
    const globalController = new AbortController()
    let globalTimeoutId: ReturnType<typeof setTimeout> | undefined

    if (options.timeout) {
      globalTimeoutId = setTimeout(() => {
        globalController.abort('Cascade timeout')
      }, options.timeout)
    }

    // Link external signal
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        globalController.abort(options.signal!.reason || 'Aborted')
      })
      if (options.signal.aborted) {
        globalController.abort(options.signal.reason || 'Aborted')
      }
    }

    try {
      // Try each type in order
      for (const type of options.trackSkipped ? typesToTry : availableTypes) {
        // Check for global abort
        if (globalController.signal.aborted) {
          const cascade: CascadePath = {
            steps,
            startedAt,
            completedAt: new Date(),
            exhausted: false,
          }
          throw new CascadeTimeoutError('Cascade timeout', cascade)
        }

        const handler = handlers[type]

        // Handle skipped handlers (when trackSkipped is true)
        if (!handler || typeof handler !== 'function') {
          if (options.trackSkipped) {
            steps.push({
              type,
              attempted: false,
              success: false,
              duration: 0,
              timestamp: new Date(),
            })
          }
          continue
        }

        const stepStart = Date.now()

        // Call onStepStart callback
        await options.onStepStart?.({ type })

        // Emit cascade.step event if requested
        if (options.emitEvents) {
          this.env.EVENTS?.emit({
            verb: 'cascade.step',
            type,
            attempted: true,
          })
        }

        try {
          // Build handler context
          const handlerContext: HandlerContext = {
            invocationId,
            cascade: {
              previousAttempts: [...steps],
            },
            ...options.context,
          }

          // Execute handler with optional per-step timeout
          let handlerResult: TOutput

          if (options.stepTimeout) {
            handlerResult = await this.executeWithTimeout(
              () => handler(options.input, handlerContext) as Promise<TOutput>,
              options.stepTimeout,
              globalController.signal
            )
          } else {
            // Check abort before executing
            if (globalController.signal.aborted) {
              throw new Error('Aborted')
            }
            // Race the handler against the abort signal
            handlerResult = await this.executeWithAbort(
              () => handler(options.input, handlerContext) as Promise<TOutput>,
              globalController.signal
            )
          }

          // Handler succeeded
          const duration = Date.now() - stepStart
          const step: CascadeStep = {
            type,
            attempted: true,
            success: true,
            duration,
            timestamp: new Date(stepStart),
          }
          steps.push(step)

          // Call onStepComplete callback
          await options.onStepComplete?.(step)

          successfulType = type
          result = handlerResult
          break
        } catch (error) {
          // Handler failed - record and continue to next type
          const duration = Date.now() - stepStart
          const errorObj = error instanceof Error ? error : new Error(String(error))
          const errorMessage = errorObj.message

          const step: CascadeStep = {
            type,
            attempted: true,
            success: false,
            error: errorMessage,
            duration,
            timestamp: new Date(stepStart),
          }
          steps.push(step)
          errors.push(errorObj)

          // Call onStepComplete callback
          await options.onStepComplete?.(step)

          // If explicit type was specified, don't cascade - re-throw error
          if (options.type) {
            throw error
          }

          // Check for global timeout/abort before continuing
          if (globalController.signal.aborted) {
            const cascade: CascadePath = {
              steps,
              startedAt,
              completedAt: new Date(),
              exhausted: false,
            }
            // Check if this was from external signal abort or internal timeout
            const reason = globalController.signal.reason || 'Cascade aborted'
            throw new CascadeTimeoutError(String(reason), cascade)
          }
        }
      }
    } finally {
      if (globalTimeoutId) {
        clearTimeout(globalTimeoutId)
      }
    }

    const completedAt = new Date()
    const duration = Date.now() - startTime

    // Build cascade path
    const cascade: CascadePath = {
      steps,
      startedAt,
      completedAt,
      exhausted: successfulType === null,
    }

    // If no handler succeeded, throw CascadeExhaustedError
    if (successfulType === null) {
      // Emit cascade.exhausted event if requested
      if (options.emitEvents) {
        this.env.EVENTS?.emit({
          verb: 'cascade.exhausted',
          disposition: 'failed',
          cascade,
        })
      }

      throw new CascadeExhaustedError(
        `All cascade handlers failed: ${errors.map((e) => e.message).join(', ')}`,
        cascade,
        errors
      )
    }

    // Build 5W+H event
    const event = this.build5WHEvent(
      options,
      successfulType,
      cascade,
      completedAt
    )

    // Build result
    const cascadeResult: CascadeResult<TOutput> = {
      success: true,
      result,
      method: successfulType,
      cascade,
      duration,
      event,
    }

    // Call onCascadeComplete callback
    await options.onCascadeComplete?.(cascadeResult as CascadeResult)

    // Emit event if requested
    if (options.emitEvent) {
      this.env.EVENTS?.emit(event)
    }

    // Emit cascade.completed event if requested
    if (options.emitEvents) {
      this.env.EVENTS?.emit({
        verb: 'cascade.completed',
        disposition: 'success',
        method: successfulType,
        cascade,
      })
    }

    return cascadeResult
  }

  /**
   * Execute a handler and race against an abort signal
   */
  private async executeWithAbort<T>(
    fn: () => Promise<T>,
    signal: AbortSignal
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false

      // Check if already aborted
      if (signal.aborted) {
        reject(new Error('Aborted'))
        return
      }

      // Listen for abort
      const abortHandler = () => {
        if (!settled) {
          settled = true
          reject(new Error('Aborted'))
        }
      }
      signal.addEventListener('abort', abortHandler, { once: true })

      // Execute the function
      fn()
        .then((result) => {
          if (!settled) {
            settled = true
            signal.removeEventListener('abort', abortHandler)
            resolve(result)
          }
        })
        .catch((error) => {
          if (!settled) {
            settled = true
            signal.removeEventListener('abort', abortHandler)
            reject(error)
          }
        })
    })
  }

  /**
   * Execute a handler with a timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    signal: AbortSignal
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      let settled = false

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
      }

      // Set up timeout
      timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true
          cleanup()
          reject(new Error('Step timeout'))
        }
      }, timeout)

      // Check if already aborted
      if (signal.aborted) {
        settled = true
        cleanup()
        reject(new Error('Aborted'))
        return
      }

      // Listen for abort
      const abortHandler = () => {
        if (!settled) {
          settled = true
          cleanup()
          reject(new Error('Aborted'))
        }
      }
      signal.addEventListener('abort', abortHandler, { once: true })

      // Execute the function
      fn()
        .then((result) => {
          if (!settled) {
            settled = true
            cleanup()
            signal.removeEventListener('abort', abortHandler)
            resolve(result)
          }
        })
        .catch((error) => {
          if (!settled) {
            settled = true
            cleanup()
            signal.removeEventListener('abort', abortHandler)
            reject(error)
          }
        })
    })
  }

  /**
   * Build 5W+H event with method field
   */
  private build5WHEvent(
    options: CascadeOptions,
    method: FunctionType,
    cascade: CascadePath,
    timestamp: Date
  ): Event5WH {
    const ctx = options.eventContext || {
      actor: 'system',
      object: 'cascade',
      type: 'Cascade',
      verb: 'executed',
      ns: 'default',
    }

    return {
      // WHO
      actor: ctx.actor,
      source: ctx.source,
      destination: ctx.destination,
      // WHAT
      object: ctx.object,
      type: ctx.type,
      quantity: ctx.quantity,
      // WHEN
      timestamp,
      recorded: new Date(),
      // WHERE
      ns: ctx.ns,
      location: ctx.location,
      readPoint: ctx.readPoint,
      // WHY
      verb: ctx.verb,
      disposition: ctx.disposition,
      reason: ctx.reason,
      // HOW
      method,
      branch: options.branch,
      model: options.model,
      tools: options.tools,
      channel: options.channel,
      cascade,
      context: options.context,
    }
  }
}

export default CascadeExecutor
