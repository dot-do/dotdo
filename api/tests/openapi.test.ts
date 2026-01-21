import { describe, it, expect } from 'vitest'
import {
  generateOpenAPI,
  OpenAPIGenerator,
  specToYAML,
  createSwaggerUI,
  addOpenAPIEndpoints
} from '../openapi'
import { Hono } from 'hono'
import { z } from 'zod'
import type { ResourceDefinition } from '../resource'

describe('OpenAPI Generation', () => {
  describe('generateOpenAPI', () => {
    it('should generate valid OpenAPI 3.0 spec with basic info', () => {
      const app = new Hono()
      app.get('/users', (c) => c.json({ users: [] }))

      const spec = generateOpenAPI({
        app,
        info: {
          title: 'Test API',
          version: '1.0.0',
          description: 'Test API Description'
        }
      })

      expect(spec.openapi).toBe('3.0.3')
      expect(spec.info.title).toBe('Test API')
      expect(spec.info.version).toBe('1.0.0')
      expect(spec.info.description).toBe('Test API Description')
      expect(spec.paths).toBeDefined()
    })

    it('should generate paths from Hono routes', () => {
      const app = new Hono()
      app.get('/users', (c) => c.json({ users: [] }))
      app.post('/users', (c) => c.json({ id: '1' }))
      app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }))
      app.put('/users/:id', (c) => c.json({ id: c.req.param('id') }))
      app.delete('/users/:id', (c) => c.json({ success: true }))

      const spec = generateOpenAPI({ app })

      expect(spec.paths['/users']).toBeDefined()
      expect(spec.paths['/users']!.get).toBeDefined()
      expect(spec.paths['/users']!.post).toBeDefined()
      expect(spec.paths['/users/{id}']).toBeDefined()
      expect(spec.paths['/users/{id}']!.get).toBeDefined()
      expect(spec.paths['/users/{id}']!.put).toBeDefined()
      expect(spec.paths['/users/{id}']!.delete).toBeDefined()
    })

    it('should convert Hono path params to OpenAPI format', () => {
      const app = new Hono()
      app.get('/users/:userId/orders/:orderId', (c) => c.json({}))

      const spec = generateOpenAPI({ app })

      expect(spec.paths['/users/{userId}/orders/{orderId}']).toBeDefined()
      const operation = spec.paths['/users/{userId}/orders/{orderId}']!.get!
      expect(operation.parameters).toHaveLength(2)
      expect(operation.parameters![0]!.name).toBe('userId')
      expect(operation.parameters![0]!.in).toBe('path')
      expect(operation.parameters![0]!.required).toBe(true)
      expect(operation.parameters![1]!.name).toBe('orderId')
    })

    it('should generate schema from Zod types', () => {
      const UserSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
        age: z.number().optional(),
        active: z.boolean().default(true)
      })

      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        schemas: {
          User: UserSchema
        }
      })

      expect(spec.components!.schemas!.User).toBeDefined()
      expect(spec.components!.schemas!.User!.type).toBe('object')
      expect(spec.components!.schemas!.User!.properties!.id).toBeDefined()
      expect(spec.components!.schemas!.User!.properties!.email!.type).toBe('string')
      expect(spec.components!.schemas!.User!.properties!.email!.format).toBe('email')
      expect(spec.components!.schemas!.User!.properties!.age!.type).toBe('number')
      expect(spec.components!.schemas!.User!.properties!.active!.default).toBe(true)
      expect(spec.components!.schemas!.User!.required).toContain('id')
      expect(spec.components!.schemas!.User!.required).toContain('name')
      expect(spec.components!.schemas!.User!.required).not.toContain('age')
    })

    it('should generate schemas from resource definitions', () => {
      const app = new Hono()
      const resources: ResourceDefinition<any>[] = [
        {
          name: 'Customer',
          schema: z.object({
            name: z.string(),
            email: z.string()
          }),
          fields: {
            name: { type: 'string', required: true },
            email: { type: 'string', required: true }
          }
        }
      ]

      const spec = generateOpenAPI({ app, resources })

      expect(spec.components!.schemas!.Customer).toBeDefined()
      expect(spec.components!.schemas!.Customer!.properties!.name).toBeDefined()
      expect(spec.components!.schemas!.Customer!.properties!.email).toBeDefined()
    })

    it('should add request body schemas for POST/PUT operations', () => {
      const UserSchema = z.object({
        name: z.string(),
        email: z.string()
      })

      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        schemas: { User: UserSchema },
        operations: {
          'POST /users': {
            requestBody: { schema: 'User' },
            responses: {
              '201': { schema: 'User' }
            }
          }
        }
      })

      const postOp = spec.paths['/users']?.post
      expect(postOp).toBeDefined()
      expect(postOp!.requestBody).toBeDefined()
      expect(postOp!.requestBody!.content!['application/json']!.schema!.$ref).toBe(
        '#/components/schemas/User'
      )
      expect(postOp!.responses['201']).toBeDefined()
      expect(postOp!.responses['201']!.content!['application/json']!.schema!.$ref).toBe(
        '#/components/schemas/User'
      )
    })

    it('should add response schemas', () => {
      const app = new Hono()
      const UserListSchema = z.object({
        users: z.array(z.object({ id: z.string(), name: z.string() })),
        total: z.number()
      })

      const spec = generateOpenAPI({
        app,
        schemas: { UserList: UserListSchema },
        operations: {
          'GET /users': {
            responses: {
              '200': { schema: 'UserList' }
            }
          }
        }
      })

      const getOp = spec.paths['/users']?.get
      expect(getOp!.responses['200']).toBeDefined()
      expect(getOp!.responses['200']!.content!['application/json']!.schema!.$ref).toBe(
        '#/components/schemas/UserList'
      )
    })

    it('should support query parameters', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        operations: {
          'GET /users': {
            parameters: [
              { name: 'page', in: 'query', schema: { type: 'integer' } },
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
              { name: 'search', in: 'query', schema: { type: 'string' }, required: false }
            ]
          }
        }
      })

      const getOp = spec.paths['/users']?.get
      expect(getOp!.parameters).toHaveLength(3)
      expect(getOp!.parameters!.find((p) => p.name === 'page')).toBeDefined()
      expect(getOp!.parameters!.find((p) => p.name === 'limit')).toBeDefined()
      expect(getOp!.parameters!.find((p) => p.name === 'search')).toBeDefined()
    })

    it('should include operation descriptions and summaries', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        operations: {
          'GET /users': {
            summary: 'List all users',
            description: 'Retrieve a paginated list of all users in the system',
            tags: ['Users']
          }
        }
      })

      const getOp = spec.paths['/users']?.get
      expect(getOp!.summary).toBe('List all users')
      expect(getOp!.description).toBe('Retrieve a paginated list of all users in the system')
      expect(getOp!.tags).toContain('Users')
    })

    it('should support authentication schemes', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        security: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      })

      expect(spec.components!.securitySchemes!.bearerAuth).toBeDefined()
      expect(spec.components!.securitySchemes!.bearerAuth!.type).toBe('http')
      expect(spec.components!.securitySchemes!.bearerAuth!.scheme).toBe('bearer')
    })

    it('should apply security requirements to operations', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        security: {
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key'
          }
        },
        operations: {
          'POST /users': {
            security: [{ apiKey: [] }]
          }
        }
      })

      const postOp = spec.paths['/users']?.post
      expect(postOp!.security).toBeDefined()
      expect(postOp!.security![0]!.apiKey).toBeDefined()
    })

    it('should support tags and grouping', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        tags: [
          { name: 'Users', description: 'User management operations' },
          { name: 'Orders', description: 'Order management operations' }
        ],
        operations: {
          'GET /users': { tags: ['Users'] },
          'GET /orders': { tags: ['Orders'] }
        }
      })

      expect(spec.tags).toHaveLength(2)
      expect(spec.tags![0]!.name).toBe('Users')
      expect(spec.tags![1]!.description).toBe('Order management operations')
    })

    it('should support servers configuration', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        servers: [
          { url: 'https://api.example.com', description: 'Production' },
          { url: 'https://staging.api.example.com', description: 'Staging' }
        ]
      })

      expect(spec.servers).toHaveLength(2)
      expect(spec.servers![0]!.url).toBe('https://api.example.com')
      expect(spec.servers![1]!.description).toBe('Staging')
    })
  })

  describe('OpenAPIGenerator class', () => {
    it('should convert Zod string to OpenAPI schema', () => {
      const generator = new OpenAPIGenerator()
      const schema = generator.zodToOpenAPI(z.string())

      expect(schema.type).toBe('string')
    })

    it('should convert Zod number to OpenAPI schema', () => {
      const generator = new OpenAPIGenerator()
      const schema = generator.zodToOpenAPI(z.number())

      expect(schema.type).toBe('number')
    })

    it('should convert Zod boolean to OpenAPI schema', () => {
      const generator = new OpenAPIGenerator()
      const schema = generator.zodToOpenAPI(z.boolean())

      expect(schema.type).toBe('boolean')
    })

    it('should convert Zod object to OpenAPI schema', () => {
      const generator = new OpenAPIGenerator()
      const zodSchema = z.object({
        name: z.string(),
        age: z.number()
      })
      const schema = generator.zodToOpenAPI(zodSchema)

      expect(schema.type).toBe('object')
      expect(schema.properties!.name!.type).toBe('string')
      expect(schema.properties!.age!.type).toBe('number')
      expect(schema.required).toEqual(['name', 'age'])
    })

    it('should convert Zod array to OpenAPI schema', () => {
      const generator = new OpenAPIGenerator()
      const schema = generator.zodToOpenAPI(z.array(z.string()))

      expect(schema.type).toBe('array')
      expect(schema.items!.type).toBe('string')
    })

    it('should handle Zod optional fields', () => {
      const generator = new OpenAPIGenerator()
      const zodSchema = z.object({
        required: z.string(),
        optional: z.string().optional()
      })
      const schema = generator.zodToOpenAPI(zodSchema)

      expect(schema.required).toEqual(['required'])
      expect(schema.required).not.toContain('optional')
    })

    it('should handle Zod default values', () => {
      const generator = new OpenAPIGenerator()
      const schema = generator.zodToOpenAPI(z.string().default('test'))

      expect(schema.default).toBe('test')
    })

    it('should handle Zod string formats', () => {
      const generator = new OpenAPIGenerator()
      const emailSchema = generator.zodToOpenAPI(z.string().email())
      const urlSchema = generator.zodToOpenAPI(z.string().url())
      const uuidSchema = generator.zodToOpenAPI(z.string().uuid())

      expect(emailSchema.format).toBe('email')
      expect(urlSchema.format).toBe('uri')
      expect(uuidSchema.format).toBe('uuid')
    })

    it('should handle Zod number constraints', () => {
      const generator = new OpenAPIGenerator()
      const schema = generator.zodToOpenAPI(z.number().min(0).max(100))

      expect(schema.minimum).toBe(0)
      expect(schema.maximum).toBe(100)
    })

    it('should handle Zod string constraints', () => {
      const generator = new OpenAPIGenerator()
      const schema = generator.zodToOpenAPI(z.string().min(5).max(20))

      expect(schema.minLength).toBe(5)
      expect(schema.maxLength).toBe(20)
    })

    it('should handle Zod enum', () => {
      const generator = new OpenAPIGenerator()
      const schema = generator.zodToOpenAPI(z.enum(['red', 'green', 'blue']))

      expect(schema.type).toBe('string')
      expect(schema.enum).toEqual(['red', 'green', 'blue'])
    })

    it('should handle nested objects', () => {
      const generator = new OpenAPIGenerator()
      const zodSchema = z.object({
        user: z.object({
          name: z.string(),
          address: z.object({
            street: z.string(),
            city: z.string()
          })
        })
      })
      const schema = generator.zodToOpenAPI(zodSchema)

      expect(schema.properties!.user!.type).toBe('object')
      expect(schema.properties!.user!.properties!.name!.type).toBe('string')
      expect(schema.properties!.user!.properties!.address!.type).toBe('object')
      expect(schema.properties!.user!.properties!.address!.properties!.street!.type).toBe('string')
    })

    it('should extract path parameters from Hono route', () => {
      const generator = new OpenAPIGenerator()
      const params = generator.extractPathParams('/users/:userId/orders/:orderId')

      expect(params).toHaveLength(2)
      expect(params[0]).toEqual({
        name: 'userId',
        in: 'path',
        required: true,
        schema: { type: 'string' }
      })
      expect(params[1]).toEqual({
        name: 'orderId',
        in: 'path',
        required: true,
        schema: { type: 'string' }
      })
    })

    it('should convert Hono path to OpenAPI path', () => {
      const generator = new OpenAPIGenerator()
      const path = generator.honoPathToOpenAPI('/users/:id/orders/:orderId')

      expect(path).toBe('/users/{id}/orders/{orderId}')
    })
  })

  describe('specToYAML', () => {
    it('should convert OpenAPI spec to YAML format', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        info: {
          title: 'Test API',
          version: '1.0.0'
        }
      })

      const yaml = specToYAML(spec)

      expect(yaml).toContain('openapi: 3.0.3')
      expect(yaml).toContain('title: Test API')
      expect(yaml).toContain('version: 1.0.0')
    })

    it('should handle nested objects in YAML', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        schemas: {
          User: z.object({ name: z.string(), email: z.string() })
        }
      })

      const yaml = specToYAML(spec)

      expect(yaml).toContain('components:')
      expect(yaml).toContain('schemas:')
      expect(yaml).toContain('User:')
      expect(yaml).toContain('properties:')
    })

    it('should handle arrays in YAML', () => {
      const app = new Hono()
      const spec = generateOpenAPI({
        app,
        tags: [
          { name: 'Users', description: 'User operations' },
          { name: 'Orders', description: 'Order operations' }
        ]
      })

      const yaml = specToYAML(spec)

      expect(yaml).toContain('tags:')
      expect(yaml).toContain('- name: Users')
      expect(yaml).toContain('- name: Orders')
    })
  })

  describe('createSwaggerUI', () => {
    it('should create Swagger UI HTML', () => {
      const html = createSwaggerUI('/openapi.json')

      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('swagger-ui')
      expect(html).toContain('/openapi.json')
      expect(html).toContain('SwaggerUIBundle')
    })

    it('should use custom spec URL', () => {
      const html = createSwaggerUI('/custom/spec.json')

      expect(html).toContain('/custom/spec.json')
    })
  })

  describe('addOpenAPIEndpoints', () => {
    it('should add /docs endpoint', async () => {
      const app = new Hono()
      app.get('/users', (c) => c.json({ users: [] }))

      addOpenAPIEndpoints(app, {
        info: { title: 'Test API', version: '1.0.0' }
      })

      const res = await app.request('/docs')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/html')

      const html = await res.text()
      expect(html).toContain('swagger-ui')
    })

    it('should add /openapi.json endpoint', async () => {
      const app = new Hono()
      app.get('/users', (c) => c.json({ users: [] }))

      addOpenAPIEndpoints(app, {
        info: { title: 'Test API', version: '1.0.0' }
      })

      const res = await app.request('/openapi.json')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')

      const spec = (await res.json()) as { openapi: string; info: { title: string } }
      expect(spec.openapi).toBe('3.0.3')
      expect(spec.info.title).toBe('Test API')
    })

    it('should add /openapi.yaml endpoint', async () => {
      const app = new Hono()
      app.get('/users', (c) => c.json({ users: [] }))

      addOpenAPIEndpoints(app, {
        info: { title: 'Test API', version: '1.0.0' }
      })

      const res = await app.request('/openapi.yaml')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/x-yaml')

      const yaml = await res.text()
      expect(yaml).toContain('openapi: 3.0.3')
      expect(yaml).toContain('title: Test API')
    })

    it('should use custom paths', async () => {
      const app = new Hono()
      app.get('/users', (c) => c.json({ users: [] }))

      addOpenAPIEndpoints(app, {
        info: { title: 'Test API', version: '1.0.0' },
        docsPath: '/api-docs',
        jsonPath: '/api-spec.json',
        yamlPath: '/api-spec.yaml'
      })

      const docsRes = await app.request('/api-docs')
      expect(docsRes.status).toBe(200)

      const jsonRes = await app.request('/api-spec.json')
      expect(jsonRes.status).toBe(200)

      const yamlRes = await app.request('/api-spec.yaml')
      expect(yamlRes.status).toBe(200)
    })
  })
})
