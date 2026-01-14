# Security Best Practices

dotdo provides security utilities to protect against common vulnerabilities. This guide covers sanitization, rate limiting, and security patterns.

> **Related:** [$ Context API](../api/workflow-context.md) | [Cross-DO Patterns](../patterns/cross-do.md) | [API Quick Reference](../API.md)

## SQL Injection Prevention

### Use Parameterized Queries (Preferred)

The safest approach is using SQLite's parameterized queries:

```typescript
import { DurableObject } from 'cloudflare:workers'

class UserStore extends DurableObject {
  async getUser(userId: string): Promise<User | null> {
    const sql = this.ctx.storage.sql

    // SAFE: Parameterized query
    const result = sql.exec<User>(
      `SELECT id, name, email FROM users WHERE id = ?`,
      userId  // Parameter is safely escaped
    ).one()

    return result
  }

  async createUser(name: string, email: string): Promise<User> {
    const sql = this.ctx.storage.sql

    // SAFE: Multiple parameters
    const result = sql.exec<User>(
      `INSERT INTO users (id, name, email) VALUES (?, ?, ?) RETURNING *`,
      crypto.randomUUID(),
      name,
      email
    ).one()

    return result!
  }

  async searchUsers(query: string): Promise<User[]> {
    const sql = this.ctx.storage.sql

    // SAFE: LIKE with parameter
    const results = sql.exec<User>(
      `SELECT * FROM users WHERE name LIKE ? ESCAPE '\\'`,
      `%${query}%`  // Note: you may want to sanitize wildcards in the input
    ).toArray()

    return results
  }
}

interface User {
  id: string
  name: string
  email: string
}
```

### SqlSanitizer (When Parameters Unavailable)

For cases where parameterized queries are not available:

```typescript
import { SqlSanitizer } from 'dotdo/lib/security/sanitizers'

// Sanitize values for string interpolation
const name = SqlSanitizer.sanitizeValue("O'Brien")
// Returns: 'O''Brien' (escaped single quote)

const age = SqlSanitizer.sanitizeValue(25)
// Returns: 25

const isActive = SqlSanitizer.sanitizeValue(true)
// Returns: 1

const missing = SqlSanitizer.sanitizeValue(null)
// Returns: NULL

// Sanitize identifiers (table/column names)
const tableName = SqlSanitizer.sanitizeIdentifier('user"data')
// Returns: "user""data" (escaped double quote)

// Sanitize LIKE patterns
const pattern = SqlSanitizer.sanitizeLikePattern('100%_discount')
// Returns: 100\%\_discount (escaped wildcards)
```

### SQL Sanitizer API

```typescript
class SqlSanitizer {
  // Sanitize a value for SQL string interpolation
  static sanitizeValue(value: unknown): string

  // Sanitize an identifier (table name, column name)
  static sanitizeIdentifier(identifier: string): string

  // Escape LIKE pattern wildcards
  static sanitizeLikePattern(pattern: string, escapeChar?: string): string
}
```

## XSS Prevention

### HTML Escaping

```typescript
import { HtmlEscaper } from 'dotdo/lib/security/sanitizers'

// Escape HTML special characters
const userInput = '<script>alert("xss")</script>'
const safe = HtmlEscaper.escape(userInput)
// Returns: &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;

// Recursively sanitize objects for JSON responses
const userData = {
  name: '<b>Alice</b>',
  bio: 'Hello <script>evil()</script>',
  tags: ['<tag>', 'normal']
}

const sanitized = HtmlEscaper.sanitizeForJson(userData)
// Returns: {
//   name: '&lt;b&gt;Alice&lt;/b&gt;',
//   bio: 'Hello &lt;script&gt;evil()&lt;/script&gt;',
//   tags: ['&lt;tag&gt;', 'normal']
// }
```

### Using in API Responses

```typescript
import { DurableObject } from 'cloudflare:workers'
import { HtmlEscaper } from 'dotdo/lib/security/sanitizers'

interface Comment {
  id: string
  text: string
  author: string
}

class CommentService extends DurableObject {
  async getComments(): Promise<Response> {
    const sql = this.ctx.storage.sql
    const comments = sql.exec<Comment>(`SELECT * FROM comments`).toArray()

    // Sanitize before sending to client
    const safeComments = HtmlEscaper.sanitizeForJson(comments)

    return Response.json(safeComments)
  }

  async addComment(text: string, author: string): Promise<Comment> {
    const sql = this.ctx.storage.sql

    // Store raw data (sanitize on output, not input)
    const result = sql.exec<Comment>(
      `INSERT INTO comments (id, text, author) VALUES (?, ?, ?) RETURNING *`,
      crypto.randomUUID(),
      text,
      author
    ).one()

    return result!
  }
}
```

## Prototype Pollution Prevention

### Object Sanitization

```typescript
import { ObjectSanitizer } from 'dotdo/lib/security/sanitizers'

// Check for dangerous keys
const userInput = {
  name: 'Alice',
  __proto__: { isAdmin: true },
  nested: {
    constructor: { pollute: true }
  }
}

if (ObjectSanitizer.hasDangerousKeys(userInput)) {
  console.warn('Potentially malicious input detected')
}

// Remove dangerous keys
const safeInput = ObjectSanitizer.sanitize(userInput)
// Returns: { name: 'Alice', nested: {} }
```

### Dangerous Keys List

```typescript
class ObjectSanitizer {
  // Keys that are filtered
  static readonly DANGEROUS_KEYS = [
    '__proto__',
    'constructor',
    'prototype'
  ]

  // Also filters keys containing:
  // - '__proto__'
  // - 'constructor.prototype'
}
```

### Safe JSON Parsing

```typescript
import { ObjectSanitizer } from 'dotdo/lib/security/sanitizers'

interface RequestBody {
  action: string
  data: unknown
}

async function parseRequestBody(request: Request): Promise<RequestBody> {
  const rawBody = await request.json() as unknown

  // Check for prototype pollution attempts
  if (ObjectSanitizer.hasDangerousKeys(rawBody)) {
    throw new Error('Invalid request body')
  }

  // Sanitize just in case
  const safeBody = ObjectSanitizer.sanitize(rawBody) as RequestBody

  return safeBody
}
```

## Rate Limiting

### In-Memory Rate Limiter

```typescript
import { RateLimiter, createRateLimiter } from 'dotdo/lib/security/rate-limiter'

// Create with preset
const limiter = createRateLimiter('standard')  // 100 req/min

// Or with custom config
const customLimiter = createRateLimiter({
  requests: 10,
  windowSeconds: 60
})

// Check rate limit
const result = limiter.check('user:123')

if (!result.allowed) {
  return new Response('Too Many Requests', {
    status: 429,
    headers: {
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': String(result.resetAt)
    }
  })
}
```

### Rate Limiter Presets

```typescript
// Strict: 10 requests per minute
const strict = createRateLimiter('strict')

// Standard: 100 requests per minute
const standard = createRateLimiter('standard')

// Relaxed: 1000 requests per minute
const relaxed = createRateLimiter('relaxed')
```

### Rate Limiter API

```typescript
interface RateLimitResult {
  allowed: boolean    // Whether request is allowed
  remaining: number   // Remaining requests in window
  resetAt: number     // Unix timestamp when window resets
  limit: number       // Total requests allowed per window
}

class RateLimiter {
  // Set configuration
  setConfig(config: { requests: number; windowSeconds: number }): void

  // Check if request is allowed (consumes quota)
  check(identifier: string): RateLimitResult

  // Reset limit for an identifier
  reset(identifier: string): void

  // Reset all limits
  resetAll(): void

  // Get current count without consuming
  getCount(identifier: string): number

  // Cleanup expired entries (call periodically)
  cleanup(): number
}
```

### Per-Endpoint Rate Limiting

```typescript
import { RateLimiter } from 'dotdo/lib/security/rate-limiter'

const loginLimiter = new RateLimiter()
loginLimiter.setConfig({ requests: 5, windowSeconds: 300 })  // 5 per 5 minutes

const apiLimiter = new RateLimiter()
apiLimiter.setConfig({ requests: 100, windowSeconds: 60 })   // 100 per minute

async function handleRequest(request: Request): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const url = new URL(request.url)

  // Strict limit on login attempts
  if (url.pathname === '/login') {
    const result = loginLimiter.check(`login:${ip}`)
    if (!result.allowed) {
      return new Response('Too many login attempts', { status: 429 })
    }
  }

  // Standard limit on API calls
  const apiResult = apiLimiter.check(`api:${ip}`)
  if (!apiResult.allowed) {
    return new Response('Rate limit exceeded', { status: 429 })
  }

  return new Response('OK')
}
```

### Cleanup Expired Entries

```typescript
import { RateLimiter } from 'dotdo/lib/security/rate-limiter'

const limiter = new RateLimiter()

// In your DO alarm handler
async function alarm(): Promise<void> {
  const cleaned = limiter.cleanup()
  console.log(`Cleaned up ${cleaned} expired rate limit entries`)
}
```

## Complete Security Middleware Example

```typescript
import { DurableObject } from 'cloudflare:workers'
import { RateLimiter } from 'dotdo/lib/security/rate-limiter'
import { ObjectSanitizer, HtmlEscaper } from 'dotdo/lib/security/sanitizers'

interface Env {
  API_DO: DurableObjectNamespace
}

class SecureAPI extends DurableObject {
  private rateLimiter: RateLimiter

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.rateLimiter = new RateLimiter()
    this.rateLimiter.setConfig({ requests: 100, windowSeconds: 60 })
  }

  async fetch(request: Request): Promise<Response> {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'

    // 1. Rate limiting
    const rateResult = this.rateLimiter.check(ip)
    if (!rateResult.allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateResult.resetAt)
        }
      })
    }

    // 2. Parse and sanitize input
    if (request.method === 'POST') {
      try {
        const body = await request.json() as unknown

        // Check for prototype pollution
        if (ObjectSanitizer.hasDangerousKeys(body)) {
          return new Response(JSON.stringify({ error: 'Invalid request' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        // Sanitize the input
        const safeBody = ObjectSanitizer.sanitize(body)

        // Process request...
        const result = await this.processRequest(safeBody)

        // 3. Sanitize output for XSS prevention
        const safeResult = HtmlEscaper.sanitizeForJson(result)

        return Response.json(safeResult, {
          headers: {
            'X-RateLimit-Remaining': String(rateResult.remaining)
          }
        })
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  private async processRequest(data: unknown): Promise<unknown> {
    return { status: 'processed', data }
  }
}

export { SecureAPI }
```

## Security Checklist

### Input Validation

- [ ] Use parameterized queries for all SQL
- [ ] Validate input types before processing
- [ ] Check for prototype pollution on JSON bodies
- [ ] Sanitize LIKE patterns before database queries

### Output Encoding

- [ ] HTML-escape all user content in responses
- [ ] Use `sanitizeForJson()` for nested objects
- [ ] Set appropriate Content-Type headers

### Rate Limiting

- [ ] Apply rate limits to all public endpoints
- [ ] Use stricter limits on authentication endpoints
- [ ] Include rate limit headers in responses
- [ ] Cleanup expired entries periodically

### General

- [ ] Never log sensitive data (passwords, tokens)
- [ ] Use HTTPS for all connections
- [ ] Validate authentication on every request
- [ ] Implement proper error handling (no stack traces to clients)

## Related Documentation

- [$ Context API](../api/workflow-context.md) - Workflow context and durable execution
- [Cross-DO Patterns](../patterns/cross-do.md) - Transaction patterns with idempotency
- [API Quick Reference](../API.md) - Quick reference for all APIs
- [Getting Started](../getting-started.md) - Basic setup and usage
- [Migration Guide](../migration.md) - Migrating from vanilla DOs

---

[Back to Documentation Index](../README.md)
