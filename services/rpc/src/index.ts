/**
 * RPC.do - Unified Gateway
 *
 * Main entry point for the unified gateway that all *.do services route through.
 *
 * Features:
 * - Authentication via id.org.ai
 * - Rate limiting per tenant/agent
 * - Usage metering (calls, messages, charges)
 * - Promise pipelining (batch multiple service calls)
 * - Request routing to appropriate *.do service
 * - Audit logging
 *
 * @module services/rpc
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

// Core modules
export * from './types'
export * from './router'
export * from './auth'
export * from './metering'
export * from './rate-limit'
export * from './pipeline'
export * from './audit'

// Import implementations
import {
  GatewayRouter,
  createRouter,
  createDefaultRegistry,
  InMemoryServiceRegistry,
} from './router'
import {
  gatewayAuth,
  requireAuth,
  requireRole,
  requirePermission,
  InMemoryApiKeyStore,
  KVApiKeyStore,
} from './auth'
import {
  MeteringService,
  meteringMiddleware,
  createDevMeteringService,
  createProdMeteringService,
  InMemoryUsageSink,
} from './metering'
import {
  rateLimitMiddleware,
  createDevRateLimiter,
  createKVRateLimiter,
  InMemoryRateLimitStore,
  DEFAULT_TIER_CONFIGS,
} from './rate-limit'
import { PipelineExecutor, PipelineClient, createPipelineClient, BatchBuilder } from './pipeline'
import {
  AuditLogger,
  auditMiddleware,
  createDevAuditLogger,
  createKVAuditLogger,
  InMemoryAuditSink,
} from './audit'

import type {
  GatewayRequest,
  GatewayResponse,
  BatchedRequest,
  BatchedResponse,
  AuthContext,
  GatewayConfig,
} from './types'
import type { RequestContext } from './router'
import type { PipelineRequest } from './pipeline'

// ============================================================================
// Environment Types
// ============================================================================

/**
 * Gateway environment bindings
 */
export interface GatewayEnv {
  /** KV namespace for sessions/caching */
  KV?: KVNamespace
  /** Rate limit KV namespace */
  RATE_LIMIT_KV?: KVNamespace
  /** Audit log KV namespace */
  AUDIT_KV?: KVNamespace
  /** Analytics pipeline (Cloudflare Analytics Engine) */
  ANALYTICS?: { send: (events: unknown[]) => Promise<void> }
  /** Cloudflare rate limit binding */
  RATE_LIMIT?: { limit: (params: { key: string }) => Promise<{ success: boolean }> }
  /** Service bindings for internal routing */
  AGENTS_SERVICE?: { fetch: typeof fetch }
  WORKERS_SERVICE?: { fetch: typeof fetch }
  FUNCTIONS_SERVICE?: { fetch: typeof fetch }
  WORKFLOWS_SERVICE?: { fetch: typeof fetch }
  DATABASE_SERVICE?: { fetch: typeof fetch }
  LLM_SERVICE?: { fetch: typeof fetch }
  /** JWT configuration */
  JWT_SECRET?: string
  JWKS_URL?: string
  /** Environment (development, staging, production) */
  ENVIRONMENT?: string
}

// ============================================================================
// Gateway Application
// ============================================================================

/**
 * Gateway options
 */
export interface GatewayOptions {
  /** Gateway configuration */
  config?: Partial<GatewayConfig>
  /** Custom service registry */
  registry?: InMemoryServiceRegistry
  /** Custom API key store */
  apiKeyStore?: InMemoryApiKeyStore | KVApiKeyStore
  /** Whether to enable development mode */
  devMode?: boolean
}

/**
 * Create the gateway Hono application
 */
export function createGateway(options: GatewayOptions = {}): Hono<{ Bindings: GatewayEnv }> {
  const app = new Hono<{ Bindings: GatewayEnv }>()

  const config: GatewayConfig = {
    name: 'rpc.do',
    version: '1.0.0',
    defaultTimeout: 30000,
    maxBatchSize: 100,
    enableLogging: true,
    enableMetrics: true,
    enableTracing: true,
    ...options.config,
  }

  // ============================================================================
  // Global Middleware
  // ============================================================================

  // CORS
  app.use(
    '*',
    cors({
      origin: config.cors?.origins || ['*'],
      allowMethods: config.cors?.methods || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: config.cors?.headers || ['Content-Type', 'Authorization', 'X-API-Key'],
      credentials: config.cors?.credentials || false,
      maxAge: config.cors?.maxAge || 86400,
    })
  )

  // Request logging
  if (config.enableLogging) {
    app.use('*', logger())
  }

  // Request ID middleware
  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') || crypto.randomUUID()
    c.set('requestId', requestId)
    c.header('X-Request-ID', requestId)
    await next()
  })

  // ============================================================================
  // Health Check Endpoints
  // ============================================================================

  app.get('/health', (c) => {
    return c.json({ status: 'healthy', version: config.version })
  })

  app.get('/ready', (c) => {
    return c.json({ status: 'ready', version: config.version })
  })

  // ============================================================================
  // Service Discovery
  // ============================================================================

  app.get('/services', (c) => {
    const registry = options.registry || createDefaultRegistry()
    const services = registry.listServices()

    return c.json({
      services: services.map((s) => ({
        name: s.name,
        domain: s.domain,
        description: s.description,
        methods: s.methods.map((m) => ({
          name: m.name,
          description: m.description,
          streaming: m.streaming,
        })),
        active: s.active,
      })),
    })
  })

  app.get('/services/:name', (c) => {
    const name = c.req.param('name')
    const registry = options.registry || createDefaultRegistry()
    const service = registry.getService(name)

    if (!service) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Service '${name}' not found` } }, 404)
    }

    return c.json(service)
  })

  // ============================================================================
  // RPC Endpoints
  // ============================================================================

  // Single request endpoint
  app.post('/rpc', async (c) => {
    // Initialize services
    const registry = options.registry || createDefaultRegistry()
    const router = createRouter({
      registry,
      bindings: getServiceBindings(c.env),
      defaultTimeout: config.defaultTimeout,
      maxBatchSize: config.maxBatchSize,
    })

    // Parse request
    let request: GatewayRequest
    try {
      request = await c.req.json()
    } catch {
      return c.json(
        { error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' } },
        400
      )
    }

    // Validate request
    if (!request.id || !request.service || !request.method) {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request must include id, service, and method',
          },
        },
        400
      )
    }

    // Get auth context
    const auth = c.get('auth') as AuthContext | undefined

    // Create request context
    const context: RequestContext = {
      requestId: c.get('requestId') as string,
      startTime: performance.now(),
      auth,
      traceId: c.req.header('x-trace-id'),
    }

    // Route request
    const response = await router.route(request, context)

    // Return response
    const statusCode = response.status === 'error' ? getErrorStatusCode(response.error?.code) : 200
    return c.json(response, statusCode)
  })

  // Batch request endpoint
  app.post('/rpc/batch', async (c) => {
    // Initialize services
    const registry = options.registry || createDefaultRegistry()
    const router = createRouter({
      registry,
      bindings: getServiceBindings(c.env),
      defaultTimeout: config.defaultTimeout,
      maxBatchSize: config.maxBatchSize,
    })

    // Parse request
    let batch: BatchedRequest
    try {
      batch = await c.req.json()
    } catch {
      return c.json(
        { error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' } },
        400
      )
    }

    // Validate batch
    if (!batch.id || !batch.requests || !Array.isArray(batch.requests)) {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Batch must include id and requests array',
          },
        },
        400
      )
    }

    // Check batch size
    if (batch.requests.length > config.maxBatchSize) {
      return c.json(
        {
          error: {
            code: 'BATCH_TOO_LARGE',
            message: `Batch size ${batch.requests.length} exceeds maximum ${config.maxBatchSize}`,
          },
        },
        400
      )
    }

    // Get auth context
    const auth = c.get('auth') as AuthContext | undefined

    // Create request context
    const context: RequestContext = {
      requestId: c.get('requestId') as string,
      startTime: performance.now(),
      auth,
      traceId: c.req.header('x-trace-id'),
    }

    // Execute batch with pipeline support
    const pipelineExecutor = new PipelineExecutor(router)
    const response = await pipelineExecutor.execute(batch.requests as PipelineRequest[], context)

    return c.json(response)
  })

  // Pipeline request endpoint (alias for batch with pipeline support)
  app.post('/rpc/pipeline', async (c) => {
    // Initialize services
    const registry = options.registry || createDefaultRegistry()
    const router = createRouter({
      registry,
      bindings: getServiceBindings(c.env),
      defaultTimeout: config.defaultTimeout,
      maxBatchSize: config.maxBatchSize,
    })

    // Parse request
    let requests: PipelineRequest[]
    try {
      const body = await c.req.json()
      requests = Array.isArray(body) ? body : body.requests
    } catch {
      return c.json(
        { error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' } },
        400
      )
    }

    if (!requests || !Array.isArray(requests)) {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Pipeline must include requests array',
          },
        },
        400
      )
    }

    // Get auth context
    const auth = c.get('auth') as AuthContext | undefined

    // Create request context
    const context: RequestContext = {
      requestId: c.get('requestId') as string,
      startTime: performance.now(),
      auth,
      traceId: c.req.header('x-trace-id'),
    }

    // Execute pipeline
    const pipelineExecutor = new PipelineExecutor(router)
    const response = await pipelineExecutor.execute(requests, context)

    return c.json(response)
  })

  // ============================================================================
  // OpenAPI Spec
  // ============================================================================

  app.get('/openapi.json', (c) => {
    const registry = options.registry || createDefaultRegistry()
    const services = registry.listServices()

    const spec = {
      openapi: '3.0.3',
      info: {
        title: 'RPC.do - Unified Gateway',
        description: 'Unified gateway for all *.do services',
        version: config.version,
      },
      servers: [
        { url: 'https://rpc.do', description: 'Production' },
        { url: 'http://localhost:8787', description: 'Development' },
      ],
      paths: {
        '/health': {
          get: {
            summary: 'Health check',
            responses: { '200': { description: 'Gateway is healthy' } },
          },
        },
        '/services': {
          get: {
            summary: 'List available services',
            responses: { '200': { description: 'List of services' } },
          },
        },
        '/rpc': {
          post: {
            summary: 'Execute a single RPC request',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/GatewayRequest' },
                },
              },
            },
            responses: {
              '200': {
                description: 'Successful response',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/GatewayResponse' },
                  },
                },
              },
            },
          },
        },
        '/rpc/batch': {
          post: {
            summary: 'Execute a batch of RPC requests',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/BatchedRequest' },
                },
              },
            },
            responses: {
              '200': {
                description: 'Batch response',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/BatchedResponse' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          GatewayRequest: {
            type: 'object',
            required: ['id', 'service', 'method'],
            properties: {
              id: { type: 'string' },
              service: { type: 'string' },
              method: { type: 'string' },
              params: { type: 'object' },
            },
          },
          GatewayResponse: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              status: { type: 'string', enum: ['success', 'error'] },
              result: {},
              error: { $ref: '#/components/schemas/GatewayError' },
            },
          },
          GatewayError: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              retryable: { type: 'boolean' },
            },
          },
          BatchedRequest: {
            type: 'object',
            required: ['id', 'requests'],
            properties: {
              id: { type: 'string' },
              requests: {
                type: 'array',
                items: { $ref: '#/components/schemas/GatewayRequest' },
              },
              parallel: { type: 'boolean' },
            },
          },
          BatchedResponse: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              responses: {
                type: 'array',
                items: { $ref: '#/components/schemas/GatewayResponse' },
              },
              durationMs: { type: 'number' },
            },
          },
        },
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        },
      },
    }

    return c.json(spec)
  })

  return app
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get service bindings from environment
 */
function getServiceBindings(env: GatewayEnv): Record<string, { fetch: typeof fetch }> {
  const bindings: Record<string, { fetch: typeof fetch }> = {}

  if (env.AGENTS_SERVICE) bindings.agents = env.AGENTS_SERVICE
  if (env.WORKERS_SERVICE) bindings.workers = env.WORKERS_SERVICE
  if (env.FUNCTIONS_SERVICE) bindings.functions = env.FUNCTIONS_SERVICE
  if (env.WORKFLOWS_SERVICE) bindings.workflows = env.WORKFLOWS_SERVICE
  if (env.DATABASE_SERVICE) bindings.database = env.DATABASE_SERVICE
  if (env.LLM_SERVICE) bindings.llm = env.LLM_SERVICE

  return bindings
}

/**
 * Map error codes to HTTP status codes
 */
function getErrorStatusCode(code?: string): number {
  switch (code) {
    case 'INVALID_REQUEST':
      return 400
    case 'UNAUTHORIZED':
    case 'INVALID_TOKEN':
    case 'TOKEN_EXPIRED':
      return 401
    case 'FORBIDDEN':
    case 'ACCESS_DENIED':
      return 403
    case 'NOT_FOUND':
    case 'SERVICE_NOT_FOUND':
      return 404
    case 'RATE_LIMITED':
      return 429
    case 'SERVICE_UNAVAILABLE':
      return 503
    case 'TIMEOUT':
      return 504
    default:
      return 500
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create gateway with full middleware stack
 */
export function createFullGateway(env: GatewayEnv, options: GatewayOptions = {}): Hono<{ Bindings: GatewayEnv }> {
  const app = createGateway(options)

  // Add authentication middleware
  app.use(
    '/rpc/*',
    gatewayAuth({
      config: {
        jwksUrl: env.JWKS_URL,
        jwtSecret: env.JWT_SECRET,
        publicPaths: ['/health', '/ready', '/services', '/openapi.json'],
      },
      apiKeyStore: env.KV ? new KVApiKeyStore(env.KV) : new InMemoryApiKeyStore(),
      required: true,
    })
  )

  // Add rate limiting middleware
  if (env.RATE_LIMIT_KV) {
    app.use('/rpc/*', createKVRateLimiter(env.RATE_LIMIT_KV))
  } else {
    const { middleware } = createDevRateLimiter()
    app.use('/rpc/*', middleware)
  }

  // Add metering middleware
  const meteringService = env.ANALYTICS
    ? createProdMeteringService(env.ANALYTICS)
    : createDevMeteringService().metering
  app.use('/rpc/*', meteringMiddleware({ metering: meteringService }))

  // Add audit middleware
  const auditLogger = env.AUDIT_KV
    ? createKVAuditLogger(env.AUDIT_KV)
    : createDevAuditLogger().logger
  app.use('/rpc/*', auditMiddleware({ logger: auditLogger }))

  return app
}

/**
 * Create development gateway (minimal middleware)
 */
export function createDevGateway(options: GatewayOptions = {}): Hono<{ Bindings: GatewayEnv }> {
  return createGateway({ ...options, devMode: true })
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  createGateway,
  createFullGateway,
  createDevGateway,
}
