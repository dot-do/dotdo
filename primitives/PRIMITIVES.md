# Extended Primitives Guide

This document provides comprehensive documentation for all 44 primitives in the dotdo platform. Each primitive is designed to work in edge runtimes (Cloudflare Workers + Durable Objects) with zero cold starts.

## Table of Contents

- [Core Primitives](#core-primitives) (5 documented)
- [Infrastructure Primitives](#infrastructure-primitives)
- [Security Primitives](#security-primitives)
- [Data Primitives](#data-primitives)
- [Messaging Primitives](#messaging-primitives)
- [Application Primitives](#application-primitives)
- [System Primitives](#system-primitives)

---

## Core Primitives

These primitives are fully documented with their own CLAUDE.md files.

### fsx - Edge Filesystem

**Location:** `primitives/fsx/`

POSIX-compatible filesystem for Cloudflare Workers with tiered storage (SQLite hot tier + R2 warm tier).

```typescript
import { fs } from 'fsx.do'

await fs.writeFile('/config.json', JSON.stringify(config))
const data = await fs.readFile('/config.json', 'utf-8')
```

See [fsx/CLAUDE.md](./fsx/CLAUDE.md) for full documentation.

### gitx - Edge Git

**Location:** `primitives/gitx/`

Git implementation running entirely on R2 object storage.

See [gitx/CLAUDE.md](./gitx/CLAUDE.md) for full documentation.

### bashx - Edge Shell

**Location:** `primitives/bashx/`

AI-enhanced bash execution with tree-sitter AST parsing and safety analysis.

```typescript
import { bash } from 'bashx.do'

const result = await bash('ls -la /app')
```

See [bashx/CLAUDE.md](./bashx/CLAUDE.md) for full documentation.

### npmx - Edge Package Manager

**Location:** `primitives/npmx/`

NPM/NPX for edge runtimes without Node.js. Uses fsx for filesystem operations.

```typescript
import { npm, npx } from 'npmx.do'

await npm.install('lodash')
await npx('create-next-app', ['my-app'])
```

See [npmx/CLAUDE.md](./npmx/CLAUDE.md) for full documentation.

### pyx - Edge Python

**Location:** `primitives/pyx/`

Python execution on edge runtimes using Pyodide.

See [pyx/CLAUDE.md](./pyx/CLAUDE.md) for full documentation.

---

## Infrastructure Primitives

### api-gateway

**Location:** `primitives/api-gateway/`

HTTP routing, middleware, CORS, authentication, and rate limiting for API endpoints.

```typescript
import { createAPIGateway } from './api-gateway'

const gateway = createAPIGateway({
  basePath: '/api/v1',
  cors: {
    origins: ['https://app.example.com'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    headers: ['Authorization', 'Content-Type'],
  },
  rateLimit: {
    requests: 100,
    window: 60000, // 1 minute
    key: 'ip',
  },
})

gateway.route({
  method: 'GET',
  path: '/users/:id',
  handler: async (req) => ({
    status: 200,
    headers: {},
    body: { id: req.params.id },
  }),
})
```

**Key Features:**
- Express-style route matching with path parameters
- Middleware chain (before/after hooks)
- Built-in CORS handling
- JWT and API key authentication
- Per-route and global rate limiting

### circuit-breaker

**Location:** `primitives/circuit-breaker/`

Fault tolerance pattern preventing cascading failures in distributed systems.

```typescript
import { createCircuitBreaker } from './circuit-breaker'

const breaker = createCircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenRequests: 3,
  bulkhead: {
    maxConcurrent: 10,
    queueSize: 100,
  },
  retryPolicy: {
    maxRetries: 3,
    baseDelay: 1000,
    backoffMultiplier: 2,
  },
})

const result = await breaker.execute(async () => {
  return await externalService.call()
})
```

**Key Features:**
- Three states: closed, open, half-open
- Sliding window failure tracking
- Configurable fallback handlers
- Bulkhead pattern for concurrency limiting
- Exponential backoff retries
- Health check integration

### health-checker

**Location:** `primitives/health-checker/`

Service health monitoring with dependency checks and alerting.

```typescript
import { createHealthChecker } from './health-checker'

const health = createHealthChecker({
  checks: [
    {
      name: 'database',
      check: async () => db.ping(),
      timeout: 5000,
      critical: true,
    },
    {
      name: 'redis',
      check: async () => redis.ping(),
      timeout: 3000,
      critical: false,
    },
  ],
  interval: 30000,
})

const status = await health.check()
// { status: 'healthy', checks: [...], timestamp: Date }
```

**Key Features:**
- Multiple check types (HTTP, TCP, custom)
- Configurable timeouts and intervals
- Critical vs non-critical dependencies
- Aggregated health status
- Alerting hooks

### rate-limiter

**Location:** `primitives/rate-limiter/`

Multi-strategy rate limiting with distributed coordination.

```typescript
import { createRateLimiter, createTokenBucket, createQuotaManager } from './rate-limiter'

// Fixed window limiter
const limiter = createRateLimiter({
  requests: 100,
  window: 60000,
  strategy: 'sliding-window',
})

const result = await limiter.consume({ identifier: 'user-123', scope: 'api' })
// { allowed: true, remaining: 99, resetAt: 1234567890, limit: 100 }

// Token bucket for burst handling
const bucket = createTokenBucket({
  capacity: 100,
  refillRate: 10, // tokens per second
})

// Quota management
const quota = createQuotaManager({
  hourly: 1000,
  daily: 10000,
  monthly: 100000,
})
```

**Strategies:**
- `fixed-window` - Simple time-based windows
- `sliding-window` - Accurate sliding log algorithm
- `token-bucket` - Burst-tolerant with refill
- `leaky-bucket` - Smooth rate enforcement

### service-registry

**Location:** `primitives/service-registry/`

Service discovery and registration for microservices.

```typescript
import { createServiceRegistry } from './service-registry'

const registry = createServiceRegistry()

// Register a service
await registry.register({
  name: 'user-service',
  version: '1.0.0',
  endpoints: [
    { url: 'https://user-1.example.com', weight: 100 },
    { url: 'https://user-2.example.com', weight: 100 },
  ],
  healthCheck: {
    path: '/health',
    interval: 30000,
  },
})

// Discover services
const service = await registry.discover('user-service')
const endpoint = service.loadBalance() // Returns healthy endpoint
```

**Key Features:**
- Service registration/deregistration
- Health-aware load balancing
- Version-based routing
- Metadata and tags support
- TTL-based expiration

---

## Security Primitives

### access-control

**Location:** `primitives/access-control/`

Policy-based access control with RBAC and ABAC support.

```typescript
import { createAccessControl } from './access-control'

const ac = createAccessControl({ defaultEffect: 'deny' })

// Define policies
ac.addPolicy({
  id: 'admin-access',
  effect: 'allow',
  principals: ['role:admin'],
  resources: ['*'],
  actions: ['*'],
  priority: 100,
})

ac.addPolicy({
  id: 'user-read',
  effect: 'allow',
  principals: ['role:user'],
  resources: ['document:*'],
  actions: ['read'],
  conditions: [
    { type: 'resource', field: 'owner', operator: 'equals', value: '{{principal.id}}' },
  ],
})

// Check access
const decision = await ac.check({
  principal: { id: 'user-123', type: 'user', roles: ['user'] },
  action: { name: 'read' },
  resource: { type: 'document', id: 'doc-456', owner: 'user-123' },
})
// { allowed: true, reason: 'user-read', matchedPolicies: ['user-read'] }
```

**Key Features:**
- Allow/Deny policies with priority
- Resource and action patterns (wildcards)
- Condition operators (equals, in, contains, matches, etc.)
- Multi-tenant scoping
- Decision caching

### audit-logger

**Location:** `primitives/audit-logger/`

Immutable audit trail for compliance and security monitoring.

```typescript
import { createAuditLogger } from './audit-logger'

const audit = createAuditLogger({
  storage: 'durable-object',
  retention: 90 * 24 * 60 * 60 * 1000, // 90 days
})

await audit.log({
  action: 'user.login',
  actor: { id: 'user-123', type: 'user' },
  resource: { type: 'session', id: 'session-456' },
  outcome: 'success',
  metadata: {
    ip: '192.168.1.1',
    userAgent: 'Mozilla/5.0...',
  },
})

// Query audit logs
const logs = await audit.query({
  actor: 'user-123',
  action: 'user.*',
  from: new Date('2024-01-01'),
  to: new Date(),
})
```

**Key Features:**
- Tamper-evident logging
- Structured event format
- Time-range queries
- Actor/action filtering
- Retention policies

### crypto-engine

**Location:** `primitives/crypto-engine/`

Cryptographic operations using Web Crypto API.

```typescript
import { createCryptoEngine } from './crypto-engine'

const crypto = createCryptoEngine()

// Symmetric encryption
const key = await crypto.generateKey('AES-GCM', 256)
const encrypted = await crypto.encrypt(key, 'sensitive data')
const decrypted = await crypto.decrypt(key, encrypted)

// Asymmetric encryption
const keyPair = await crypto.generateKeyPair('RSA-OAEP', 2048)
const sealed = await crypto.seal(keyPair.publicKey, 'message')
const opened = await crypto.open(keyPair.privateKey, sealed)

// Signatures
const signingKey = await crypto.generateSigningKey('ECDSA', 'P-256')
const signature = await crypto.sign(signingKey.privateKey, 'data to sign')
const valid = await crypto.verify(signingKey.publicKey, 'data to sign', signature)

// Hashing
const hash = await crypto.hash('SHA-256', 'data')
```

**Algorithms:**
- AES-GCM, AES-CBC (symmetric)
- RSA-OAEP, ECDH (asymmetric)
- ECDSA, RSA-PSS, HMAC (signing)
- SHA-256, SHA-384, SHA-512 (hashing)

### permission-engine

**Location:** `primitives/permission-engine/`

Fine-grained permission management with inheritance.

```typescript
import { createPermissionEngine } from './permission-engine'

const permissions = createPermissionEngine()

// Define roles with permissions
permissions.defineRole('editor', {
  permissions: [
    { resource: 'document', actions: ['read', 'write', 'delete'] },
    { resource: 'comment', actions: ['read', 'write'] },
  ],
})

permissions.defineRole('viewer', {
  permissions: [
    { resource: 'document', actions: ['read'] },
    { resource: 'comment', actions: ['read'] },
  ],
})

// Assign roles to users
await permissions.assignRole('user-123', 'editor')

// Check permissions
const can = await permissions.can('user-123', 'document', 'write')
// true
```

**Key Features:**
- Role-based permissions
- Resource-action pairs
- Permission inheritance
- Wildcard support
- Bulk permission checks

### secret-store

**Location:** `primitives/secret-store/`

Encrypted secret storage with versioning and rotation.

```typescript
import { createSecretStore } from './secret-store'

const secrets = createSecretStore({
  encryption: {
    algorithm: 'AES-GCM-256',
    keyId: 'master-key-001',
    envelope: true,
  },
})

// Store secrets
await secrets.set('api-key', 'sk-abc123', {
  tags: ['external', 'stripe'],
  expiresAt: new Date('2025-01-01'),
})

// Retrieve secrets
const value = await secrets.get('api-key')

// Rotate secrets
await secrets.rotate('api-key', 'sk-xyz789')

// Access policies
await secrets.setPolicy('api-key', {
  principals: ['service:billing'],
  actions: ['read'],
  conditions: [],
})
```

**Key Features:**
- AES-GCM-256, AES-CBC-256, ChaCha20-Poly1305
- Envelope encryption
- Secret versioning
- Automatic rotation policies
- Access policies
- Audit logging

### token-manager

**Location:** `primitives/token-manager/`

JWT and opaque token generation and validation.

```typescript
import { createTokenManager } from './token-manager'

const tokens = createTokenManager({
  issuer: 'https://auth.example.com',
  audience: 'https://api.example.com',
  signingKey: await crypto.generateSigningKey('ES256'),
})

// Generate JWT
const jwt = await tokens.sign({
  sub: 'user-123',
  scope: 'read write',
  exp: Math.floor(Date.now() / 1000) + 3600,
})

// Verify JWT
const claims = await tokens.verify(jwt)

// Refresh tokens
const { accessToken, refreshToken } = await tokens.createTokenPair('user-123')
const newTokens = await tokens.refresh(refreshToken)

// Revoke tokens
await tokens.revoke(refreshToken)
```

**Key Features:**
- JWT signing (ES256, RS256, HS256)
- Token validation and expiration
- Refresh token rotation
- Token revocation
- Claims customization

---

## Data Primitives

### cache-manager

**Location:** `primitives/cache-manager/`

Multi-tier caching with automatic invalidation.

```typescript
import { createCacheManager } from './cache-manager'

const cache = createCacheManager({
  tiers: [
    { name: 'memory', ttl: 60000, maxSize: 1000 },
    { name: 'durable-object', ttl: 3600000 },
  ],
  serializer: 'json',
})

// Basic operations
await cache.set('user:123', userData, { ttl: 300000 })
const user = await cache.get('user:123')

// Patterns
await cache.invalidate('user:*') // Invalidate all users

// Cache-aside pattern
const result = await cache.getOrSet('expensive-query', async () => {
  return await db.query('...')
}, { ttl: 60000 })
```

**Key Features:**
- Multi-tier caching (memory, DO, KV)
- TTL and size-based eviction
- Pattern-based invalidation
- Stale-while-revalidate
- Cache warming

### compression-engine

**Location:** `primitives/compression-engine/`

Data compression with multiple algorithms.

```typescript
import { createCompressionEngine } from './compression-engine'

const compressor = createCompressionEngine()

// Compress data
const compressed = await compressor.compress(largeData, {
  algorithm: 'gzip',
  level: 6,
})

// Decompress data
const original = await compressor.decompress(compressed, 'gzip')

// Stream compression
const stream = compressor.createCompressStream('gzip')
```

**Algorithms:**
- gzip
- deflate
- brotli
- zstd (when available)

### data-pipeline

**Location:** `primitives/data-pipeline/`

ETL pipeline for data transformation and loading.

```typescript
import { createDataPipeline } from './data-pipeline'

const pipeline = createDataPipeline()
  .extract(async () => {
    return await api.fetchRecords()
  })
  .transform(async (records) => {
    return records.map(r => ({
      ...r,
      processedAt: new Date(),
    }))
  })
  .load(async (records) => {
    await db.bulkInsert(records)
  })

await pipeline.run()
```

**Key Features:**
- Chainable extract/transform/load stages
- Batch processing
- Error handling and retries
- Progress tracking
- Parallel execution

### serialization-engine

**Location:** `primitives/serialization-engine/`

Multi-format serialization and deserialization.

```typescript
import { createSerializationEngine } from './serialization-engine'

const serializer = createSerializationEngine()

// JSON (default)
const json = serializer.serialize(data, 'json')
const fromJson = serializer.deserialize(json, 'json')

// MessagePack (compact binary)
const msgpack = serializer.serialize(data, 'msgpack')

// CBOR
const cbor = serializer.serialize(data, 'cbor')

// Custom schemas
serializer.registerSchema('User', {
  id: 'string',
  name: 'string',
  age: 'number',
})
const typed = serializer.serialize(user, 'User')
```

**Formats:**
- JSON
- MessagePack
- CBOR
- Protocol Buffers (schema-based)

### validation-engine

**Location:** `primitives/validation-engine/`

Schema validation with comprehensive type checking.

```typescript
import { createValidationEngine, v } from './validation-engine'

const validator = createValidationEngine()

// Define schemas
const userSchema = v.object({
  id: v.string().uuid(),
  email: v.string().email(),
  age: v.number().min(0).max(150).optional(),
  roles: v.array(v.enum(['admin', 'user', 'guest'])),
  metadata: v.record(v.string(), v.unknown()),
})

// Validate
const result = validator.validate(data, userSchema)
if (result.success) {
  console.log(result.data) // Typed data
} else {
  console.log(result.errors) // Validation errors
}

// Parse (throws on error)
const user = validator.parse(data, userSchema)
```

**Validators:**
- string, number, boolean, date
- array, object, record, tuple
- enum, literal, union, intersection
- Custom validators
- Transformations

---

## Messaging Primitives

### channel

**Location:** `primitives/channel/`

Pub/sub channels for real-time messaging.

```typescript
import { createChannel } from './channel'

const channel = createChannel('updates')

// Subscribe
const unsubscribe = channel.subscribe((message) => {
  console.log('Received:', message)
})

// Publish
await channel.publish({ type: 'user.updated', data: { id: 'user-123' } })

// Pattern subscriptions
channel.subscribe('user.*', (message) => {
  // Handles user.created, user.updated, etc.
})
```

### event-emitter

**Location:** `primitives/event-emitter/`

Type-safe event emitter with async support.

```typescript
import { createEventEmitter } from './event-emitter'

interface Events {
  'user:created': { id: string; email: string }
  'user:deleted': { id: string }
}

const emitter = createEventEmitter<Events>()

// Listen
emitter.on('user:created', async (data) => {
  await sendWelcomeEmail(data.email)
})

// Emit
await emitter.emit('user:created', { id: 'user-123', email: 'user@example.com' })

// Once listener
emitter.once('user:created', handler)

// Remove listener
emitter.off('user:created', handler)
```

**Key Features:**
- Type-safe events
- Async handlers
- Once listeners
- Wildcard patterns
- Max listeners warning

### task-queue

**Location:** `primitives/task-queue/`

Background job processing with priorities and retries.

```typescript
import { createTaskQueue } from './task-queue'

const queue = createTaskQueue({
  concurrency: 5,
  retries: 3,
  timeout: 30000,
  backoff: {
    type: 'exponential',
    delay: 1000,
    maxDelay: 60000,
    factor: 2,
  },
})

// Register handlers
queue.register('email:send', async (task, context) => {
  context.progress(0, 1, 'Sending email...')
  await sendEmail(task.payload)
  context.progress(1, 1, 'Email sent')
  return { sent: true }
})

// Enqueue tasks
const taskId = await queue.enqueue('email:send', {
  to: 'user@example.com',
  subject: 'Welcome!',
}, { priority: 10 })

// Check status
const status = await queue.getStatus(taskId)

// Events
queue.on('task:completed', (task) => console.log('Done:', task.id))
queue.on('task:failed', (task) => console.log('Failed:', task.id))
```

**Key Features:**
- Priority queues
- Configurable concurrency
- Exponential/linear/fixed backoff
- Progress reporting
- Dead letter queue
- Task cancellation

### webhook-engine

**Location:** `primitives/webhook-engine/`

Reliable webhook delivery with retries and signatures.

```typescript
import { createWebhookEngine } from './webhook-engine'

const webhooks = createWebhookEngine({
  retryPolicy: {
    maxAttempts: 5,
    backoff: 'exponential',
    baseDelay: 1000,
    maxDelay: 60000,
  },
})

// Register webhooks
const webhookId = await webhooks.register({
  url: 'https://example.com/webhook',
  secret: 'whsec_abc123',
  events: ['order.created', 'order.updated'],
})

// Trigger events
await webhooks.trigger('order.created', {
  id: 'order-123',
  total: 99.99,
})

// Delivery tracking
const deliveries = await webhooks.getDeliveries(webhookId)
```

**Key Features:**
- HMAC-SHA256 signatures
- Configurable retry policies
- Delivery tracking
- Event filtering
- Payload transformation

---

## Application Primitives

### config-manager

**Location:** `primitives/config-manager/`

Configuration management with environment support.

```typescript
import { createConfigManager } from './config-manager'

const config = createConfigManager({
  sources: [
    { type: 'env', prefix: 'APP_' },
    { type: 'file', path: './config.json' },
    { type: 'secrets', store: secretStore },
  ],
  schema: {
    database: {
      host: { type: 'string', required: true },
      port: { type: 'number', default: 5432 },
    },
    features: {
      newUI: { type: 'boolean', default: false },
    },
  },
})

// Access config
const dbHost = config.get('database.host')
const port = config.get('database.port', 5432)

// Watch for changes
config.watch('features.newUI', (newValue, oldValue) => {
  console.log('Feature flag changed:', newValue)
})
```

**Key Features:**
- Multiple sources (env, files, secrets)
- Schema validation
- Default values
- Hot reloading
- Change notifications

### email-templater

**Location:** `primitives/email-templater/`

Email template rendering with layouts and partials.

```typescript
import { createEmailTemplater } from './email-templater'

const templater = createEmailTemplater({
  templatesDir: './templates',
  defaultLayout: 'main',
})

// Register templates
templater.register('welcome', {
  subject: 'Welcome to {{appName}}!',
  html: `
    <h1>Hello {{name}}</h1>
    <p>Thanks for joining {{appName}}.</p>
  `,
  text: 'Hello {{name}}, Thanks for joining {{appName}}.',
})

// Render
const email = await templater.render('welcome', {
  appName: 'dotdo',
  name: 'Alice',
})
// { subject: '...', html: '...', text: '...' }
```

**Key Features:**
- Mustache/Handlebars syntax
- HTML and plain text
- Layouts and partials
- CSS inlining
- Preview mode

### feature-flags

**Location:** `primitives/feature-flags/`

Feature flag evaluation with targeting rules.

```typescript
import { createFeatureFlags } from './feature-flags'

const flags = createFeatureFlags({
  flags: [
    {
      key: 'new-checkout',
      enabled: true,
      defaultValue: false,
      rules: [
        {
          conditions: [
            { attribute: 'plan', operator: 'eq', values: ['premium'] },
          ],
          percentage: 100,
          value: true,
        },
        {
          conditions: [],
          percentage: 20, // 20% rollout
          value: true,
        },
      ],
    },
  ],
})

// Evaluate
const result = flags.evaluate('new-checkout', {
  userId: 'user-123',
  attributes: { plan: 'premium' },
})
// { value: true, reason: 'RULE_MATCH', variant: undefined }

// Simple check
const enabled = flags.isEnabled('new-checkout', context)
```

**Key Features:**
- Boolean, string, number, JSON values
- Targeting rules with operators
- Percentage rollouts
- Sticky bucketing
- Scheduled releases
- A/B testing variants

### form-builder

**Location:** `primitives/form-builder/`

Dynamic form generation and validation.

```typescript
import { createFormBuilder } from './form-builder'

const form = createFormBuilder({
  fields: [
    {
      name: 'email',
      type: 'email',
      label: 'Email Address',
      required: true,
      validation: { email: true },
    },
    {
      name: 'password',
      type: 'password',
      label: 'Password',
      required: true,
      validation: { minLength: 8, pattern: /[A-Z]/ },
    },
    {
      name: 'plan',
      type: 'select',
      label: 'Plan',
      options: [
        { value: 'free', label: 'Free' },
        { value: 'pro', label: 'Pro - $10/mo' },
      ],
    },
  ],
})

// Validate submission
const result = await form.validate({
  email: 'user@example.com',
  password: 'SecurePass123',
  plan: 'pro',
})
```

**Key Features:**
- Multiple field types
- Validation rules
- Conditional fields
- Multi-step forms
- File uploads

### i18n-engine

**Location:** `primitives/i18n-engine/`

Internationalization with pluralization and formatting.

```typescript
import { createI18nEngine } from './i18n-engine'

const i18n = createI18nEngine({
  defaultLocale: 'en',
  fallbackLocale: 'en',
  locales: [
    { code: 'en', name: 'English', direction: 'ltr' },
    { code: 'ar', name: 'Arabic', direction: 'rtl' },
  ],
  translations: {
    en: {
      common: {
        welcome: 'Welcome, {{name}}!',
        items: {
          one: '{{count}} item',
          other: '{{count}} items',
        },
      },
    },
  },
})

// Translate
i18n.t('common.welcome', { values: { name: 'Alice' } })
// 'Welcome, Alice!'

// Pluralization
i18n.t('common.items', { count: 5 })
// '5 items'

// Formatting
i18n.formatNumber(1234.56) // '1,234.56'
i18n.formatCurrency(99.99, 'USD') // '$99.99'
i18n.formatDate(new Date(), { dateStyle: 'long' }) // 'January 13, 2025'
```

**Key Features:**
- Dot notation keys
- Variable interpolation
- CLDR plural rules
- Number/date/currency formatting
- RTL support
- Fallback handling

### migration-engine

**Location:** `primitives/migration-engine/`

Database migration management.

```typescript
import { createMigrationEngine } from './migration-engine'

const migrations = createMigrationEngine({
  directory: './migrations',
  tableName: '_migrations',
})

// Define migrations
migrations.define({
  version: '001',
  name: 'create-users-table',
  up: async (db) => {
    await db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
  },
  down: async (db) => {
    await db.exec('DROP TABLE users')
  },
})

// Run migrations
await migrations.up() // Run all pending
await migrations.up('001') // Run specific
await migrations.down() // Rollback last
await migrations.status() // Check status
```

**Key Features:**
- Version tracking
- Up/down migrations
- Transaction support
- Dry run mode
- Status reporting

### scheduler-engine

**Location:** `primitives/scheduler-engine/`

Cron-based job scheduling.

```typescript
import { createSchedulerEngine } from './scheduler-engine'

const scheduler = createSchedulerEngine()

// Schedule jobs
scheduler.schedule({
  id: 'daily-report',
  cron: '0 9 * * *', // Every day at 9am
  handler: async () => {
    await generateDailyReport()
  },
  timezone: 'America/New_York',
})

scheduler.schedule({
  id: 'cleanup',
  cron: '0 0 * * 0', // Every Sunday at midnight
  handler: async () => {
    await cleanupOldRecords()
  },
})

// Control
scheduler.start()
scheduler.pause('daily-report')
scheduler.resume('daily-report')
scheduler.cancel('daily-report')
```

**Key Features:**
- Cron expressions
- Timezone support
- Job management (pause/resume/cancel)
- Execution history
- Overlap prevention

### search-engine

**Location:** `primitives/search-engine/`

Full-text search with facets and highlighting.

```typescript
import { createSearchEngine } from './search-engine'

const search = createSearchEngine({
  mapping: {
    fields: {
      title: { type: 'text', analyzer: 'standard', boost: 2 },
      content: { type: 'text', analyzer: 'standard' },
      tags: { type: 'keyword', facet: true },
      price: { type: 'number' },
    },
  },
})

// Index documents
await search.index({
  id: 'product-1',
  source: {
    title: 'Wireless Headphones',
    content: 'Premium noise-canceling headphones...',
    tags: ['electronics', 'audio'],
    price: 299.99,
  },
})

// Search
const results = await search.search({
  query: 'wireless headphones',
  filters: [
    { field: 'price', operator: 'lte', value: 500 },
  ],
  facets: [{ field: 'tags', size: 10 }],
  highlight: { fields: ['title', 'content'] },
  pagination: { offset: 0, limit: 10 },
})
```

**Key Features:**
- Full-text search
- Filters and facets
- Result highlighting
- Fuzzy matching
- Relevance scoring
- Pagination

### session-manager

**Location:** `primitives/session-manager/`

User session management with storage abstraction.

```typescript
import { createSessionManager } from './session-manager'

const sessions = createSessionManager({
  ttl: 24 * 60 * 60 * 1000, // 24 hours
  rolling: true,
  cookie: {
    name: 'session',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
  },
})

// Create session
const session = await sessions.create({
  userId: 'user-123',
  roles: ['user'],
})

// Get session
const current = await sessions.get(sessionId)

// Update session
await sessions.update(sessionId, {
  lastActivity: new Date(),
})

// Destroy session
await sessions.destroy(sessionId)

// Destroy all user sessions
await sessions.destroyAll({ userId: 'user-123' })
```

**Key Features:**
- Cookie-based sessions
- Rolling expiration
- Session data storage
- Multi-device support
- Session invalidation

### state-manager

**Location:** `primitives/state-manager/`

Reactive state management with subscriptions.

```typescript
import { createStateManager } from './state-manager'

const state = createStateManager({
  user: null,
  cart: { items: [], total: 0 },
  settings: { theme: 'light' },
})

// Get state
const user = state.get('user')
const theme = state.get('settings.theme')

// Set state
state.set('user', { id: 'user-123', name: 'Alice' })
state.set('settings.theme', 'dark')

// Subscribe to changes
const unsubscribe = state.subscribe('cart', (newCart, oldCart) => {
  console.log('Cart updated:', newCart)
})

// Batch updates
state.batch(() => {
  state.set('cart.items', [...items, newItem])
  state.set('cart.total', calculateTotal(items))
})
```

**Key Features:**
- Dot notation paths
- Change subscriptions
- Batch updates
- Computed values
- Persistence adapters

### trigger-engine

**Location:** `primitives/trigger-engine/`

Event-driven automation triggers.

```typescript
import { createTriggerEngine } from './trigger-engine'

const triggers = createTriggerEngine()

// Define triggers
triggers.define({
  id: 'high-value-order',
  event: 'order.created',
  conditions: [
    { field: 'total', operator: 'gte', value: 1000 },
  ],
  actions: [
    { type: 'webhook', url: 'https://example.com/notify' },
    { type: 'email', to: 'sales@example.com', template: 'high-value-order' },
  ],
})

// Fire events
await triggers.fire('order.created', {
  id: 'order-123',
  total: 1500,
  customer: 'user-456',
})
```

**Key Features:**
- Event-condition-action rules
- Multiple action types
- Condition operators
- Action chaining
- Execution logging

### workflow-orchestrator

**Location:** `primitives/workflow-orchestrator/`

Multi-step workflow execution with compensation.

```typescript
import { createWorkflowOrchestrator } from './workflow-orchestrator'

const orchestrator = createWorkflowOrchestrator({
  maxConcurrency: 10,
  defaultStepTimeout: 30000,
})

// Define workflow
const orderWorkflow = {
  id: 'process-order',
  name: 'Process Order',
  steps: [
    {
      id: 'validate',
      name: 'Validate Order',
      handler: async (ctx) => {
        return await validateOrder(ctx.inputs.orderId)
      },
    },
    {
      id: 'charge',
      name: 'Charge Payment',
      dependencies: ['validate'],
      handler: async (ctx) => {
        const order = ctx.getStepOutput('validate')
        return await chargePayment(order)
      },
      compensation: async (ctx, output) => {
        await refundPayment(output.chargeId)
      },
      retry: { maxAttempts: 3, delayMs: 1000 },
    },
    {
      id: 'fulfill',
      name: 'Fulfill Order',
      dependencies: ['charge'],
      handler: async (ctx) => {
        return await fulfillOrder(ctx.inputs.orderId)
      },
    },
  ],
}

// Execute workflow
const execution = await orchestrator.execute(orderWorkflow, {
  orderId: 'order-123',
})

// Check status
const status = await orchestrator.getExecution(execution.id)
```

**Key Features:**
- Step dependencies (DAG)
- Compensation (saga pattern)
- Retry policies
- Timeouts
- Conditional execution
- Event hooks

---

## System Primitives

### adapter

**Location:** `primitives/adapter/`

Pluggable adapters for external services.

```typescript
import { createAdapter } from './adapter'

const dbAdapter = createAdapter({
  name: 'database',
  interface: {
    query: (sql: string) => Promise<unknown[]>,
    execute: (sql: string) => Promise<void>,
  },
})

// Implement for different backends
dbAdapter.implement('sqlite', {
  query: async (sql) => db.all(sql),
  execute: async (sql) => db.run(sql),
})

dbAdapter.implement('postgres', {
  query: async (sql) => pg.query(sql).rows,
  execute: async (sql) => pg.query(sql),
})

// Use adapter
const adapter = dbAdapter.get('sqlite')
const rows = await adapter.query('SELECT * FROM users')
```

### log-aggregator

**Location:** `primitives/log-aggregator/`

Structured logging with multiple outputs.

```typescript
import { createLogAggregator } from './log-aggregator'

const logger = createLogAggregator({
  level: 'info',
  outputs: [
    { type: 'console', format: 'pretty' },
    { type: 'file', path: './app.log', format: 'json' },
    { type: 'http', url: 'https://logs.example.com', batch: true },
  ],
})

// Log messages
logger.debug('Debug message', { context: 'test' })
logger.info('User logged in', { userId: 'user-123' })
logger.warn('Rate limit approaching', { remaining: 10 })
logger.error('Failed to process', { error: err, requestId: 'req-456' })

// Child loggers
const requestLogger = logger.child({ requestId: 'req-789' })
requestLogger.info('Processing request') // Includes requestId automatically
```

**Key Features:**
- Log levels (debug, info, warn, error)
- Structured metadata
- Multiple outputs
- Batched HTTP delivery
- Child loggers

### machine

**Location:** `primitives/machine/`

Finite state machine implementation.

```typescript
import { createMachine } from './machine'

const orderMachine = createMachine({
  initial: 'pending',
  states: {
    pending: {
      on: {
        PAY: 'paid',
        CANCEL: 'cancelled',
      },
    },
    paid: {
      on: {
        SHIP: 'shipped',
        REFUND: 'refunded',
      },
    },
    shipped: {
      on: {
        DELIVER: 'delivered',
        RETURN: 'returned',
      },
    },
    delivered: { type: 'final' },
    cancelled: { type: 'final' },
    refunded: { type: 'final' },
    returned: { type: 'final' },
  },
})

// Use machine
const state = orderMachine.transition('pending', 'PAY')
// 'paid'

// With context
const machine = orderMachine.withContext({ orderId: 'order-123' })
machine.send('PAY')
console.log(machine.state) // 'paid'
```

**Key Features:**
- State transitions
- Guards (conditions)
- Actions (side effects)
- Context data
- Final states

### metrics-collector

**Location:** `primitives/metrics-collector/`

Application metrics with multiple metric types.

```typescript
import { createMetricsCollector } from './metrics-collector'

const metrics = createMetricsCollector({
  prefix: 'app',
  tags: { env: 'production' },
})

// Counter
const requestCounter = metrics.counter('requests_total', {
  description: 'Total HTTP requests',
})
requestCounter.inc({ method: 'GET', path: '/api/users' })

// Gauge
const activeConnections = metrics.gauge('connections_active', {
  description: 'Active WebSocket connections',
})
activeConnections.set(42)

// Histogram
const requestDuration = metrics.histogram('request_duration_seconds', {
  description: 'Request duration',
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
})
requestDuration.observe(0.123, { method: 'GET' })

// Export metrics
const output = await metrics.export('prometheus')
```

**Key Features:**
- Counter, Gauge, Histogram, Summary
- Tags/labels
- Prometheus format
- Percentiles
- Rate calculations

### pipe

**Location:** `primitives/pipe/`

Data transformation pipelines.

```typescript
import { createPipe } from './pipe'

const pipeline = createPipe<string>()
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map((s) => s.toLowerCase())
  .unique()
  .take(10)

const result = await pipeline.process(['  Hello ', 'WORLD', '', 'hello', 'Test'])
// ['hello', 'world', 'test']

// Async operations
const asyncPipe = createPipe<number>()
  .mapAsync(async (n) => await fetchData(n))
  .batch(10)
  .mapAsync(async (batch) => await bulkProcess(batch))
```

**Key Features:**
- Chainable transformations
- Async support
- Batching
- Filtering
- Deduplication

### protocol

**Location:** `primitives/protocol/`

Protocol definition and message handling.

```typescript
import { createProtocol } from './protocol'

const protocol = createProtocol({
  version: '1.0',
  messages: {
    ping: { type: 'request', response: 'pong' },
    pong: { type: 'response' },
    subscribe: {
      type: 'request',
      schema: {
        channel: 'string',
      },
    },
    event: {
      type: 'notification',
      schema: {
        channel: 'string',
        data: 'unknown',
      },
    },
  },
})

// Handle messages
protocol.handle('ping', async (msg) => ({ type: 'pong' }))
protocol.handle('subscribe', async (msg) => {
  await subscribe(msg.channel)
  return { type: 'subscribed' }
})

// Send messages
await protocol.send({ type: 'ping' })
```

### resource

**Location:** `primitives/resource/`

Resource lifecycle management.

```typescript
import { createResource } from './resource'

const dbResource = createResource({
  name: 'database',
  create: async () => {
    const conn = await createConnection()
    return conn
  },
  destroy: async (conn) => {
    await conn.close()
  },
  healthCheck: async (conn) => {
    await conn.ping()
  },
})

// Acquire and use
const conn = await dbResource.acquire()
try {
  await conn.query('SELECT 1')
} finally {
  await dbResource.release(conn)
}

// Pool management
const pool = dbResource.pool({ min: 2, max: 10 })
await pool.use(async (conn) => {
  return await conn.query('SELECT * FROM users')
})
```

**Key Features:**
- Resource pooling
- Lifecycle hooks
- Health checks
- Automatic cleanup

### conversation

**Location:** `primitives/conversation/`

Conversation state management for AI agents.

```typescript
import { createConversation } from './conversation'

const conversation = createConversation({
  systemPrompt: 'You are a helpful assistant.',
  maxHistory: 100,
  summarizeAfter: 50,
})

// Add messages
await conversation.addMessage({
  role: 'user',
  content: 'Hello!',
})

await conversation.addMessage({
  role: 'assistant',
  content: 'Hi there! How can I help you?',
})

// Get context for AI
const context = await conversation.getContext()

// Branching
const branch = await conversation.branch()
await branch.addMessage({ role: 'user', content: 'Alternative question' })
```

**Key Features:**
- Message history
- Context windowing
- Automatic summarization
- Branching conversations
- Token counting

---

## Design Principles

All primitives follow these design principles:

### 1. DO-First State Management

Every stateful primitive has a Durable Object storage adapter:

```typescript
interface StorageAdapter<T> {
  get(key: string): Promise<T | null>
  set(key: string, value: T, options?: { ttl?: number }): Promise<void>
  delete(key: string): Promise<void>
  list(prefix?: string): Promise<Map<string, T>>
}
```

### 2. Event-Driven Backbone

Primitives emit events for cross-component coordination:

```typescript
bus.subscribe('payment.completed', async (event) => {
  await notifications.send(event.userId, 'payment-receipt', event)
  await analytics.track('Payment Completed', event)
})
```

### 3. Request Context Propagation

All primitives inherit request context automatically:

```typescript
const ctx = createRequestContext({
  requestId: crypto.randomUUID(),
  traceId: request.headers.get('x-trace-id'),
  userId: auth.userId,
})
```

### 4. Observability by Default

Every operation emits OpenTelemetry-compatible telemetry.

### 5. Composable Interfaces

Primitives share common interfaces for interoperability.

---

## Testing

Each primitive includes comprehensive tests:

```bash
# Run tests for a specific primitive
npx vitest run primitives/rate-limiter/

# Run all primitive tests
npx vitest run primitives/
```

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Detailed architecture plan
- [fsx/CLAUDE.md](./fsx/CLAUDE.md) - Filesystem primitive
- [bashx/CLAUDE.md](./bashx/CLAUDE.md) - Shell primitive
- [npmx/CLAUDE.md](./npmx/CLAUDE.md) - Package manager primitive
- [pyx/CLAUDE.md](./pyx/CLAUDE.md) - Python primitive
- [gitx/CLAUDE.md](./gitx/CLAUDE.md) - Git primitive
