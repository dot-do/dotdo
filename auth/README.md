# @dotdo/auth

Lightweight authentication middleware for Hono, designed for Cloudflare Workers and Durable Objects.

## Overview

`@dotdo/auth` provides:
- JWT Bearer token authentication
- API key authentication
- Role-based access control (RBAC)
- Scope-based permissions
- Composable permission guards
- Resource ownership validation

## Installation

```bash
npm install @dotdo/auth
```

## Quick Start

### Basic Authentication

```typescript
import { Hono } from 'hono'
import { authMiddleware, requireAuth } from '@dotdo/auth'

const app = new Hono()

// Apply auth middleware globally
app.use('/*', authMiddleware())

// Protected route
app.get('/profile', requireAuth(), (c) => {
  const user = c.get('user')
  return c.json({ user })
})
```

### With API Keys

```typescript
import { apiKeyMiddleware } from '@dotdo/auth'

const app = new Hono()

// Use API key authentication
app.use('/api/*', apiKeyMiddleware())

app.get('/api/data', (c) => {
  const user = c.get('user')
  return c.json({ message: `API access granted for ${user.id}` })
})
```

## API Reference

### Middleware

#### `authMiddleware(options?)`

Main authentication middleware that validates JWT Bearer tokens.

**Options:**
```typescript
interface AuthOptions {
  issuer?: string         // JWT issuer to validate
  audience?: string       // JWT audience to validate
  secret?: string         // HMAC secret for validation
  publicKey?: string      // RSA/ECDSA public key for validation
  skipPaths?: string[]    // Paths to skip auth (e.g., ['/public'])
}
```

**Example:**
```typescript
app.use('/*', authMiddleware({
  issuer: 'https://auth.example.com',
  audience: 'api.example.com.ai',
  skipPaths: ['/public', '/health']
}))
```

**Sets context variables:**
- `user` (AuthUser): Authenticated user object
- `token` (string): Raw token string

**AuthUser Interface:**
```typescript
interface AuthUser {
  id: string           // User identifier (from 'sub' claim)
  email?: string       // User email
  roles?: string[]     // User roles (e.g., ['admin', 'user'])
  scopes?: string[]    // OAuth-style scopes (e.g., ['users:read'])
}
```

#### `apiKeyMiddleware(options?)`

Alternative authentication using API keys.

**Options:**
```typescript
interface APIKeyOptions {
  header?: string  // Header name (default: 'X-API-Key')
}
```

**Example:**
```typescript
app.use('/api/*', apiKeyMiddleware({ header: 'X-API-Key' }))
```

### Guards

Guards are composable middleware functions for permission checks.

#### `requireAuth()`

Ensures user is authenticated.

```typescript
app.get('/protected', requireAuth(), (c) => {
  return c.json({ message: 'Authenticated!' })
})
```

#### `requireRole(...roles)`

Requires user to have one of the specified roles.

```typescript
// Single role
app.delete('/users/:id', requireRole('admin'), (c) => {
  return c.json({ message: 'Admin access granted' })
})

// Multiple roles (OR logic)
app.get('/dashboard', requireRole('admin', 'moderator'), (c) => {
  return c.json({ message: 'Access granted' })
})
```

#### `requireScope(...scopes)`

Requires user to have one of the specified scopes. Supports wildcard matching.

```typescript
// Exact scope
app.get('/users', requireScope('users:read'), (c) => {
  return c.json({ users: [] })
})

// Multiple scopes
app.post('/users', requireScope('users:write', 'users:admin'), (c) => {
  return c.json({ message: 'User created' })
})
```

**Wildcard Scopes:**
- `users:*` matches `users:read`, `users:write`, etc.
- `*` matches all scopes

#### `requireOwner(getResourceOwnerId)`

Ensures user owns the resource (or is admin).

```typescript
app.get('/posts/:id', requireOwner(async (c) => {
  const postId = c.req.param('id')
  const post = await db.getPost(postId)
  return post.authorId
}), (c) => {
  return c.json({ message: 'Access granted' })
})
```

#### `requireAll(...guards)`

Combines guards with AND logic (all must pass).

```typescript
app.delete('/posts/:id',
  requireAll(
    requireAuth(),
    requireRole('editor'),
    requireScope('posts:delete')
  ),
  (c) => {
    return c.json({ message: 'Post deleted' })
  }
)
```

#### `requireAny(...guards)`

Combines guards with OR logic (any must pass).

```typescript
app.get('/admin',
  requireAny(
    requireRole('admin'),
    requireScope('admin:*')
  ),
  (c) => {
    return c.json({ message: 'Admin access' })
  }
)
```

## Usage Examples

### Complete API

```typescript
import { Hono } from 'hono'
import {
  authMiddleware,
  requireAuth,
  requireRole,
  requireScope,
  requireOwner
} from '@dotdo/auth'

const app = new Hono()

// Apply auth globally, skip public paths
app.use('/*', authMiddleware({
  skipPaths: ['/public', '/health']
}))

// Public endpoint (no auth)
app.get('/health', (c) => c.json({ status: 'ok' }))

// Authenticated endpoint
app.get('/profile', requireAuth(), (c) => {
  const user = c.get('user')
  return c.json({ user })
})

// Admin-only endpoint
app.delete('/users/:id', requireRole('admin'), async (c) => {
  const id = c.req.param('id')
  await db.deleteUser(id)
  return c.json({ deleted: id })
})

// Scope-based access
app.get('/users', requireScope('users:read'), async (c) => {
  const users = await db.listUsers()
  return c.json({ users })
})

app.post('/users', requireScope('users:write'), async (c) => {
  const body = await c.req.json()
  const user = await db.createUser(body)
  return c.json({ user })
})

// Resource ownership
app.get('/posts/:id', requireOwner(async (c) => {
  const post = await db.getPost(c.req.param('id'))
  return post.authorId
}), async (c) => {
  const post = await db.getPost(c.req.param('id'))
  return c.json({ post })
})

export default app
```

### Role-Based Access Control

```typescript
import { Hono } from 'hono'
import { authMiddleware, requireRole, requireAny } from '@dotdo/auth'

const app = new Hono()
app.use('/*', authMiddleware())

// Only users with 'user' role
app.get('/dashboard', requireRole('user'), (c) => {
  return c.json({ message: 'User dashboard' })
})

// Only admins
app.get('/admin', requireRole('admin'), (c) => {
  return c.json({ message: 'Admin panel' })
})

// Admins OR moderators
app.get('/moderate', requireRole('admin', 'moderator'), (c) => {
  return c.json({ message: 'Moderation tools' })
})

// Complex permissions
app.delete('/content/:id',
  requireAny(
    requireRole('admin'),  // Admins can delete anything
    requireOwner(async (c) => {
      const content = await db.getContent(c.req.param('id'))
      return content.authorId  // Authors can delete their own
    })
  ),
  async (c) => {
    await db.deleteContent(c.req.param('id'))
    return c.json({ deleted: true })
  }
)

export default app
```

### OAuth Scopes

```typescript
import { Hono } from 'hono'
import { authMiddleware, requireScope } from '@dotdo/auth'

const app = new Hono()
app.use('/*', authMiddleware())

// Read-only access
app.get('/users', requireScope('users:read'), async (c) => {
  const users = await db.listUsers()
  return c.json({ users })
})

// Write access
app.post('/users', requireScope('users:write'), async (c) => {
  const user = await db.createUser(await c.req.json())
  return c.json({ user })
})

// Delete requires special scope
app.delete('/users/:id', requireScope('users:delete'), async (c) => {
  await db.deleteUser(c.req.param('id'))
  return c.json({ deleted: true })
})

// Wildcard scopes
// User with scope 'users:*' can access all of the above
// User with scope '*' can access everything

export default app
```

### API Key Authentication

```typescript
import { Hono } from 'hono'
import { apiKeyMiddleware } from '@dotdo/auth'

const app = new Hono()

// Use API keys for machine-to-machine auth
app.use('/api/*', apiKeyMiddleware({ header: 'X-API-Key' }))

app.get('/api/data', (c) => {
  const user = c.get('user')
  // user.id will be 'apikey:xxxxxxxx'
  return c.json({ message: 'API access granted' })
})

export default app
```

### Mixed Authentication

```typescript
import { Hono } from 'hono'
import { authMiddleware, apiKeyMiddleware, requireAny } from '@dotdo/auth'

const app = new Hono()

// Allow both JWT and API key
app.use('/api/*', requireAny(
  authMiddleware(),
  apiKeyMiddleware()
))

app.get('/api/data', (c) => {
  const user = c.get('user')
  return c.json({ user })
})

export default app
```

## Integration with WorkOS (id.org.ai)

```typescript
import { Hono } from 'hono'
import { authMiddleware } from '@dotdo/auth'

const app = new Hono()

// Configure for WorkOS JWT tokens
app.use('/*', authMiddleware({
  issuer: 'https://api.workos.com',
  audience: 'project_xxxxx',
  // WorkOS provides public keys via JWKS endpoint
  // In production, fetch and cache these
}))

app.get('/profile', (c) => {
  const user = c.get('user')
  // user.id is WorkOS user ID
  // user.email from WorkOS profile
  // user.roles from WorkOS organization roles
  return c.json({ user })
})

export default app
```

## Error Handling

All guards throw `HTTPException` from Hono:

```typescript
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

const app = new Hono()

// Global error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({
      error: err.message,
      status: err.status
    }, err.status)
  }

  return c.json({ error: 'Internal server error' }, 500)
})
```

**Error Status Codes:**
- `401` - Authentication required or invalid token
- `403` - Insufficient permissions (role/scope/ownership)

## Testing

```typescript
import { Hono } from 'hono'
import { authMiddleware, requireRole } from '@dotdo/auth'
import { describe, it, expect } from 'vitest'

describe('Auth', () => {
  const app = new Hono()
  app.use('/*', authMiddleware({ skipPaths: ['/public'] }))
  app.get('/protected', requireRole('admin'), (c) => c.json({ ok: true }))

  it('allows authenticated admin', async () => {
    const token = btoa(JSON.stringify({ sub: '123', roles: ['admin'] }))
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` }
    })
    expect(res.status).toBe(200)
  })

  it('blocks unauthenticated', async () => {
    const res = await app.request('/protected')
    expect(res.status).toBe(401)
  })

  it('blocks non-admin', async () => {
    const token = btoa(JSON.stringify({ sub: '123', roles: ['user'] }))
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` }
    })
    expect(res.status).toBe(403)
  })
})
```

## Auth Flow

```
id.org.ai (WorkOS)
    ↓ (OAuth/OIDC)
org.ai/auth
    ↓ (JWT)
@dotdo/auth
    ↓ (Validates & Extracts)
oauth.do (CLI)
    ↓ (Stores token)
User's App
```

## Roadmap

Current implementation is a lightweight placeholder. Future enhancements:

- [x] Bearer token authentication
- [x] API key authentication
- [x] Role-based guards
- [x] Scope-based guards
- [x] Ownership guards
- [ ] Full JWT validation (RS256, ES256)
- [ ] JWKS endpoint support
- [ ] Token refresh
- [ ] Rate limiting per user/key
- [ ] Audit logging

See beads issues `do-7rf.3.*` for implementation progress.

## Related Packages

- [@dotdo/api](/api) - Self-describing API (uses auth guards)
- [@dotdo/do](/do) - Durable Object base class
- [org.ai/auth](https://org.ai/auth) - Auth provider layer
- [oauth.do](https://oauth.do) - CLI OAuth helper

## License

MIT
