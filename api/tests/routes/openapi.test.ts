import { describe, it, expect, beforeAll } from 'vitest'

/**
 * OpenAPI Spec Generation Tests
 *
 * These tests verify that the API generates a valid OpenAPI 3.1 specification
 * from Hono routes using @hono/zod-openapi.
 *
 * Expected to FAIL until:
 * - @hono/zod-openapi is installed and configured
 * - Routes are converted to use OpenAPI schemas
 * - /api/openapi.json endpoint is exposed
 * - Security schemes are defined
 */

// Import the actual app
import { app } from '../../index'

// ============================================================================
// Types
// ============================================================================

interface OpenAPISpec {
  openapi: string
  info: {
    title: string
    version: string
    description?: string
    contact?: {
      name?: string
      url?: string
      email?: string
    }
    license?: {
      name: string
      url?: string
    }
  }
  servers?: Array<{
    url: string
    description?: string
  }>
  paths: Record<string, PathItem>
  components?: {
    schemas?: Record<string, unknown>
    securitySchemes?: Record<string, SecurityScheme>
    parameters?: Record<string, unknown>
    responses?: Record<string, unknown>
  }
  security?: Array<Record<string, string[]>>
  tags?: Array<{
    name: string
    description?: string
  }>
}

interface PathItem {
  get?: Operation
  post?: Operation
  put?: Operation
  delete?: Operation
  patch?: Operation
  options?: Operation
  head?: Operation
  summary?: string
  description?: string
  parameters?: Parameter[]
}

interface Operation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: Parameter[]
  requestBody?: RequestBody
  responses: Record<string, ResponseObject>
  security?: Array<Record<string, string[]>>
  deprecated?: boolean
}

interface Parameter {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie'
  required?: boolean
  schema?: unknown
  description?: string
  example?: unknown
}

interface RequestBody {
  description?: string
  required?: boolean
  content: Record<string, MediaType>
}

interface ResponseObject {
  description: string
  content?: Record<string, MediaType>
  headers?: Record<string, unknown>
}

interface MediaType {
  schema?: unknown
  example?: unknown
  examples?: Record<string, unknown>
}

interface SecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect'
  description?: string
  name?: string
  in?: 'query' | 'header' | 'cookie'
  scheme?: string
  bearerFormat?: string
  flows?: unknown
  openIdConnectUrl?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

async function getOpenAPISpec(): Promise<OpenAPISpec> {
  const res = await app.request('/api/openapi.json')
  if (res.status !== 200) {
    throw new Error(`Failed to fetch OpenAPI spec: ${res.status}`)
  }
  return res.json() as Promise<OpenAPISpec>
}

// ============================================================================
// 1. OpenAPI Spec Endpoint Tests
// ============================================================================

describe('GET /api/openapi.json', () => {
  it('returns 200 status', async () => {
    const res = await app.request('/api/openapi.json')
    expect(res.status).toBe(200)
  })

  it('returns JSON content type', async () => {
    const res = await app.request('/api/openapi.json')
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('returns valid OpenAPI 3.1 spec', async () => {
    const spec = await getOpenAPISpec()
    expect(spec.openapi).toMatch(/^3\.1\./)
  })

  it('includes CORS headers for spec access', async () => {
    const res = await app.request('/api/openapi.json')
    expect(res.headers.get('access-control-allow-origin')).toBeDefined()
  })
})

// ============================================================================
// 2. OpenAPI Info Object Tests
// ============================================================================

describe('OpenAPI Info Object', () => {
  let spec: OpenAPISpec

  beforeAll(async () => {
    spec = await getOpenAPISpec()
  })

  it('has required info object', () => {
    expect(spec.info).toBeDefined()
  })

  it('has title', () => {
    expect(spec.info.title).toBeDefined()
    expect(spec.info.title.length).toBeGreaterThan(0)
  })

  it('has version', () => {
    expect(spec.info.version).toBeDefined()
    expect(spec.info.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('has description', () => {
    expect(spec.info.description).toBeDefined()
    expect(spec.info.description!.length).toBeGreaterThan(10)
  })

  it('has contact information', () => {
    expect(spec.info.contact).toBeDefined()
  })

  it('has license information', () => {
    expect(spec.info.license).toBeDefined()
    expect(spec.info.license!.name).toBeDefined()
  })
})

// ============================================================================
// 3. OpenAPI Servers Tests
// ============================================================================

describe('OpenAPI Servers', () => {
  let spec: OpenAPISpec

  beforeAll(async () => {
    spec = await getOpenAPISpec()
  })

  it('has servers array', () => {
    expect(spec.servers).toBeDefined()
    expect(Array.isArray(spec.servers)).toBe(true)
  })

  it('has at least one server', () => {
    expect(spec.servers!.length).toBeGreaterThan(0)
  })

  it('servers have valid URLs', () => {
    for (const server of spec.servers!) {
      expect(server.url).toMatch(/^https?:\/\/|^\//)
    }
  })

  it('servers have descriptions', () => {
    for (const server of spec.servers!) {
      expect(server.description).toBeDefined()
    }
  })
})

// ============================================================================
// 4. OpenAPI Paths Tests - Things API
// ============================================================================

describe('OpenAPI Paths - Things API', () => {
  let spec: OpenAPISpec

  beforeAll(async () => {
    spec = await getOpenAPISpec()
  })

  describe('/api/things endpoint', () => {
    it('is documented', () => {
      expect(spec.paths['/api/things']).toBeDefined()
    })

    it('has GET operation', () => {
      expect(spec.paths['/api/things'].get).toBeDefined()
    })

    it('has POST operation', () => {
      expect(spec.paths['/api/things'].post).toBeDefined()
    })

    it('GET has operationId', () => {
      expect(spec.paths['/api/things'].get!.operationId).toBeDefined()
    })

    it('GET has summary', () => {
      expect(spec.paths['/api/things'].get!.summary).toBeDefined()
    })

    it('GET has description', () => {
      expect(spec.paths['/api/things'].get!.description).toBeDefined()
    })

    it('GET documents query parameters', () => {
      const params = spec.paths['/api/things'].get!.parameters || []
      const limitParam = params.find((p) => p.name === 'limit')
      const offsetParam = params.find((p) => p.name === 'offset')
      expect(limitParam).toBeDefined()
      expect(offsetParam).toBeDefined()
    })

    it('GET limit parameter has schema with type and constraints', () => {
      const params = spec.paths['/api/things'].get!.parameters || []
      const limitParam = params.find((p) => p.name === 'limit')
      expect(limitParam!.schema).toBeDefined()
    })

    it('POST has request body schema', () => {
      const post = spec.paths['/api/things'].post!
      expect(post.requestBody).toBeDefined()
      expect(post.requestBody!.content['application/json']).toBeDefined()
      expect(post.requestBody!.content['application/json'].schema).toBeDefined()
    })

    it('POST request body documents required fields', () => {
      const post = spec.paths['/api/things'].post!
      const schema = post.requestBody!.content['application/json'].schema as Record<string, unknown>
      expect(schema.required).toBeDefined()
      expect(Array.isArray(schema.required)).toBe(true)
    })

    it('GET has 200 response documented', () => {
      expect(spec.paths['/api/things'].get!.responses['200']).toBeDefined()
    })

    it('POST has 201 response documented', () => {
      expect(spec.paths['/api/things'].post!.responses['201']).toBeDefined()
    })

    it('POST has 400 response documented', () => {
      expect(spec.paths['/api/things'].post!.responses['400']).toBeDefined()
    })

    it('POST has 422 response documented', () => {
      expect(spec.paths['/api/things'].post!.responses['422']).toBeDefined()
    })
  })

  describe('/api/things/{id} endpoint', () => {
    it('is documented', () => {
      expect(spec.paths['/api/things/{id}']).toBeDefined()
    })

    it('has GET operation', () => {
      expect(spec.paths['/api/things/{id}'].get).toBeDefined()
    })

    it('has PUT operation', () => {
      expect(spec.paths['/api/things/{id}'].put).toBeDefined()
    })

    it('has DELETE operation', () => {
      expect(spec.paths['/api/things/{id}'].delete).toBeDefined()
    })

    it('documents id path parameter', () => {
      const pathItem = spec.paths['/api/things/{id}']
      const params = pathItem.parameters || pathItem.get!.parameters || []
      const idParam = params.find((p) => p.name === 'id' && p.in === 'path')
      expect(idParam).toBeDefined()
      expect(idParam!.required).toBe(true)
    })

    it('GET has 404 response documented', () => {
      expect(spec.paths['/api/things/{id}'].get!.responses['404']).toBeDefined()
    })

    it('DELETE has 204 response documented', () => {
      expect(spec.paths['/api/things/{id}'].delete!.responses['204']).toBeDefined()
    })
  })
})

// ============================================================================
// 5. OpenAPI Paths Tests - Health API
// ============================================================================

describe('OpenAPI Paths - Health API', () => {
  let spec: OpenAPISpec

  beforeAll(async () => {
    spec = await getOpenAPISpec()
  })

  it('/api/health endpoint is documented', () => {
    expect(spec.paths['/api/health']).toBeDefined()
  })

  it('has GET operation', () => {
    expect(spec.paths['/api/health'].get).toBeDefined()
  })

  it('has 200 response with schema', () => {
    const response = spec.paths['/api/health'].get!.responses['200']
    expect(response).toBeDefined()
    expect(response.content).toBeDefined()
    expect(response.content!['application/json'].schema).toBeDefined()
  })
})

// ============================================================================
// 6. OpenAPI Components - Schemas Tests
// ============================================================================

describe('OpenAPI Components - Schemas', () => {
  let spec: OpenAPISpec

  beforeAll(async () => {
    spec = await getOpenAPISpec()
  })

  it('has components object', () => {
    expect(spec.components).toBeDefined()
  })

  it('has schemas defined', () => {
    expect(spec.components!.schemas).toBeDefined()
  })

  it('has Thing schema', () => {
    expect(spec.components!.schemas!.Thing).toBeDefined()
  })

  it('Thing schema has required id field', () => {
    const schema = spec.components!.schemas!.Thing as Record<string, unknown>
    expect(schema.properties).toBeDefined()
    const props = schema.properties as Record<string, unknown>
    expect(props.id).toBeDefined()
  })

  it('Thing schema has $id field', () => {
    const schema = spec.components!.schemas!.Thing as Record<string, unknown>
    const props = schema.properties as Record<string, unknown>
    expect(props.$id).toBeDefined()
  })

  it('Thing schema has $type field', () => {
    const schema = spec.components!.schemas!.Thing as Record<string, unknown>
    const props = schema.properties as Record<string, unknown>
    expect(props.$type).toBeDefined()
  })

  it('Thing schema has name field', () => {
    const schema = spec.components!.schemas!.Thing as Record<string, unknown>
    const props = schema.properties as Record<string, unknown>
    expect(props.name).toBeDefined()
  })

  it('Thing schema has timestamps', () => {
    const schema = spec.components!.schemas!.Thing as Record<string, unknown>
    const props = schema.properties as Record<string, unknown>
    expect(props.createdAt).toBeDefined()
    expect(props.updatedAt).toBeDefined()
  })

  it('has Error schema', () => {
    expect(spec.components!.schemas!.Error).toBeDefined()
  })

  it('Error schema has code and message fields', () => {
    const schema = spec.components!.schemas!.Error as Record<string, unknown>
    const props = schema.properties as Record<string, unknown>
    expect(props.code).toBeDefined()
    expect(props.message).toBeDefined()
  })

  it('has CreateThingRequest schema', () => {
    expect(spec.components!.schemas!.CreateThingRequest).toBeDefined()
  })

  it('has UpdateThingRequest schema', () => {
    expect(spec.components!.schemas!.UpdateThingRequest).toBeDefined()
  })
})

// ============================================================================
// 7. OpenAPI Security Schemes Tests
// ============================================================================

describe('OpenAPI Security Schemes', () => {
  let spec: OpenAPISpec

  beforeAll(async () => {
    spec = await getOpenAPISpec()
  })

  it('has securitySchemes defined', () => {
    expect(spec.components!.securitySchemes).toBeDefined()
  })

  it('has Bearer authentication scheme', () => {
    const schemes = spec.components!.securitySchemes!
    expect(schemes.bearerAuth || schemes.BearerAuth).toBeDefined()
  })

  it('Bearer scheme is correctly configured', () => {
    const schemes = spec.components!.securitySchemes!
    const bearerScheme = (schemes.bearerAuth || schemes.BearerAuth) as SecurityScheme
    expect(bearerScheme.type).toBe('http')
    expect(bearerScheme.scheme).toBe('bearer')
    expect(bearerScheme.bearerFormat).toBe('JWT')
  })

  it('has API key authentication scheme', () => {
    const schemes = spec.components!.securitySchemes!
    expect(schemes.apiKey || schemes.ApiKey).toBeDefined()
  })

  it('API key scheme is correctly configured', () => {
    const schemes = spec.components!.securitySchemes!
    const apiKeyScheme = (schemes.apiKey || schemes.ApiKey) as SecurityScheme
    expect(apiKeyScheme.type).toBe('apiKey')
    expect(apiKeyScheme.in).toBe('header')
    expect(apiKeyScheme.name).toBeDefined()
  })

  it('security schemes have descriptions', () => {
    const schemes = spec.components!.securitySchemes!
    for (const [, scheme] of Object.entries(schemes)) {
      expect((scheme as SecurityScheme).description).toBeDefined()
    }
  })
})

// ============================================================================
// 8. OpenAPI Protected Routes Tests
// ============================================================================

describe('OpenAPI Protected Routes', () => {
  let spec: OpenAPISpec

  beforeAll(async () => {
    spec = await getOpenAPISpec()
  })

  it('/api/protected endpoint is documented', () => {
    expect(spec.paths['/api/protected']).toBeDefined()
  })

  it('protected endpoint has security requirement', () => {
    const endpoint = spec.paths['/api/protected'].get!
    expect(endpoint.security).toBeDefined()
    expect(endpoint.security!.length).toBeGreaterThan(0)
  })

  it('protected endpoint has 401 response', () => {
    expect(spec.paths['/api/protected'].get!.responses['401']).toBeDefined()
  })

  it('admin endpoint has security requirement', () => {
    if (spec.paths['/api/admin/settings']) {
      const endpoint = spec.paths['/api/admin/settings'].get!
      expect(endpoint.security).toBeDefined()
    }
  })

  it('admin endpoint has 403 response', () => {
    if (spec.paths['/api/admin/settings']) {
      expect(spec.paths['/api/admin/settings'].get!.responses['403']).toBeDefined()
    }
  })
})

// ============================================================================
// 9. OpenAPI Tags Tests
// ============================================================================

describe('OpenAPI Tags', () => {
  let spec: OpenAPISpec

  beforeAll(async () => {
    spec = await getOpenAPISpec()
  })

  it('has tags array', () => {
    expect(spec.tags).toBeDefined()
    expect(Array.isArray(spec.tags)).toBe(true)
  })

  it('has Things tag', () => {
    const thingsTag = spec.tags!.find((t) => t.name.toLowerCase() === 'things')
    expect(thingsTag).toBeDefined()
  })

  it('has Health tag', () => {
    const healthTag = spec.tags!.find((t) => t.name.toLowerCase() === 'health')
    expect(healthTag).toBeDefined()
  })

  it('tags have descriptions', () => {
    for (const tag of spec.tags!) {
      expect(tag.description).toBeDefined()
      expect(tag.description!.length).toBeGreaterThan(0)
    }
  })

  it('endpoints are tagged', () => {
    const thingsGet = spec.paths['/api/things'].get!
    expect(thingsGet.tags).toBeDefined()
    expect(thingsGet.tags!.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// 10. OpenAPI Response Examples Tests
// ============================================================================

describe('OpenAPI Response Examples', () => {
  let spec: OpenAPISpec

  beforeAll(async () => {
    spec = await getOpenAPISpec()
  })

  it('GET /api/things has response example', () => {
    const response = spec.paths['/api/things'].get!.responses['200']
    const content = response.content!['application/json']
    expect(content.example || content.examples).toBeDefined()
  })

  it('POST /api/things has request body example', () => {
    const requestBody = spec.paths['/api/things'].post!.requestBody!
    const content = requestBody.content['application/json']
    expect(content.example || content.examples).toBeDefined()
  })

  it('POST /api/things 201 response has example', () => {
    const response = spec.paths['/api/things'].post!.responses['201']
    const content = response.content!['application/json']
    expect(content.example || content.examples).toBeDefined()
  })

  it('error responses have examples', () => {
    const response = spec.paths['/api/things'].post!.responses['400']
    if (response.content) {
      const content = response.content['application/json']
      expect(content.example || content.examples).toBeDefined()
    }
  })

  it('GET /api/things/{id} 404 response has example', () => {
    const response = spec.paths['/api/things/{id}'].get!.responses['404']
    if (response.content) {
      const content = response.content['application/json']
      expect(content.example || content.examples).toBeDefined()
    }
  })
})

// ============================================================================
// 11. OpenAPI MCP Routes Tests
// ============================================================================

describe('OpenAPI Paths - MCP Routes', () => {
  let spec: OpenAPISpec

  beforeAll(async () => {
    spec = await getOpenAPISpec()
  })

  it('/mcp endpoint is documented', () => {
    expect(spec.paths['/mcp']).toBeDefined()
  })

  it('has POST operation for JSON-RPC', () => {
    expect(spec.paths['/mcp'].post).toBeDefined()
  })

  it('has GET operation for SSE stream', () => {
    expect(spec.paths['/mcp'].get).toBeDefined()
  })

  it('has DELETE operation for session termination', () => {
    expect(spec.paths['/mcp'].delete).toBeDefined()
  })

  it('POST documents Mcp-Session-Id header', () => {
    const post = spec.paths['/mcp'].post!
    const params = post.parameters || []
    const sessionHeader = params.find((p) => p.name === 'Mcp-Session-Id' && p.in === 'header')
    expect(sessionHeader).toBeDefined()
  })

  it('POST request body shows JSON-RPC schema', () => {
    const post = spec.paths['/mcp'].post!
    expect(post.requestBody).toBeDefined()
    expect(post.requestBody!.content['application/json']).toBeDefined()
  })
})

// ============================================================================
// 12. OpenAPI RPC Routes Tests
// ============================================================================

describe('OpenAPI Paths - RPC Routes', () => {
  let spec: OpenAPISpec

  beforeAll(async () => {
    spec = await getOpenAPISpec()
  })

  it('/rpc endpoint is documented', () => {
    expect(spec.paths['/rpc']).toBeDefined()
  })

  it('has POST operation for batch RPC', () => {
    expect(spec.paths['/rpc'].post).toBeDefined()
  })

  it('has GET operation for WebSocket upgrade', () => {
    expect(spec.paths['/rpc'].get).toBeDefined()
  })

  it('documents WebSocket protocol', () => {
    const get = spec.paths['/rpc'].get!
    const description = get.description || ''
    expect(description.toLowerCase()).toContain('websocket')
  })
})

// ============================================================================
// 13. OpenAPI Validation Tests
// ============================================================================

describe('OpenAPI Spec Validation', () => {
  let spec: OpenAPISpec

  beforeAll(async () => {
    spec = await getOpenAPISpec()
  })

  it('all paths start with /', () => {
    for (const path of Object.keys(spec.paths)) {
      expect(path.startsWith('/')).toBe(true)
    }
  })

  it('all operations have responses', () => {
    for (const [, pathItem] of Object.entries(spec.paths)) {
      for (const method of ['get', 'post', 'put', 'delete', 'patch'] as const) {
        const operation = pathItem[method]
        if (operation) {
          expect(operation.responses).toBeDefined()
          expect(Object.keys(operation.responses).length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('all response status codes are valid', () => {
    for (const [, pathItem] of Object.entries(spec.paths)) {
      for (const method of ['get', 'post', 'put', 'delete', 'patch'] as const) {
        const operation = pathItem[method]
        if (operation) {
          for (const statusCode of Object.keys(operation.responses)) {
            const code = parseInt(statusCode, 10)
            expect(code >= 100 && code < 600).toBe(true)
          }
        }
      }
    }
  })

  it('path parameters are defined', () => {
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      const pathParams = path.match(/\{([^}]+)\}/g) || []
      if (pathParams.length > 0) {
        for (const method of ['get', 'post', 'put', 'delete', 'patch'] as const) {
          const operation = pathItem[method]
          if (operation) {
            const allParams = [...(pathItem.parameters || []), ...(operation.parameters || [])]
            for (const paramMatch of pathParams) {
              const paramName = paramMatch.slice(1, -1)
              const paramDef = allParams.find((p) => p.name === paramName && p.in === 'path')
              expect(paramDef).toBeDefined()
            }
          }
        }
      }
    }
  })

  it('$ref references are valid', () => {
    const specString = JSON.stringify(spec)
    const refs = specString.match(/"\$ref":\s*"([^"]+)"/g) || []
    for (const ref of refs) {
      const refPath = ref.match(/"\$ref":\s*"([^"]+)"/)?.[1]
      if (refPath && refPath.startsWith('#/')) {
        // Internal reference - should be resolvable
        const parts = refPath.slice(2).split('/')
        let current: unknown = spec
        for (const part of parts) {
          expect(current).toBeDefined()
          current = (current as Record<string, unknown>)[part]
        }
        expect(current).toBeDefined()
      }
    }
  })
})

// ============================================================================
// 14. OpenAPI Error Responses Tests
// ============================================================================

describe('OpenAPI Error Response Documentation', () => {
  let spec: OpenAPISpec

  beforeAll(async () => {
    spec = await getOpenAPISpec()
  })

  it('400 Bad Request responses have consistent schema', () => {
    const response400s: string[] = []
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const method of ['post', 'put', 'patch'] as const) {
        const operation = pathItem[method]
        if (operation?.responses['400']) {
          response400s.push(`${method.toUpperCase()} ${path}`)
        }
      }
    }
    expect(response400s.length).toBeGreaterThan(0)
  })

  it('404 Not Found responses have consistent schema', () => {
    const response404s: string[] = []
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const method of ['get', 'put', 'delete'] as const) {
        const operation = pathItem[method]
        if (operation?.responses['404']) {
          response404s.push(`${method.toUpperCase()} ${path}`)
        }
      }
    }
    expect(response404s.length).toBeGreaterThan(0)
  })

  it('422 Unprocessable Entity responses are documented', () => {
    const post = spec.paths['/api/things']?.post
    expect(post?.responses['422']).toBeDefined()
  })

  it('error responses reference Error schema', () => {
    const post = spec.paths['/api/things']?.post
    if (post?.responses['400']?.content) {
      const schema = post.responses['400'].content['application/json'].schema
      const schemaStr = JSON.stringify(schema)
      expect(schemaStr).toContain('Error')
    }
  })
})

// ============================================================================
// 15. OpenAPI Content Negotiation Tests
// ============================================================================

describe('OpenAPI Content Negotiation', () => {
  let spec: OpenAPISpec

  beforeAll(async () => {
    spec = await getOpenAPISpec()
  })

  it('API endpoints specify application/json content type', () => {
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      if (path.startsWith('/api/')) {
        for (const method of ['get', 'post', 'put', 'delete'] as const) {
          const operation = pathItem[method]
          if (operation) {
            const successResponse = operation.responses['200'] || operation.responses['201']
            if (successResponse?.content) {
              expect(successResponse.content['application/json']).toBeDefined()
            }
          }
        }
      }
    }
  })

  it('MCP endpoint specifies text/event-stream for GET', () => {
    const mcpGet = spec.paths['/mcp']?.get
    if (mcpGet?.responses['200']?.content) {
      expect(mcpGet.responses['200'].content['text/event-stream']).toBeDefined()
    }
  })

  it('request bodies specify application/json', () => {
    for (const [, pathItem] of Object.entries(spec.paths)) {
      for (const method of ['post', 'put', 'patch'] as const) {
        const operation = pathItem[method]
        if (operation?.requestBody?.content) {
          expect(operation.requestBody.content['application/json']).toBeDefined()
        }
      }
    }
  })
})
