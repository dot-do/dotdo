/**
 * Handler Chain for Transport Layer
 *
 * Provides a composable chain of transport handlers that process requests
 * in priority order. The chain supports:
 * - Handler registration with priorities
 * - Middleware wrapping (e.g., auth before handlers)
 * - Fallback handling for unmatched requests
 * - Performance optimization through caching
 */

import type {
  TransportHandler,
  HandlerContext,
  CanHandleResult,
  Logger,
  MethodInfo,
} from './handler'
import { buildErrorResponse, createRequestTimer, logRequest } from './shared'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for the handler chain
 */
export interface HandlerChainConfig {
  /** Enable debug mode (verbose logging, stack traces) */
  debug?: boolean
  /** Logger instance */
  logger?: Logger
  /** Fallback response for unmatched requests */
  fallbackHandler?: (request: Request, context: HandlerContext) => Promise<Response>
  /** Cache handler selection results */
  cacheHandlerSelection?: boolean
  /** Default timeout for handlers (ms) */
  defaultTimeout?: number
}

/**
 * Entry in the handler chain
 */
interface HandlerEntry {
  handler: TransportHandler
  priority: number
  enabled: boolean
}

/**
 * Cache key for handler selection
 */
interface SelectionCacheKey {
  method: string
  pathPrefix: string
  contentType?: string
}

// ============================================================================
// HANDLER CHAIN
// ============================================================================

/**
 * Handler Chain - Manages and routes requests to appropriate transport handlers
 *
 * The chain selects handlers based on their `canHandle` method and priority.
 * Higher priority handlers are checked first. The first handler that can handle
 * the request processes it.
 *
 * @example
 * ```typescript
 * const chain = new HandlerChain({ debug: true })
 *
 * // Add handlers (higher priority = checked first)
 * chain.use(new AuthHandler(), 100)  // Auth middleware
 * chain.use(new McpHandler(), 50)    // MCP JSON-RPC
 * chain.use(new RpcHandler(), 40)    // Cap'n Web RPC
 * chain.use(new RestHandler(), 30)   // REST API
 *
 * // Handle request
 * const response = await chain.handle(request, context)
 * ```
 */
export class HandlerChain {
  private handlers: HandlerEntry[] = []
  private config: HandlerChainConfig
  private selectionCache: Map<string, TransportHandler | null> = new Map()
  private methodCache: Map<string, MethodInfo> = new Map()

  constructor(config: HandlerChainConfig = {}) {
    this.config = {
      cacheHandlerSelection: true,
      ...config,
    }
  }

  /**
   * Add a handler to the chain
   *
   * @param handler - The transport handler
   * @param priority - Higher priority handlers are checked first (default: 0)
   * @returns This chain for chaining calls
   *
   * @example
   * ```typescript
   * chain
   *   .use(authHandler, 100)
   *   .use(restHandler, 50)
   *   .use(rpcHandler, 40)
   * ```
   */
  use(handler: TransportHandler, priority: number = 0): this {
    this.handlers.push({
      handler,
      priority,
      enabled: true,
    })

    // Sort by priority (descending)
    this.handlers.sort((a, b) => b.priority - a.priority)

    // Clear selection cache when handlers change
    this.selectionCache.clear()

    this.log('debug', `Handler '${handler.name}' added with priority ${priority}`)

    return this
  }

  /**
   * Remove a handler from the chain
   *
   * @param handler - The handler to remove (or handler name)
   * @returns Whether the handler was found and removed
   */
  remove(handler: TransportHandler | string): boolean {
    const name = typeof handler === 'string' ? handler : handler.name
    const index = this.handlers.findIndex((e) => e.handler.name === name)

    if (index >= 0) {
      const removed = this.handlers.splice(index, 1)[0]
      removed.handler.dispose?.()
      this.selectionCache.clear()
      this.log('debug', `Handler '${name}' removed`)
      return true
    }

    return false
  }

  /**
   * Enable or disable a handler
   *
   * @param handler - The handler to toggle (or handler name)
   * @param enabled - Whether to enable or disable
   */
  setEnabled(handler: TransportHandler | string, enabled: boolean): void {
    const name = typeof handler === 'string' ? handler : handler.name
    const entry = this.handlers.find((e) => e.handler.name === name)

    if (entry) {
      entry.enabled = enabled
      this.selectionCache.clear()
      this.log('debug', `Handler '${name}' ${enabled ? 'enabled' : 'disabled'}`)
    }
  }

  /**
   * Get all registered handlers
   */
  getHandlers(): Array<{ name: string; priority: number; enabled: boolean }> {
    return this.handlers.map((e) => ({
      name: e.handler.name,
      priority: e.priority,
      enabled: e.enabled,
    }))
  }

  /**
   * Handle a request by routing to the appropriate handler
   *
   * @param request - The incoming HTTP request
   * @param context - Handler context with environment, state, and methods
   * @returns HTTP response from the matching handler
   */
  async handle(request: Request, context: HandlerContext): Promise<Response> {
    const timer = createRequestTimer()

    try {
      // Try to find a handler from cache first
      const cacheKey = this.getCacheKey(request)
      let selectedHandler: TransportHandler | null = null

      if (this.config.cacheHandlerSelection && this.selectionCache.has(cacheKey)) {
        selectedHandler = this.selectionCache.get(cacheKey) || null
        // Verify the cached handler can still handle this request
        if (selectedHandler) {
          const result = selectedHandler.canHandle(request)
          if (!result.canHandle) {
            selectedHandler = null
            this.selectionCache.delete(cacheKey)
          }
        }
      }

      // Find handler if not cached
      if (!selectedHandler) {
        selectedHandler = this.selectHandler(request)
        if (this.config.cacheHandlerSelection) {
          this.selectionCache.set(cacheKey, selectedHandler)
        }
      }

      // No handler found
      if (!selectedHandler) {
        if (this.config.fallbackHandler) {
          return this.config.fallbackHandler(request, context)
        }

        const response = buildErrorResponse(
          { message: 'No handler available', code: 'NO_HANDLER' },
          404,
          { debug: this.config.debug }
        )

        this.logRequestComplete(request, response.status, timer.stop())
        return response
      }

      // Execute the handler
      this.log('debug', `Routing to handler '${selectedHandler.name}'`)
      const response = await selectedHandler.handle(request, context)

      this.logRequestComplete(request, response.status, timer.stop(), selectedHandler.name)
      return response
    } catch (error) {
      const durationMs = timer.stop()
      const errorMessage = error instanceof Error ? error.message : String(error)

      this.log('error', `Handler chain error: ${errorMessage}`, { error })

      const response = buildErrorResponse(
        error instanceof Error ? error : { message: errorMessage, code: 'HANDLER_ERROR' },
        500,
        { debug: this.config.debug }
      )

      this.logRequestComplete(request, response.status, durationMs, undefined, errorMessage)
      return response
    }
  }

  /**
   * Select the best handler for a request
   */
  private selectHandler(request: Request): TransportHandler | null {
    let bestHandler: TransportHandler | null = null
    let bestPriority = -Infinity

    for (const entry of this.handlers) {
      if (!entry.enabled) continue

      const result = entry.handler.canHandle(request)

      if (result.canHandle) {
        // Use result priority if provided, otherwise use entry priority
        const effectivePriority = result.priority ?? entry.priority

        if (effectivePriority > bestPriority) {
          bestHandler = entry.handler
          bestPriority = effectivePriority
        }
      }
    }

    return bestHandler
  }

  /**
   * Generate cache key for handler selection
   */
  private getCacheKey(request: Request): string {
    const url = new URL(request.url)
    // Use method + path prefix for caching
    // This allows similar paths to share cached selections
    const pathPrefix = url.pathname.split('/').slice(0, 3).join('/')
    const contentType = request.headers.get('Content-Type')?.split(';')[0] || ''

    return `${request.method}:${pathPrefix}:${contentType}`
  }

  /**
   * Log request completion
   */
  private logRequestComplete(
    request: Request,
    status: number,
    durationMs: number,
    handlerName?: string,
    error?: string
  ): void {
    if (this.config.logger) {
      logRequest(request, { status, durationMs, error }, this.config.logger)
    }
  }

  /**
   * Log a message
   */
  private log(level: keyof Logger, message: string, data?: Record<string, unknown>): void {
    if (this.config.logger) {
      this.config.logger[level](message, data)
    }
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.selectionCache.clear()
    this.methodCache.clear()
    this.log('debug', 'Caches cleared')
  }

  /**
   * Dispose all handlers
   */
  dispose(): void {
    for (const entry of this.handlers) {
      entry.handler.dispose?.()
    }
    this.handlers = []
    this.clearCaches()
  }
}

// ============================================================================
// MIDDLEWARE CHAIN SUPPORT
// ============================================================================

/**
 * Create a middleware wrapper that applies before a handler
 *
 * @param middleware - The middleware handler
 * @param wrapped - The handler to wrap
 * @returns A new handler that applies middleware before wrapped handler
 *
 * @example
 * ```typescript
 * const protectedRest = wrapWithMiddleware(authHandler, restHandler)
 * chain.use(protectedRest, 50)
 * ```
 */
export function wrapWithMiddleware(
  middleware: TransportHandler,
  wrapped: TransportHandler
): TransportHandler {
  return {
    name: `${middleware.name}>${wrapped.name}`,

    canHandle(request: Request): CanHandleResult {
      // Middleware must be able to handle, and wrapped must be able to handle
      const middlewareResult = middleware.canHandle(request)
      if (!middlewareResult.canHandle) {
        return middlewareResult
      }

      const wrappedResult = wrapped.canHandle(request)
      return {
        canHandle: wrappedResult.canHandle,
        priority: Math.max(
          middlewareResult.priority ?? 0,
          wrappedResult.priority ?? 0
        ),
      }
    },

    async handle(request: Request, context: HandlerContext): Promise<Response> {
      // First call middleware
      const middlewareResponse = await middleware.handle(request, context)

      // If middleware returned an error response, return it
      if (middlewareResponse.status >= 400) {
        return middlewareResponse
      }

      // Middleware succeeded, call wrapped handler
      return wrapped.handle(request, context)
    },

    dispose() {
      middleware.dispose?.()
      wrapped.dispose?.()
    },
  }
}

// ============================================================================
// HANDLER CHAIN BUILDER
// ============================================================================

/**
 * Builder pattern for creating handler chains
 *
 * @example
 * ```typescript
 * const chain = HandlerChainBuilder.create()
 *   .withDebug(true)
 *   .withLogger(console)
 *   .withAuth(authHandler)
 *   .use(restHandler, 50)
 *   .use(rpcHandler, 40)
 *   .build()
 * ```
 */
export class HandlerChainBuilder {
  private config: HandlerChainConfig = {}
  private handlers: Array<{ handler: TransportHandler; priority: number }> = []
  private authHandler?: TransportHandler

  static create(): HandlerChainBuilder {
    return new HandlerChainBuilder()
  }

  /**
   * Enable debug mode
   */
  withDebug(enabled: boolean): this {
    this.config.debug = enabled
    return this
  }

  /**
   * Set logger
   */
  withLogger(logger: Logger): this {
    this.config.logger = logger
    return this
  }

  /**
   * Set fallback handler
   */
  withFallback(
    handler: (request: Request, context: HandlerContext) => Promise<Response>
  ): this {
    this.config.fallbackHandler = handler
    return this
  }

  /**
   * Enable/disable handler selection caching
   */
  withCaching(enabled: boolean): this {
    this.config.cacheHandlerSelection = enabled
    return this
  }

  /**
   * Set default timeout
   */
  withTimeout(ms: number): this {
    this.config.defaultTimeout = ms
    return this
  }

  /**
   * Set auth handler (will wrap all other handlers)
   */
  withAuth(handler: TransportHandler): this {
    this.authHandler = handler
    return this
  }

  /**
   * Add a handler
   */
  use(handler: TransportHandler, priority: number = 0): this {
    this.handlers.push({ handler, priority })
    return this
  }

  /**
   * Build the handler chain
   */
  build(): HandlerChain {
    const chain = new HandlerChain(this.config)

    for (const { handler, priority } of this.handlers) {
      // Wrap with auth if auth handler is set
      const finalHandler = this.authHandler
        ? wrapWithMiddleware(this.authHandler, handler)
        : handler

      chain.use(finalHandler, priority)
    }

    // Add auth handler itself at highest priority for auth-specific routes
    if (this.authHandler) {
      chain.use(this.authHandler, 1000)
    }

    return chain
  }
}

// ============================================================================
// CONTEXT FACTORY
// ============================================================================

/**
 * Create a handler context from DO components
 *
 * @param options - Context creation options
 * @returns Handler context
 */
export function createHandlerContext(options: {
  env: Record<string, unknown>
  ctx: { waitUntil: (p: Promise<unknown>) => void; passThroughOnException: () => void }
  state: {
    id: { toString: () => string; equals: (other: unknown) => boolean; name?: string }
    storage: unknown
    waitUntil: (p: Promise<unknown>) => void
    blockConcurrencyWhile: <T>(cb: () => Promise<T>) => Promise<T>
  }
  instance: Record<string, unknown>
  methods?: Map<string, MethodInfo>
}): HandlerContext {
  return {
    env: options.env,
    ctx: options.ctx as HandlerContext['ctx'],
    state: options.state as HandlerContext['state'],
    instance: options.instance,
    methods: options.methods ?? new Map(),
  }
}

/**
 * Discover methods from a DO instance for the handler context
 *
 * @param instance - The DO instance
 * @param options - Discovery options
 * @returns Map of method names to method info
 */
export function discoverMethods(
  instance: Record<string, unknown>,
  options: {
    blockedMethods?: Set<string>
    includePrivate?: boolean
  } = {}
): Map<string, MethodInfo> {
  const methods = new Map<string, MethodInfo>()
  const { blockedMethods = new Set(), includePrivate = false } = options

  // Default blocked methods
  const defaultBlocked = new Set([
    'constructor',
    'fetch',
    'alarm',
    'webSocketMessage',
    'webSocketClose',
    'webSocketError',
  ])

  const visited = new Set<string>()
  let obj = instance

  while (obj && obj !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(obj)) {
      if (visited.has(key)) continue
      visited.add(key)

      // Skip blocked
      if (blockedMethods.has(key) || defaultBlocked.has(key)) continue

      // Skip private unless explicitly included
      if (!includePrivate && key.startsWith('_')) continue

      // Check if it's a function
      const value = instance[key]
      if (typeof value === 'function') {
        methods.set(key, {
          name: key,
        })
      }
    }

    obj = Object.getPrototypeOf(obj)
  }

  return methods
}
