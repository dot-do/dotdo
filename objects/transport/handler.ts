/**
 * Unified Transport Handler Interface
 *
 * Defines a common interface for all transport handlers (REST, MCP, RPC),
 * enabling consistent request handling and handler composition.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Information about a DO method exposed via transport
 */
export interface MethodInfo {
  /** Method name */
  name: string
  /** HTTP methods supported (for REST) */
  httpMethods?: string[]
  /** Whether method requires authentication */
  requiresAuth?: boolean
  /** Required roles */
  roles?: string[]
  /** Required permissions */
  permissions?: string[]
  /** Rate limit config */
  rateLimit?: { requests: number; window: string }
  /** JSON schema for input validation */
  inputSchema?: Record<string, unknown>
  /** Description for documentation */
  description?: string
}

/**
 * Context passed to handlers during request processing
 */
export interface HandlerContext {
  /** Cloudflare environment bindings */
  env: Record<string, unknown>
  /** Cloudflare execution context */
  ctx: ExecutionContext
  /** Durable Object state */
  state: DurableObjectState
  /** Map of available methods and their metadata */
  methods: Map<string, MethodInfo>
  /** The DO instance to invoke methods on */
  instance: Record<string, unknown>
  /** Optional auth context if already authenticated */
  auth?: AuthContext
}

/**
 * Authentication context
 */
export interface AuthContext {
  authenticated: boolean
  user?: {
    id: string
    email?: string
    name?: string
    roles: string[]
    permissions: string[]
    organizationId?: string
  }
  session?: {
    id: string
    createdAt: Date
    expiresAt: Date
  }
  apiKey?: {
    id: string
    name: string
    scopes: string[]
  }
  token?: {
    type: 'jwt' | 'oauth' | 'api_key'
    issuer?: string
    expiresAt: Date
  }
}

/**
 * Simplified execution context for handlers
 */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

/**
 * Simplified durable object state for handlers
 */
export interface DurableObjectState {
  id: DurableObjectId
  storage: DurableObjectStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

/**
 * Durable object ID interface
 */
export interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

/**
 * Durable object storage interface
 */
export interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>
  put<T>(key: string, value: T): Promise<void>
  put<T>(entries: Record<string, T>): Promise<void>
  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  deleteAll(): Promise<void>
  list<T = unknown>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>>
}

/**
 * Result of handler's canHandle check
 */
export interface CanHandleResult {
  /** Whether this handler can process the request */
  canHandle: boolean
  /** Priority (higher = more specific, checked first) */
  priority?: number
  /** Reason for not handling (useful for debugging) */
  reason?: string
}

/**
 * Handler response with metadata
 */
export interface HandlerResponse {
  /** The HTTP response */
  response: Response
  /** Whether the handler fully processed the request */
  handled: boolean
  /** Optional metadata about the handling */
  metadata?: {
    handlerName: string
    processingTimeMs: number
    methodCalled?: string
  }
}

// ============================================================================
// TRANSPORT HANDLER INTERFACE
// ============================================================================

/**
 * Base interface for all transport handlers
 *
 * Handlers implement protocol-specific request processing (REST, MCP, RPC, etc.)
 * and can be composed into chains for flexible request routing.
 *
 * @example
 * ```typescript
 * class MyHandler implements TransportHandler {
 *   name = 'my-handler'
 *
 *   canHandle(request: Request): CanHandleResult {
 *     const url = new URL(request.url)
 *     return {
 *       canHandle: url.pathname.startsWith('/my-api'),
 *       priority: 10
 *     }
 *   }
 *
 *   async handle(request: Request, context: HandlerContext): Promise<Response> {
 *     // Process request...
 *     return new Response('OK')
 *   }
 * }
 * ```
 */
export interface TransportHandler {
  /** Handler name for debugging and logging */
  readonly name: string

  /**
   * Check if this handler can process the given request
   *
   * @param request - The incoming HTTP request
   * @returns Whether the handler can process this request and its priority
   */
  canHandle(request: Request): CanHandleResult

  /**
   * Process the request and return a response
   *
   * @param request - The incoming HTTP request
   * @param context - Handler context with environment, state, and methods
   * @returns HTTP response
   */
  handle(request: Request, context: HandlerContext): Promise<Response>

  /**
   * Optional cleanup when handler is no longer needed
   */
  dispose?(): void
}

/**
 * Extended handler interface for handlers that support middleware wrapping
 */
export interface WrappableHandler extends TransportHandler {
  /**
   * Wrap this handler with another handler (e.g., auth middleware)
   *
   * @param wrapper - The wrapping handler
   * @returns A new handler that applies the wrapper before this handler
   */
  wrap(wrapper: TransportHandler): TransportHandler
}

/**
 * Handler that can act as middleware, wrapping other handlers
 */
export interface MiddlewareHandler extends TransportHandler {
  /**
   * The wrapped handler that will be called after middleware processing
   */
  readonly wrapped: TransportHandler

  /**
   * Set the handler to wrap
   */
  setWrapped(handler: TransportHandler): void
}

// ============================================================================
// HANDLER FACTORY TYPES
// ============================================================================

/**
 * Options for creating handlers
 */
export interface HandlerOptions {
  /** Debug mode (include stack traces in errors) */
  debug?: boolean
  /** Custom logger */
  logger?: Logger
  /** Timeout for method execution (ms) */
  timeout?: number
}

/**
 * Logger interface for handlers
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/**
 * Factory function type for creating handlers
 */
export type HandlerFactory<T extends TransportHandler = TransportHandler> = (
  options?: HandlerOptions
) => T

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if a handler supports wrapping
 */
export function isWrappable(handler: TransportHandler): handler is WrappableHandler {
  return 'wrap' in handler && typeof (handler as WrappableHandler).wrap === 'function'
}

/**
 * Check if a handler is middleware
 */
export function isMiddleware(handler: TransportHandler): handler is MiddlewareHandler {
  return 'wrapped' in handler && 'setWrapped' in handler
}

// ============================================================================
// ABSTRACT BASE CLASS
// ============================================================================

/**
 * Abstract base class for transport handlers with common functionality
 */
export abstract class BaseHandler implements TransportHandler {
  abstract readonly name: string

  constructor(protected options: HandlerOptions = {}) {}

  abstract canHandle(request: Request): CanHandleResult
  abstract handle(request: Request, context: HandlerContext): Promise<Response>

  /**
   * Log a message if logger is configured
   */
  protected log(level: keyof Logger, message: string, ...args: unknown[]): void {
    if (this.options.logger) {
      this.options.logger[level](message, ...args)
    }
  }

  /**
   * Execute a method with optional timeout
   */
  protected async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs?: number
  ): Promise<T> {
    const timeout = timeoutMs ?? this.options.timeout

    if (!timeout) {
      return fn()
    }

    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Method execution timeout')), timeout)
      ),
    ])
  }

  dispose(): void {
    // Override in subclasses if cleanup is needed
  }
}
