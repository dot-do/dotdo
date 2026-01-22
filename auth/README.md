# @dotdo/auth

> Lightweight authentication middleware for Hono

[![npm version](https://img.shields.io/npm/v/@dotdo/auth.svg)](https://www.npmjs.com/package/@dotdo/auth)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

## The Problem

Adding authentication to Cloudflare Workers is tedious:

- **JWT complexity** - Validating tokens, extracting claims, handling expiration
- **Permission sprawl** - Roles, scopes, ownership checks scattered across routes
- **Boilerplate everywhere** - The same auth checks repeated in every handler
- **Testing friction** - Mocking auth state for tests is painful

You end up with auth code duplicated across your codebase, each copy slightly different.

## The Solution

Composable auth middleware for Hono:

```typescript
import { authMiddleware, requireAuth, requireRole, requireScope } from '@dotdo/auth'

const app = new Hono()

// Apply auth globally
app.use('/*', authMiddleware())

// Protected routes
app.get('/profile', requireAuth(), (c) => {
  const user = c.get('user')
  return c.json({ user })
})

// Role-based access
app.delete('/users/:id', requireRole('admin'), (c) => {
  return c.json({ deleted: true })
})

// Scope-based access
app.get('/users', requireScope('users:read'), (c) => {
  return c.json({ users: [] })
})
```

## Quick Start

### Installation

```bash
npm install @dotdo/auth
```

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

export default app
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

## Features

### JWT Bearer Authentication

Validate JWT tokens from the Authorization header:

```typescript
app.use('/*', authMiddleware({
  issuer: 'https://auth.example.com',
  audience: 'api.example.com',
  skipPaths: ['/public', '/health']
}))
```

### Role-Based Access Control

Require specific roles to access routes:

```typescript
// Single role
app.delete('/users/:id', requireRole('admin'), handler)

// Multiple roles (OR logic - any role grants access)
app.get('/dashboard', requireRole('admin', 'moderator'), handler)
```

### Scope-Based Permissions

OAuth-style scope checking with wildcard support:

```typescript
// Exact scope
app.get('/users', requireScope('users:read'), handler)

// Multiple scopes (OR logic)
app.post('/users', requireScope('users:write', 'users:admin'), handler)

// Wildcard scopes
// User with 'users:*' can access all users endpoints
// User with '*' can access everything
```

### Ownership Validation

Ensure users can only access their own resources:

```typescript
import { requireOwner } from '@dotdo/auth'

app.get('/posts/:id', requireOwner(async (c) => {
  const post = await db.getPost(c.req.param('id'))
  return post.authorId  // Return the owner ID
}), handler)

// Admins bypass ownership checks automatically
```

### Composable Guards

Combine guards with AND/OR logic:

```typescript
import { requireAll, requireAny } from '@dotdo/auth'

// All guards must pass (AND)
app.delete('/posts/:id',
  requireAll(
    requireAuth(),
    requireRole('editor'),
    requireScope('posts:delete')
  ),
  handler
)

// Any guard can pass (OR)
app.get('/admin',
  requireAny(
    requireRole('admin'),
    requireScope('admin:*')
  ),
  handler
)
```

## API Reference

### Middleware

#### `authMiddleware(options?)`

Main authentication middleware for JWT Bearer tokens.

```typescript
interface AuthOptions {
  issuer?: string       // JWT issuer to validate
  audience?: string     // JWT audience to validate
  secret?: string       // HMAC secret for validation
  publicKey?: string    // RSA/ECDSA public key
  skipPaths?: string[]  // Paths to skip auth
}
```

Sets context variables:
- `user` (AuthUser): Authenticated user object
- `token` (string): Raw token string

#### `apiKeyMiddleware(options?)`

API key authentication from headers.

```typescript
interface APIKeyOptions {
  header?: string  // Header name (default: 'X-API-Key')
}
```

### Guards

| Guard | Description |
|-------|-------------|
| `requireAuth()` | Ensures user is authenticated |
| `requireRole(...roles)` | Requires one of the specified roles |
| `requireScope(...scopes)` | Requires one of the specified scopes |
| `requireOwner(getOwnerId)` | Validates resource ownership |
| `requireAll(...guards)` | All guards must pass (AND) |
| `requireAny(...guards)` | Any guard can pass (OR) |

### AuthUser Interface

```typescript
interface AuthUser {
  id: string           // User identifier (from 'sub' claim)
  email?: string       // User email
  roles?: string[]     // User roles (e.g., ['admin', 'user'])
  scopes?: string[]    // OAuth scopes (e.g., ['users:read'])
}
```

## Examples

### Complete API

```typescript
import { Hono } from 'hono'
import {
  authMiddleware,
  requireAuth,
  requireRole,
  requireScope,
  requireOwner,
  requireAny
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
app.get('/users', requireScope('users:read'), handler)
app.post('/users', requireScope('users:write'), handler)

// Resource ownership
app.get('/posts/:id', requireOwner(async (c) => {
  const post = await db.getPost(c.req.param('id'))
  return post.authorId
}), handler)

// Complex permissions
app.delete('/content/:id',
  requireAny(
    requireRole('admin'),
    requireOwner(async (c) => {
      const content = await db.getContent(c.req.param('id'))
      return content.authorId
    })
  ),
  handler
)

export default app
```

### Mixed Authentication

Support both JWT and API key authentication:

```typescript
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
```

## Error Handling

All guards throw `HTTPException` from Hono:

```typescript
import { HTTPException } from 'hono/http-exception'

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

## Related Packages

| Package | Description |
|---------|-------------|
| [@dotdo/api](/api) | Self-describing API (uses auth guards) |
| [@dotdo/do](/do) | Durable Object base class |
| [@dotdo/rpc](/rpc) | Cap'n Web RPC transport |

## License

MIT
