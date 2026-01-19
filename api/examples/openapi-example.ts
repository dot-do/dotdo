// Example: OpenAPI auto-generation with @dotdo/api
// This demonstrates the complete OpenAPI generation workflow

import { Hono } from 'hono'
import { z } from 'zod'
import { generateOpenAPI, addOpenAPIEndpoints } from '../openapi'

// Define Zod schemas for your data models
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().min(0).max(150).optional(),
  role: z.enum(['admin', 'user', 'guest']).default('user'),
  createdAt: z.string().datetime()
})

const CreateUserSchema = UserSchema.omit({ id: true, createdAt: true })

const OrderSchema = z.object({
  id: z.string(),
  userId: z.string(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().min(1),
    price: z.number()
  })),
  total: z.number(),
  status: z.enum(['pending', 'processing', 'shipped', 'delivered']),
  createdAt: z.string().datetime()
})

const UserListSchema = z.object({
  users: z.array(UserSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number()
})

// Create your Hono app with routes
const app = new Hono()

// Users routes
app.get('/users', (c) => c.json({ users: [], total: 0 }))
app.post('/users', (c) => c.json({ id: '1', name: 'Alice' }))
app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }))
app.put('/users/:id', (c) => c.json({ id: c.req.param('id') }))
app.delete('/users/:id', (c) => c.json({ success: true }))

// Orders routes
app.get('/users/:userId/orders', (c) => c.json({ orders: [] }))
app.post('/users/:userId/orders', (c) => c.json({ id: '1' }))

// Custom actions
app.post('/users/:id/activate', (c) => c.json({ activated: true }))
app.post('/users/:id/deactivate', (c) => c.json({ deactivated: true }))

// Method 1: Generate OpenAPI spec programmatically
const spec = generateOpenAPI({
  app,
  info: {
    title: 'User Management API',
    version: '1.0.0',
    description: 'A comprehensive API for managing users and their orders',
    contact: {
      name: 'API Support',
      email: 'support@example.com',
      url: 'https://example.com/support'
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT'
    }
  },
  servers: [
    { url: 'https://api.example.com', description: 'Production' },
    { url: 'https://staging.api.example.com', description: 'Staging' },
    { url: 'http://localhost:3000', description: 'Development' }
  ],
  schemas: {
    User: UserSchema,
    CreateUser: CreateUserSchema,
    UserList: UserListSchema,
    Order: OrderSchema
  },
  operations: {
    'GET /users': {
      summary: 'List all users',
      description: 'Retrieve a paginated list of all users in the system',
      tags: ['Users'],
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        { name: 'search', in: 'query', schema: { type: 'string' }, required: false }
      ],
      responses: {
        '200': { schema: 'UserList', description: 'List of users' }
      }
    },
    'POST /users': {
      summary: 'Create a new user',
      description: 'Create a new user account',
      tags: ['Users'],
      requestBody: { schema: 'CreateUser' },
      responses: {
        '201': { schema: 'User', description: 'User created successfully' },
        '400': { description: 'Invalid input' }
      }
    },
    'GET /users/:id': {
      summary: 'Get user by ID',
      description: 'Retrieve a single user by their unique identifier',
      tags: ['Users'],
      responses: {
        '200': { schema: 'User', description: 'User found' },
        '404': { description: 'User not found' }
      },
      security: [{ apiKey: [] }]
    },
    'PUT /users/:id': {
      summary: 'Update user',
      description: 'Update an existing user',
      tags: ['Users'],
      requestBody: { schema: 'CreateUser' },
      responses: {
        '200': { schema: 'User', description: 'User updated' },
        '404': { description: 'User not found' }
      },
      security: [{ apiKey: [] }]
    },
    'DELETE /users/:id': {
      summary: 'Delete user',
      description: 'Delete a user from the system',
      tags: ['Users'],
      responses: {
        '200': { description: 'User deleted successfully' },
        '404': { description: 'User not found' }
      },
      security: [{ apiKey: [] }]
    },
    'GET /users/:userId/orders': {
      summary: 'Get user orders',
      description: 'Retrieve all orders for a specific user',
      tags: ['Orders'],
      responses: {
        '200': { description: 'List of orders' }
      }
    },
    'POST /users/:id/activate': {
      summary: 'Activate user',
      description: 'Activate a deactivated user account',
      tags: ['Users', 'Actions'],
      responses: {
        '200': { description: 'User activated' }
      },
      security: [{ apiKey: [] }]
    },
    'POST /users/:id/deactivate': {
      summary: 'Deactivate user',
      description: 'Deactivate an active user account',
      tags: ['Users', 'Actions'],
      responses: {
        '200': { description: 'User deactivated' }
      },
      security: [{ apiKey: [] }]
    }
  },
  security: {
    apiKey: {
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
      description: 'API key for authentication'
    },
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'JWT Bearer token'
    }
  },
  tags: [
    { name: 'Users', description: 'User management operations' },
    { name: 'Orders', description: 'Order management operations' },
    { name: 'Actions', description: 'Custom user actions' }
  ]
})

console.log('Generated OpenAPI spec:')
console.log(JSON.stringify(spec, null, 2))

// Method 2: Add OpenAPI endpoints to your app
// This automatically adds:
// - GET /docs - Swagger UI
// - GET /openapi.json - OpenAPI spec as JSON
// - GET /openapi.yaml - OpenAPI spec as YAML

const appWithDocs = new Hono()

// Add your routes first
appWithDocs.get('/users', (c) => c.json({ users: [] }))
appWithDocs.post('/users', (c) => c.json({ id: '1' }))
appWithDocs.get('/users/:id', (c) => c.json({ id: c.req.param('id') }))

// Then add OpenAPI endpoints
addOpenAPIEndpoints(appWithDocs, {
  info: {
    title: 'User Management API',
    version: '1.0.0',
    description: 'Auto-generated OpenAPI documentation'
  },
  schemas: {
    User: UserSchema,
    CreateUser: CreateUserSchema
  },
  operations: {
    'GET /users': {
      summary: 'List users',
      tags: ['Users'],
      responses: {
        '200': { description: 'Success' }
      }
    }
  }
})

// Now you can:
// - Visit /docs to see Swagger UI
// - Fetch /openapi.json for the spec
// - Download /openapi.yaml for YAML format

// Custom paths example
const appWithCustomPaths = new Hono()
addOpenAPIEndpoints(appWithCustomPaths, {
  info: { title: 'My API', version: '2.0.0' },
  docsPath: '/api-docs',
  jsonPath: '/api/spec.json',
  yamlPath: '/api/spec.yaml'
})

// Integration example with resources (from do-7rf.7.4)
// Once resource definitions are implemented, you can do:
/*
import { defineResource } from '@dotdo/api'

const Customer = defineResource({
  name: 'Customer',
  schema: z.object({
    name: z.string(),
    email: z.string().email()
  }),
  fields: {
    name: { type: 'string', required: true },
    email: { type: 'string', required: true }
  }
})

const spec = generateOpenAPI({
  app,
  resources: [Customer],
  info: { title: 'My API', version: '1.0.0' }
})
*/

export { app, appWithDocs, appWithCustomPaths, spec }
