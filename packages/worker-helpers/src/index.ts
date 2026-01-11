/**
 * @dotdo/worker-helpers
 *
 * Simple export helpers that allow customers to easily expose their Durable Objects
 * with minimal boilerplate.
 *
 * @example
 * // Single DO - minimal boilerplate
 * export default createWorker(MyDO)
 *
 * // With middleware
 * export default { fetch: withCORS(createHandler(MyDO)) }
 *
 * // Multiple DOs
 * export default createMultiDOWorker({ users: UserDO, posts: PostDO })
 */

// ============================================================================
// Types
// ============================================================================

/** Durable Object namespace interface */
export interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): DurableObjectId
  idFromString(id: string): DurableObjectId
  newUniqueId(options?: { jurisdiction?: string }): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub<T>
}

/** Durable Object ID interface */
export interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

/** Durable Object stub interface */
export interface DurableObjectStub<T = unknown> {
  id: DurableObjectId
  fetch(request: Request): Promise<Response>
  connect?(): WebSocket
}

/** Environment type - generic for any env bindings */
export type Env = Record<string, unknown>

/** Execution context interface */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

/** Durable Object class constructor type */
export interface DOClass {
  new (state: unknown, env: Env): DOInstance
  $type?: string
  name?: string
}

/** Durable Object instance interface */
export interface DOInstance {
  fetch?(request: Request): Promise<Response>
  handleWebSocket?(request: Request): Promise<Response>
  rpc?(method: string, args: unknown[]): Promise<unknown>
}

/** Fetch handler type */
export type FetchHandler = (
  request: Request,
  env: Env,
  ctx: ExecutionContext
) => Promise<Response>

/** Middleware function type */
export type Middleware = (
  request: Request,
  next: () => Promise<Response>,
  env?: Env,
  ctx?: ExecutionContext
) => Promise<Response>

/** Worker object type */
export interface Worker {
  fetch: FetchHandler
}

/** Options for createWorker */
export interface CreateWorkerOptions {
  /** Custom binding name override */
  bindingName?: string
  /** Source of DO id: 'path' (default), 'query', 'header' */
  idSource?: 'path' | 'query' | 'header'
  /** Header name when idSource is 'header' */
  idHeader?: string
  /** Path prefix to strip before extracting ID */
  pathPrefix?: string
  /** Custom id extractor function */
  idExtractor?: (request: Request) => string | undefined
  /** Custom id validator function */
  idValidator?: (id: string) => boolean
  /** Enable WebSocket support */
  websocket?: boolean
  /** Timeout in milliseconds */
  timeout?: number
}

/** Multi-DO config entry (simple form) */
export type SimpleDOConfig = DOClass

/** Multi-DO config entry (detailed form) */
export interface DetailedDOConfig {
  DO: DOClass
  pattern?: string
  binding?: string
  middleware?: Middleware[]
}

/** Multi-DO configuration */
export type MultiDOConfig = Record<string, SimpleDOConfig | DetailedDOConfig>

/** Options for createMultiDOWorker */
export interface MultiDOWorkerOptions {
  middleware?: Middleware[]
}

/** CORS options */
export interface CORSOptions {
  origin?: string | string[]
  methods?: string[]
  headers?: string[]
  credentials?: boolean
  maxAge?: number
}

/** Auth configuration */
export interface AuthConfig {
  type: 'bearer' | 'apiKey'
  header?: string
  validate: (token: string) => Promise<boolean>
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Converts a class name to SCREAMING_SNAKE_CASE for binding name inference
 * @example 'UserDO' -> 'USER_DO'
 * @example 'MyCustomDurableObject' -> 'MY_CUSTOM_DURABLE_OBJECT'
 */
export function inferBindingName(DOClass: { $type?: string; name?: string }): string {
  const name = DOClass.$type || DOClass.name || ''
  // Insert underscore before uppercase letters, then uppercase everything
  return name
    .replace(/([A-Z])/g, (match, letter, offset) => {
      // Don't add underscore at the start or if previous char is uppercase
      if (offset === 0) return letter
      const prevChar = name[offset - 1]
      // If previous is uppercase and current is uppercase, only add underscore
      // if the next char (if exists) is lowercase (to handle 'ABCService' -> 'ABC_SERVICE')
      if (prevChar === prevChar?.toUpperCase() && prevChar !== prevChar?.toLowerCase()) {
        const nextChar = name[offset + 1]
        if (nextChar && nextChar === nextChar.toLowerCase() && nextChar !== nextChar.toUpperCase()) {
          return '_' + letter
        }
        return letter
      }
      return '_' + letter
    })
    .toUpperCase()
}

/**
 * Resolves a DO namespace from environment by explicit binding name
 * @throws If binding is not found or not a valid DO namespace
 */
export function resolveDO<T = unknown>(env: Env, bindingName: string): DurableObjectNamespace<T> {
  const binding = env[bindingName]

  if (!binding) {
    throw new Error(`Durable Object binding '${bindingName}' not found in environment`)
  }

  // Validate it's a DO namespace by checking for required methods
  if (
    typeof binding !== 'object' ||
    binding === null ||
    typeof (binding as DurableObjectNamespace).idFromName !== 'function' ||
    typeof (binding as DurableObjectNamespace).get !== 'function'
  ) {
    throw new Error(`'${bindingName}' is not a Durable Object namespace`)
  }

  return binding as DurableObjectNamespace<T>
}

/**
 * Resolves a DO namespace from environment using the DO class
 * Uses $type or class name to infer binding name
 * @throws If binding is not found
 */
export function bindDO<T = unknown>(env: Env, DOClass: DOClass): DurableObjectNamespace<T> {
  const bindingName = inferBindingName(DOClass)
  return resolveDO<T>(env, bindingName)
}

/**
 * Auto-detects a DO binding from environment
 * @returns The namespace if found, undefined otherwise
 */
export function getDOBinding(env: Env, DOClass: DOClass): DurableObjectNamespace | undefined {
  const bindingName = inferBindingName(DOClass)
  const binding = env[bindingName]

  if (!binding) {
    return undefined
  }

  if (
    typeof binding !== 'object' ||
    binding === null ||
    typeof (binding as DurableObjectNamespace).idFromName !== 'function'
  ) {
    return undefined
  }

  return binding as DurableObjectNamespace
}

/**
 * Extracts DO ID from a request based on options
 */
function extractDOId(request: Request, options: CreateWorkerOptions = {}): string | undefined {
  // Custom extractor takes precedence
  if (options.idExtractor) {
    return options.idExtractor(request)
  }

  const url = new URL(request.url)

  switch (options.idSource) {
    case 'query':
      return url.searchParams.get('id') || undefined

    case 'header':
      const headerName = options.idHeader || 'X-DO-ID'
      return request.headers.get(headerName) || undefined

    case 'path':
    default: {
      let pathname = url.pathname

      // Strip path prefix if specified
      if (options.pathPrefix && pathname.startsWith(options.pathPrefix)) {
        pathname = pathname.slice(options.pathPrefix.length)
      }

      // Extract first path segment as ID
      const segments = pathname.split('/').filter(Boolean)
      return segments[0] || undefined
    }
  }
}

/**
 * Creates a JSON error response
 */
function errorResponse(message: string, status: number = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Creates a worker that proxies requests to a Durable Object
 *
 * @example
 * export default createWorker(MyDO)
 *
 * @example
 * export default createWorker(MyDO, {
 *   idSource: 'header',
 *   idHeader: 'X-User-ID'
 * })
 */
export function createWorker(DOClass: DOClass, options: CreateWorkerOptions = {}): Worker {
  return {
    fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
      try {
        // Resolve the DO binding
        const bindingName = options.bindingName || inferBindingName(DOClass)
        const namespace = env[bindingName] as DurableObjectNamespace | undefined

        if (!namespace) {
          return errorResponse(`Durable Object binding '${bindingName}' not found in environment`)
        }

        // Extract DO ID
        const doId = extractDOId(request, options)

        if (!doId) {
          return errorResponse('Missing Durable Object ID in request', 400)
        }

        // Validate ID if validator provided
        if (options.idValidator && !options.idValidator(doId)) {
          return errorResponse('Invalid Durable Object ID', 400)
        }

        // Get the DO stub
        const id = namespace.idFromName(doId)
        const stub = namespace.get(id)

        // Handle WebSocket upgrade if enabled
        if (options.websocket && request.headers.get('Upgrade') === 'websocket') {
          return await stub.fetch(request)
        }

        // Forward the request to the DO
        return await stub.fetch(request)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error'
        return errorResponse(message)
      }
    },
  }
}

/**
 * Creates a fetch handler for a Durable Object with optional middleware
 *
 * @example
 * export default { fetch: createHandler(MyDO) }
 *
 * @example
 * export default { fetch: createHandler(MyDO, [logMiddleware, authMiddleware]) }
 */
export function createHandler(DOClass: DOClass, middleware?: Middleware[]): FetchHandler {
  const worker = createWorker(DOClass)

  if (!middleware || middleware.length === 0) {
    return worker.fetch
  }

  // Wrap handler with middleware
  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    let index = 0

    const next = async (): Promise<Response> => {
      if (index < middleware.length) {
        const mw = middleware[index++]
        return mw(request, next, env, ctx)
      }
      return worker.fetch(request, env, ctx)
    }

    return next()
  }
}

/**
 * Creates an HTTP-only fetch handler (rejects WebSocket upgrades)
 *
 * @example
 * export default { fetch: createFetchHandler(MyDO) }
 */
export function createFetchHandler(DOClass: DOClass): FetchHandler {
  const worker = createWorker(DOClass)

  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    // Reject WebSocket upgrades
    if (request.headers.get('Upgrade') === 'websocket') {
      return new Response('WebSocket upgrades not supported', { status: 426 })
    }

    return worker.fetch(request, env, ctx)
  }
}

/**
 * Creates a WebSocket-only handler (requires WebSocket upgrade)
 *
 * @example
 * export default { fetch: createWebSocketHandler(MyDO) }
 */
export function createWebSocketHandler(DOClass: DOClass): FetchHandler {
  const worker = createWorker(DOClass, { websocket: true })

  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    // Require WebSocket upgrade
    if (request.headers.get('Upgrade') !== 'websocket') {
      return errorResponse('WebSocket upgrade required', 400)
    }

    return worker.fetch(request, env, ctx)
  }
}

/**
 * Creates a JSON-RPC 2.0 handler for a Durable Object
 *
 * @example
 * export default { fetch: createRPCHandler(MyDO) }
 */
export function createRPCHandler(DOClass: DOClass): FetchHandler {
  const worker = createWorker(DOClass)

  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    // Parse the JSON-RPC request
    let body: unknown

    try {
      body = await request.json()
    } catch {
      return Response.json({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
        id: null,
      })
    }

    // Handle batch requests
    if (Array.isArray(body)) {
      const results = await Promise.all(
        body.map((item) => processRPCRequest(item, worker.fetch, request, env, ctx))
      )
      return Response.json(results)
    }

    // Handle single request
    const result = await processRPCRequest(body, worker.fetch, request, env, ctx)
    return Response.json(result)
  }
}

/**
 * Process a single JSON-RPC request
 */
async function processRPCRequest(
  rpcRequest: unknown,
  handler: FetchHandler,
  originalRequest: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<unknown> {
  // Validate JSON-RPC structure
  if (
    typeof rpcRequest !== 'object' ||
    rpcRequest === null ||
    (rpcRequest as { jsonrpc?: string }).jsonrpc !== '2.0' ||
    typeof (rpcRequest as { method?: string }).method !== 'string'
  ) {
    return {
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid Request' },
      id: (rpcRequest as { id?: unknown })?.id ?? null,
    }
  }

  const { method, params, id } = rpcRequest as {
    method: string
    params?: unknown[]
    id?: unknown
  }

  try {
    // Create a modified request with RPC info
    const url = new URL(originalRequest.url)
    const rpcBody = JSON.stringify({ method, params })

    const rpcRequestObj = new Request(url.toString(), {
      method: 'POST',
      headers: {
        ...Object.fromEntries(originalRequest.headers),
        'Content-Type': 'application/json',
        'X-RPC-Method': method,
      },
      body: rpcBody,
    })

    const response = await handler(rpcRequestObj, env, ctx)
    const result = await response.json()

    return {
      jsonrpc: '2.0',
      result,
      id,
    }
  } catch (error) {
    return {
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Internal error',
      },
      id,
    }
  }
}

/**
 * Creates a worker that routes to multiple Durable Objects based on path
 *
 * @example
 * export default createMultiDOWorker({
 *   users: UserDO,
 *   posts: PostDO,
 * })
 *
 * @example
 * export default createMultiDOWorker({
 *   users: { DO: UserDO, pattern: '/api/v1/users/:id/*', binding: 'USER_DO' },
 *   posts: { DO: PostDO, middleware: [authMiddleware] },
 * })
 */
export function createMultiDOWorker(
  config: MultiDOConfig,
  options: MultiDOWorkerOptions = {}
): Worker {
  // Normalize config entries
  const routes: Array<{
    name: string
    DOClass: DOClass
    pattern?: string
    binding?: string
    middleware?: Middleware[]
  }> = []

  for (const [name, entry] of Object.entries(config)) {
    if (typeof entry === 'function') {
      // Simple form: just the DO class
      routes.push({ name, DOClass: entry as DOClass })
    } else {
      // Detailed form
      const detailed = entry as DetailedDOConfig
      routes.push({
        name,
        DOClass: detailed.DO,
        pattern: detailed.pattern,
        binding: detailed.binding,
        middleware: detailed.middleware,
      })
    }
  }

  return {
    fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
      const url = new URL(request.url)
      const pathname = url.pathname
      const segments = pathname.split('/').filter(Boolean)

      // Global middleware
      const runGlobalMiddleware = async (
        req: Request,
        finalHandler: () => Promise<Response>
      ): Promise<Response> => {
        if (!options.middleware || options.middleware.length === 0) {
          return finalHandler()
        }

        let index = 0
        const next = async (): Promise<Response> => {
          if (index < options.middleware!.length) {
            const mw = options.middleware![index++]
            return mw(req, next, env, ctx)
          }
          return finalHandler()
        }

        return next()
      }

      // Find matching route
      for (const route of routes) {
        let matches = false
        let doId: string | undefined

        if (route.pattern) {
          // Custom pattern matching
          const patternMatch = matchPattern(route.pattern, pathname)
          if (patternMatch) {
            matches = true
            doId = patternMatch.id
          }
        } else {
          // Default: match by route name as first segment
          if (segments[0] === route.name) {
            matches = true
            doId = segments[1]
          }
        }

        if (matches) {
          if (!doId) {
            return errorResponse('Missing Durable Object ID', 400)
          }

          // Resolve the DO binding
          const bindingName = route.binding || inferBindingName(route.DOClass)
          const namespace = env[bindingName] as DurableObjectNamespace | undefined

          if (!namespace) {
            return errorResponse(
              `Durable Object binding '${bindingName}' not found in environment`
            )
          }

          // Get the DO stub
          const id = namespace.idFromName(doId)
          const stub = namespace.get(id)

          // Create the final handler
          const finalHandler = async (): Promise<Response> => {
            // Per-route middleware
            if (route.middleware && route.middleware.length > 0) {
              let mwIndex = 0
              const mwNext = async (): Promise<Response> => {
                if (mwIndex < route.middleware!.length) {
                  const mw = route.middleware![mwIndex++]
                  return mw(request, mwNext, env, ctx)
                }
                return stub.fetch(request)
              }
              return mwNext()
            }

            return stub.fetch(request)
          }

          // Run with global middleware
          return runGlobalMiddleware(request, finalHandler)
        }
      }

      // No route matched
      return errorResponse('Not Found', 404)
    },
  }
}

/**
 * Match a pattern against a path
 * Supports patterns like '/api/v1/users/:id/*'
 */
function matchPattern(
  pattern: string,
  pathname: string
): { id?: string } | null {
  const patternSegments = pattern.split('/').filter(Boolean)
  const pathSegments = pathname.split('/').filter(Boolean)

  let id: string | undefined

  for (let i = 0; i < patternSegments.length; i++) {
    const patternSeg = patternSegments[i]
    const pathSeg = pathSegments[i]

    if (patternSeg === '*') {
      // Wildcard matches anything remaining
      return { id }
    }

    if (!pathSeg) {
      return null
    }

    if (patternSeg.startsWith(':')) {
      // Parameter segment
      if (patternSeg === ':id') {
        id = pathSeg
      }
      continue
    }

    if (patternSeg !== pathSeg) {
      return null
    }
  }

  return { id }
}

// ============================================================================
// Middleware Helpers
// ============================================================================

/**
 * Wraps a handler with one or more middleware functions
 *
 * @example
 * const handler = withMiddleware(baseHandler, logMiddleware, authMiddleware)
 */
export function withMiddleware(
  handler: FetchHandler,
  ...middleware: Middleware[]
): FetchHandler {
  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    let index = 0

    const next = async (): Promise<Response> => {
      if (index < middleware.length) {
        const mw = middleware[index++]
        return mw(request, next, env, ctx)
      }
      return handler(request, env, ctx)
    }

    return next()
  }
}

/**
 * Wraps a handler with error handling
 *
 * @example
 * const handler = withErrorHandler(baseHandler)
 *
 * @example
 * const handler = withErrorHandler(baseHandler, (error) =>
 *   new Response(error.message, { status: 500 })
 * )
 */
export function withErrorHandler(
  handler: FetchHandler,
  errorHandler?: (error: Error) => Response
): FetchHandler {
  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    try {
      return await handler(request, env, ctx)
    } catch (error) {
      if (errorHandler) {
        return errorHandler(error instanceof Error ? error : new Error(String(error)))
      }

      const message = error instanceof Error ? error.message : 'Internal server error'
      return Response.json({ error: message }, { status: 500 })
    }
  }
}

/**
 * Wraps a handler with CORS support
 *
 * @example
 * const handler = withCORS(baseHandler)
 *
 * @example
 * const handler = withCORS(baseHandler, {
 *   origin: 'https://example.com.ai',
 *   methods: ['GET', 'POST'],
 * })
 */
export function withCORS(handler: FetchHandler, options?: CORSOptions): FetchHandler {
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  if (options?.origin) {
    corsHeaders['Access-Control-Allow-Origin'] = Array.isArray(options.origin)
      ? options.origin.join(', ')
      : options.origin
  }

  if (options?.methods) {
    corsHeaders['Access-Control-Allow-Methods'] = options.methods.join(', ')
  }

  if (options?.headers) {
    corsHeaders['Access-Control-Allow-Headers'] = options.headers.join(', ')
  }

  if (options?.credentials) {
    corsHeaders['Access-Control-Allow-Credentials'] = 'true'
  }

  if (options?.maxAge) {
    corsHeaders['Access-Control-Max-Age'] = String(options.maxAge)
  }

  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    // Handle preflight OPTIONS request
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      })
    }

    // Execute handler and add CORS headers to response
    const response = await handler(request, env, ctx)

    // Create new response with CORS headers
    const newHeaders = new Headers(response.headers)
    for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value)
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    })
  }
}

/**
 * Wraps a handler with authentication
 *
 * @example
 * const handler = withAuth(baseHandler, {
 *   type: 'bearer',
 *   validate: async (token) => token === 'secret',
 * })
 *
 * @example
 * const handler = withAuth(baseHandler, {
 *   type: 'apiKey',
 *   header: 'X-API-Key',
 *   validate: async (key) => key === 'secret',
 * })
 */
export function withAuth(handler: FetchHandler, config: AuthConfig): FetchHandler {
  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    let token: string | null = null

    if (config.type === 'bearer') {
      const authHeader = request.headers.get('Authorization')
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7)
      }
    } else if (config.type === 'apiKey') {
      const headerName = config.header || 'X-API-Key'
      token = request.headers.get(headerName)
    }

    // Check for missing auth
    if (!token) {
      return Response.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Validate the token
    const isValid = await config.validate(token)
    if (!isValid) {
      return Response.json({ error: 'Invalid authentication' }, { status: 401 })
    }

    return handler(request, env, ctx)
  }
}
