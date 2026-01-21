# @dotdo/api

> Self-describing APIs with auto-generated SDKs, CLIs, and MCP tools

## APIs Are Exhausting

You build an API. Then you write OpenAPI docs. Then an SDK. Then a CLI. Then MCP tools for AI agents.

They drift apart. Docs get stale. SDKs break. The CLI has different parameters than the API. Your AI tools don't match your actual endpoints.

You're maintaining five things when you should be maintaining one.

## Define Once, Generate Everything

```typescript
import { defineResource, createAPI, generateOpenAPI, generateSDK } from '@dotdo/api'

const Customer = defineResource('Customer')
  .fields({
    name: { type: 'string', required: true },
    email: { type: 'string', format: 'email', required: true },
    status: { type: 'enum', values: ['active', 'inactive'] }
  })
  .relations({
    orders: { type: 'hasMany', resource: 'Order' }
  })
  .build()

// That's it. You now have:
// - REST API with HATEOAS links
// - OpenAPI 3.0 specification
// - TypeScript SDK with full types
// - CLI commands
// - MCP tools for AI agents
```

## Features

- **HATEOAS Links** - Self-describing, discoverable APIs with hypermedia controls
- **OpenAPI 3.0** - Auto-generated specs with Swagger UI, JSON, and YAML exports
- **TypeScript SDK** - Type-safe clients generated from your resource definitions
- **CLI Generation** - Command-line interface with all CRUD operations
- **MCP Tools** - Model Context Protocol tools so AI agents can use your API
- **Zod Integration** - Automatic schema validation from field definitions
- **Rate Limiting** - Built-in distributed rate limiting middleware
- **Request Isolation** - Per-request resource contexts prevent tenant state leakage

## Installation

```bash
npm install @dotdo/api
```

## Quick Start

### 1. Define Your Resources

```typescript
import { defineResource } from '@dotdo/api'

const Customer = defineResource('Customer')
  .fields({
    name: { type: 'string', required: true },
    email: { type: 'string', format: 'email', required: true },
    plan: { type: 'enum', values: ['free', 'pro', 'enterprise'] }
  })
  .relations({
    orders: { type: 'hasMany', resource: 'Order' },
    account: { type: 'belongsTo', resource: 'Account' }
  })
  .hooks({
    afterCreate: async (data) => {
      await sendWelcomeEmail(data.email)
      return data
    }
  })
  .build()
```

### 2. Create Your API with OpenAPI Docs

```typescript
import { Hono } from 'hono'
import { addOpenAPIEndpoints } from '@dotdo/api'

const app = new Hono()

// Your routes
app.get('/customers', (c) => c.json({ customers: [] }))
app.post('/customers', (c) => c.json({ id: '123' }))

// Add OpenAPI endpoints automatically
addOpenAPIEndpoints(app, {
  info: { title: 'My API', version: '1.0.0' },
  schemas: { Customer }
})

// Now available:
// GET /docs         - Swagger UI
// GET /openapi.json - OpenAPI spec (JSON)
// GET /openapi.yaml - OpenAPI spec (YAML)
```

### 3. Generate a TypeScript SDK

```typescript
import { generateSDK, getAllResources } from '@dotdo/api'

const sdk = generateSDK(Object.values(getAllResources()))

// Generated SDK usage:
// const client = createClient({ baseUrl: 'https://api.example.com' })
// const customers = await client.customers.list()
// const customer = await client.customers.create({ name: 'Alice', email: 'alice@example.com' })
// await client.customers('cust-123').orders.list()
```

### 4. Generate MCP Tools for AI Agents

```typescript
import { generateMCPTools, getAllResources } from '@dotdo/api'

const tools = generateMCPTools(Object.values(getAllResources()))

// Each resource gets CRUD tools:
// - customer_create
// - customer_get
// - customer_update
// - customer_delete
// - customer_list
```

## API Reference

### Resource Definition

```typescript
defineResource<T>(name: string): ResourceBuilder<T>
```

Creates a new resource builder with a fluent API:

```typescript
const User = defineResource<UserData>('User')
  .fields({
    name: { type: 'string', required: true, minLength: 1, maxLength: 100 },
    email: { type: 'string', format: 'email', required: true },
    age: { type: 'integer', min: 0, max: 150 },
    tags: { type: 'array', items: 'string' },
    metadata: { type: 'object' },
    role: { type: 'enum', values: ['admin', 'user', 'guest'] },
    createdAt: { type: 'date' }
  })
  .relations({
    posts: { type: 'hasMany', resource: 'Post' },
    profile: { type: 'hasOne', resource: 'Profile' },
    organization: { type: 'belongsTo', resource: 'Organization' }
  })
  .actions({
    activate: {
      method: 'POST',
      handler: async (ctx) => { /* ... */ }
    }
  })
  .hooks({
    beforeCreate: async (data) => data,
    afterCreate: async (data) => data,
    beforeUpdate: async (id, data) => data,
    afterUpdate: async (id, data) => data,
    beforeDelete: async (id) => {},
    afterDelete: async (id) => {}
  })
  .computed({
    fullName: (data) => `${data.firstName} ${data.lastName}`
  })
  .build()
```

### Field Types

| Type | OpenAPI | Validation Options |
|------|---------|-------------------|
| `string` | `string` | `minLength`, `maxLength`, `pattern`, `format` |
| `number` | `number` | `min`, `max` |
| `integer` | `integer` | `min`, `max` |
| `boolean` | `boolean` | - |
| `array` | `array` | `items`, `minItems`, `maxItems` |
| `object` | `object` | `schema` (Zod) |
| `enum` | `string` + `enum` | `values` |
| `date` | `string` + `date-time` | - |

### String Formats

```typescript
{ type: 'string', format: 'email' }    // Email validation
{ type: 'string', format: 'url' }      // URL validation
{ type: 'string', format: 'uuid' }     // UUID validation
{ type: 'string', format: 'date-time' } // ISO date-time
```

### HATEOAS Links

```typescript
import { generateLinks, withLinks, generateAPIRoot } from '@dotdo/api'

// Generate links for a resource
const links = generateLinks('customers', 'cust-123', 'https://api.example.com', {
  relations: { orders: { type: 'hasMany', resource: 'Order' } },
  actions: ['activate', 'suspend']
})

// Wrap response with links
const response = withLinks(customerData, links)
// { data: {...}, _links: { self: {...}, update: {...}, orders: {...} } }

// Generate discoverable API root
const root = generateAPIRoot({
  baseUrl: 'https://api.example.com',
  name: 'My API',
  version: '1.0.0',
  resources: {
    customers: { path: '/customers', title: 'Customer collection' },
    orders: { path: '/orders', title: 'Order collection' }
  },
  openapi: { json: '/openapi.json', yaml: '/openapi.yaml' },
  docsPath: '/docs'
})
```

### OpenAPI Generation

```typescript
import { generateOpenAPI, addOpenAPIEndpoints } from '@dotdo/api'

// Manual generation
const spec = generateOpenAPI({
  app: honoApp,
  info: { title: 'My API', version: '1.0.0', description: 'API description' },
  servers: [{ url: 'https://api.example.com', description: 'Production' }],
  schemas: { Customer: customerSchema, Order: orderSchema },
  security: {
    bearerAuth: { type: 'http', scheme: 'bearer' },
    apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' }
  },
  tags: [{ name: 'customers', description: 'Customer operations' }]
})

// Or add endpoints directly to Hono app
addOpenAPIEndpoints(app, {
  info: { title: 'My API', version: '1.0.0' },
  docsPath: '/docs',      // Swagger UI
  jsonPath: '/openapi.json',
  yamlPath: '/openapi.yaml'
})
```

### Rate Limiting

```typescript
import { rateLimitMiddleware, createRateLimiter } from '@dotdo/api'

// Use default tiers
app.use('*', rateLimitMiddleware())

// Custom configuration
const limiter = createRateLimiter({
  tiers: {
    free: { requestsPerMinute: 60, requestsPerDay: 1000 },
    pro: { requestsPerMinute: 600, requestsPerDay: 50000 }
  },
  getTier: (c) => c.get('user')?.plan || 'free'
})
app.use('*', limiter)
```

### Request-Scoped Resources

Prevent tenant state leakage in multi-tenant environments:

```typescript
import { runWithResourceContext, defineResource } from '@dotdo/api'

app.use(async (c, next) => {
  await runWithResourceContext(async () => {
    // Resources defined here are isolated to this request
    await next()
  })
})
```

## Examples

### Complete API Setup

```typescript
import { Hono } from 'hono'
import {
  defineResource,
  createAPI,
  addOpenAPIEndpoints,
  generateLinks,
  withLinks,
  rateLimitMiddleware
} from '@dotdo/api'

// Define resources
const Customer = defineResource('Customer')
  .fields({
    name: { type: 'string', required: true },
    email: { type: 'string', format: 'email', required: true }
  })
  .build()

const Order = defineResource('Order')
  .fields({
    customerId: { type: 'string', required: true },
    total: { type: 'number', required: true },
    status: { type: 'enum', values: ['pending', 'paid', 'shipped'] }
  })
  .build()

// Create app
const app = new Hono()

// Middleware
app.use('*', rateLimitMiddleware())

// Routes with HATEOAS
app.get('/customers/:id', async (c) => {
  const id = c.req.param('id')
  const customer = await db.get(id)
  const links = generateLinks('customers', id, 'https://api.example.com')
  return c.json(withLinks(customer, links))
})

// Add OpenAPI
addOpenAPIEndpoints(app, {
  info: { title: 'E-commerce API', version: '1.0.0' },
  schemas: { Customer, Order }
})

export default app
```

## Related Packages

| Package | Description |
|---------|-------------|
| `@dotdo/do` | Durable Object with built-in entities |
| `@dotdo/db` | Abstract storage layer |
| `@dotdo/auth` | JWT authentication with jose |
| `@dotdo/rpc` | Cap'n Web RPC transport |
| `@dotdo/mcp` | Model Context Protocol server |

## License

MIT
