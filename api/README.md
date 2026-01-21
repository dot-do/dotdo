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

## CORS Configuration

CORS (Cross-Origin Resource Sharing) is configured through the `createAPI` options. The implementation follows secure defaults with explicit opt-in for specific origins.

### Quick Start

```typescript
import { createAPI } from '@dotdo/api'

// Development: Allow all origins (not secure)
const devApp = createAPI({
  cors: {
    allowedOrigins: ['*']  // WARNING: Development only!
  }
})

// Production: Whitelist specific origins
const prodApp = createAPI({
  cors: {
    allowedOrigins: [
      'https://app.example.com',
      'https://admin.example.com'
    ]
  }
})

// Restrictive: No origins allowed (default)
const restrictiveApp = createAPI()
```

### Configuration Options

The `allowedOrigins` field accepts:

| Value | Behavior | Use Case |
|-------|----------|----------|
| `[]` (default) | No origins allowed | Most restrictive, secure default |
| `['https://example.com']` | Only listed origins allowed | Production with specific clients |
| `['*']` | All origins allowed | Development and testing only |

### Security Warnings

**Wildcard Origins (`['*']`) in Production**

Do NOT use `['*']` in production environments. This allows any website to make authenticated requests to your API.

Risks:
- Credentials can be stolen via CSRF attacks
- Authentication tokens can be leaked
- Your API becomes accessible to malicious sites

```typescript
// WRONG - Never in production
const prodApp = createAPI({
  cors: {
    allowedOrigins: ['*']  // SECURITY RISK!
  }
})
```

### Environment-Specific Configuration

Recommended approach: Configure CORS based on environment.

```typescript
import { createAPI } from '@dotdo/api'

interface Env {
  ENVIRONMENT: 'development' | 'staging' | 'production'
  ALLOWED_ORIGINS?: string
}

function getCorsConfig(env: Env) {
  if (env.ENVIRONMENT === 'development') {
    return {
      allowedOrigins: ['*']  // OK for local development
    }
  }

  // Production and staging: whitelist specific origins
  return {
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
  }
}

const app = createAPI({
  cors: getCorsConfig(env)
})
```

### CORS Headers

The API configures the following CORS headers:

```
Access-Control-Allow-Origin: <origin> | *
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Request-ID, X-API-Key
Access-Control-Expose-Headers: X-Request-ID
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400
```

### Testing CORS

Test your CORS configuration with:

```bash
# Test OPTIONS request
curl -i -X OPTIONS https://api.example.com/health \
  -H "Origin: https://app.example.com" \
  -H "Access-Control-Request-Method: GET"

# Check response headers
# Should see: Access-Control-Allow-Origin: https://app.example.com
```

See `/api/tests/cors.test.ts` for comprehensive test examples.

### Deployment Configuration

For production deployments, set allowed origins via environment variables:

```bash
# .env.production
ENVIRONMENT=production
ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com,https://dashboard.example.com
```

Then configure in your app:

```typescript
const app = createAPI({
  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',')
  }
})
```

### References

- See `DEPLOYMENT.md` section 5.2 for production CORS best practices
- See `/api/tests/cors.test.ts` for test patterns
- Source: `/api/app.ts` lines 9-158

## Status

See beads issues do-7rf.7.* for implementation progress.
