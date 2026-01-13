# lib/ - Core Library Modules

This directory contains reusable library modules for the dotdo platform. These modules provide foundational capabilities that are used across Durable Objects, workflows, and the API layer.

## Directory Structure

```
lib/
├── agent/           # Agent tools (bash, edit, glob, grep, read, write)
├── ai/              # AI gateway and tool loop agent
├── auth/            # JWT storage claims and authentication
├── browse/          # Browser automation abstraction
├── cache/           # Cache visibility and utilities
├── capabilities/    # DO capability mixins (fs, git, bash, npm)
├── channels/        # Multi-channel notification adapters
├── cloudflare/      # Cloudflare binding wrappers (KV, R2, Queues, AI, etc.)
├── colo/            # Colocation detection and caching
├── errors/          # DOError hierarchy with HTTP status mapping
├── executors/       # Function executors (Code, Generative, Agentic, Human)
├── flags/           # Feature flag store
├── functions/       # Function registry and composition
├── human/           # Human channel factory and workflows
├── humans/          # Human escalation primitives (humans.do)
├── iterators/       # Async iteration and aggregation utilities
├── logging/         # Structured logging infrastructure
├── namespace/       # Namespace resolution
├── okrs/            # OKR definitions and prebuilt metrics
├── pagination/      # Pagination utilities
├── payments/        # Invoice and metering utilities
├── pricing/         # Pricing models (outcome, credit, activity, seat)
├── rate-limit/      # Rate limiting utilities
├── response/        # Response builders (collection, linked-data, URLs)
├── rpc/             # RPC binding architecture
├── sandbox/         # Miniflare sandbox utilities
├── sql/             # SQL parser abstraction
├── storage/         # Authorized R2, chunked uploads, presigned URLs
├── support/         # AI-driven customer support system
├── tools/           # Tool adapters and permissions
├── utils/           # General utilities
├── validation/      # Input validation and schema registry
├── vault/           # Secure credential storage
└── tests/           # Library-level tests
```

---

## Core Modules

### auto-wiring.ts

DO auto-wiring via reflection. Discovers public methods on DO subclasses and exposes them to SDK/RPC/MCP/REST/CLI transports.

#### Key Types

```typescript
interface ParameterInfo {
  name: string      // Parameter name (e.g., 'orderId')
  optional: boolean // Whether parameter has default or is marked optional
}

interface MethodSignature {
  name: string
  parameterCount: number
  parameters: ParameterInfo[]
  async: boolean
}

interface MethodMetadata {
  name: string
  description?: string
  parameters?: Record<string, { description?: string }>
  returns?: { description?: string }
  throws?: string[]
}

interface ExposedMethodInfo {
  name: string
  signature: MethodSignature
  metadata: MethodMetadata
}
```

#### Public API

```typescript
// Get list of exposed (public) method names
getExposedMethods(DOClass: Function): string[]

// Check if a method is exposed
isExposed(DOClass: Function, methodName: string): boolean

// Get method signature with parameter info
getMethodSignature(DOClass: Function, methodName: string): MethodSignature | undefined

// Get method metadata with descriptions
getMethodMetadata(DOClass: Function, methodName: string): MethodMetadata | undefined
```

#### Usage

```typescript
import { getExposedMethods, getMethodSignature } from 'lib/auto-wiring'

class OrderDO extends DO {
  async createOrder(customerId: string, items: OrderItem[]): Promise<Order> { ... }
  async cancelOrder(orderId: string): Promise<void> { ... }
  private _internalMethod(): void { ... } // Not exposed
}

const methods = getExposedMethods(OrderDO)
// ['createOrder', 'cancelOrder']

const sig = getMethodSignature(OrderDO, 'createOrder')
// { name: 'createOrder', parameterCount: 2, parameters: [...], async: true }
```

---

### capabilities.ts

Capability lazy loading system. Provides lazy loading of capability modules that are loaded on first access.

#### Key Types

```typescript
type CapabilityModule = new (...args: unknown[]) => unknown
type CapabilityFactory = () => Promise<unknown>

interface CapabilityOptions {
  force?: boolean       // Re-register even if exists
  passContext?: boolean // Pass registry to constructor
}

interface CapabilityProxyOptions {
  reservedNames?: string[] // Names that return undefined instead of throwing
}

interface DestroyResult {
  errors: Array<{ capability: string; error: Error }>
}
```

#### CapabilityError

```typescript
class CapabilityError extends Error {
  capability: string
  reason: 'not_available' | 'permission_denied' | 'load_failed'
}
```

#### CapabilityRegistry Class

```typescript
class CapabilityRegistry {
  // Register a module constructor
  register(name: string, module: CapabilityModule, options?: CapabilityOptions): void

  // Register an async factory
  registerFactory(name: string, factory: CapabilityFactory, options?: CapabilityOptions): void

  // Unregister a capability
  unregister(name: string): boolean

  // Check if registered
  has(name: string): boolean

  // List all registered names
  list(): string[]

  // Check if loaded (instantiated)
  isLoaded(name: string): boolean

  // Get instance (lazy loads if needed)
  get(name: string): unknown

  // Cleanup all instances
  async destroy(): Promise<DestroyResult>
}
```

#### Usage

```typescript
import { CapabilityRegistry, createCapabilityProxy } from 'lib/capabilities'

const registry = new CapabilityRegistry()

// Register a module
registry.register('fs', FsCapability)

// Register an async factory
registry.registerFactory('db', async () => {
  const client = new DbClient()
  await client.connect()
  return client
})

// Access via proxy
const proxy = createCapabilityProxy(registry)
const fs = proxy.fs // Lazily loads FsCapability
```

---

### StateStorage.ts

Type-safe wrapper around Durable Object state API with batch operations, transactions, schema validation, versioning, TTL, and key prefixing.

#### Key Types

```typescript
type Validator<T> = (value: unknown) => value is T
type MigrationFn<T> = (data: unknown) => T
type Migrations = Record<string, Record<number, MigrationFn>>

interface ValueMetadata {
  version?: number
  createdAt: number
  updatedAt: number
  expiresAt?: number
}

interface StateStorageOptions {
  prefix?: string           // Key prefix for namespacing
  defaultTTL?: number       // Default TTL in milliseconds
  maxValueSize?: number     // Max value size in bytes
  versioned?: boolean       // Enable versioning
  version?: number          // Current schema version
  validators?: Validators   // Validation functions by key
  validateOnGet?: boolean   // Validate on retrieval
  migrations?: Migrations   // Migration functions
}

interface SetOptions {
  ttl?: number
  warnOnLargeValue?: boolean
  largeValueThreshold?: number
}

interface TransactionContext {
  get<T>(key: string, defaultValue?: T): Promise<T | undefined>
  set<T>(key: string, value: T, options?: SetOptions): Promise<void>
  delete(key: string): Promise<boolean>
  has(key: string): Promise<boolean>
}
```

#### Error Classes

```typescript
class StateStorageError extends Error {
  key?: string
  operation: string
}

class StateValidationError extends StateStorageError {
  validatorKey: string
}

class StateMigrationError extends StateStorageError {
  fromVersion: number
  toVersion: number
}
```

#### StateStorage Class

```typescript
class StateStorage {
  constructor(state: DurableObjectState, options?: StateStorageOptions)

  // Basic operations
  async get<T>(key: string, defaultValue?: T): Promise<T | undefined>
  async set<T>(key: string, value: T, options?: SetOptions): Promise<void>
  async delete(key: string): Promise<boolean>
  async has(key: string): Promise<boolean>

  // Batch operations
  async getMany<T>(keys: string[]): Promise<Record<string, T | undefined>>
  async setMany(values: Record<string, unknown>, options?: SetOptions): Promise<void>
  async deleteMany(keys: string[]): Promise<number>
  async list<T>(options?: ListOptions): Promise<Map<string, T>>
  async keys(options?: ListOptions): Promise<string[]>
  async count(options?: ListOptions): Promise<number>
  async clear(options?: ClearOptions): Promise<void>

  // Transactions
  async transaction<T>(closure: (tx: TransactionContext) => Promise<T>): Promise<T>

  // Metadata
  async getMetadata(key: string): Promise<ValueMetadata | undefined>
  async getStats(): Promise<StorageStats>
}
```

#### Usage

```typescript
import { StateStorage } from 'lib/StateStorage'

const storage = new StateStorage(state, {
  prefix: 'orders:',
  versioned: true,
  version: 2,
  migrations: {
    'order': {
      1: (data) => ({ ...data, currency: 'USD' })
    }
  }
})

// Basic operations
await storage.set('order-123', { id: '123', items: [] })
const order = await storage.get<Order>('order-123')

// With TTL
await storage.set('session', { userId: '456' }, { ttl: 3600000 })

// Transactions
await storage.transaction(async (tx) => {
  const balance = await tx.get<number>('balance', 0)
  await tx.set('balance', balance - 100)
})
```

---

### identity.ts

Identity and authentication utilities for DO identifiers.

#### Key Types

```typescript
interface ParsedDoId {
  namespace?: string
  type: string
  id: string
  subPath?: string
}

interface BuildDoIdOptions {
  namespace?: string
  type: string
  id: string
}

interface ResolveIdResult {
  DOClass: DOClass
  bindingName: string
  doIdString: string
  lookupKey: string
}
```

#### Public API

```typescript
// Parse a DO ID into components
// Formats: "Type/id", "https://namespace/Type/id", "Type/id/SubType/subId"
parseDoId(doId: string, registry?: TypeRegistry): ParsedDoId

// Build a DO ID from components
buildDoId(options: BuildDoIdOptions): string

// Resolve a DO ID to class and binding info
resolveId(doId: string, registry: TypeRegistry, env: Env): Promise<ResolveIdResult>
```

#### Usage

```typescript
import { parseDoId, buildDoId } from 'lib/identity'

const ref = parseDoId('https://acme.api.do/Customer/alice')
// { namespace: 'https://acme.api.do', type: 'Customer', id: 'alice' }

const id = buildDoId({ namespace: 'https://api.do', type: 'Order', id: 'ord-123' })
// 'https://api.do/Order/ord-123'
```

---

### DOAuth.ts

Authentication capability for Durable Objects with Hono-based auth routes, OAuth federation, and session management.

#### Key Types

```typescript
interface DOAuthConfig {
  federate?: boolean          // Federate to parent DO (default: true)
  federateTo?: string         // Federation URL (default: 'https://id.org.ai')
  providers?: Record<string, ProviderConfig>
  oauthProvider?: { enabled: boolean; loginPage?: string; consentPage?: string }
  oauthProxy?: { enabled: boolean }
  organization?: { enabled: boolean; allowUserToCreateOrganization?: boolean }
  jwtSecret?: string
  jwksUrl?: string
  cookieName?: string
  publicPaths?: string[]
  validateSession?: (token: string) => Promise<SessionData | null>
  sessionCache?: KVNamespace
}

interface DOAuthContext {
  userId: string
  email?: string
  role: 'admin' | 'user'
  permissions?: string[]
  method: 'jwt' | 'session' | 'apikey'
  activeOrganizationId?: string
}
```

#### DOAuth Class

```typescript
class DOAuth {
  constructor(doInstance: DO, config?: DOAuthConfig)

  // Handle auth routes (/api/auth/*)
  async handle(request: Request): Promise<Response | null>

  // Create middleware
  createMiddleware(): MiddlewareHandler
  requireAuth(): MiddlewareHandler
  requireRole(role: 'admin' | 'user'): MiddlewareHandler

  // Context getters
  getAuth(c: HonoContext): DOAuthContext | undefined
  getUser(c: HonoContext): { id: string; email?: string; role: string } | undefined
  getSession(c: HonoContext): SessionData | undefined
  isAuthenticated(c: HonoContext): boolean
  hasRole(c: HonoContext, role: 'admin' | 'user'): boolean
  hasPermission(c: HonoContext, permission: string): boolean

  // Configuration
  updateConfig(config: Partial<DOAuthConfig>): void
  getConfig(): Readonly<DOAuthConfig>
}

// Factory function
createDOAuth(doInstance: DO, config?: DOAuthConfig): DOAuth
```

#### Usage

```typescript
import { DOAuth } from 'lib/DOAuth'

class MyDO extends DO {
  private auth = new DOAuth(this, {
    federate: true,
    federateTo: 'https://id.org.ai',
  })

  async fetch(request: Request): Promise<Response> {
    const authResponse = await this.auth.handle(request)
    if (authResponse) return authResponse
    return super.fetch(request)
  }
}
```

---

## Cloudflare Integrations

### cloudflare/

Typed wrappers for Cloudflare bindings with enhanced functionality.

#### KV Store

```typescript
import { createKVStore, KVStore } from 'lib/cloudflare'

const store = createKVStore(env.KV, { namespace: 'tenant-123' })

// Basic operations with TTL helpers
await store.set('key', { data: 'value' }, { ttl: store.ttl.hours(1) })
const value = await store.get('key')

// Session management
await store.setSession('sess-abc', { userId: 'user-123' }, store.ttl.days(7))

// Rate limiting
const result = await store.checkRateLimit('user:123:api', 100, store.ttl.minutes(1))
if (!result.allowed) throw new Error('Rate limit exceeded')

// Caching expensive operations
const data = await store.cache('expensive-result', async () => {
  return await computeExpensiveResult()
}, { ttl: store.ttl.minutes(5) })
```

#### R2 Object Storage

```typescript
import { createR2Store, buildPath, parsePath } from 'lib/cloudflare'

const r2 = createR2Store(env.BUCKET, { prefix: 'uploads' })
await r2.put('file.txt', content)
const object = await r2.get('file.txt')
```

#### Queues

```typescript
import {
  createQueueClient,
  createJobMessage,
  createEventMessage,
  processMessageBatch
} from 'lib/cloudflare'

const queue = createQueueClient(env.MY_QUEUE)
await queue.send(createJobMessage({ type: 'process', data: {...} }))
```

#### Workers AI

```typescript
import { createWorkersAI, createFastAI, createQualityAI } from 'lib/cloudflare'

const ai = createWorkersAI(env)
const response = await ai.generate('Hello, world!')

// Preset configurations
const fastAI = createFastAI(env)   // Optimized for speed
const qualityAI = createQualityAI(env) // Optimized for quality
```

#### Vectorize

```typescript
import { createVectorizeClient, createSemanticSearchClient } from 'lib/cloudflare'

const vectorize = createVectorizeClient(env)
await vectorize.upsert([{ id: 'doc-1', values: [...], metadata: {...} }])
const results = await vectorize.query({ values: [...], topK: 10 })
```

#### Workflows

```typescript
import { createWorkflowDefinition, SagaBuilder } from 'lib/cloudflare'

const workflow = createWorkflowDefinition('order-workflow')
  .step('validate', async (ctx) => {...})
  .step('process', async (ctx) => {...})
  .step('notify', async (ctx) => {...})
  .build()
```

---

## Communication Channels

### channels/

Multi-channel notification adapters for human-in-the-loop workflows.

#### Channel Types

```typescript
type ChannelType = 'slack' | 'discord' | 'email' | 'mdxui'

interface NotificationPayload {
  title: string
  body?: string
  actions?: Action[]
  priority?: 'low' | 'normal' | 'high' | 'urgent'
}

interface NotificationResult {
  messageId: string
  channel: ChannelType
  sentAt: Date
}
```

#### Channel Factory

```typescript
import { createChannel, channelRegistry } from 'lib/channels'

// Create channel instances
const slack = createChannel('slack', { webhookUrl: '...' })
const discord = createChannel('discord', { webhookUrl: '...' })
const email = createChannel('email', { apiKey: '...', from: '...' })
const mdxui = createChannel('mdxui', { userDO: env.USER_DO })
```

#### Slack BlockKit

```typescript
import { SlackBlockKitChannel, buildApprovalBlocks, buildFormBlocks } from 'lib/channels'

const slack = new SlackBlockKitChannel({ webhookUrl: '...' })
await slack.send({
  title: 'Approval Required',
  actions: ['Approve', 'Reject'],
})
```

#### Exactly-Once Delivery

```typescript
import { createExactlyOnceChannelDelivery } from 'lib/channels'

const delivery = createExactlyOnceChannelDelivery({
  storage: state.storage,
  channel: slack,
  retryPolicy: { maxAttempts: 3, backoff: 'exponential' }
})

await delivery.send(idempotencyKey, payload)
```

---

## Human-in-the-Loop

### humans/

Human escalation primitives exported as `humans.do`.

#### Role Templates

```typescript
import { ceo, legal, cfo, cto, hr, support, manager } from 'lib/humans'

// Template literal syntax for human escalation
const approved = await ceo`approve the partnership deal`
const reviewed = await legal`review contract ${contractId}`
const signedOff = await cfo`approve budget increase to ${amount}`
```

#### HumanFunction

```typescript
import { HumanFunction, HumanFunctionConfig } from 'lib/humans'

interface HumanFunctionConfig {
  trigger?: string    // Trigger condition expression
  role: string        // Role to route to
  sla?: string        // SLA duration string
  escalate?: string   // Escalation path
  notify?: string[]   // Notification channels
}

// Declarative configuration
escalation = this.HumanFunction({
  trigger: 'refund > $10000',
  role: 'senior-accountant',
  sla: '4 hours',
})
```

#### SLA Tracking

```typescript
import {
  calculateTimeToFirstResponse,
  calculateTimeToCompletion,
  checkSLABreach,
  getSLADeadlineForPriority
} from 'lib/humans'

const metrics = calculateTimeToFirstResponse(request)
const breach = checkSLABreach(request, config)
```

---

## Function Executors

### executors/

Function executors for different execution strategies.

#### Base Executor

```typescript
abstract class BaseFunctionExecutor<TOptions> {
  // Retry with configurable backoff
  protected async executeWithRetry<T>(
    fn: () => Promise<T>,
    config: RetryConfig,
    signal?: AbortSignal
  ): Promise<{ result: T; retryCount: number }>

  // Timeout handling
  protected async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    signal?: AbortSignal
  ): Promise<T>

  // Middleware pipeline
  use(middleware: ExecutionMiddleware): this
}
```

#### Error Classes

```typescript
class ExecutionTimeoutError extends Error
class ExecutionCancelledError extends Error
class ExecutionRetryExhaustedError extends Error
class ExecutionValidationError extends Error
```

#### Retry Configuration

```typescript
interface RetryConfig {
  maxAttempts: number
  delay: number
  backoff?: 'fixed' | 'exponential' | 'exponential-jitter' | 'linear'
  increment?: number
  maxDelay?: number
  retryIf?: (error: Error) => boolean
  retryOnTimeout?: boolean
  onRetry?: (info: { attempt: number; delay: number; error: Error }) => void
}
```

#### Executor Types

- **CodeFunctionExecutor** - Execute TypeScript/JavaScript code
- **GenerativeFunctionExecutor** - LLM-based generation
- **AgenticFunctionExecutor** - Multi-step agent with tools
- **HumanFunctionExecutor** - Human-in-the-loop workflows
- **CascadeExecutor** - Try multiple executors in sequence
- **ParallelStepExecutor** - Execute steps in parallel

---

## RPC Bindings

### rpc/

RPC binding architecture for capability modules running as separate Workers.

#### Core Classes

```typescript
import {
  RPCBinding,
  BindingRegistry,
  RPCBindingError,
  RPCTimeoutError,
  RPCNetworkError
} from 'lib/rpc'
```

#### Factory Functions

```typescript
import {
  createAIBinding,
  createKVBinding,
  createR2Binding,
  createD1Binding,
  createQueueBinding,
  createVectorizeBinding,
  createToolBinding,
  createUnifiedBinding,
  createCapabilityProxy
} from 'lib/rpc'

const ai = createAIBinding(env.AI_SERVICE)
const result = await ai.call('ai.generate', { prompt: 'Hello', temperature: 0.7 })

// Proxy pattern with auto-fallback
const proxy = createCapabilityProxy({
  binding: env.AI_SERVICE,
  fallback: {
    'ai.generate': async (params) => inlineImplementation(params)
  }
})
```

---

## Secure Storage

### vault/

WorkOS Vault-style credential storage with user isolation, TTL, and OAuth token management.

#### Key Types

```typescript
interface VaultCredential {
  key: string
  value: string
  metadata?: Record<string, unknown>
  expiresAt?: Date
  createdAt: Date
  updatedAt: Date
}

interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  tokenType: string
  expiresAt: Date
  scope?: string
}
```

#### VaultInstance API

```typescript
interface VaultInstance {
  get(key: string): Promise<VaultCredential | null>
  set(key: string, value: string, options?: VaultSetOptions): Promise<VaultCredential>
  delete(key: string): Promise<boolean>
  list(): Promise<string[]>
  has(key: string): Promise<boolean>
}
```

#### Usage

```typescript
import { createMockVaultContext } from 'lib/vault/store'

const $ = createMockVaultContext()

// Store a credential with TTL
await $.vault('user:123').set('api-key', 'sk-secret', { ttl: 3600 })

// Retrieve a credential
const cred = await $.vault('user:123').get('api-key')

// OAuth flow
const { redirectUrl, state } = await $.oauth.initiate({
  provider: 'google',
  clientId: '...',
  clientSecret: '...',
  scopes: ['email', 'profile'],
  redirectUri: '...'
})

const tokens = await $.oauth.callback(code, state)
const accessToken = await $.oauth.getAccessToken('user:123', 'google')
```

---

## Pricing Models

### pricing/

Pricing models for SaaS applications.

#### Model Types

```typescript
type PricingModel = 'outcome' | 'activity' | 'seat' | 'credit' | 'hybrid'
```

#### Outcome-Based Pricing

```typescript
import { createOutcomeTracker, calculateOutcomeCost } from 'lib/pricing'

const tracker = createOutcomeTracker({
  outcomes: {
    'conversion': { value: 10.00 },
    'signup': { value: 2.50 }
  }
})

await tracker.record({ type: 'conversion', metadata: {...} })
const summary = await tracker.getSummary()
```

#### Credit-Based Pricing

```typescript
import { createCreditAccount } from 'lib/pricing'

const account = createCreditAccount({
  initialBalance: 1000,
  topUpThreshold: 100,
  autoTopUp: { amount: 500, paymentMethodId: '...' }
})

const result = await account.consume(50, 'api-call')
const balance = await account.getBalance()
```

#### Activity-Based Pricing

```typescript
import { createActivityTracker, calculateActivityCost } from 'lib/pricing'

const tracker = createActivityTracker({
  metrics: {
    'api-calls': { rate: 0.001 },
    'storage-gb': { rate: 0.10 }
  }
})

await tracker.record('api-calls', 1)
```

#### Seat-Based Pricing

```typescript
import { createSeatManager } from 'lib/pricing'

const seats = createSeatManager({
  seatTypes: {
    'viewer': { price: 0 },
    'editor': { price: 10 },
    'admin': { price: 25 }
  },
  maxSeats: { viewer: -1, editor: 50, admin: 5 }
})

await seats.acquire('user-123', 'editor')
const status = await seats.getStatus()
```

---

## Logging

### logging/

Structured logging abstraction replacing console.log.

```typescript
import { createLogger, LogLevel, Logger } from 'lib/logging'

const logger = createLogger({
  name: 'my-service',
  level: LogLevel.INFO,
  context: { service: 'api', version: '1.0.0' }
})

logger.info('Request received', { requestId: 'req-123' })
// {"timestamp":"...","level":"info","name":"my-service","message":"Request received",...}

logger.error('Failed to process', { error: new Error('Connection failed') })

// Child loggers inherit context
const authLogger = logger.child({ component: 'auth' })
authLogger.info('User logged in', { userId: 123 })
```

---

## Iterators & Aggregators

### iterators/

Async iteration and aggregation utilities for memory-efficient streaming.

```typescript
import { iterate, collect, aggregate } from 'lib/iterators'

// Iterator - array to individual items
for await (const item of iterate([1, 2, 3])) {
  console.log(item)
}

// Aggregator - items to array
const items = await collect(asyncGenerator())

// Numeric aggregator
const stats = await aggregate.numeric(asyncGenerator())
console.log(stats.sum, stats.avg, stats.min, stats.max)
```

#### Backpressure-Aware Processing

```typescript
import { createBackpressureIterator } from 'lib/iterators'

const iterator = createBackpressureIterator(source, {
  highWaterMark: 100,
  lowWaterMark: 25
})
```

---

## OKRs

### okrs/

OKR (Objectives and Key Results) definitions and prebuilt metrics.

```typescript
import { defineOKR, defineMetric } from 'lib/okrs'
import { ProductOKRs, SaaSKRs, EngineeringOKRs } from 'lib/okrs'

const okr = defineOKR({
  objective: 'Launch MVP successfully',
  keyResults: [
    { metric: 'ActiveUsers', target: 1000, current: 500 },
    { metric: 'NPS', target: 50, current: 30 },
  ],
})

console.log(okr.progress())    // 0.55
console.log(okr.isComplete())  // false

// Prebuilt OKRs for common business functions
const productOKRs = ProductOKRs.featureAdoption({...})
const saasOKRs = SaaSKRs.mrr({...})
const engOKRs = EngineeringOKRs.buildVelocity({...})
```

---

## Support System

### support/

AI-driven customer support system.

```typescript
import { createChatBox, createRouter, createAITopicDetector } from 'lib/support'

const chatbox = createChatBox({
  agents: { default: myAgent },
  escalation: {
    triggers: [
      { type: 'keyword', value: 'urgent', escalateTo: 'human' },
      { type: 'sentiment', threshold: -0.5, escalateTo: 'human' }
    ]
  }
})

const session = await chatbox.startSession({ customerId: 'cust-123' })
const response = await session.sendMessage('I need help with my order')

// Topic-based routing
const router = createRouter({
  topics: {
    'billing': billingAgent,
    'technical': techAgent,
    'general': defaultAgent
  }
})

const route = await router.route(message)
```

---

## Response Builders

### response/

Response builders for collections and linked data.

```typescript
import { buildCollectionResponse } from 'lib/response/collection'

const response = buildCollectionResponse(
  [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }],
  100,
  {
    ns: 'https://headless.ly',
    type: 'Customer',
    pagination: { hasNext: true, after: 'bob' },
    facets: { sort: ['name', 'createdAt'] }
  }
)
// Returns JSON-LD style response with $context, $type, $id, links, actions, items
```

---

## Utility Modules

### sqids.ts

Short unique ID generation using Sqids algorithm with self-describing tags.

```typescript
import { sqids, Tag } from 'lib/sqids'

// Encode tag-value pairs
const id = sqids.encode([Tag.THING, 42, Tag.BRANCH, 7])

// Decode to self-describing object
const decoded = sqids.decode(id)
// { THING: 42, BRANCH: 7 }
```

### rate-limit.ts

Rate limiting wrapper for Cloudflare Rate Limit bindings.

```typescript
import { RateLimitWrapper } from 'lib/rate-limit'

const wrapper = new RateLimitWrapper(env.RATE_LIMIT_API)
const result = await wrapper.checkLimit('user:123')

if (!result.success) {
  // Rate limited
}

// Build composite keys
const key = wrapper.buildKey({ userId: '123', endpoint: '/api/users', action: 'create' })
// 'user:123:endpoint:/api/users:action:create'
```

### safe-stringify.ts

JSON stringify that handles circular references safely.

```typescript
import { safeStringify, serializeError } from 'lib/safe-stringify'

const json = safeStringify(objectWithCircularRef)
const errorObj = serializeError(new Error('Something went wrong'))
```

---

## Storage Utilities

### storage/

Advanced storage utilities for R2 with authorization, chunked uploads, and presigned URLs.

#### Authorized R2

```typescript
import { createAuthorizedR2 } from 'lib/storage/authorized-r2'

const r2 = createAuthorizedR2(env.BUCKET, {
  authorize: async (request) => {
    // Custom authorization logic
    return { allowed: true, userId: 'user-123' }
  }
})

await r2.put('file.txt', content)
```

#### Chunked Uploads

```typescript
import { ChunkedUploader, createMultipartUpload } from 'lib/storage/chunked-upload'

// For large file uploads (>100MB)
const uploader = new ChunkedUploader(bucket, {
  chunkSize: 10 * 1024 * 1024, // 10MB chunks
  maxConcurrency: 4
})

const result = await uploader.upload('large-file.zip', stream)
```

#### Presigned URLs

```typescript
import { generatePresignedUrl, verifyPresignedUrl } from 'lib/storage/presigned-urls'

// Generate a presigned URL for uploads
const uploadUrl = await generatePresignedUrl({
  bucket: env.BUCKET,
  key: 'uploads/file.pdf',
  method: 'PUT',
  expiresIn: 3600, // 1 hour
  secret: env.PRESIGN_SECRET
})

// Verify a presigned URL
const isValid = await verifyPresignedUrl(url, env.PRESIGN_SECRET)
```

---

## Tool Provider Infrastructure

### tools/

Provider tool adapter infrastructure for exposing compat SDKs as Tool Things.

#### Provider Adapter

```typescript
import { createProviderAdapter, ProviderRegistry, globalRegistry } from 'lib/tools'

// Create an adapter for a service
const adapter = createProviderAdapter({
  name: 'myservice',
  category: 'communication',
  credential: { type: 'api_key', envVar: 'MY_API_KEY' },
  tools: [
    {
      id: 'send',
      name: 'Send Message',
      description: 'Send a message',
      parameters: { type: 'object', properties: { to: { type: 'string' } } },
      handler: async (params, creds) => { /* ... */ },
    },
  ],
})

// Register with global registry
globalRegistry.register(adapter)

// Execute a tool
const result = await globalRegistry.execute('myservice', 'send', { to: 'user@example.com' })
```

#### Permission Enforcement

```typescript
import { checkToolPermission, PermissionDeniedError } from 'lib/tools'

// Check permissions before tool execution
const result = await checkToolPermission(executorId, toolId, graph)
if (!result.allowed) {
  throw new PermissionDeniedError(result.reason)
}
```

---

## Error Hierarchy

### errors/

Structured error classes for the dotdo runtime with HTTP status mapping.

```typescript
import {
  DOError,
  ValidationError,
  NotFoundError,
  AuthorizationError,
  TimeoutError,
  TransportError
} from 'lib/errors'

// Base error with code, message, and cause chaining
throw new DOError('INTERNAL_ERROR', 'Something went wrong', underlyingError)

// Specialized errors with appropriate HTTP status codes
throw new ValidationError('INVALID_INPUT', 'Email is required')  // 400
throw new NotFoundError('USER_NOT_FOUND', 'User does not exist') // 404
throw new AuthorizationError('ACCESS_DENIED', 'Insufficient permissions') // 403
throw new TimeoutError('OPERATION_TIMEOUT', 'Request timed out') // 408
throw new TransportError('RPC_FAILED', 'Service unavailable') // 502

// Serialize for logging/transport
const json = error.toJSON()
// { name: 'ValidationError', code: 'INVALID_INPUT', message: '...', cause?: {...} }
```

---

## DO Capabilities

### capabilities/

Durable Object capability mixins for extending DO functionality.

```typescript
import { withFs, withGit, withBash, withNpm } from 'lib/capabilities'

// Compose capabilities
class MyDO extends withGit(withFs(DO)) {
  async deploy() {
    await this.$.fs.write('/config.json', JSON.stringify(config))
    await this.$.git.add('.')
    await this.$.git.commit('chore: update config')
    await this.$.git.push()
  }
}

// Capability dependency chain:
// - withFs: Base filesystem (no dependencies)
// - withGit: Git operations (requires withFs)
// - withBash: Shell execution (requires withFs)
// - withNpm: Package management (requires withFs)
```

---

## Related Documentation

- [Agent System](/docs/agents/) - User-facing documentation for named agents and human escalation
- [Human Escalation](/docs/humans/escalation) - Triggers, roles, SLAs, and channels
- [Workflows](/docs/workflows/) - $ context DSL and workflow orchestration
- [SDK Reference](/docs/sdk/) - Full API reference for dotdo primitives
- [Architecture](/docs/architecture/) - System architecture and design decisions
