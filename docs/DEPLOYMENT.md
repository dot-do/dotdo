# Production Deployment Guide

This guide covers deploying dotdo applications to Cloudflare Workers in production environments. It includes pre-deployment checklists, deployment procedures, production configuration, scaling strategies, security hardening, and monitoring.

## Table of Contents

1. [Pre-deployment Checklist](#1-pre-deployment-checklist)
2. [Deployment Process](#2-deployment-process)
3. [Production Configuration](#3-production-configuration)
4. [Scaling Considerations](#4-scaling-considerations)
5. [Security Hardening](#5-security-hardening)
6. [Monitoring and Alerting](#6-monitoring-and-alerting)
7. [Troubleshooting Production Issues](#7-troubleshooting-production-issues)

---

## 1. Pre-deployment Checklist

Before deploying to production, complete this checklist to ensure a smooth deployment.

### 1.1 Environment Variables

Verify all required environment variables are documented and configured.

**Required Variables:**

| Variable | Purpose | Where to Set |
|----------|---------|--------------|
| `ENVIRONMENT` | Environment identifier (production/staging/dev) | wrangler.toml `[vars]` |
| `BETTER_AUTH_SECRET` | Session signing secret | `wrangler secret` |
| `ENCRYPTION_KEY` | Data encryption at rest | `wrangler secret` |

**Optional Variables (enable as needed):**

| Variable | Purpose | Where to Set |
|----------|---------|--------------|
| `GITHUB_CLIENT_ID/SECRET` | GitHub OAuth | `wrangler secret` |
| `GOOGLE_CLIENT_ID/SECRET` | Google OAuth | `wrangler secret` |
| `STRIPE_SECRET_KEY` | Payment processing | `wrangler secret` |
| `STRIPE_WEBHOOK_SECRET` | Webhook verification | `wrangler secret` |
| `SENTRY_DSN` | Error tracking | `wrangler secret` |
| `AXIOM_TOKEN` | Logging | `wrangler secret` |
| `OPENAI_API_KEY` | AI features | `wrangler secret` |
| `ANTHROPIC_API_KEY` | AI features | `wrangler secret` |

### 1.2 Secrets Configuration

Never commit secrets to version control. Use Wrangler to manage secrets.

```bash
# Set a secret
wrangler secret put BETTER_AUTH_SECRET

# Set secret for specific environment
wrangler secret put BETTER_AUTH_SECRET --env production

# List all secrets (names only, values hidden)
wrangler secret list

# Delete a secret
wrangler secret delete BETTER_AUTH_SECRET
```

**Generate secure secrets:**

```bash
# Generate a 32-byte base64 secret
openssl rand -base64 32

# Generate a 64-byte hex secret
openssl rand -hex 64
```

**Bulk secret management:**

For multiple secrets, use a script (do not commit this file):

```bash
#!/bin/bash
# secrets.sh - Run once, then delete

echo "your-auth-secret" | wrangler secret put BETTER_AUTH_SECRET
echo "your-encryption-key" | wrangler secret put ENCRYPTION_KEY
echo "your-stripe-key" | wrangler secret put STRIPE_SECRET_KEY
```

### 1.3 Wrangler Configuration Validation

Validate your `wrangler.toml` or `wrangler.jsonc` before deployment.

**Required fields:**

```toml
# wrangler.toml
name = "your-app-name"
main = "src/index.ts"
compatibility_date = "2025-01-15"

[durable_objects]
bindings = [
  { name = "DO", class_name = "DO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["DO"]
```

Or in JSONC format:

```jsonc
// wrangler.jsonc
{
  "name": "your-app-name",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-15",
  "compatibility_flags": ["nodejs_compat"],

  "durable_objects": {
    "bindings": [
      { "name": "DO", "class_name": "DO" }
    ]
  },

  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["DO"]
    }
  ]
}
```

**Environment-specific configuration:**

```toml
# wrangler.toml

# Default (production)
[vars]
ENVIRONMENT = "production"

# Staging environment
[env.staging]
name = "your-app-staging"

[env.staging.vars]
ENVIRONMENT = "staging"

# Development environment
[env.dev]
name = "your-app-dev"

[env.dev.vars]
ENVIRONMENT = "development"
```

**Validate configuration:**

```bash
# Check for configuration errors
npx wrangler deploy --dry-run

# Validate without deploying
npx wrangler types
```

### 1.4 Pre-deployment Testing

Run all tests before deploying:

```bash
# Run unit tests
npm test

# Run integration tests with Miniflare
npm run test:integration

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

### 1.5 Build Verification

Ensure the build succeeds and bundle size is acceptable:

```bash
# Build the worker
npm run build

# Check bundle size (should be under 5MB compressed)
npx wrangler deploy --dry-run --outdir dist

# Inspect the bundle
ls -la dist/
```

---

## 2. Deployment Process

### 2.1 Using Wrangler Deploy

**Deploy to production:**

```bash
# Deploy to production (default environment)
npx wrangler deploy

# Deploy to specific environment
npx wrangler deploy --env staging
npx wrangler deploy --env production
```

**Deploy with build step:**

```bash
# Build and deploy
npm run build && npx wrangler deploy
```

**CI/CD deployment script:**

```bash
#!/bin/bash
set -e

# Install dependencies
npm ci

# Run tests
npm test

# Type check
npx tsc --noEmit

# Deploy
npx wrangler deploy --env production
```

### 2.2 Blue-Green Deployments

Cloudflare Workers support zero-downtime deployments by default. For more control, use versioned deployments.

**Strategy 1: Environment-based blue-green**

```toml
# wrangler.toml

# Blue (current production)
[env.blue]
name = "your-app-blue"
routes = [
  { pattern = "api.example.com/*", zone_name = "example.com" }
]

# Green (new version)
[env.green]
name = "your-app-green"
routes = [
  { pattern = "api-preview.example.com/*", zone_name = "example.com" }
]
```

**Deployment workflow:**

```bash
# 1. Deploy new version to green
npx wrangler deploy --env green

# 2. Test green environment
curl https://api-preview.example.com/health

# 3. Swap routes (promote green to production)
# Update wrangler.toml to swap blue/green routes
npx wrangler deploy --env green
```

**Strategy 2: Gradual rollout with Cloudflare Workers**

Use Cloudflare's built-in gradual rollout feature:

```bash
# Deploy with gradual rollout (10% of traffic)
npx wrangler versions upload
npx wrangler versions deploy <version-id> --percentage 10

# Increase to 50%
npx wrangler versions deploy <version-id> --percentage 50

# Full rollout
npx wrangler versions deploy <version-id> --percentage 100
```

### 2.3 Rollback Procedures

**Immediate rollback using versions:**

```bash
# List recent versions
npx wrangler versions list

# Rollback to previous version
npx wrangler rollback

# Rollback to specific version
npx wrangler versions deploy <previous-version-id> --percentage 100
```

**Rollback using Git:**

```bash
# Find the last good commit
git log --oneline

# Checkout and deploy
git checkout <last-good-commit>
npm ci
npx wrangler deploy
```

**Emergency rollback script:**

```bash
#!/bin/bash
# rollback.sh - Emergency rollback

echo "Starting emergency rollback..."

# Rollback to previous deployment
npx wrangler rollback

echo "Rollback complete. Verify at:"
echo "https://your-app.example.com/health"
```

### 2.4 Migration Handling

When adding or modifying Durable Object classes:

```toml
# wrangler.toml

# Initial migration
[[migrations]]
tag = "v1"
new_sqlite_classes = ["DO"]

# Add new DO class
[[migrations]]
tag = "v2"
new_sqlite_classes = ["NewDO"]

# Rename DO class
[[migrations]]
tag = "v3"
renamed_classes = [{ from = "OldDO", to = "NewDO" }]

# Delete DO class (data will be lost!)
[[migrations]]
tag = "v4"
deleted_classes = ["DeprecatedDO"]
```

**Important migration rules:**

1. Never remove a migration tag once deployed
2. Add new migrations with incrementing tags
3. Test migrations in staging before production
4. Back up data before destructive migrations

---

## 3. Production Configuration

### 3.1 Durable Object Storage Limits and Quotas

**Current limits (Workers Paid plan):**

| Resource | Limit |
|----------|-------|
| SQLite storage per DO | 10 GB |
| Row size | ~2 MB practical (1 GB theoretical) |
| Key-value storage per DO | 1 GB |
| Concurrent requests per DO | Single-threaded |
| DO request timeout | 30 seconds (soft), 120 seconds (hard) |
| WebSocket connections per DO | 32,768 |

**Monitor storage usage:**

```typescript
// In your DO class
async getStorageStats(): Promise<StorageStats> {
  const sql = this.ctx.storage.sql

  // Get SQLite database size
  const result = sql.exec<{ page_count: number; page_size: number }>(
    `SELECT page_count, page_size FROM pragma_page_count(), pragma_page_size()`
  ).one()

  const dbSize = result.page_count * result.page_size

  return {
    databaseSizeBytes: dbSize,
    databaseSizeMB: dbSize / (1024 * 1024)
  }
}
```

### 3.2 Rate Limiting

Implement rate limiting to protect your DOs from abuse.

**Basic rate limiter:**

```typescript
interface RateLimitConfig {
  windowMs: number      // Time window in milliseconds
  maxRequests: number   // Max requests per window
}

class RateLimiter {
  private requests = new Map<string, number[]>()

  constructor(private config: RateLimitConfig) {}

  isAllowed(key: string): boolean {
    const now = Date.now()
    const windowStart = now - this.config.windowMs

    // Get existing requests, filter to current window
    const existing = this.requests.get(key) ?? []
    const recent = existing.filter(t => t > windowStart)

    if (recent.length >= this.config.maxRequests) {
      return false
    }

    recent.push(now)
    this.requests.set(key, recent)
    return true
  }
}

// Usage in DO
const rateLimiter = new RateLimiter({
  windowMs: 60_000,    // 1 minute
  maxRequests: 100     // 100 requests per minute
})

async fetch(request: Request): Promise<Response> {
  const clientIP = request.headers.get('CF-Connecting-IP') ?? 'unknown'

  if (!rateLimiter.isAllowed(clientIP)) {
    return new Response('Rate limit exceeded', { status: 429 })
  }

  // Process request...
}
```

**Sliding window rate limiter with SQLite:**

```typescript
class PersistentRateLimiter {
  constructor(private sql: SqlStorage) {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        requests TEXT,  -- JSON array of timestamps
        updated_at INTEGER
      )
    `)
  }

  isAllowed(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now()
    const windowStart = now - windowMs

    const row = this.sql.exec<{ requests: string }>(
      'SELECT requests FROM rate_limits WHERE key = ?',
      key
    ).one()

    let requests: number[] = row ? JSON.parse(row.requests) : []
    requests = requests.filter(t => t > windowStart)

    if (requests.length >= maxRequests) {
      return false
    }

    requests.push(now)
    this.sql.exec(
      'INSERT OR REPLACE INTO rate_limits (key, requests, updated_at) VALUES (?, ?, ?)',
      key, JSON.stringify(requests), now
    )

    return true
  }
}
```

### 3.3 Error Handling

Implement comprehensive error handling for production.

**Error response format:**

```typescript
interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: unknown
    requestId?: string
  }
}

function createErrorResponse(
  code: string,
  message: string,
  status: number,
  requestId?: string
): Response {
  const body: ErrorResponse = {
    error: {
      code,
      message,
      requestId
    }
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}
```

**Global error handler:**

```typescript
async fetch(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID()

  try {
    return await this.handleRequest(request, requestId)
  } catch (error) {
    // Log error with context
    console.error({
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      url: request.url,
      method: request.method
    })

    // Return appropriate error response
    if (error instanceof ValidationError) {
      return createErrorResponse('VALIDATION_ERROR', error.message, 400, requestId)
    }

    if (error instanceof AuthenticationError) {
      return createErrorResponse('AUTHENTICATION_ERROR', error.message, 401, requestId)
    }

    if (error instanceof AuthorizationError) {
      return createErrorResponse('AUTHORIZATION_ERROR', error.message, 403, requestId)
    }

    if (error instanceof NotFoundError) {
      return createErrorResponse('NOT_FOUND', error.message, 404, requestId)
    }

    // Generic server error (don't expose internal details)
    return createErrorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred',
      500,
      requestId
    )
  }
}
```

### 3.4 Logging and Monitoring

**Structured logging:**

```typescript
interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  timestamp: string
  requestId?: string
  context?: Record<string, unknown>
}

function log(entry: Omit<LogEntry, 'timestamp'>) {
  const logEntry: LogEntry = {
    ...entry,
    timestamp: new Date().toISOString()
  }

  // Use appropriate console method
  switch (entry.level) {
    case 'debug':
      console.debug(JSON.stringify(logEntry))
      break
    case 'info':
      console.info(JSON.stringify(logEntry))
      break
    case 'warn':
      console.warn(JSON.stringify(logEntry))
      break
    case 'error':
      console.error(JSON.stringify(logEntry))
      break
  }
}

// Usage
log({
  level: 'info',
  message: 'Request processed',
  requestId: 'abc-123',
  context: {
    method: 'POST',
    path: '/api/users',
    duration: 45
  }
})
```

**Integration with external logging (Axiom):**

```typescript
async function sendToAxiom(entries: LogEntry[], env: Env) {
  if (!env.AXIOM_TOKEN || !env.AXIOM_DATASET) {
    return
  }

  await fetch(`https://api.axiom.co/v1/datasets/${env.AXIOM_DATASET}/ingest`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.AXIOM_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(entries)
  })
}
```

---

## 4. Scaling Considerations

### 4.1 Durable Object Sharding Strategies

When a single DO reaches storage or performance limits, shard data across multiple DOs.

**Strategy 1: Hash-based sharding**

```typescript
function getShardId(key: string, numShards: number): string {
  // Simple hash function
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i)
    hash = hash & hash  // Convert to 32-bit integer
  }
  const shardIndex = Math.abs(hash) % numShards
  return `shard-${shardIndex}`
}

// Usage
const NUM_SHARDS = 16
const shardId = getShardId(userId, NUM_SHARDS)
const stub = env.DO.get(env.DO.idFromName(shardId))
```

**Strategy 2: Range-based sharding**

```typescript
function getShardByRange(id: string): string {
  const firstChar = id.charAt(0).toLowerCase()

  if (firstChar >= 'a' && firstChar <= 'h') return 'shard-a-h'
  if (firstChar >= 'i' && firstChar <= 'p') return 'shard-i-p'
  if (firstChar >= 'q' && firstChar <= 'z') return 'shard-q-z'
  return 'shard-numeric'
}
```

**Strategy 3: Tenant-based sharding (multi-tenancy)**

```typescript
// Each tenant gets their own DO
function getTenantDO(tenantId: string, env: Env): DurableObjectStub {
  const id = env.DO.idFromName(`tenant:${tenantId}`)
  return env.DO.get(id)
}
```

**Sharding coordinator pattern:**

```typescript
class ShardCoordinator {
  private shardConfig: ShardConfig

  async routeRequest(key: string, request: Request): Promise<Response> {
    const shardId = this.getShardForKey(key)
    const stub = this.env.DO.get(this.env.DO.idFromName(shardId))
    return stub.fetch(request)
  }

  async broadcastToAllShards(request: Request): Promise<Response[]> {
    const responses = await Promise.all(
      this.shardConfig.shardIds.map(shardId => {
        const stub = this.env.DO.get(this.env.DO.idFromName(shardId))
        return stub.fetch(request)
      })
    )
    return responses
  }
}
```

### 4.2 R2 for Large Data

Use R2 for objects larger than SQLite row limits or for cold data archival.

**Store large blobs in R2:**

```typescript
interface Env {
  DO: DurableObjectNamespace
  STORAGE: R2Bucket
}

class MyDO extends DurableObject<Env> {
  async storeLargeObject(id: string, data: ArrayBuffer): Promise<void> {
    const r2Key = `objects/${this.ctx.id}/${id}`

    // Store in R2
    await this.env.STORAGE.put(r2Key, data, {
      customMetadata: {
        createdAt: new Date().toISOString(),
        size: data.byteLength.toString()
      }
    })

    // Store reference in SQLite
    this.ctx.storage.sql.exec(
      'INSERT INTO objects (id, r2_key, size, created_at) VALUES (?, ?, ?, ?)',
      id, r2Key, data.byteLength, Date.now()
    )
  }

  async getLargeObject(id: string): Promise<ArrayBuffer | null> {
    const row = this.ctx.storage.sql.exec<{ r2_key: string }>(
      'SELECT r2_key FROM objects WHERE id = ?', id
    ).one()

    if (!row) return null

    const object = await this.env.STORAGE.get(row.r2_key)
    return object?.arrayBuffer() ?? null
  }
}
```

**R2 for data archival:**

```typescript
async archiveOldData(cutoffDate: number): Promise<number> {
  const sql = this.ctx.storage.sql

  // Get old records
  const oldRecords = sql.exec<{ id: string; data: string }>(
    'SELECT id, data FROM events WHERE created_at < ?', cutoffDate
  ).toArray()

  if (oldRecords.length === 0) return 0

  // Archive to R2
  const archiveKey = `archives/${this.ctx.id}/${Date.now()}.json`
  await this.env.STORAGE.put(archiveKey, JSON.stringify(oldRecords), {
    customMetadata: {
      recordCount: oldRecords.length.toString(),
      cutoffDate: cutoffDate.toString()
    }
  })

  // Delete from SQLite
  sql.exec('DELETE FROM events WHERE created_at < ?', cutoffDate)

  return oldRecords.length
}
```

### 4.3 KV for Caching

Use KV for frequently accessed, rarely changed data.

**Configure KV namespace:**

```toml
# wrangler.toml
[[kv_namespaces]]
binding = "CACHE"
id = "your-kv-namespace-id"
```

**Caching pattern:**

```typescript
interface Env {
  CACHE: KVNamespace
}

async function getCachedOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  env: Env,
  ttlSeconds = 3600
): Promise<T> {
  // Try cache first
  const cached = await env.CACHE.get(key, 'json')
  if (cached) {
    return cached as T
  }

  // Fetch fresh data
  const data = await fetcher()

  // Cache for future requests
  await env.CACHE.put(key, JSON.stringify(data), {
    expirationTtl: ttlSeconds
  })

  return data
}

// Usage
const config = await getCachedOrFetch(
  'config:global',
  () => fetchConfigFromDatabase(),
  env,
  300  // 5 minutes
)
```

**Cache invalidation:**

```typescript
async function invalidateCache(pattern: string, env: Env): Promise<void> {
  // KV doesn't support pattern deletion, so track keys explicitly
  const keyList = await env.CACHE.get('cache:keys', 'json') as string[] ?? []

  const keysToDelete = keyList.filter(k => k.startsWith(pattern))

  await Promise.all(keysToDelete.map(k => env.CACHE.delete(k)))

  // Update key list
  const remainingKeys = keyList.filter(k => !k.startsWith(pattern))
  await env.CACHE.put('cache:keys', JSON.stringify(remainingKeys))
}
```

---

## 5. Security Hardening

### 5.1 JWT Validation

Implement proper JWT validation for authentication.

**JWT validation middleware:**

```typescript
import { decode, verify } from '@tsndr/cloudflare-worker-jwt'

interface JWTPayload {
  sub: string
  iat: number
  exp: number
  iss: string
  aud: string
}

async function validateJWT(
  token: string,
  secret: string,
  options: { issuer: string; audience: string }
): Promise<JWTPayload> {
  // Verify signature
  const isValid = await verify(token, secret)
  if (!isValid) {
    throw new AuthenticationError('Invalid token signature')
  }

  // Decode and validate claims
  const { payload } = decode(token)
  const claims = payload as JWTPayload

  // Check expiration
  const now = Math.floor(Date.now() / 1000)
  if (claims.exp && claims.exp < now) {
    throw new AuthenticationError('Token has expired')
  }

  // Check not-before
  if (claims.iat && claims.iat > now) {
    throw new AuthenticationError('Token not yet valid')
  }

  // Check issuer
  if (options.issuer && claims.iss !== options.issuer) {
    throw new AuthenticationError('Invalid token issuer')
  }

  // Check audience
  if (options.audience && claims.aud !== options.audience) {
    throw new AuthenticationError('Invalid token audience')
  }

  return claims
}
```

**Auth middleware for Hono:**

```typescript
import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>()

app.use('/api/*', async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing authorization header' }, 401)
  }

  const token = authHeader.slice(7)

  try {
    const user = await validateJWT(token, c.env.JWT_SECRET, {
      issuer: 'https://auth.example.com',
      audience: 'https://api.example.com'
    })

    c.set('user', user)
    await next()
  } catch (error) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
})
```

### 5.2 CORS Configuration

Configure CORS properly for your API.

**CORS middleware:**

```typescript
import { cors } from 'hono/cors'

const app = new Hono()

// Production CORS configuration
app.use('/api/*', cors({
  origin: (origin) => {
    // Allow specific origins
    const allowedOrigins = [
      'https://app.example.com',
      'https://admin.example.com'
    ]

    if (allowedOrigins.includes(origin)) {
      return origin
    }

    // Reject unknown origins
    return null
  },

  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposeHeaders: ['X-Request-ID', 'X-RateLimit-Remaining'],
  credentials: true,
  maxAge: 86400  // 24 hours
}))
```

**Environment-specific CORS:**

```typescript
function getCorsConfig(env: Env) {
  if (env.ENVIRONMENT === 'development') {
    return cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['*']
    })
  }

  return cors({
    origin: env.ALLOWED_ORIGINS?.split(',') ?? [],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  })
}
```

### 5.3 Authentication Best Practices

**1. Use secure session management:**

```typescript
interface Session {
  userId: string
  createdAt: number
  expiresAt: number
  ipAddress: string
  userAgent: string
}

async function createSession(
  userId: string,
  request: Request,
  sql: SqlStorage
): Promise<string> {
  const sessionId = crypto.randomUUID()
  const now = Date.now()

  sql.exec(`
    INSERT INTO sessions (id, user_id, created_at, expires_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    sessionId,
    userId,
    now,
    now + (7 * 24 * 60 * 60 * 1000),  // 7 days
    request.headers.get('CF-Connecting-IP'),
    request.headers.get('User-Agent')
  )

  return sessionId
}

async function validateSession(
  sessionId: string,
  request: Request,
  sql: SqlStorage
): Promise<Session | null> {
  const session = sql.exec<Session>(
    'SELECT * FROM sessions WHERE id = ? AND expires_at > ?',
    sessionId, Date.now()
  ).one()

  if (!session) return null

  // Optional: Validate IP hasn't changed significantly
  const currentIP = request.headers.get('CF-Connecting-IP')
  if (session.ipAddress !== currentIP) {
    // Log suspicious activity
    console.warn({
      event: 'session_ip_mismatch',
      sessionId,
      originalIP: session.ipAddress,
      currentIP
    })
  }

  return session
}
```

**2. Implement account lockout:**

```typescript
async function trackFailedLogin(
  email: string,
  sql: SqlStorage
): Promise<{ locked: boolean; remainingAttempts: number }> {
  const MAX_ATTEMPTS = 5
  const LOCKOUT_DURATION = 15 * 60 * 1000  // 15 minutes

  const now = Date.now()
  const record = sql.exec<{ attempts: number; locked_until: number }>(
    'SELECT attempts, locked_until FROM login_attempts WHERE email = ?',
    email
  ).one()

  // Check if currently locked
  if (record?.locked_until && record.locked_until > now) {
    return { locked: true, remainingAttempts: 0 }
  }

  // Update attempt count
  const attempts = (record?.attempts ?? 0) + 1
  const lockedUntil = attempts >= MAX_ATTEMPTS ? now + LOCKOUT_DURATION : null

  sql.exec(`
    INSERT OR REPLACE INTO login_attempts (email, attempts, locked_until, updated_at)
    VALUES (?, ?, ?, ?)
  `, email, attempts, lockedUntil, now)

  return {
    locked: attempts >= MAX_ATTEMPTS,
    remainingAttempts: Math.max(0, MAX_ATTEMPTS - attempts)
  }
}
```

**3. Secure password hashing:**

```typescript
// Use Web Crypto API for password hashing
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const encoder = new TextEncoder()

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  )

  // Combine salt and hash
  const combined = new Uint8Array(salt.length + hash.byteLength)
  combined.set(salt)
  combined.set(new Uint8Array(hash), salt.length)

  return btoa(String.fromCharCode(...combined))
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const combined = Uint8Array.from(atob(stored), c => c.charCodeAt(0))
  const salt = combined.slice(0, 16)
  const storedHash = combined.slice(16)

  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  )

  const hashArray = new Uint8Array(hash)
  return hashArray.every((byte, i) => byte === storedHash[i])
}
```

### 5.4 Input Validation

Always validate and sanitize input:

```typescript
import { z } from 'zod'

// Define schemas
const UserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(100),
  age: z.number().int().min(0).max(150).optional()
})

// Validation middleware
async function validateBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<T> {
  const body = await request.json()

  const result = schema.safeParse(body)
  if (!result.success) {
    throw new ValidationError(
      'Invalid request body',
      result.error.flatten()
    )
  }

  return result.data
}

// Usage
app.post('/api/users', async (c) => {
  const data = await validateBody(c.req.raw, UserSchema)
  // data is fully typed and validated
})
```

---

## 6. Monitoring and Alerting

### 6.1 Cloudflare Analytics

Access analytics in the Cloudflare dashboard or via API.

**Key metrics to monitor:**

- Request count and error rate
- CPU time per request
- Subrequest count
- DO storage usage
- WebSocket connections

**Programmatic access:**

```typescript
// Query analytics via Cloudflare API
async function getWorkerAnalytics(
  accountId: string,
  scriptName: string,
  apiToken: string
): Promise<AnalyticsData> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/analytics/basic?script=${scriptName}`,
    {
      headers: {
        'Authorization': `Bearer ${apiToken}`
      }
    }
  )

  return response.json()
}
```

### 6.2 Custom Metrics

Implement custom metrics collection:

```typescript
interface Metrics {
  requestCount: number
  errorCount: number
  p50Latency: number
  p95Latency: number
  p99Latency: number
}

class MetricsCollector {
  private latencies: number[] = []
  private requestCount = 0
  private errorCount = 0

  recordRequest(latencyMs: number, isError: boolean) {
    this.latencies.push(latencyMs)
    this.requestCount++
    if (isError) this.errorCount++

    // Keep only last 1000 latencies
    if (this.latencies.length > 1000) {
      this.latencies = this.latencies.slice(-1000)
    }
  }

  getMetrics(): Metrics {
    const sorted = [...this.latencies].sort((a, b) => a - b)

    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      p50Latency: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      p95Latency: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      p99Latency: sorted[Math.floor(sorted.length * 0.99)] ?? 0
    }
  }
}

// Metrics endpoint
app.get('/metrics', (c) => {
  const metrics = metricsCollector.getMetrics()
  return c.json(metrics)
})
```

**Export to external monitoring:**

```typescript
// Send metrics to Prometheus pushgateway
async function pushMetrics(metrics: Metrics, pushgatewayUrl: string) {
  const prometheusFormat = `
# HELP request_count Total request count
# TYPE request_count counter
request_count ${metrics.requestCount}

# HELP error_count Total error count
# TYPE error_count counter
error_count ${metrics.errorCount}

# HELP request_latency_p95 95th percentile latency
# TYPE request_latency_p95 gauge
request_latency_p95 ${metrics.p95Latency}
  `.trim()

  await fetch(`${pushgatewayUrl}/metrics/job/dotdo`, {
    method: 'POST',
    body: prometheusFormat
  })
}
```

### 6.3 Wrangler Tail for Debugging

Use `wrangler tail` to stream live logs from production.

**Basic usage:**

```bash
# Stream all logs
npx wrangler tail

# Stream logs for specific environment
npx wrangler tail --env production

# Filter by status
npx wrangler tail --status error

# Filter by search string
npx wrangler tail --search "user-123"

# Format output as JSON
npx wrangler tail --format json
```

**Advanced filtering:**

```bash
# Multiple filters
npx wrangler tail --status error --search "timeout"

# Save to file
npx wrangler tail --format json > logs.json

# Pipe to jq for analysis
npx wrangler tail --format json | jq '.logs[] | select(.level == "error")'
```

**Programmatic log tailing:**

```bash
# Tail in CI/CD for deployment verification
timeout 60 npx wrangler tail --format json | grep -q "deployment:ready" && echo "Deployment verified"
```

### 6.4 Health Checks

Implement health check endpoints:

```typescript
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  checks: {
    name: string
    status: 'pass' | 'fail'
    message?: string
  }[]
  version: string
  uptime: number
}

const startTime = Date.now()

app.get('/health', async (c) => {
  const checks = []

  // Check SQLite
  try {
    const sql = c.get('sql')
    sql.exec('SELECT 1')
    checks.push({ name: 'sqlite', status: 'pass' as const })
  } catch (error) {
    checks.push({
      name: 'sqlite',
      status: 'fail' as const,
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }

  // Check external services
  try {
    const response = await fetch('https://api.stripe.com/healthcheck')
    checks.push({
      name: 'stripe',
      status: response.ok ? 'pass' as const : 'fail' as const
    })
  } catch {
    checks.push({ name: 'stripe', status: 'fail' as const })
  }

  const allPassed = checks.every(c => c.status === 'pass')
  const anyFailed = checks.some(c => c.status === 'fail')

  const health: HealthStatus = {
    status: allPassed ? 'healthy' : anyFailed ? 'unhealthy' : 'degraded',
    checks,
    version: '1.0.0',
    uptime: Date.now() - startTime
  }

  return c.json(health, allPassed ? 200 : 503)
})

// Liveness probe (simple)
app.get('/livez', (c) => c.text('OK'))

// Readiness probe (checks dependencies)
app.get('/readyz', async (c) => {
  // Similar to health but returns 200/503
  const healthy = await checkDependencies()
  return c.text(healthy ? 'OK' : 'NOT READY', healthy ? 200 : 503)
})
```

### 6.5 Alerting Configuration

Set up alerts using Cloudflare notifications or external services.

**Cloudflare notification example:**

1. Go to Cloudflare Dashboard > Notifications
2. Create notification for "Workers: Error Rate" exceeding threshold
3. Configure email/webhook/PagerDuty destination

**Custom alerting with webhooks:**

```typescript
async function sendAlert(
  severity: 'info' | 'warning' | 'critical',
  message: string,
  context: Record<string, unknown>,
  webhookUrl: string
) {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      severity,
      message,
      context,
      timestamp: new Date().toISOString(),
      service: 'dotdo'
    })
  })
}

// Usage
if (errorRate > 0.05) {  // 5% error rate
  await sendAlert(
    'critical',
    'High error rate detected',
    { errorRate, requestCount },
    env.ALERT_WEBHOOK_URL
  )
}
```

---

## 7. Troubleshooting Production Issues

### 7.1 Common Issues and Solutions

**Issue: High latency**

```bash
# Check with wrangler tail
npx wrangler tail --format json | jq '.outcome.cpuTime'

# Possible causes:
# - Cold starts (rare with DOs)
# - Large database queries
# - External API calls
```

**Issue: Storage quota exceeded**

```typescript
// Check storage usage
const stats = await getStorageStats()
if (stats.databaseSizeMB > 9000) {  // 9GB warning
  await archiveOldData(Date.now() - 30 * 24 * 60 * 60 * 1000)  // Archive 30+ days
}
```

**Issue: WebSocket disconnections**

```typescript
// Implement reconnection logic
ws.addEventListener('close', (event) => {
  if (event.code !== 1000) {  // Abnormal close
    console.error('WebSocket closed abnormally:', event.code, event.reason)
    setTimeout(() => reconnect(), 1000)
  }
})
```

### 7.2 Debugging Checklist

1. Check `wrangler tail` for errors
2. Verify secrets are set correctly
3. Check Cloudflare dashboard for rate limiting
4. Review recent deployments
5. Check external service status pages
6. Verify DNS and routing configuration

### 7.3 Support Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare Community Forums](https://community.cloudflare.com/)
- [Wrangler GitHub Issues](https://github.com/cloudflare/workers-sdk)
- [dotdo GitHub Issues](https://github.com/dotdo/dotdo)

---

## 8. Backup and Disaster Recovery

### 8.1 Backup Strategies for Durable Objects

Durable Objects with SQLite storage require careful backup planning since data lives at the edge.

**Strategy 1: Periodic snapshots to R2**

```typescript
interface BackupMetadata {
  doId: string
  timestamp: number
  tables: string[]
  rowCount: Record<string, number>
}

async function createBackup(
  sql: SqlStorage,
  env: Env,
  doId: string
): Promise<string> {
  const timestamp = Date.now()
  const backupKey = `backups/${doId}/${timestamp}.json`

  // Get all table names
  const tables = sql.exec<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
  ).toArray().map(t => t.name)

  const backup: Record<string, unknown[]> = {}
  const rowCount: Record<string, number> = {}

  for (const table of tables) {
    const rows = sql.exec(`SELECT * FROM "${table}"`).toArray()
    backup[table] = rows
    rowCount[table] = rows.length
  }

  const metadata: BackupMetadata = {
    doId,
    timestamp,
    tables,
    rowCount
  }

  // Store backup data
  await env.BACKUP_BUCKET.put(backupKey, JSON.stringify(backup), {
    customMetadata: {
      doId,
      timestamp: timestamp.toString(),
      tables: tables.join(','),
      totalRows: Object.values(rowCount).reduce((a, b) => a + b, 0).toString()
    }
  })

  // Store metadata index
  await env.BACKUP_BUCKET.put(
    `backups/${doId}/latest.json`,
    JSON.stringify(metadata)
  )

  return backupKey
}
```

**Strategy 2: Continuous replication to external database**

```typescript
interface ReplicationConfig {
  targetUrl: string
  authToken: string
  batchSize: number
}

class ReplicationManager {
  private lastReplicatedVersion = 0

  async replicateChanges(
    sql: SqlStorage,
    config: ReplicationConfig
  ): Promise<number> {
    // Get changes since last replication
    const changes = sql.exec<{ id: number; table_name: string; operation: string; data: string }>(
      `SELECT * FROM _change_log WHERE id > ? ORDER BY id LIMIT ?`,
      this.lastReplicatedVersion,
      config.batchSize
    ).toArray()

    if (changes.length === 0) return 0

    // Send to external database
    const response = await fetch(config.targetUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ changes })
    })

    if (!response.ok) {
      throw new Error(`Replication failed: ${response.status}`)
    }

    this.lastReplicatedVersion = changes[changes.length - 1].id
    return changes.length
  }
}
```

**Strategy 3: Event sourcing for point-in-time recovery**

```typescript
// Store all mutations as events
async function recordEvent(
  sql: SqlStorage,
  eventType: string,
  payload: unknown
): Promise<void> {
  sql.exec(`
    INSERT INTO _events (type, payload, created_at, version)
    VALUES (?, ?, ?, (SELECT COALESCE(MAX(version), 0) + 1 FROM _events))
  `, eventType, JSON.stringify(payload), Date.now())
}

// Replay events to rebuild state
async function replayEvents(
  sql: SqlStorage,
  targetVersion?: number
): Promise<void> {
  const events = sql.exec<{ type: string; payload: string }>(
    targetVersion
      ? `SELECT type, payload FROM _events WHERE version <= ? ORDER BY version`
      : `SELECT type, payload FROM _events ORDER BY version`,
    targetVersion
  ).toArray()

  // Clear current state
  sql.exec('DELETE FROM things')
  sql.exec('DELETE FROM relationships')

  // Replay each event
  for (const event of events) {
    await applyEvent(sql, event.type, JSON.parse(event.payload))
  }
}
```

### 8.2 Scheduled Backups with Alarms

```typescript
class DO extends DurableObject<Env> {
  async alarm(): Promise<void> {
    const alarmType = await this.ctx.storage.get<string>('alarm_type')

    if (alarmType === 'backup') {
      await this.performBackup()
      // Schedule next backup in 24 hours
      await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000)
    }
  }

  async performBackup(): Promise<void> {
    const sql = this.ctx.storage.sql
    const doId = this.ctx.id.toString()

    try {
      const backupKey = await createBackup(sql, this.env, doId)
      console.log({ event: 'backup_completed', backupKey })
    } catch (error) {
      console.error({ event: 'backup_failed', error: error instanceof Error ? error.message : 'Unknown' })
      // Retry in 1 hour
      await this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000)
    }
  }

  async enableBackups(): Promise<void> {
    await this.ctx.storage.put('alarm_type', 'backup')
    await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000)
  }
}
```

### 8.3 Restore Procedures

**Restore from R2 backup:**

```typescript
async function restoreFromBackup(
  sql: SqlStorage,
  env: Env,
  backupKey: string
): Promise<void> {
  // Get backup data
  const object = await env.BACKUP_BUCKET.get(backupKey)
  if (!object) {
    throw new Error(`Backup not found: ${backupKey}`)
  }

  const backup = await object.json() as Record<string, unknown[]>

  // Begin transaction
  sql.exec('BEGIN TRANSACTION')

  try {
    // Clear existing data
    for (const table of Object.keys(backup)) {
      sql.exec(`DELETE FROM "${table}"`)
    }

    // Restore data
    for (const [table, rows] of Object.entries(backup)) {
      for (const row of rows) {
        const columns = Object.keys(row as Record<string, unknown>)
        const placeholders = columns.map(() => '?').join(', ')
        const values = columns.map(c => (row as Record<string, unknown>)[c])

        sql.exec(
          `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
          ...values
        )
      }
    }

    sql.exec('COMMIT')
  } catch (error) {
    sql.exec('ROLLBACK')
    throw error
  }
}
```

**List available backups:**

```typescript
async function listBackups(
  env: Env,
  doId: string
): Promise<BackupMetadata[]> {
  const prefix = `backups/${doId}/`
  const listed = await env.BACKUP_BUCKET.list({ prefix })

  const backups: BackupMetadata[] = []

  for (const object of listed.objects) {
    if (object.key.endsWith('.json') && !object.key.endsWith('latest.json')) {
      const metadata = await env.BACKUP_BUCKET.get(object.key)
      if (metadata) {
        backups.push(await metadata.json() as BackupMetadata)
      }
    }
  }

  return backups.sort((a, b) => b.timestamp - a.timestamp)
}
```

### 8.4 Backup Configuration

Add R2 bucket binding for backups:

```toml
# wrangler.toml

[[r2_buckets]]
binding = "BACKUP_BUCKET"
bucket_name = "dotdo-backups"

# Production environment
[env.production]
[[env.production.r2_buckets]]
binding = "BACKUP_BUCKET"
bucket_name = "dotdo-backups-prod"
```

**Backup retention policy:**

```typescript
async function cleanupOldBackups(
  env: Env,
  doId: string,
  retentionDays: number = 30
): Promise<number> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const prefix = `backups/${doId}/`

  const listed = await env.BACKUP_BUCKET.list({ prefix })
  let deleted = 0

  for (const object of listed.objects) {
    if (object.key.endsWith('.json') && !object.key.endsWith('latest.json')) {
      const timestamp = parseInt(object.key.split('/').pop()?.replace('.json', '') ?? '0')
      if (timestamp < cutoff) {
        await env.BACKUP_BUCKET.delete(object.key)
        deleted++
      }
    }
  }

  return deleted
}
```

---

## 9. Domain Configuration

### 9.1 Custom Domains with Workers Routes

**Single domain configuration:**

```toml
# wrangler.toml

name = "dotdo-api"
main = "src/index.ts"

# Route configuration
routes = [
  { pattern = "api.example.com/*", zone_name = "example.com" }
]
```

**Multi-tenant subdomain routing:**

```toml
# wrangler.toml

routes = [
  { pattern = "*.api.dotdo.dev/*", zone_name = "dotdo.dev" },
  { pattern = "api.dotdo.dev/*", zone_name = "dotdo.dev" }
]
```

**Environment-specific domains:**

```toml
# Production
[env.production]
routes = [
  { pattern = "api.dotdo.dev/*", zone_name = "dotdo.dev" }
]

# Staging
[env.staging]
routes = [
  { pattern = "api-staging.dotdo.dev/*", zone_name = "dotdo.dev" }
]

# Development (workers.dev subdomain)
[env.dev]
# No routes - uses default workers.dev URL
```

### 9.2 DNS Configuration

**Required DNS records in Cloudflare:**

| Type | Name | Content | Proxy Status |
|------|------|---------|--------------|
| CNAME | api | `<worker-name>.<account>.workers.dev` | Proxied |
| CNAME | *.api | `<worker-name>.<account>.workers.dev` | Proxied |
| A | @ | `192.0.2.1` (placeholder) | Proxied |

**Wildcard subdomains for multi-tenancy:**

```
Type    Name    Content                              Proxy
CNAME   *       dotdo-api.<account>.workers.dev     Proxied
```

### 9.3 SSL/TLS Configuration

Cloudflare automatically provisions SSL certificates for proxied domains.

**For custom certificates (Enterprise):**

1. Go to Cloudflare Dashboard > SSL/TLS > Edge Certificates
2. Upload custom certificate
3. Configure certificate priority

**Force HTTPS in worker:**

```typescript
app.use('*', async (c, next) => {
  // Cloudflare adds this header
  const protocol = c.req.header('X-Forwarded-Proto')

  if (protocol === 'http' && c.env.ENVIRONMENT === 'production') {
    const httpsUrl = c.req.url.replace('http://', 'https://')
    return c.redirect(httpsUrl, 301)
  }

  await next()
})
```

### 9.4 Custom Domain Verification

**Verify domain ownership:**

```bash
# Check DNS propagation
dig api.example.com

# Verify worker is responding
curl -v https://api.example.com/health

# Check certificate
curl -vI https://api.example.com 2>&1 | grep -A 5 "Server certificate"
```

---

## 10. Production Readiness Checklist

Use this checklist before deploying to production.

### 10.1 Pre-Deployment Checklist

#### Environment & Secrets

- [ ] All required environment variables documented
- [ ] `BETTER_AUTH_SECRET` set via `wrangler secret put`
- [ ] `ENCRYPTION_KEY` set via `wrangler secret put`
- [ ] OAuth secrets configured (if using OAuth)
- [ ] API keys for external services configured
- [ ] No secrets committed to version control
- [ ] `.env` files in `.gitignore`

#### Configuration

- [ ] `wrangler.toml`/`wrangler.jsonc` validated
- [ ] `compatibility_date` set to recent date
- [ ] DO migrations properly configured
- [ ] Environment-specific configurations defined
- [ ] Custom domain routes configured
- [ ] R2 buckets created and bound

#### Code Quality

- [ ] All tests passing (`npm test`)
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] No lint errors (`npm run lint`)
- [ ] Bundle size under 5MB
- [ ] No console.log statements in production code

### 10.2 Security Checklist

#### Authentication & Authorization

- [ ] JWT validation implemented and tested
- [ ] Token expiration enforced
- [ ] Session management secure
- [ ] Account lockout implemented
- [ ] Password hashing uses PBKDF2/bcrypt
- [ ] API keys hashed before storage

#### Input Validation

- [ ] All user input validated with Zod/similar
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (output encoding)
- [ ] Request body size limits configured
- [ ] File upload validation (if applicable)

#### Network Security

- [ ] CORS configured for production origins only
- [ ] HTTPS enforced
- [ ] Security headers configured (CSP, HSTS, X-Frame-Options)
- [ ] Rate limiting implemented
- [ ] No sensitive data in URLs or logs

### 10.3 Performance Checklist

#### Database Optimization

- [ ] Database indexes created for common queries
- [ ] Large data offloaded to R2
- [ ] Query performance tested under load
- [ ] Connection pooling considered (for external DBs)
- [ ] Caching strategy implemented

#### Worker Optimization

- [ ] Response compression enabled
- [ ] Static assets cached appropriately
- [ ] Expensive computations avoided in hot paths
- [ ] WebSocket connections monitored
- [ ] Memory usage profiled

### 10.4 Monitoring Checklist

#### Logging & Observability

- [ ] Structured logging implemented
- [ ] Request IDs added to all logs
- [ ] Error tracking configured (Sentry/similar)
- [ ] External logging configured (Axiom/similar)
- [ ] Log retention policy defined

#### Health Checks

- [ ] `/health` endpoint implemented
- [ ] `/livez` endpoint for liveness probes
- [ ] `/readyz` endpoint for readiness probes
- [ ] Health checks verify external dependencies
- [ ] Uptime monitoring configured

#### Alerting

- [ ] Error rate alerts configured
- [ ] Latency threshold alerts configured
- [ ] Storage quota alerts configured
- [ ] External service failure alerts configured
- [ ] On-call rotation defined

### 10.5 Backup & Recovery Checklist

#### Backup Strategy

- [ ] Automated backups configured
- [ ] Backup schedule defined (daily recommended)
- [ ] R2 bucket for backups created
- [ ] Backup retention policy defined
- [ ] Cross-region backup replication (optional)

#### Disaster Recovery

- [ ] Restore procedure documented
- [ ] Restore procedure tested
- [ ] RTO (Recovery Time Objective) defined
- [ ] RPO (Recovery Point Objective) defined
- [ ] Incident response runbook created

### 10.6 Deployment Checklist

#### Pre-Deploy

- [ ] Changes reviewed and approved
- [ ] Staging deployment tested
- [ ] Database migrations tested
- [ ] Rollback plan prepared
- [ ] Team notified of deployment

#### Deploy

- [ ] Deploy via CI/CD or `wrangler deploy`
- [ ] Verify deployment succeeded
- [ ] Smoke test critical endpoints
- [ ] Check error rates post-deploy
- [ ] Monitor for 15-30 minutes

#### Post-Deploy

- [ ] Document any issues encountered
- [ ] Update runbooks if needed
- [ ] Archive deployment artifacts
- [ ] Notify team of successful deployment

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.1.0 | 2026-01-21 | Added backup strategy, domain configuration, and production checklist |
| 1.0.0 | 2025-01-20 | Initial release |

---

## Quick Reference

### Deployment Commands

```bash
# Deploy to production
npx wrangler deploy

# Deploy to staging
npx wrangler deploy --env staging

# Rollback
npx wrangler rollback

# View logs
npx wrangler tail

# Set secret
wrangler secret put SECRET_NAME
```

### Required Environment Variables

```bash
BETTER_AUTH_SECRET   # Session signing (required)
ENCRYPTION_KEY       # Data encryption (required)
```

### Health Check Endpoints

```
GET /health   # Detailed health status
GET /livez    # Liveness probe
GET /readyz   # Readiness probe
```
