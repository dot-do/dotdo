import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Env } from '../types'

/**
 * OpenAPI Routes for /api/*
 *
 * Implements the same functionality as api.ts but with OpenAPI schema generation
 * using @hono/zod-openapi.
 */

// ============================================================================
// Zod Schemas
// ============================================================================

// Thing schema - represents a resource in the system
export const ThingSchema = z
  .object({
    id: z.string().uuid().openapi({ description: 'Unique identifier (UUID)' }),
    $id: z.string().openapi({ description: 'Qualified identifier (thing:{id})', example: 'thing:123e4567-e89b-12d3-a456-426614174000' }),
    $type: z.string().openapi({ description: 'Type URL or "thing"', example: 'thing' }),
    name: z.string().min(1).max(10000).openapi({ description: 'Name of the thing', example: 'My Thing' }),
    data: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Additional data' }),
    createdAt: z.string().datetime().openapi({ description: 'Creation timestamp (ISO 8601)', example: '2024-01-01T00:00:00.000Z' }),
    updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp (ISO 8601)', example: '2024-01-01T00:00:00.000Z' }),
  })
  .openapi('Thing', {})

// Error schema - standard error response
export const ErrorSchema = z
  .object({
    code: z.string().openapi({ description: 'Error code', example: 'NOT_FOUND' }),
    message: z.string().openapi({ description: 'Human-readable error message', example: 'Thing not found' }),
    details: z.record(z.string(), z.array(z.string())).optional().openapi({ description: 'Field-specific error details' }),
  })
  .openapi('Error', {})

// Error response wrapper
export const ErrorResponseSchema = z.object({
  error: ErrorSchema,
})

// Create thing request
export const CreateThingRequestSchema = z
  .object({
    name: z.string().min(1).max(10000).openapi({ description: 'Name of the thing', example: 'My New Thing' }),
    $type: z.string().optional().openapi({ description: 'Type URL or "thing"', example: 'thing' }),
    data: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Additional data' }),
  })
  .openapi('CreateThingRequest', {})

// Update thing request
export const UpdateThingRequestSchema = z
  .object({
    name: z.string().min(1).max(10000).optional().openapi({ description: 'Updated name', example: 'Updated Thing' }),
    data: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Updated data' }),
  })
  .openapi('UpdateThingRequest', {})

// Health response
export const HealthResponseSchema = z
  .object({
    status: z.literal('ok').openapi({ description: 'Health status', example: 'ok' }),
    timestamp: z.string().datetime().openapi({ description: 'Current timestamp (ISO 8601)', example: '2024-01-01T00:00:00.000Z' }),
  })
  .openapi('HealthResponse', {})

// JSON-RPC schemas for MCP
export const JsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal('2.0').openapi({ description: 'JSON-RPC version' }),
    id: z.union([z.string(), z.number()]).optional().openapi({ description: 'Request ID' }),
    method: z.string().openapi({ description: 'Method name', example: 'initialize' }),
    params: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Method parameters' }),
  })
  .openapi('JsonRpcRequest', {})

export const JsonRpcResponseSchema = z
  .object({
    jsonrpc: z.literal('2.0').openapi({ description: 'JSON-RPC version' }),
    id: z.union([z.string(), z.number(), z.null()]).openapi({ description: 'Request ID' }),
    result: z.unknown().optional().openapi({ description: 'Success result' }),
    error: z
      .object({
        code: z.number().openapi({ description: 'Error code' }),
        message: z.string().openapi({ description: 'Error message' }),
        data: z.unknown().optional().openapi({ description: 'Error data' }),
      })
      .optional()
      .openapi({ description: 'Error object' }),
  })
  .openapi('JsonRpcResponse', {})

// RPC schemas
export const RpcRequestSchema = z
  .object({
    id: z.string().openapi({ description: 'Request ID' }),
    type: z.enum(['call', 'batch', 'resolve', 'dispose']).openapi({ description: 'Request type' }),
    calls: z
      .array(
        z.object({
          promiseId: z.string(),
          target: z.record(z.string(), z.unknown()),
          method: z.string(),
          args: z.array(z.record(z.string(), z.unknown())),
        }),
      )
      .optional(),
  })
  .openapi('RpcRequest', {})

export const RpcResponseSchema = z
  .object({
    id: z.string().openapi({ description: 'Request ID' }),
    type: z.enum(['result', 'error', 'batch']).openapi({ description: 'Response type' }),
    results: z.array(z.record(z.string(), z.unknown())).optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        data: z.unknown().optional(),
      })
      .optional(),
  })
  .openapi('RpcResponse', {})

// ============================================================================
// In-memory storage (shared with api.ts - should use DO in production)
// ============================================================================

interface Thing {
  id: string
  $id: string
  $type: string
  name: string
  data?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

const things = new Map<string, Thing>()

// ============================================================================
// Route Definitions
// ============================================================================

// Health check route
const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  operationId: 'getHealth',
  summary: 'Health check',
  description: 'Returns the health status of the API service',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Service is healthy',
      content: {
        'application/json': {
          schema: HealthResponseSchema,
          example: { status: 'ok', timestamp: '2024-01-01T00:00:00.000Z' },
        },
      },
    },
  },
})

// List things route
const listThingsRoute = createRoute({
  method: 'get',
  path: '/things',
  operationId: 'getThings',
  summary: 'List all things',
  description: 'Returns a paginated list of all things. Supports limit and offset query parameters for pagination.',
  tags: ['Things'],
  request: {
    query: z.object({
      limit: z.string().optional().openapi({ description: 'Maximum number of items to return (default: 100)', example: '10' }),
      offset: z.string().optional().openapi({ description: 'Number of items to skip (default: 0)', example: '0' }),
    }),
  },
  responses: {
    200: {
      description: 'List of things',
      content: {
        'application/json': {
          schema: z.array(ThingSchema),
          example: [
            {
              id: '123e4567-e89b-12d3-a456-426614174000',
              $id: 'thing:123e4567-e89b-12d3-a456-426614174000',
              $type: 'thing',
              name: 'Example Thing',
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        },
      },
    },
  },
})

// Create thing route
const createThingRoute = createRoute({
  method: 'post',
  path: '/things',
  operationId: 'createThing',
  summary: 'Create a new thing',
  description: 'Creates a new thing with the provided name and optional data. Returns the created thing with generated ID and timestamps.',
  tags: ['Things'],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: CreateThingRequestSchema,
          example: { name: 'My New Thing', $type: 'thing', data: { key: 'value' } },
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Thing created successfully',
      content: {
        'application/json': {
          schema: ThingSchema,
          example: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            $id: 'thing:123e4567-e89b-12d3-a456-426614174000',
            $type: 'thing',
            name: 'My New Thing',
            data: { key: 'value' },
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        },
      },
    },
    400: {
      description: 'Bad request - invalid JSON or missing Content-Type',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
          example: { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        },
      },
    },
    422: {
      description: 'Validation error - invalid field values',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
          example: { error: { code: 'UNPROCESSABLE_ENTITY', message: 'Validation failed: name is required', details: { name: ['Name is required'] } } },
        },
      },
    },
  },
})

// Get thing by ID route
const getThingRoute = createRoute({
  method: 'get',
  path: '/things/{id}',
  operationId: 'getThing',
  summary: 'Get a thing by ID',
  description: 'Returns a single thing by its unique identifier',
  tags: ['Things'],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ description: 'Thing ID (UUID)', example: '123e4567-e89b-12d3-a456-426614174000' }),
    }),
  },
  responses: {
    200: {
      description: 'Thing found',
      content: {
        'application/json': {
          schema: ThingSchema,
          example: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            $id: 'thing:123e4567-e89b-12d3-a456-426614174000',
            $type: 'thing',
            name: 'Example Thing',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        },
      },
    },
    404: {
      description: 'Thing not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
          example: { error: { code: 'NOT_FOUND', message: 'Thing not found' } },
        },
      },
    },
  },
})

// Update thing route
const updateThingRoute = createRoute({
  method: 'put',
  path: '/things/{id}',
  operationId: 'updateThing',
  summary: 'Update a thing',
  description: 'Updates an existing thing with the provided fields',
  tags: ['Things'],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ description: 'Thing ID (UUID)', example: '123e4567-e89b-12d3-a456-426614174000' }),
    }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: UpdateThingRequestSchema,
          example: { name: 'Updated Thing Name' },
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Thing updated successfully',
      content: {
        'application/json': {
          schema: ThingSchema,
          example: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            $id: 'thing:123e4567-e89b-12d3-a456-426614174000',
            $type: 'thing',
            name: 'Updated Thing Name',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        },
      },
    },
    400: {
      description: 'Bad request - invalid JSON',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
          example: { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        },
      },
    },
    404: {
      description: 'Thing not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
          example: { error: { code: 'NOT_FOUND', message: 'Thing not found' } },
        },
      },
    },
  },
})

// Delete thing route
const deleteThingRoute = createRoute({
  method: 'delete',
  path: '/things/{id}',
  operationId: 'deleteThing',
  summary: 'Delete a thing',
  description: 'Deletes a thing by its unique identifier. Returns 204 on success.',
  tags: ['Things'],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ description: 'Thing ID (UUID)', example: '123e4567-e89b-12d3-a456-426614174000' }),
    }),
  },
  responses: {
    204: {
      description: 'Thing deleted successfully (no content)',
    },
    404: {
      description: 'Thing not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
          example: { error: { code: 'NOT_FOUND', message: 'Thing not found' } },
        },
      },
    },
  },
})

// Protected route
const protectedRoute = createRoute({
  method: 'get',
  path: '/protected',
  operationId: 'getProtected',
  summary: 'Protected endpoint',
  description: 'A protected endpoint that requires authentication. Returns 401 if not authenticated.',
  tags: ['Auth'],
  security: [{ bearerAuth: [] }, { apiKey: [] }],
  responses: {
    200: {
      description: 'Access granted',
      content: {
        'application/json': {
          schema: z.object({ message: z.string() }),
          example: { message: 'Access granted' },
        },
      },
    },
    401: {
      description: 'Unauthorized - authentication required',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
          example: { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        },
      },
    },
  },
})

// Admin settings route
const adminSettingsRoute = createRoute({
  method: 'get',
  path: '/admin/settings',
  operationId: 'getAdminSettings',
  summary: 'Get admin settings',
  description: 'Retrieves admin settings. Requires admin role.',
  tags: ['Admin'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Admin settings',
      content: {
        'application/json': {
          schema: z.object({ settings: z.record(z.string(), z.unknown()) }),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden - admin permission required',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
          example: { error: { code: 'FORBIDDEN', message: 'Access denied - admin permission required' } },
        },
      },
    },
  },
})

// ============================================================================
// MCP Routes
// ============================================================================

const mcpPostRoute = createRoute({
  method: 'post',
  path: '',
  operationId: 'mcpPost',
  summary: 'MCP JSON-RPC endpoint',
  description: 'Handle JSON-RPC 2.0 requests for the Model Context Protocol (MCP). Supports batch requests.',
  tags: ['MCP'],
  request: {
    headers: z.object({
      'Mcp-Session-Id': z.string().optional().openapi({ description: 'Session identifier for stateful operations' }),
    }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.union([JsonRpcRequestSchema, z.array(JsonRpcRequestSchema)]),
          example: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        },
      },
    },
  },
  responses: {
    200: {
      description: 'JSON-RPC response',
      content: {
        'application/json': {
          schema: z.union([JsonRpcResponseSchema, z.array(JsonRpcResponseSchema)]),
          example: { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } },
        },
      },
    },
  },
})

const mcpGetRoute = createRoute({
  method: 'get',
  path: '',
  operationId: 'mcpGet',
  summary: 'MCP SSE stream',
  description: 'Server-Sent Events (SSE) stream for receiving MCP server-initiated notifications. Requires an established session.',
  tags: ['MCP'],
  request: {
    headers: z.object({
      'Mcp-Session-Id': z.string().openapi({ description: 'Session identifier' }),
    }),
  },
  responses: {
    200: {
      description: 'SSE event stream',
      content: {
        'text/event-stream': {
          schema: z.string().openapi({ description: 'Server-Sent Events stream' }),
        },
      },
    },
    400: {
      description: 'Bad request - missing session ID',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Session not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

const mcpDeleteRoute = createRoute({
  method: 'delete',
  path: '',
  operationId: 'mcpDelete',
  summary: 'Terminate MCP session',
  description: 'Terminates an MCP session and cleans up associated resources.',
  tags: ['MCP'],
  request: {
    headers: z.object({
      'Mcp-Session-Id': z.string().openapi({ description: 'Session identifier to terminate' }),
    }),
  },
  responses: {
    204: {
      description: 'Session terminated successfully',
    },
    400: {
      description: 'Bad request - missing session ID',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Session not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

// ============================================================================
// RPC Routes
// ============================================================================

const rpcPostRoute = createRoute({
  method: 'post',
  path: '',
  operationId: 'rpcPost',
  summary: 'RPC batch endpoint',
  description: 'HTTP POST endpoint for batch RPC calls. Supports Capnweb-style promise pipelining and pass-by-reference.',
  tags: ['RPC'],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: RpcRequestSchema,
          example: {
            id: 'req-1',
            type: 'call',
            calls: [{ promiseId: 'p1', target: { type: 'root' }, method: 'echo', args: [{ type: 'value', value: 'hello' }] }],
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: 'RPC response',
      content: {
        'application/json': {
          schema: RpcResponseSchema,
          example: { id: 'req-1', type: 'batch', results: [{ promiseId: 'p1', type: 'value', value: 'hello' }] },
        },
      },
    },
  },
})

const rpcGetRoute = createRoute({
  method: 'get',
  path: '',
  operationId: 'rpcGet',
  summary: 'RPC WebSocket endpoint',
  description: 'WebSocket endpoint for streaming RPC. Supports JSON-RPC 2.0 protocol over WebSocket for real-time bidirectional communication.',
  tags: ['RPC'],
  responses: {
    101: {
      description: 'WebSocket upgrade successful',
    },
    200: {
      description: 'RPC endpoint info (when accessed without WebSocket upgrade)',
      content: {
        'application/json': {
          schema: z.object({
            message: z.string(),
            methods: z.array(z.string()),
            hint: z.string(),
          }),
          example: {
            message: 'RPC endpoint - use POST for HTTP batch mode or WebSocket for streaming',
            methods: ['echo', 'add', 'multiply', 'getUser'],
            hint: 'Connect with WebSocket protocol for streaming RPC',
          },
        },
      },
    },
  },
})

// ============================================================================
// Create OpenAPI Hono App
// ============================================================================

export const openapiRoutes = new OpenAPIHono<{ Bindings: Env }>()

// Register API routes with handlers
openapiRoutes.openapi(healthRoute, (c) => {
  return c.json({ status: 'ok' as const, timestamp: new Date().toISOString() })
})

openapiRoutes.openapi(listThingsRoute, (c) => {
  const limitParam = c.req.query('limit')
  const offsetParam = c.req.query('offset')

  const limit = limitParam ? parseInt(limitParam, 10) : 100
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0

  const allThings = Array.from(things.values())
  const paginated = allThings.slice(offset, offset + limit)

  return c.json(paginated)
})

openapiRoutes.openapi(createThingRoute, async (c) => {
  const body = c.req.valid('json')

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const thing: Thing = {
    id,
    $id: `thing:${id}`,
    $type: body.$type || 'thing',
    name: body.name,
    data: body.data,
    createdAt: now,
    updatedAt: now,
  }

  things.set(id, thing)

  return c.json(thing, 201)
})

openapiRoutes.openapi(getThingRoute, (c) => {
  const { id } = c.req.valid('param')
  const thing = things.get(id)

  if (!thing) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }, 404)
  }

  return c.json(thing, 200)
})

openapiRoutes.openapi(updateThingRoute, async (c) => {
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  const existing = things.get(id)

  if (!existing) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }, 404)
  }

  const updated: Thing = {
    ...existing,
    name: body.name ?? existing.name,
    data: body.data ?? existing.data,
    updatedAt: new Date().toISOString(),
  }

  things.set(id, updated)

  return c.json(updated, 200)
})

openapiRoutes.openapi(deleteThingRoute, (c) => {
  const { id } = c.req.valid('param')
  const existed = things.delete(id)

  if (!existed) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }, 404)
  }

  return new Response(null, { status: 204 })
})

openapiRoutes.openapi(protectedRoute, (c) => {
  return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401)
})

openapiRoutes.openapi(adminSettingsRoute, (c) => {
  return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied - admin permission required' } }, 403)
})

// ============================================================================
// MCP Routes App
// ============================================================================

export const mcpOpenapiRoutes = new OpenAPIHono<{ Bindings: Env }>()

// Register MCP routes (handlers will forward to actual MCP implementation)
// Note: MCP handlers return raw Response objects, not Hono typed responses.
// We use Response cast as the actual runtime type, with eslint override for
// the type mismatch between OpenAPI route expectations and proxy handler pattern.
mcpOpenapiRoutes.openapi(mcpPostRoute, async (c) => {
  // Forward to actual MCP handler - returns raw Response, cast for OpenAPI route type
  const { handleMcpRequest } = await import('./mcp')
  const response = await handleMcpRequest(c.req.raw)
  return response as unknown as ReturnType<typeof c.json>
})

mcpOpenapiRoutes.openapi(mcpGetRoute, async (c) => {
  const { handleMcpRequest } = await import('./mcp')
  const response = await handleMcpRequest(c.req.raw)
  return response as unknown as ReturnType<typeof c.json>
})

mcpOpenapiRoutes.openapi(mcpDeleteRoute, async (c) => {
  const { handleMcpRequest } = await import('./mcp')
  const response = await handleMcpRequest(c.req.raw)
  return response as unknown as ReturnType<typeof c.json>
})

// ============================================================================
// RPC Routes App
// ============================================================================

export const rpcOpenapiRoutes = new OpenAPIHono<{ Bindings: Env }>()

// RPC routes just document the endpoints
rpcOpenapiRoutes.openapi(rpcPostRoute, async (c) => {
  const { rpcRoutes } = await import('./rpc')
  // Create a new request for the /rpc POST handler
  const req = new Request(c.req.url, {
    method: 'POST',
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  })
  const app = new OpenAPIHono<{ Bindings: Env }>()
  app.route('/', rpcRoutes)
  // Returns raw Response from app.fetch, cast for OpenAPI route type
  return app.fetch(req, c.env) as unknown as ReturnType<typeof c.json>
})

rpcOpenapiRoutes.openapi(rpcGetRoute, (c) => {
  return c.json({
    message: 'RPC endpoint - use POST for HTTP batch mode or WebSocket for streaming',
    methods: ['echo', 'add', 'multiply', 'ping', 'getUser', 'getData', 'getPosts'],
    hint: 'Connect with WebSocket protocol for streaming RPC',
  })
})

// ============================================================================
// OpenAPI Document Configuration
// ============================================================================

export function getOpenAPIDocument() {
  // Create a combined app with all routes for doc generation
  const docApp = new OpenAPIHono<{ Bindings: Env }>()

  // Register security schemes using the registry
  docApp.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'JWT Bearer token authentication. Obtain a token via the auth flow and include it in the Authorization header.',
  })

  docApp.openAPIRegistry.registerComponent('securitySchemes', 'apiKey', {
    type: 'apiKey',
    in: 'header',
    name: 'X-API-Key',
    description: 'API key authentication. Include your API key in the X-API-Key header.',
  })

  // Mount API routes at /api
  docApp.route('/api', openapiRoutes)

  // Mount MCP routes at /mcp
  docApp.route('/mcp', mcpOpenapiRoutes)

  // Mount RPC routes at /rpc
  docApp.route('/rpc', rpcOpenapiRoutes)

  return docApp.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: 'dotdo API',
      version: '0.0.1',
      description: 'The dotdo platform API provides REST endpoints for managing things, MCP protocol support for AI tools, and RPC endpoints for real-time communication.',
      contact: {
        name: 'dotdo Team',
        url: 'https://github.com/dotdo',
        email: 'support@dotdo.dev',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: 'https://api.dotdo.dev',
        description: 'Production server',
      },
      {
        url: 'http://localhost:8787',
        description: 'Local development server',
      },
    ],
    tags: [
      {
        name: 'Things',
        description: 'CRUD operations for things - the core resource type',
      },
      {
        name: 'Health',
        description: 'Health check and status endpoints',
      },
      {
        name: 'Auth',
        description: 'Authentication and authorization endpoints',
      },
      {
        name: 'Admin',
        description: 'Administrative endpoints requiring elevated permissions',
      },
      {
        name: 'MCP',
        description: 'Model Context Protocol (MCP) endpoints for AI tool integration',
      },
      {
        name: 'RPC',
        description: 'Remote Procedure Call endpoints with WebSocket support',
      },
    ],
    security: [],
  })
}

export default openapiRoutes
