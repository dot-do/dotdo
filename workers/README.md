# Workers

Proxy workers that route HTTP requests to Durable Objects.

## Quick Start

```typescript
import { API } from 'dotdo'

export default API()
```

That's it. Requests are routed to DOs based on hostname subdomain.

## API() Factory

The `API()` factory creates minimal proxy workers with a clean, declarative API.

### Hostname Mode (Default)

Extracts namespace from the hostname subdomain:

```typescript
export default API()

// tenant.api.dotdo.dev/users → DO('tenant').fetch('/users')
// my-org.api.dotdo.dev/data  → DO('my-org').fetch('/data')
```

**Subdomain detection:** Requires 4+ hostname parts (e.g., `tenant.api.dotdo.dev`). Apex domains like `api.dotdo.dev` return 404.

### Path Param Routing

Extracts namespace from path segments using Express-style patterns:

```typescript
// Single param
export default API({ ns: '/:org' })

// api.dotdo.dev/acme/users       → DO('acme').fetch('/users')
// api.dotdo.dev/acme/users/123   → DO('acme').fetch('/users/123')
// api.dotdo.dev/acme             → DO('acme').fetch('/')
```

```typescript
// Nested params (joined by colon)
export default API({ ns: '/:org/:project' })

// api.dotdo.dev/acme/proj1/tasks → DO('acme:proj1').fetch('/tasks')
// api.dotdo.dev/acme/proj1       → DO('acme:proj1').fetch('/')
```

### Fixed Namespace

Routes all requests to a single DO instance:

```typescript
export default API({ ns: 'main' })

// api.dotdo.dev/users     → DO('main').fetch('/users')
// api.dotdo.dev/anything  → DO('main').fetch('/anything')
```

## Routing Summary

| Mode | Pattern | URL | DO | Path |
|------|---------|-----|----|----- |
| Hostname | `undefined` | `tenant.api.dotdo.dev/users` | `tenant` | `/users` |
| Path | `/:org` | `api.dotdo.dev/acme/users` | `acme` | `/users` |
| Nested | `/:org/:proj` | `api.dotdo.dev/acme/p1/tasks` | `acme:p1` | `/tasks` |
| Fixed | `main` | `api.dotdo.dev/users` | `main` | `/users` |

## Request Forwarding

The proxy forwards everything to the DO:

- **Method** - GET, POST, PUT, DELETE, etc.
- **Headers** - Authorization, Content-Type, custom headers
- **Body** - JSON, form data, binary
- **Query params** - Preserved in forwarded URL

```typescript
// Incoming
POST https://tenant.api.dotdo.dev/users?notify=true
Authorization: Bearer token123
Content-Type: application/json
{"name": "Alice"}

// Forwarded to DO('tenant')
POST /users?notify=true
Authorization: Bearer token123
Content-Type: application/json
{"name": "Alice"}
```

## Error Responses

| Status | Condition |
|--------|-----------|
| 404 | Namespace not found (no subdomain, missing path param) |
| 500 | No DO binding in env |
| 503 | DO threw an error |

## Advanced: Low-Level API

For more control, use `createProxyHandler` directly:

```typescript
import { createProxyHandler, type ProxyConfig } from './hostname-proxy'

const config: ProxyConfig = {
  mode: 'hostname',
  hostname: {
    rootDomain: 'api.dotdo.dev',
    stripLevels: 1  // custom subdomain depth
  },
  defaultNs: 'fallback',  // default when no namespace found
  basepath: '/v1'         // strip basepath prefix
}

export default {
  fetch: createProxyHandler(config)
}
```

### ProxyConfig Options

```typescript
interface ProxyConfig {
  mode: 'hostname' | 'path' | 'fixed'
  basepath?: string           // Strip prefix from path
  defaultNs?: string          // Fallback namespace
  hostname?: {
    rootDomain: string        // Expected root domain
    stripLevels?: number      // Subdomain depth to strip
  }
  fixed?: {
    namespace: string         // Fixed namespace for all requests
  }
}
```

## Files

| File | Description |
|------|-------------|
| `api.ts` | Clean `API()` factory |
| `hostname-proxy.ts` | Configurable proxy implementation |
| `proxy.ts` | Path-based proxy (thin wrapper) |

## Testing

Tests use `vitest-pool-workers` for real Workers runtime testing:

```bash
# Run workers tests
npx vitest run workers/api.test.ts

# Run all workers tests
npx vitest --project=workers-integration
```
