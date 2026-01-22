# @dotdo/api

Self-describing Hono API for dotdo.

## Define Once, Generate Everything

```typescript
const Customer = defineResource({
  name: 'Customer',
  schema: CustomerSchema,
  fields: { name: { type: 'string' } },
  relations: { orders: { type: 'hasMany', resource: 'Order' } }
})

// Auto-generates:
// - API routes with HATEOAS links
// - OpenAPI spec
// - TypeScript SDK
// - CLI commands
// - MCP tools
```

## OpenAPI Auto-Generation (do-7rf.7.3) ✅

Generate complete OpenAPI 3.0 specs from Hono routes and Zod schemas.

### Quick Start

```typescript
import { Hono } from 'hono'
import { z } from 'zod'
import { addOpenAPIEndpoints } from '@dotdo/api'

const app = new Hono()
app.get('/users', (c) => c.json({ users: [] }))

addOpenAPIEndpoints(app, {
  info: { title: 'My API', version: '1.0.0' },
  schemas: {
    User: z.object({
      name: z.string(),
      email: z.string().email()
    })
  }
})

// Available endpoints:
// GET /docs         - Swagger UI
// GET /openapi.json - OpenAPI spec (JSON)
// GET /openapi.yaml - OpenAPI spec (YAML)
```

### Features

- ✅ OpenAPI 3.0.3 spec generation
- ✅ Zod schema to OpenAPI schema conversion
- ✅ Automatic path parameter detection
- ✅ Request/response body schemas
- ✅ Authentication schemes (API Key, Bearer, OAuth2)
- ✅ Tags and operation grouping
- ✅ YAML export
- ✅ Built-in Swagger UI
- ✅ Server configuration
- ✅ Comprehensive type safety

### Zod to OpenAPI Mapping

| Zod | OpenAPI | Example |
|-----|---------|---------|
| `z.string()` | `type: 'string'` | Basic string |
| `z.string().email()` | `format: 'email'` | Email validation |
| `z.string().url()` | `format: 'uri'` | URL validation |
| `z.string().uuid()` | `format: 'uuid'` | UUID format |
| `z.number().min(0).max(100)` | `minimum/maximum` | Range constraints |
| `z.enum(['a','b'])` | `enum: ['a','b']` | Enumeration |
| `z.string().optional()` | Not in required | Optional field |
| `z.string().default('x')` | `default: 'x'` | Default value |

See `api/examples/openapi-example.ts` for comprehensive examples.

## Status

See beads issues do-7rf.7.* for implementation progress.
