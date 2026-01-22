# @dotdo/api

> Self-describing APIs with auto-generated SDKs, CLIs, and MCP tools

[![npm version](https://img.shields.io/npm/v/@dotdo/api.svg)](https://www.npmjs.com/package/@dotdo/api)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

## The Problem

APIs are exhausting:

- **Documentation drift** - You build an API, then write OpenAPI docs, then they get stale
- **SDK sprawl** - You need TypeScript clients, Python clients, CLI tools... each maintained separately
- **AI integration pain** - Now you need MCP tools for AI agents too
- **Inconsistency everywhere** - Docs say one thing, SDK does another, CLI has different parameters

You're maintaining five things when you should be maintaining one.

## The Solution

Define once, generate everything:

```typescript
import { defineResource, addOpenAPIEndpoints } from '@dotdo/api'

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

## Quick Start

### Installation

```bash
npm install @dotdo/api
```

### Define Your Resources

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

### Add OpenAPI Documentation

```typescript
import { Hono } from 'hono'
import { addOpenAPIEndpoints } from '@dotdo/api'

const app = new Hono()

// Your routes
app.get('/customers', (c) => c.json({ customers: [] }))
app.post('/customers', (c) => c.json({ id: '123' }))

// Add OpenAPI endpoints
addOpenAPIEndpoints(app, {
  info: { title: 'My API', version: '1.0.0' },
  schemas: { Customer }
})

// Now available:
// GET /docs         - Swagger UI
// GET /openapi.json - OpenAPI spec (JSON)
// GET /openapi.yaml - OpenAPI spec (YAML)
```

## Features

### HATEOAS Links

Self-describing, discoverable APIs:

```typescript
import { generateLinks, withLinks } from '@dotdo/api'

app.get('/customers/:id', async (c) => {
  const id = c.req.param('id')
  const customer = await db.get(id)
  const links = generateLinks('customers', id, 'https://api.example.com')
  return c.json(withLinks(customer, links))
})

// Response:
// {
//   "data": { "id": "123", "name": "Alice" },
//   "_links": {
//     "self": { "href": "/customers/123" },
//     "update": { "href": "/customers/123", "method": "PATCH" },
//     "orders": { "href": "/customers/123/orders" }
//   }
// }
```

### SDK Generation

Generate TypeScript SDKs from your resources:

```typescript
import { generateSDK, getAllResources } from '@dotdo/api'

const sdk = generateSDK(Object.values(getAllResources()))

// Generated SDK usage:
// const client = createClient({ baseUrl: 'https://api.example.com' })
// const customers = await client.customers.list()
// const customer = await client.customers.create({ name: 'Alice', email: 'alice@example.com' })
// await client.customers('cust-123').orders.list()
```

### MCP Tools

Generate Model Context Protocol tools for AI agents:

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

### Rate Limiting

Built-in distributed rate limiting:

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

### Request Isolation

Prevent tenant state leakage in multi-tenant environments:

```typescript
import { runWithResourceContext } from '@dotdo/api'

app.use(async (c, next) => {
  await runWithResourceContext(async () => {
    // Resources defined here are isolated to this request
    await next()
  })
})
```

## API Reference

### Resource Definition

```typescript
const User = defineResource<UserData>('User')
  .fields({
    name: { type: 'string', required: true, minLength: 1 },
    email: { type: 'string', format: 'email', required: true },
    age: { type: 'integer', min: 0, max: 150 },
    role: { type: 'enum', values: ['admin', 'user'] }
  })
  .relations({
    posts: { type: 'hasMany', resource: 'Post' },
    profile: { type: 'hasOne', resource: 'Profile' }
  })
  .actions({
    activate: {
      method: 'POST',
      handler: async (ctx) => { /* ... */ }
    }
  })
  .hooks({
    beforeCreate: async (data) => data,
    afterCreate: async (data) => data
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
{ type: 'string', format: 'email' }     // Email validation
{ type: 'string', format: 'url' }       // URL validation
{ type: 'string', format: 'uuid' }      // UUID validation
{ type: 'string', format: 'date-time' } // ISO date-time
```

### OpenAPI Generation

```typescript
import { generateOpenAPI, addOpenAPIEndpoints } from '@dotdo/api'

// Manual generation
const spec = generateOpenAPI({
  app: honoApp,
  info: { title: 'My API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  schemas: { Customer, Order }
})

// Or add endpoints directly
addOpenAPIEndpoints(app, {
  info: { title: 'My API', version: '1.0.0' },
  docsPath: '/docs',
  jsonPath: '/openapi.json',
  yamlPath: '/openapi.yaml'
})
```

## Examples

### Complete API Setup

```typescript
import { Hono } from 'hono'
import {
  defineResource,
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
| [@dotdo/do](/do) | Durable Object with built-in entities |
| [@dotdo/db](/db) | Abstract storage layer |
| [@dotdo/auth](/auth) | JWT authentication |
| [@dotdo/rpc](/rpc) | Cap'n Web RPC transport |
| [@dotdo/mcp](/mcp) | Model Context Protocol server |

## License

MIT
