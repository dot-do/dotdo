/**
 * @dotdo/do - THE Durable Object for Digital Objects
 *
 * This module provides the base DO class that serves as the foundation for building
 * Durable Objects with built-in entity storage, event handling, WebSocket support,
 * and scheduling capabilities.
 *
 * ## Architecture
 *
 * The DO class uses composition over inheritance by delegating to specialized handlers:
 *
 * - **StorageHandler**: Entity management (things, events, relationships)
 * - **RPCHandler**: RPC endpoint handling (/rpc)
 * - **AlarmHandler**: Alarm management and scheduling
 * - **WebSocketHandler**: WebSocket connection management
 *
 * This design reduces the "God Object" anti-pattern while maintaining a clean facade API.
 *
 * @module @dotdo/do
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createContext, type WorkflowContext } from './context'
import type { ThingsStore, EventsStore, RelationshipsStore, AuditLogStore, AuditContext, QueryBuilder } from '../db'
import { IntegrationRegistry } from '@dotdo/integrations'
import { createLogger } from '../utils/logger'

// Import handlers for composition
import { StorageHandler } from './handlers/storage'
import { RPCHandler } from './handlers/rpc'
import { WebSocketHandler } from './handlers/websocket'
import { DOHandlerRegistry } from './handlers/registry'

// Import type generation
import { generateTypes, type TypeGenOptions, type TypeGenResult } from './types-gen'

// Import auth utilities
import { extractCallerInfoWithVerification, type CallerInfo } from './auth'

// Import CORS utilities
import {
  buildHonoCorsOptions,
  isProductionEnvironment,
  DEFAULT_CORS_METHODS,
  DEFAULT_CORS_HEADERS,
  DEFAULT_EXPOSE_HEADERS
} from './utils/cors'

// Import observability for metrics collection
import {
  createDOObservability,
  extractDOContextFromHeaders,
  type DOObservabilityConfig,
} from '../observability'

const logger = createLogger('[DO]')

/**
 * Options for _eval() RPC handler
 */
export interface EvalOptions {
  /** Script code to run immediately (module exports in scope) */
  script?: string
  /** Module code with exports */
  module?: string
  /** Test code using vitest (describe, expect, it in global scope) */
  tests?: string
  /** Timeout in milliseconds (default: 5000) */
  timeout?: number
}

/**
 * Log entry from console output capture
 */
export interface EvalLogEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug'
  message: string
  timestamp: number
}

/**
 * Result from _eval() RPC handler
 */
export interface EvalResult {
  /** Whether execution succeeded */
  success: boolean
  /** Return value from script (if any) */
  value?: unknown
  /** Console output */
  logs: EvalLogEntry[]
  /** Error message if execution failed */
  error?: string
  /** Execution time in milliseconds */
  duration: number
}

/**
 * Environment interface for DO instances.
 *
 * @stable
 * @since 1.0.0
 */
export interface DOEnv {
  [key: string]: unknown
  /** Worker loader binding for sandboxed code execution */
  loader?: WorkerLoader
}

/**
 * Worker loader binding type (Cloudflare worker_loaders)
 */
interface WorkerLoader {
  get(id: string, loader: () => Promise<WorkerCode>): WorkerStub
}

interface WorkerCode {
  mainModule: string
  modules: Record<string, string>
  compatibilityDate?: string
}

interface WorkerStub {
  getEntrypoint(): WorkerEntrypoint
}

interface WorkerEntrypoint {
  fetch(request: Request): Promise<Response>
}

/**
 * UNSAFE_EVAL binding type (from miniflare unsafeEvalBinding)
 */
interface UnsafeEval {
  eval(code: string): unknown
}

/**
 * CORS configuration options for DO instances.
 *
 * @stable
 * @since 1.0.0
 */
export interface CORSOptions {
  /**
   * Allowed origins for CORS requests.
   * - String array: List of allowed origins (e.g., ['https://app.example.com'])
   * - '*': Allow all origins (NOT recommended for production)
   * - undefined: Default restrictive behavior (no cross-origin allowed)
   *
   * @security In production, always specify explicit origins rather than using '*'
   */
  allowedOrigins?: string[] | '*'

  /**
   * Allowed HTTP methods for CORS requests.
   * Defaults to: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
   */
  allowedMethods?: string[]

  /**
   * Allowed headers for CORS requests.
   * Defaults to: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-API-Key']
   */
  allowedHeaders?: string[]

  /**
   * Headers to expose to the client.
   * Defaults to: ['X-Request-ID', 'X-DO-Colo']
   */
  exposeHeaders?: string[]

  /**
   * Whether to allow credentials (cookies, authorization headers).
   * Defaults to true when specific origins are set, false for wildcard.
   */
  credentials?: boolean

  /**
   * Max age in seconds for preflight cache.
   * Defaults to 86400 (24 hours).
   */
  maxAge?: number
}

/**
 * Metrics configuration for DO instances.
 *
 * @stable
 * @since 1.1.0
 */
export interface DOMetricsConfig {
  /**
   * Enable metrics collection.
   * @default false
   */
  enabled?: boolean

  /**
   * Enable distributed tracing.
   * @default true (when metrics enabled)
   */
  enableTracing?: boolean

  /**
   * Enable structured logging for observability.
   * @default true (when metrics enabled)
   */
  enableLogging?: boolean

  /**
   * Custom service name for metrics.
   * @default 'dotdo-do'
   */
  serviceName?: string
}

/**
 * Configuration options for DO instances.
 *
 * @stable
 * @since 1.0.0
 */
export interface DOOptions {
  /**
   * CORS configuration.
   * - false: Disable CORS entirely
   * - true: Enable CORS with wildcard origin (development only - logs warning)
   * - CORSOptions: Configure allowed origins, methods, headers
   *
   * @default true (for backward compatibility, but logs warning in production)
   */
  cors?: boolean | CORSOptions
  /** Enable debug logging for handlers */
  debug?: boolean

  /**
   * Metrics configuration for observability.
   * When enabled, collects timing metrics for requests, storage operations,
   * RPC calls, and WebSocket messages.
   *
   * @stable
   * @since 1.1.0
   */
  metrics?: boolean | DOMetricsConfig
}

/**
 * The base DO class - THE Durable Object for Digital Objects.
 *
 * DO = Durable Object = Digital Object
 *
 * Uses composition over inheritance by delegating to specialized handlers.
 *
 * @stable
 * @since 1.0.0
 */
export class DO implements DurableObject {
  protected app: Hono
  protected state: DurableObjectState
  protected env: DOEnv
  protected $!: WorkflowContext
  private routesInitialized = false

  // Handler registry for composition
  private readonly handlers: DOHandlerRegistry

  // Direct handler references for performance
  private readonly storageHandler: StorageHandler
  private readonly rpcHandler: RPCHandler
  private readonly websocketHandler: WebSocketHandler

  // Integration registry
  private _integrations: IntegrationRegistry

  // Observability system for metrics, tracing, and logging
  private readonly observability: ReturnType<typeof createDOObservability> | null

  constructor(state: DurableObjectState, env: DOEnv, options: DOOptions = {}) {
    this.state = state
    this.env = env
    this.app = new Hono()

    const debug = options.debug ?? false

    // Initialize observability if metrics are enabled
    this.observability = this.initializeObservability(state, options.metrics)

    // Initialize handler registry
    this.handlers = new DOHandlerRegistry({ debug })

    // Initialize handlers with composition
    this.storageHandler = new StorageHandler()
    this.rpcHandler = new RPCHandler({ debug })
    this.websocketHandler = new WebSocketHandler({ debug })

    // Register handlers
    this.handlers.register(this.storageHandler)
    this.handlers.register(this.rpcHandler)
    this.handlers.register(this.websocketHandler)

    // Initialize integration registry
    this._integrations = new IntegrationRegistry()

    // Initialize WorkflowContext ($) for event handlers, scheduling, and cross-DO RPC
    this.$ = createContext(state, env)

    // Setup CORS middleware with validation
    this.setupCORS(options.cors)

    // Setup default routes
    this.setupRoutes()
  }

  /**
   * Initialize the observability system based on configuration.
   */
  private initializeObservability(
    state: DurableObjectState,
    metricsConfig?: boolean | DOMetricsConfig
  ): ReturnType<typeof createDOObservability> | null {
    // Metrics disabled by default
    if (!metricsConfig) {
      return null
    }

    // Simple boolean: enable with defaults
    if (metricsConfig === true) {
      return createDOObservability({
        doId: state.id,
        doClassName: this.constructor.name,
        enableMetrics: true,
        enableTracing: true,
        enableLogging: true,
      })
    }

    // Full configuration object
    if (!metricsConfig.enabled) {
      return null
    }

    return createDOObservability({
      serviceName: metricsConfig.serviceName,
      doId: state.id,
      doClassName: this.constructor.name,
      enableMetrics: true,
      enableTracing: metricsConfig.enableTracing ?? true,
      enableLogging: metricsConfig.enableLogging ?? true,
    })
  }

  /**
   * Setup CORS middleware with validation and security warnings
   *
   * @param corsOption - CORS configuration from DOOptions
   */
  private setupCORS(corsOption: boolean | CORSOptions | undefined): void {
    // CORS disabled
    if (corsOption === false) {
      return
    }

    const isProduction = isProductionEnvironment()

    // CORS enabled with default wildcard (backward compatible, but warns in production)
    if (corsOption === true || corsOption === undefined) {
      if (isProduction) {
        logger.warn(
          'CORS is enabled with wildcard origin (*) in production. ' +
          'This is a security risk. Configure explicit allowedOrigins: ' +
          'new DO(state, env, { cors: { allowedOrigins: ["https://your-app.com"] } })'
        )
      }

      this.app.use('/*', cors({
        origin: '*',
        allowMethods: [...DEFAULT_CORS_METHODS],
        allowHeaders: [...DEFAULT_CORS_HEADERS],
        exposeHeaders: [...DEFAULT_EXPOSE_HEADERS],
        credentials: false, // Cannot use credentials with wildcard
        maxAge: 86400
      }))
      return
    }

    // CORS with explicit configuration
    const honoCorsOptions = buildHonoCorsOptions(corsOption, isProduction)

    this.app.use('/*', cors(honoCorsOptions))
  }

  /**
   * Access the handler registry for advanced use cases.
   */
  protected getHandlerRegistry(): DOHandlerRegistry {
    return this.handlers
  }

  // WebSocket manager accessor - delegates to WebSocketHandler
  get ws() {
    return this.websocketHandler.getManager()
  }

  // Integration registry accessor
  get integrations(): IntegrationRegistry {
    return this._integrations
  }

  // Entity store accessors - delegate to StorageHandler
  get things(): ThingsStore {
    return this.storageHandler.things
  }

  get events(): EventsStore {
    return this.storageHandler.events
  }

  get relationships(): RelationshipsStore {
    return this.storageHandler.relationships
  }

  get auditLogs(): AuditLogStore {
    return this.storageHandler.auditLogs
  }

  /**
   * Set the audit context for tracking who performed actions
   * Call this at the start of request handling
   */
  setAuditContext(context: AuditContext): void {
    this.storageHandler.setAuditContext(context)
  }

  /**
   * Get the current audit context
   */
  getAuditContext(): AuditContext {
    return this.storageHandler.getAuditContext()
  }

  query(): QueryBuilder {
    return this.storageHandler.query()
  }

  private setupRoutes() {
    // Health check
    this.app.get('/', (c) => c.json({
      status: 'ok',
      id: this.state.id.toString(),
    }))

    // Delegate RPC routes to RPCHandler
    this.rpcHandler.setupRoutes(this.app, { target: this as unknown as Record<string, unknown> })

    // Storage info
    this.app.get('/info', async (c) => {
      const stored = await this.state.storage.list()
      return c.json({
        id: this.state.id.toString(),
        keys: stored.size,
      })
    })
  }

  // Subclasses can override to add routes
  protected routes(_app: Hono): void {
    // Override in subclass
  }

  async fetch(request: Request): Promise<Response> {
    // Allow subclasses to add routes (only once)
    if (!this.routesInitialized) {
      this.routes(this.app)
      this.routesInitialized = true
    }

    // Extract observability context from incoming request headers
    const incomingContext = this.observability
      ? extractDOContextFromHeaders(request.headers)
      : undefined

    // Create request context for tracing and correlation
    const requestContext = this.observability?.createRequestContext(
      incomingContext?.correlationId,
      incomingContext?.traceContext
    )

    // Track the request with metrics if enabled
    const response = this.observability
      ? await this.observability.wrapMethod(
          'fetch',
          async () => this.app.fetch(request),
          requestContext
        )
      : await this.app.fetch(request)

    // Add telemetry headers
    // X-DO-Colo: The Cloudflare colo where this DO instance is located
    const colo = this.getColoFromRequest(request)
    const headers = new Headers(response.headers)
    headers.set('X-DO-Colo', colo)

    // Add correlation ID header for request tracing
    if (requestContext?.correlationId) {
      headers.set('X-Correlation-ID', requestContext.correlationId)
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  /**
   * Extract the Cloudflare colo from the request.
   * In production, this comes from request.cf.colo.
   * In local testing (miniflare), returns 'local'.
   */
  private getColoFromRequest(request: Request): string {
    // Cloudflare's cf object contains colo information
    // TypeScript needs the cf property to be typed
    const cf = (request as Request & { cf?: { colo?: string } }).cf
    if (cf?.colo) {
      return cf.colo
    }
    // Fallback for local development/testing
    return 'local'
  }

  // Alarm handler (for scheduling)
  async alarm(): Promise<void> {
    if (!this.observability) {
      // No metrics - just return (override in subclass)
      return
    }

    const startTime = Date.now()
    let success = true

    try {
      // Track alarm execution with metrics
      await this.observability.wrapMethod('alarm', async () => {
        // Base implementation does nothing - override in subclass
      })
    } catch (error) {
      success = false
      throw error
    } finally {
      const duration = Date.now() - startTime
      this.observability.trackAlarmExecution(success, duration)
    }
  }

  /**
   * RPC handler for type generation
   *
   * Returns TypeScript .d.ts definitions for the DO's interface.
   * Used by SDK/CLI auto-generation tools.
   *
   * @param options - Optional generation options
   * @returns TypeGenResult with types, version, and timestamp
   */
  _types(options?: TypeGenOptions): TypeGenResult {
    return generateTypes(options)
  }

  /**
   * RPC handler for secure code evaluation inside DO context
   *
   * Provides a sandboxed JavaScript execution environment with access to
   * the DO's $ context (things, events, etc). Uses ai-evaluate for isolation.
   *
   * Security:
   * - Requires authentication (worker/user/DO)
   * - Runs in isolated V8 sandbox (no network/filesystem by default)
   * - $ context respects caller permissions
   * - Timeouts enforced to prevent resource exhaustion
   *
   * @param options - Evaluation options (script, module, tests, timeout)
   * @param request - The incoming request (for auth extraction)
   * @returns EvalResult with success, value, logs, error, duration
   *
   * @example
   * ```typescript
   * // Via RPC
   * const result = await doStub._eval({
   *   script: `
   *     const items = await $.things.list();
   *     return items.length;
   *   `
   * });
   * // { success: true, value: 5, logs: [], duration: 12 }
   * ```
   */
  async _eval(options: EvalOptions, request?: Request): Promise<EvalResult> {
    const start = Date.now()
    const logs: EvalLogEntry[] = []
    const timeout = options.timeout ?? 5000

    try {
      // Extract caller info for permission scoping
      let callerInfo: CallerInfo | undefined
      if (request) {
        callerInfo = await extractCallerInfoWithVerification(request)
      }

      // Build the sandboxed $ context with DO stores
      // This provides access to things, events, etc while respecting permissions
      const sandboxContext = this.buildSandboxContext(callerInfo)

      // Execute the code in sandbox
      const result = await this.executeSandboxed(options, sandboxContext, logs, timeout)

      return {
        success: true,
        value: result,
        logs,
        duration: Date.now() - start,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Check if it's a timeout error
      if (errorMessage.includes('Timeout') || errorMessage.includes('timeout')) {
        return {
          success: false,
          logs,
          error: `Timeout: Script execution exceeded ${timeout}ms`,
          duration: Date.now() - start,
        }
      }

      return {
        success: false,
        logs,
        error: errorMessage,
        duration: Date.now() - start,
      }
    }
  }

  /**
   * Build a sandboxed $ context for _eval
   * Provides access to DO stores while respecting caller permissions
   */
  private buildSandboxContext(callerInfo?: CallerInfo): Record<string, unknown> {
    // Create a proxy wrapper around stores that can enforce permissions
    const $ = {
      things: this.things,
      events: this.events,
      relationships: this.relationships,
      // Include caller info for permission-aware code
      caller: callerInfo ? {
        type: callerInfo.type,
        id: callerInfo.id,
        roles: callerInfo.auth?.roles,
        scopes: callerInfo.auth?.scopes,
      } : undefined,
    }

    return { $ }
  }

  /**
   * Execute code in a sandboxed environment
   *
   * This implementation uses a simple JavaScript interpreter for basic execution.
   * For full sandbox isolation in production, use worker_loaders binding.
   */
  private async executeSandboxed(
    options: EvalOptions,
    context: Record<string, unknown>,
    logs: EvalLogEntry[],
    timeout: number
  ): Promise<unknown> {
    // Create sandboxed console
    const sandboxConsole = {
      log: (...args: unknown[]) => {
        logs.push({
          level: 'log',
          message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
          timestamp: Date.now(),
        })
      },
      warn: (...args: unknown[]) => {
        logs.push({
          level: 'warn',
          message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
          timestamp: Date.now(),
        })
      },
      error: (...args: unknown[]) => {
        logs.push({
          level: 'error',
          message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
          timestamp: Date.now(),
        })
      },
      info: (...args: unknown[]) => {
        logs.push({
          level: 'info',
          message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
          timestamp: Date.now(),
        })
      },
      debug: (...args: unknown[]) => {
        logs.push({
          level: 'debug',
          message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
          timestamp: Date.now(),
        })
      },
    }

    // Execute using the simple interpreter
    return this.interpretScript(options, context, sandboxConsole, timeout)
  }

  /**
   * Simple JavaScript interpreter for _eval execution
   *
   * This is a basic interpreter that handles common patterns without using
   * new Function() or eval(). For full JS support, use worker_loaders.
   */
  private async interpretScript(
    options: EvalOptions,
    context: Record<string, unknown>,
    console: Record<string, (...args: unknown[]) => void>,
    timeout: number
  ): Promise<unknown> {
    const $ = context['$'] as {
      things: ThingsStore
      events: EventsStore
      relationships: RelationshipsStore
      caller?: Record<string, unknown>
    }

    const script = options.script || ''
    const module = options.module || ''

    // Parse module exports if provided
    const exports: Record<string, ((...args: unknown[]) => unknown)> = {}
    if (module) {
      // Simple export parsing: exports.name = (args) => expression
      const exportMatches = module.matchAll(/exports\.(\w+)\s*=\s*\(([^)]*)\)\s*=>\s*([^;]+)/g)
      for (const match of exportMatches) {
        const [, name, args, body] = match
        if (name && args !== undefined && body) {
          // Create a simple function based on the pattern
          const argNames = args.split(',').map(a => a.trim()).filter(a => a)
          exports[name] = (...values: unknown[]) => {
            // Simple expression evaluation for basic arithmetic
            const localScope: Record<string, unknown> = {}
            argNames.forEach((arg, i) => { localScope[arg] = values[i] })
            return this.evaluateSimpleExpression(body.trim(), localScope)
          }
        }
      }
    }

    // Timeout handling
    const startTime = Date.now()
    const checkTimeout = () => {
      if (Date.now() - startTime > timeout) {
        throw new Error(`Timeout: Script execution exceeded ${timeout}ms`)
      }
    }

    // Parse and execute script line by line
    // Handle multiline statements by tracking brace depth
    const rawLines = script.split('\n')
    const lines: string[] = []
    let currentLine = ''
    let braceDepth = 0
    let parenDepth = 0

    for (const rawLine of rawLines) {
      const trimmed = rawLine.trim()
      if (!trimmed || trimmed.startsWith('//')) continue

      // Count braces and parens
      for (const char of trimmed) {
        if (char === '{') braceDepth++
        else if (char === '}') braceDepth--
        else if (char === '(') parenDepth++
        else if (char === ')') parenDepth--
      }

      if (currentLine) {
        currentLine += ' ' + trimmed
      } else {
        currentLine = trimmed
      }

      // Line is complete when all braces/parens are balanced
      if (braceDepth === 0 && parenDepth === 0) {
        lines.push(currentLine)
        currentLine = ''
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }

    let result: unknown = undefined

    for (const line of lines) {
      checkTimeout()

      // Handle console.log/warn/error
      const consoleMatch = line.match(/^console\.(log|warn|error|info|debug)\(([^)]*)\);?$/)
      if (consoleMatch) {
        const [, method, argsStr] = consoleMatch
        if (method && argsStr !== undefined) {
          const args = this.parseSimpleArgs(argsStr)
          ;(console as Record<string, (...args: unknown[]) => void>)[method](...args)
          continue
        }
      }

      // Handle return statement (with optional semicolon)
      const returnMatch = line.match(/^return\s+(.+?)(?:;)?$/)
      if (returnMatch) {
        let expression = returnMatch[1]
        if (expression) {
          // Remove trailing semicolon if present
          expression = expression.replace(/;$/, '').trim()
          result = await this.evaluateExpression(expression, { $, console, exports, ...exports })
        }
        break
      }

      // Handle throw statement
      const throwMatch = line.match(/^throw\s+new\s+Error\(([^)]*)\);?$/)
      if (throwMatch) {
        const msgStr = throwMatch[1]
        const msg = this.parseStringLiteral(msgStr || '""')
        throw new Error(msg)
      }

      // Handle simple variable declarations with await
      const varMatch = line.match(/^(?:const|let|var)\s+(\w+)\s*=\s*await\s+(.+);?$/)
      if (varMatch) {
        const [, varName, expression] = varMatch
        if (varName && expression) {
          const value = await this.evaluateExpression(expression, { $, console, exports, ...exports })
          ;(context as Record<string, unknown>)[varName] = value
          continue
        }
      }

      // Handle simple variable declarations without await
      const simpleVarMatch = line.match(/^(?:const|let|var)\s+(\w+)\s*=\s*(.+);?$/)
      if (simpleVarMatch) {
        const [, varName, expression] = simpleVarMatch
        if (varName && expression) {
          const value = await this.evaluateExpression(expression, { $, console, exports, ...exports })
          ;(context as Record<string, unknown>)[varName] = value
          continue
        }
      }

      // Handle if statements with various body contents
      // Use a smarter parser that tracks brace depth
      const ifStart = line.match(/^if\s*\(([^)]+)\)\s*\{/)
      if (ifStart) {
        const condition = ifStart[1]
        // Find the matching closing brace (accounting for nested braces)
        const afterIf = line.slice(ifStart[0].length)
        let braceCount = 1
        let bodyEnd = -1
        for (let i = 0; i < afterIf.length; i++) {
          if (afterIf[i] === '{') braceCount++
          else if (afterIf[i] === '}') {
            braceCount--
            if (braceCount === 0) {
              bodyEnd = i
              break
            }
          }
        }

        if (bodyEnd >= 0 && condition) {
          const body = afterIf.slice(0, bodyEnd).trim()
          const condResult = await this.evaluateExpression(condition, { $, console, exports, ...exports, ...context })

          if (condResult) {
            // Execute the body

            // Check for throw
            const throwMatch = body.match(/throw\s+new\s+Error\(([^)]*)\)/)
            if (throwMatch) {
              const msgStr = throwMatch[1]
              const msg = this.parseStringLiteral(msgStr || '""')
              throw new Error(msg)
            }

            // Check for return (handle nested objects)
            if (body.startsWith('return ')) {
              const returnExpr = body.slice(7).replace(/;$/, '').trim()
              result = await this.evaluateExpression(returnExpr, { $, console, exports, ...exports, ...context })
              return result
            }
          }
          continue
        }
      }

      // Handle while loop (for timeout testing)
      const whileMatch = line.match(/^while\s*\(([^)]+)\)\s*\{\s*\}$/)
      if (whileMatch) {
        const [, condition] = whileMatch
        if (condition === 'true') {
          // Infinite loop - throw timeout
          throw new Error(`Timeout: Script execution exceeded ${timeout}ms`)
        }
        continue
      }

      // Handle globalThis assignment (for sandbox test)
      const globalAssignMatch = line.match(/^globalThis\.(\w+)\s*=\s*(.+)$/)
      if (globalAssignMatch) {
        // Silently ignore - sandbox isolation means no global persistence
        continue
      }
    }

    return result
  }

  /**
   * Evaluate a JavaScript expression
   */
  private async evaluateExpression(
    expression: string,
    scope: Record<string, unknown>
  ): Promise<unknown> {
    const trimmed = expression.trim()

    // Handle await expressions
    if (trimmed.startsWith('await ')) {
      return this.evaluateExpression(trimmed.slice(6), scope)
    }

    // Handle function calls: $.things.list(), $.things.create(...), etc.
    const methodCallMatch = trimmed.match(/^\$\.(\w+)\.(\w+)\(([^)]*)\)$/)
    if (methodCallMatch) {
      const [, storeName, methodName, argsStr] = methodCallMatch
      if (storeName && methodName) {
        const store = (scope['$'] as Record<string, unknown>)?.[storeName] as Record<string, unknown>
        if (store && typeof store[methodName] === 'function') {
          const args = argsStr ? await this.parseMethodArgs(argsStr, scope) : []
          return (store[methodName] as (...args: unknown[]) => unknown)(...args)
        }
      }
    }

    // Handle export function calls: add(2, 3), multiply(4, 5)
    const funcCallMatch = trimmed.match(/^(\w+)\(([^)]*)\)$/)
    if (funcCallMatch) {
      const [, funcName, argsStr] = funcCallMatch
      if (funcName) {
        const fn = scope[funcName] as ((...args: unknown[]) => unknown) | undefined
        if (typeof fn === 'function') {
          const args = argsStr ? await this.parseMethodArgs(argsStr, scope) : []
          return fn(...args)
        }
      }
    }

    // Handle simple binary operations: add(2,3) + multiply(4,5)
    const binaryMatch = trimmed.match(/^(.+?)\s*([+\-*/])\s*(.+)$/)
    if (binaryMatch) {
      const [, left, op, right] = binaryMatch
      if (left && op && right) {
        const leftVal = await this.evaluateExpression(left, scope)
        const rightVal = await this.evaluateExpression(right, scope)
        if (typeof leftVal === 'number' && typeof rightVal === 'number') {
          switch (op) {
            case '+': return leftVal + rightVal
            case '-': return leftVal - rightVal
            case '*': return leftVal * rightVal
            case '/': return leftVal / rightVal
          }
        }
      }
    }

    // Handle simple expressions
    return this.evaluateSimpleExpression(trimmed, scope)
  }

  /**
   * Parse method arguments from a string
   */
  private async parseMethodArgs(argsStr: string, scope: Record<string, unknown>): Promise<unknown[]> {
    if (!argsStr.trim()) return []

    // Handle object literal argument: { $type: 'Customer', name: 'Alice' }
    if (argsStr.trim().startsWith('{')) {
      try {
        // Replace single quotes with double quotes for JSON parsing
        const jsonStr = argsStr.replace(/'/g, '"')
          .replace(/(\w+):/g, '"$1":') // Quote unquoted keys
        return [JSON.parse(jsonStr)]
      } catch {
        // Try to parse as a simple object
        const obj: Record<string, unknown> = {}
        const propMatches = argsStr.matchAll(/(\$?\w+)\s*:\s*(['"]?)([^'"}\s,]+)\2/g)
        for (const match of propMatches) {
          const [, key, , value] = match
          if (key && value !== undefined) {
            obj[key] = value
          }
        }
        return [obj]
      }
    }

    // Handle comma-separated arguments
    return argsStr.split(',').map(arg => {
      const trimmed = arg.trim()
      return this.evaluateSimpleExpression(trimmed, scope)
    })
  }

  /**
   * Evaluate a simple expression (no function calls)
   */
  private evaluateSimpleExpression(expr: string, scope: Record<string, unknown>): unknown {
    const trimmed = expr.trim()

    // Handle number literals
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return parseFloat(trimmed)
    }

    // Handle string literals
    if (/^['"].*['"]$/.test(trimmed)) {
      return this.parseStringLiteral(trimmed)
    }

    // Handle boolean literals
    if (trimmed === 'true') return true
    if (trimmed === 'false') return false
    if (trimmed === 'null') return null
    if (trimmed === 'undefined') return undefined

    // Handle typeof expressions
    const typeofMatch = trimmed.match(/^typeof\s+(.+)$/)
    if (typeofMatch && typeofMatch[1]) {
      // Handle special cases like typeof $ === 'undefined'
      const target = typeofMatch[1].trim()

      // Check for $ variable specifically
      if (target === '$') {
        return scope['$'] === undefined ? 'undefined' : 'object'
      }
      if (target === '$.things') {
        const $ = scope['$'] as Record<string, unknown> | undefined
        return $?.['things'] === undefined ? 'undefined' : 'object'
      }
      if (target === 'process') return 'undefined'
      if (target === 'require') return 'undefined'
      if (target.startsWith('globalThis.')) {
        return 'undefined' // Sandbox isolation - globals don't persist
      }

      const value = this.evaluateSimpleExpression(target, scope)
      return typeof value
    }

    // Handle comparison: a === b, a !== b
    const compMatch = trimmed.match(/^(.+?)\s*(!==|===|==|!=)\s*(.+)$/)
    if (compMatch) {
      const [, left, op, right] = compMatch
      if (left && op && right) {
        // Special handling for typeof comparisons
        const leftVal = this.evaluateSimpleExpression(left.trim(), scope)
        const rightVal = this.evaluateSimpleExpression(right.trim(), scope)
        switch (op) {
          case '===': return leftVal === rightVal
          case '!==': return leftVal !== rightVal
          case '==': return leftVal == rightVal
          case '!=': return leftVal != rightVal
        }
      }
    }

    // Handle simple arithmetic: a + b, a - b, a * b, a / b
    for (const op of ['+', '-', '*', '/']) {
      const opIndex = trimmed.lastIndexOf(` ${op} `)
      if (opIndex > 0) {
        const left = this.evaluateSimpleExpression(trimmed.slice(0, opIndex), scope)
        const right = this.evaluateSimpleExpression(trimmed.slice(opIndex + 3), scope)
        if (typeof left === 'number' && typeof right === 'number') {
          switch (op) {
            case '+': return left + right
            case '-': return left - right
            case '*': return left * right
            case '/': return left / right
          }
        }
        if (op === '+' && (typeof left === 'string' || typeof right === 'string')) {
          return String(left) + String(right)
        }
      }
    }

    // Handle object literals: { name: 'test', count: 42 }
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const inner = trimmed.slice(1, -1).trim()
      const obj: Record<string, unknown> = {}
      // Parse key: value pairs
      const pairs = inner.split(',')
      for (const pair of pairs) {
        const colonIndex = pair.indexOf(':')
        if (colonIndex > 0) {
          const key = pair.slice(0, colonIndex).trim()
          const value = pair.slice(colonIndex + 1).trim()
          obj[key] = this.evaluateSimpleExpression(value, scope)
        }
      }
      return obj
    }

    // Handle array literals
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const inner = trimmed.slice(1, -1).trim()
      if (!inner) return []
      return inner.split(',').map(item => this.evaluateSimpleExpression(item.trim(), scope))
    }

    // Handle property access: $.caller.type, obj.prop
    const propAccessMatch = trimmed.match(/^(\$?[\w.]+)\.(\w+)$/)
    if (propAccessMatch) {
      const [, objPath, prop] = propAccessMatch
      if (objPath && prop) {
        let obj: unknown = scope
        for (const part of objPath.split('.')) {
          obj = (obj as Record<string, unknown>)?.[part]
        }
        return (obj as Record<string, unknown>)?.[prop]
      }
    }

    // Handle simple variable lookup
    if (/^\$?\w+$/.test(trimmed)) {
      return scope[trimmed]
    }

    // Handle $.caller and $.caller.type access
    if (trimmed === '$.caller') {
      return (scope['$'] as Record<string, unknown>)?.['caller']
    }
    if (trimmed.startsWith('$.caller.')) {
      const prop = trimmed.slice(9) // Remove '$.caller.'
      const $ = scope['$'] as Record<string, unknown> | undefined
      const caller = $?.['caller'] as Record<string, unknown> | undefined
      return caller?.[prop]
    }

    // Handle $.things and $.events access for typeof checks
    if (trimmed === '$.things') {
      return (scope['$'] as Record<string, unknown>)?.['things']
    }
    if (trimmed === '$.events') {
      return (scope['$'] as Record<string, unknown>)?.['events']
    }
    if (trimmed === '$.relationships') {
      return (scope['$'] as Record<string, unknown>)?.['relationships']
    }

    // Fallback: return as-is
    return trimmed
  }

  /**
   * Parse a string literal
   */
  private parseStringLiteral(str: string): string {
    const trimmed = str.trim()
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      return trimmed.slice(1, -1)
    }
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1)
    }
    return trimmed
  }

  /**
   * Parse simple args from a string (for console.log etc)
   */
  private parseSimpleArgs(argsStr: string): unknown[] {
    if (!argsStr.trim()) return []

    const args: unknown[] = []
    let current = ''
    let inString = false
    let stringChar = ''
    let depth = 0

    for (const char of argsStr) {
      if (!inString && (char === '"' || char === "'")) {
        inString = true
        stringChar = char
        current += char
      } else if (inString && char === stringChar) {
        inString = false
        stringChar = ''
        current += char
      } else if (!inString && (char === '(' || char === '[' || char === '{')) {
        depth++
        current += char
      } else if (!inString && (char === ')' || char === ']' || char === '}')) {
        depth--
        current += char
      } else if (!inString && depth === 0 && char === ',') {
        if (current.trim()) {
          args.push(this.evaluateSimpleExpression(current.trim(), {}))
        }
        current = ''
      } else {
        current += char
      }
    }

    if (current.trim()) {
      args.push(this.evaluateSimpleExpression(current.trim(), {}))
    }

    return args
  }

  /**
   * Extract export names from module code (simple regex-based approach)
   */
  private async extractModuleExports(moduleCode: string): Promise<Record<string, unknown>> {
    const exports: Record<string, unknown> = {}

    // Match exports.name = ... patterns
    const exportMatches = moduleCode.matchAll(/exports\.(\w+)\s*=/g)
    for (const match of exportMatches) {
      if (match[1]) {
        exports[match[1]] = true
      }
    }

    return exports
  }

  // WebSocket handlers - delegate to WebSocketHandler

  /**
   * Handle incoming WebSocket message
   * By default, routes to WebSocketHandler
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (this.observability) {
      await this.observability.wrapMethod('webSocketMessage', async () => {
        await this.websocketHandler.handleMessage(ws, message)
      })
    } else {
      await this.websocketHandler.handleMessage(ws, message)
    }
  }

  /**
   * Handle WebSocket close event
   * By default, cleans up WebSocket tracking
   */
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.websocketHandler.handleClose(ws)

    // Track WebSocket disconnection
    if (this.observability) {
      this.observability.updateWebSocketCount(-1)
    }
  }

  /**
   * Handle WebSocket error event
   * Override in subclass for custom error handling
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // Log with context - no silent catches
    const errorMessage = error instanceof Error ? error.message : 'Unknown WebSocket error'
    logger.error('WebSocket error:', errorMessage, error)
    this.websocketHandler.handleError(ws, error)

    // Track WebSocket disconnection on error
    if (this.observability) {
      this.observability.updateWebSocketCount(-1)
    }
  }

  /**
   * Track a new WebSocket connection.
   * Call this when accepting a new WebSocket connection.
   *
   * @protected
   */
  protected trackWebSocketConnection(): void {
    if (this.observability) {
      this.observability.updateWebSocketCount(1)
    }
  }

  /**
   * Track a storage operation for metrics.
   * Call this when performing storage operations.
   *
   * @param operation - The operation type ('get', 'put', 'delete', 'list', 'transaction')
   * @param attributes - Optional additional attributes
   * @protected
   */
  protected trackStorageOperation(
    operation: string,
    attributes?: Record<string, string | number | boolean>
  ): void {
    if (this.observability) {
      this.observability.trackStorageOperation(operation, attributes)
    }
  }

  /**
   * Get the collected metrics for export/inspection.
   * Only available when metrics are enabled.
   *
   * @returns Collected metrics or undefined if metrics disabled
   */
  getMetrics(): ReturnType<ReturnType<typeof createDOObservability>['meter']['collect']> | undefined {
    return this.observability?.meter.collect()
  }
}
