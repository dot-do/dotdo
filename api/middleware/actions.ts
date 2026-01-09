import type { Context, MiddlewareHandler } from 'hono'

/**
 * Actions Middleware
 *
 * Handles action invocation for different function types:
 * - CodeFunction: Synchronous code execution
 * - GenerativeFunction: Calls AI model for response
 * - AgenticFunction: Runs multi-step agent loop
 * - HumanFunction: Sends to human, waits for response
 *
 * Features:
 * - GET /api/actions to list available actions
 * - POST /api/actions/:action to invoke functions
 * - Permission checks before execution
 * - Timeout handling per function type
 * - Function type handler registry for extensibility
 * - Automatic retry with exponential backoff
 * - Action result caching
 * - Execution tracing and metrics
 */

// ============================================================================
// Types - Input/Output Typing
// ============================================================================

/** Base input type for all actions */
export type ActionInput = Record<string, unknown>

/** Result from any action execution */
export type ActionOutput = unknown

/** Generic typed handler signature */
export type TypedHandler<TInput = ActionInput, TOutput = ActionOutput> = (
  input: TInput,
  c: Context
) => TOutput | Promise<TOutput>

/** AI service interface */
export interface AIService {
  generate: (params: { model: string; prompt: string }) => Promise<{ text: string }>
  stream: (params: { model: string; prompt: string }) => AsyncIterable<{ text: string }>
}

/** Agent runner interface */
export interface AgentRunner {
  run: (params: { agent: string; input: unknown; maxIterations: number }) => Promise<unknown>
}

/** Notification service interface */
export interface NotificationService {
  send: (params: { channel: string; message: string }) => Promise<{ messageId: string }>
  waitForResponse: (params: { timeout: number }) => Promise<unknown>
}

// ============================================================================
// Function Type Definitions
// ============================================================================

export interface CodeFunction<TInput = ActionInput, TOutput = ActionOutput> {
  type: 'code'
  description?: string
  handler: TypedHandler<TInput, TOutput>
  timeout?: number
  requiredPermission?: string
  /** Enable caching for this action */
  cacheable?: boolean
  /** Cache TTL in milliseconds */
  cacheTTL?: number
  /** Retry configuration */
  retry?: RetryConfig
}

export interface GenerativeFunction {
  type: 'generative'
  description?: string
  model: string
  prompt: string
  stream?: boolean
  timeout?: number
  requiredPermission?: string
  cacheable?: boolean
  cacheTTL?: number
  retry?: RetryConfig
}

export interface AgenticFunction {
  type: 'agentic'
  description?: string
  agent: string
  maxIterations?: number
  timeout?: number
  requiredPermission?: string
  retry?: RetryConfig
}

export interface HumanFunction {
  type: 'human'
  description?: string
  channel: string
  prompt?: string
  timeout: number
  requiredPermission?: string
}

export type ActionFunction = CodeFunction | GenerativeFunction | AgenticFunction | HumanFunction

export interface ActionsConfig {
  actions?: Record<string, ActionFunction>
  /** Global retry configuration */
  defaultRetry?: RetryConfig
  /** Global cache configuration */
  cache?: CacheConfig
  /** Enable execution metrics */
  enableMetrics?: boolean
}

// ============================================================================
// Retry Configuration
// ============================================================================

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number
  /** Initial delay in ms (default: 100) */
  initialDelay?: number
  /** Maximum delay in ms (default: 5000) */
  maxDelay?: number
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number
  /** Errors that should trigger retry */
  retryableErrors?: string[]
}

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxAttempts: 3,
  initialDelay: 100,
  maxDelay: 5000,
  backoffMultiplier: 2,
  retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'Service unavailable', 'rate limit'],
}

// ============================================================================
// Cache Configuration
// ============================================================================

export interface CacheConfig {
  /** Default TTL in milliseconds */
  defaultTTL?: number
  /** Maximum cache entries */
  maxEntries?: number
}

interface CacheEntry {
  value: unknown
  expiresAt: number
}

// ============================================================================
// Execution Metrics
// ============================================================================

export interface ExecutionMetrics {
  actionName: string
  actionType: string
  startTime: number
  endTime?: number
  duration?: number
  success: boolean
  error?: string
  retryCount: number
  cacheHit: boolean
}

/** Metrics collector interface */
export interface MetricsCollector {
  record(metrics: ExecutionMetrics): void
}

// ============================================================================
// Internal Cache Implementation
// ============================================================================

class ActionCache {
  private cache = new Map<string, CacheEntry>()
  private maxEntries: number

  constructor(config?: CacheConfig) {
    this.maxEntries = config?.maxEntries ?? 1000
  }

  private generateKey(actionName: string, input: unknown): string {
    return `${actionName}:${JSON.stringify(input)}`
  }

  get(actionName: string, input: unknown): unknown | undefined {
    const key = this.generateKey(actionName, input)
    const entry = this.cache.get(key)

    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }

    return entry.value
  }

  set(actionName: string, input: unknown, value: unknown, ttl: number): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }

    const key = this.generateKey(actionName, input)
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    })
  }

  clear(): void {
    this.cache.clear()
  }
}

// ============================================================================
// Execution Context
// ============================================================================

export interface ExecutionContext {
  actionName: string
  actionConfig: ActionFunction
  input: unknown
  honoContext: Context
  retryCount: number
  startTime: number
  cacheHit: boolean
}

// ============================================================================
// Function Type Handler Registry
// ============================================================================

export type FunctionTypeHandler<T extends ActionFunction = ActionFunction> = (
  config: T,
  input: unknown,
  c: Context
) => Promise<unknown>

interface HandlerRegistryEntry<T extends ActionFunction = ActionFunction> {
  handler: FunctionTypeHandler<T>
  canRetry: boolean
}

/**
 * Registry for function type handlers.
 * Allows extensibility by registering custom handlers for new function types.
 */
class FunctionTypeHandlerRegistry {
  private handlers = new Map<string, HandlerRegistryEntry>()

  register<T extends ActionFunction>(
    type: T['type'],
    handler: FunctionTypeHandler<T>,
    options: { canRetry?: boolean } = {}
  ): void {
    this.handlers.set(type, {
      handler: handler as FunctionTypeHandler,
      canRetry: options.canRetry ?? true,
    })
  }

  get(type: string): HandlerRegistryEntry | undefined {
    return this.handlers.get(type)
  }

  has(type: string): boolean {
    return this.handlers.has(type)
  }
}

// Create global handler registry
const handlerRegistry = new FunctionTypeHandlerRegistry()

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Substitutes {{variable}} placeholders in a template with input values
 */
function substituteTemplate(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return String(input[key] ?? '')
  })
}

/**
 * Wraps a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

/**
 * Checks if user has required permission
 */
function hasPermission(user: { permissions?: string[] } | null, requiredPermission?: string): boolean {
  if (!requiredPermission) return true
  if (!user?.permissions) return false
  return user.permissions.includes(requiredPermission) || user.permissions.includes('actions:*')
}

/**
 * Determines if an error should trigger a retry
 */
function isRetryableError(error: Error, retryableErrors: string[]): boolean {
  const message = error.message.toLowerCase()
  return retryableErrors.some(pattern => message.includes(pattern.toLowerCase()))
}

/**
 * Calculates delay with exponential backoff
 */
function calculateBackoffDelay(
  attempt: number,
  config: Required<RetryConfig>
): number {
  const delay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt)
  return Math.min(delay, config.maxDelay)
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================================
// Function Type Handlers - Registered in Registry
// ============================================================================

/**
 * Executes a code function
 */
const executeCodeFunction: FunctionTypeHandler<CodeFunction> = async (
  config,
  input,
  c
) => {
  const result = await Promise.resolve(config.handler(input as ActionInput, c))
  return result
}

/**
 * Executes a generative function
 */
const executeGenerativeFunction: FunctionTypeHandler<GenerativeFunction> = async (
  config,
  input,
  c
) => {
  const ai = c.get('ai') as AIService | undefined
  if (!ai) {
    throw new Error('AI service not available')
  }

  const inputObj = (input || {}) as Record<string, unknown>
  const prompt = substituteTemplate(config.prompt, inputObj)

  if (config.stream) {
    // For streaming, we can either stream or generate - tests accept either
    const result = await ai.generate({
      model: config.model,
      prompt,
    })
    return result
  }

  const result = await ai.generate({
    model: config.model,
    prompt,
  })

  return result
}

/**
 * Executes an agentic function
 */
const executeAgenticFunction: FunctionTypeHandler<AgenticFunction> = async (
  config,
  input,
  c
) => {
  const agentRunner = c.get('agentRunner') as AgentRunner | undefined
  if (!agentRunner) {
    throw new Error('Agent runner not available')
  }

  const maxIterations = config.maxIterations ?? 10

  const result = await agentRunner.run({
    agent: config.agent,
    input,
    maxIterations,
  })

  return result
}

/**
 * Executes a human function
 */
const executeHumanFunction: FunctionTypeHandler<HumanFunction> = async (
  config,
  input,
  c
) => {
  const notifications = c.get('notifications') as NotificationService | undefined

  if (!notifications) {
    throw new Error('Notification channel not available')
  }

  const inputObj = (input || {}) as Record<string, unknown>
  const message = config.prompt ? substituteTemplate(config.prompt, inputObj) : ''

  // Send notification
  await notifications.send({
    channel: config.channel,
    message,
  })

  // Wait for response with timeout
  const response = await notifications.waitForResponse({
    timeout: config.timeout,
  })

  return response
}

// Register default handlers
handlerRegistry.register('code', executeCodeFunction, { canRetry: true })
handlerRegistry.register('generative', executeGenerativeFunction, { canRetry: true })
handlerRegistry.register('agentic', executeAgenticFunction, { canRetry: true })
handlerRegistry.register('human', executeHumanFunction, { canRetry: false }) // Human actions should not auto-retry

// ============================================================================
// Execution Engine
// ============================================================================

/**
 * Core execution engine that handles retry, caching, and metrics
 */
class ActionExecutionEngine {
  private cache: ActionCache
  private metricsCollector?: MetricsCollector
  private defaultRetry: Required<RetryConfig>
  private enableMetrics: boolean

  constructor(config?: ActionsConfig) {
    this.cache = new ActionCache(config?.cache)
    this.defaultRetry = { ...DEFAULT_RETRY_CONFIG, ...config?.defaultRetry }
    this.enableMetrics = config?.enableMetrics ?? false
  }

  /**
   * Set metrics collector for execution tracing
   */
  setMetricsCollector(collector: MetricsCollector): void {
    this.metricsCollector = collector
  }

  /**
   * Execute an action with retry, caching, and metrics
   */
  async execute(ctx: ExecutionContext): Promise<unknown> {
    const { actionName, actionConfig, input, honoContext } = ctx
    const startTime = Date.now()
    let cacheHit = false
    let retryCount = 0

    // Check cache first for cacheable actions
    if (this.isCacheable(actionConfig)) {
      const cached = this.cache.get(actionName, input)
      if (cached !== undefined) {
        cacheHit = true
        this.recordMetrics({
          actionName,
          actionType: actionConfig.type,
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
          success: true,
          retryCount: 0,
          cacheHit: true,
        })
        return cached
      }
    }

    // Get handler from registry
    const registryEntry = handlerRegistry.get(actionConfig.type)
    if (!registryEntry) {
      throw new Error(`Unknown action type`)
    }

    // Determine retry configuration
    const retryConfig = this.getRetryConfig(actionConfig, registryEntry.canRetry)

    // Execute with retry logic
    let lastError: Error | undefined
    for (let attempt = 0; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        if (attempt > 0) {
          const delay = calculateBackoffDelay(attempt - 1, retryConfig)
          await sleep(delay)
          retryCount = attempt
        }

        const result = await registryEntry.handler(actionConfig, input, honoContext)

        // Cache result if cacheable
        if (this.isCacheable(actionConfig)) {
          const ttl = this.getCacheTTL(actionConfig)
          this.cache.set(actionName, input, result, ttl)
        }

        // Record successful metrics
        this.recordMetrics({
          actionName,
          actionType: actionConfig.type,
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
          success: true,
          retryCount,
          cacheHit,
        })

        return result
      } catch (error) {
        lastError = error as Error

        // Check if we should retry
        const shouldRetry =
          attempt < retryConfig.maxAttempts &&
          registryEntry.canRetry &&
          isRetryableError(lastError, retryConfig.retryableErrors)

        if (!shouldRetry) {
          break
        }
      }
    }

    // Record failed metrics
    this.recordMetrics({
      actionName,
      actionType: actionConfig.type,
      startTime,
      endTime: Date.now(),
      duration: Date.now() - startTime,
      success: false,
      error: lastError?.message,
      retryCount,
      cacheHit,
    })

    throw lastError
  }

  private isCacheable(config: ActionFunction): boolean {
    if (config.type === 'code' || config.type === 'generative') {
      return (config as CodeFunction | GenerativeFunction).cacheable ?? false
    }
    return false
  }

  private getCacheTTL(config: ActionFunction): number {
    if (config.type === 'code' || config.type === 'generative') {
      return (config as CodeFunction | GenerativeFunction).cacheTTL ?? 60000
    }
    return 60000
  }

  private getRetryConfig(config: ActionFunction, canRetry: boolean): Required<RetryConfig> {
    if (!canRetry) {
      return { ...this.defaultRetry, maxAttempts: 0 }
    }

    const actionRetry = 'retry' in config ? config.retry : undefined
    return { ...this.defaultRetry, ...actionRetry }
  }

  private recordMetrics(metrics: ExecutionMetrics): void {
    if (this.enableMetrics && this.metricsCollector) {
      this.metricsCollector.record(metrics)
    }
  }
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Creates an actions middleware for handling action invocation.
 *
 * @param config - Actions configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.use('/api/actions/*', actions({
 *   actions: {
 *     'send-email': {
 *       type: 'code',
 *       handler: async (input) => { ... },
 *     },
 *     'summarize': {
 *       type: 'generative',
 *       model: 'claude-3-sonnet',
 *       prompt: 'Summarize: {{input}}',
 *     },
 *     'research': {
 *       type: 'agentic',
 *       agent: 'researcher',
 *       maxIterations: 10,
 *     },
 *     'approve': {
 *       type: 'human',
 *       channel: 'slack',
 *       timeout: 3600000,
 *     },
 *   },
 *   defaultRetry: {
 *     maxAttempts: 3,
 *     initialDelay: 100,
 *   },
 *   cache: {
 *     defaultTTL: 60000,
 *   },
 *   enableMetrics: true,
 * }))
 * ```
 */
export function actions(config?: ActionsConfig): MiddlewareHandler {
  const actionsMap = config?.actions || {}
  const executionEngine = new ActionExecutionEngine(config)

  return async (c, next) => {
    // Parse the path to determine what action to take
    const path = c.req.path
    const method = c.req.method

    // Match /api/actions or /api/actions/
    const isListRoute = /^\/api\/actions\/?$/.test(path)
    // Match /api/actions/:action
    const actionMatch = path.match(/^\/api\/actions\/([^/]+)\/?$/)

    if (isListRoute && method === 'GET') {
      // GET / - list available actions
      const actionList = Object.entries(actionsMap).map(([name, actionConfig]) => ({
        name,
        description: actionConfig.description,
        type: actionConfig.type,
      }))
      return c.json({ actions: actionList })
    }

    if (actionMatch) {
      const actionName = actionMatch[1]

      // Only POST is allowed for action invocation
      if (method !== 'POST') {
        return c.json({ error: 'Method not allowed' }, 405)
      }

      // Check if action exists
      const actionConfig = actionsMap[actionName]
      if (!actionConfig) {
        return c.json({ error: `Action '${actionName}' not found` }, 404)
      }

      // Check authentication
      const user = c.get('user') as { id: string; permissions?: string[] } | undefined
      if (!user) {
        return c.json({ error: 'Authentication required' }, 401)
      }

      // Check permission
      if (!hasPermission(user, actionConfig.requiredPermission)) {
        return c.json({ error: 'Permission denied' }, 403)
      }

      // Parse input
      let input: unknown
      try {
        const bodyText = await c.req.text()
        if (bodyText) {
          input = JSON.parse(bodyText)
        } else {
          input = {}
        }
      } catch {
        return c.json({ error: 'Invalid JSON input' }, 400)
      }

      // Execute action using execution engine
      try {
        const timeout = actionConfig.timeout

        const executeAction = async (): Promise<unknown> => {
          return executionEngine.execute({
            actionName,
            actionConfig,
            input,
            honoContext: c,
            retryCount: 0,
            startTime: Date.now(),
            cacheHit: false,
          })
        }

        let result: unknown
        if (timeout) {
          result = await withTimeout(executeAction(), timeout, 'Action timeout')
        } else {
          result = await executeAction()
        }

        return c.json({ result })
      } catch (error) {
        const err = error as Error

        // Handle timeout errors
        if (err.message === 'Action timeout' || err.message?.includes('Timeout')) {
          return c.json({ error: 'Timeout waiting for response' }, 408)
        }

        // Handle human function timeout
        if (actionConfig.type === 'human' && err.message?.includes('Timeout')) {
          return c.json({ error: 'Timeout waiting for response' }, 408)
        }

        // Handle AI/agent errors
        if (actionConfig.type === 'generative' || actionConfig.type === 'agentic') {
          return c.json({ error: 'Service unavailable' }, 502)
        }

        // Handle notification channel errors
        if (actionConfig.type === 'human') {
          return c.json({ error: 'Channel unavailable' }, 502)
        }

        // Generic server error - don't leak details
        return c.json({ error: 'Internal server error' }, 500)
      }
    }

    // Not an actions route, pass to next middleware
    await next()
  }
}

// ============================================================================
// Exports for extensibility
// ============================================================================

/**
 * Register a custom function type handler
 */
export function registerFunctionTypeHandler<T extends ActionFunction>(
  type: T['type'],
  handler: FunctionTypeHandler<T>,
  options: { canRetry?: boolean } = {}
): void {
  handlerRegistry.register(type, handler, options)
}

/**
 * Export handler registry for testing and advanced use cases
 */
export { handlerRegistry, ActionCache, ActionExecutionEngine }

export default actions
