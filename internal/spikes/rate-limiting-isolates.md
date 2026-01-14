# Rate Limiting Across Isolates

**Issue:** dotdo-vbcnh
**Date:** 2026-01-13
**Author:** Research Spike
**Status:** COMPLETE

## Executive Summary

This spike analyzes distributed rate limiting strategies for V8 isolates in the dotdo platform. Isolates are ephemeral and share no memory, making traditional in-process rate limiting ineffective. We document **existing implementations** and provide **recommendations for ETL connector rate limiting**.

### Key Findings

| Finding | Impact |
|---------|--------|
| Comprehensive rate limiting primitives already exist | High - can leverage existing code |
| Multiple storage backends available (Memory, KV, DO, CF Binding) | High - production-ready options |
| Token bucket best for ETL burst scenarios | High - matches connector patterns |
| DO-coordinated limiting provides strong consistency | Medium - needed for cross-isolate coordination |

## Existing Rate Limiting Infrastructure

### 1. Primitives Library (`primitives/rate-limiter/`)

The codebase already contains a comprehensive rate limiting library with multiple algorithms:

```typescript
import {
  createRateLimiter,
  createTokenBucket,
  createLeakyBucket,
  createQuotaManager,
  DistributedRateLimiter,
} from 'dotdo/primitives/rate-limiter'
```

**Available Algorithms:**

| Algorithm | Class | Use Case | Memory | Burst Handling |
|-----------|-------|----------|--------|----------------|
| Fixed Window | `FixedWindow` | Simple rate limiting | Low | Allows boundary bursts |
| Sliding Window | `SlidingWindow` | Accurate limiting | Higher | No boundary issues |
| Token Bucket | `TokenBucket` | API rate limiting | Low | Controlled bursts |
| Leaky Bucket | `LeakyBucket` | Traffic shaping | Low | Smooth output |
| Distributed | `DistributedRateLimiter` | Multi-region | Varies | Local burst + global sync |
| Quota Manager | `QuotaManager` | Period-based limits | Low | N/A |

### 2. Storage Backends (`services/rpc/src/rate-limit.ts`)

Multiple storage implementations exist for different consistency requirements:

```typescript
// In-memory (development/testing)
class InMemoryRateLimitStore implements RateLimitStore

// Cloudflare KV (eventual consistency, global scale)
class KVRateLimitStore implements RateLimitStore

// Cloudflare Rate Limit binding (native, optimized)
class CloudflareRateLimitStore implements RateLimitStore

// Durable Object (strong consistency)
class DORateLimitStore implements RateLimitStore
```

### 3. RateLimitDO (`examples/compat-upstash/src/RateLimitDO.ts`)

A complete Durable Object implementation compatible with Upstash Ratelimit API:

```typescript
export class RateLimitDO extends DO {
  async fixedWindow(identifier: string, config: RateLimitConfig): Promise<LimitResponse>
  async slidingWindow(identifier: string, config: RateLimitConfig): Promise<LimitResponse>
  async tokenBucket(identifier: string, config: TokenBucketConfig): Promise<LimitResponse>
  async limit(identifier: string, options?: LimitOptions): Promise<LimitResponse>
  async reset(identifier: string): Promise<void>
}
```

### 4. Workflow Context API (`workflows/context/rate-limit.ts`)

Fluent API for rate limiting within workflow contexts:

```typescript
// Check and consume
const result = await $.rateLimit('user:123').check({ name: 'api', cost: 1 })

// Check without consuming
const allowed = await $.rateLimit('user:123').isAllowed({ name: 'api' })

// Get remaining quota
const remaining = await $.rateLimit('user:123').remaining({ name: 'api' })

// Configure named limits
$.rateLimits.configure('api', { limit: 100, window: '1m' })
```

### 5. Connector Framework Rate Limiting (`db/primitives/connector-framework/rate-limiting.ts`)

ETL-specific rate limiting with:
- Token bucket for request throttling
- Retry with exponential backoff
- Circuit breaker integration
- Rate limit header parsing (X-RateLimit-*)

```typescript
// Create rate limiter for external API
const limiter = createTokenBucketRateLimiter({
  maxTokens: 100,       // Burst capacity
  refillRate: 10,       // 10 requests/second
  refillInterval: 1000, // Refill every second
})

// Create retry executor with circuit breaker
const retry = createRetryWithBackoff({
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
  },
})
```

## Algorithm Analysis for ETL Connectors

### Token Bucket (Recommended for ETL)

**Why it fits ETL patterns:**
1. **Burst tolerance** - Initial sync can use accumulated tokens
2. **Steady-state rate** - Continuous sync respects API limits
3. **Configurable** - Can match specific API rate limits (e.g., Salesforce: 100 req/15min)

**Implementation:**
```typescript
// Salesforce connector rate limit
const sfLimiter = createTokenBucket({
  capacity: 100,        // Max burst (Salesforce limit)
  refillRate: 100/900,  // ~0.11 tokens/second (100 per 15 min)
  initialTokens: 100,   // Start with full capacity
})

// Before each API call
const allowed = await sfLimiter.tryConsume('salesforce:org123')
if (!allowed) {
  const state = await sfLimiter.getTokens('salesforce:org123')
  // Wait for tokens or queue the request
}
```

### Sliding Window (Alternative for Strict Limits)

**When to use:** APIs with strict per-window limits without burst tolerance.

```typescript
const limiter = createRateLimiter({
  requests: 1000,
  window: 3600000, // 1 hour
  strategy: 'sliding-window',
})
```

### Leaky Bucket (For Downstream Protection)

**When to use:** Protecting internal services from connector bursts.

```typescript
const internalLimiter = createLeakyBucket({
  capacity: 50,    // Queue size
  leakRate: 10,    // 10 requests/second drain
})
```

## Distributed Rate Limiting Patterns

### Pattern 1: Per-Connector DO Instance

Each connector gets a dedicated DO for rate limiting, ensuring strong consistency per external API.

```
┌─────────────┐     ┌─────────────────────┐     ┌──────────────┐
│  Worker 1   │────▶│  RateLimitDO:       │────▶│ External API │
│  (isolate)  │     │  salesforce:org123  │     │ (Salesforce) │
└─────────────┘     └─────────────────────┘     └──────────────┘
                              ▲
┌─────────────┐               │
│  Worker 2   │───────────────┘
│  (isolate)  │
└─────────────┘
```

**Implementation:**
```typescript
// In connector worker
async function callSalesforceAPI(orgId: string, operation: () => Promise<T>): Promise<T> {
  const limiter = ctx.env.RATE_LIMIT_DO.get(
    ctx.env.RATE_LIMIT_DO.idFromName(`salesforce:${orgId}`)
  )

  const result = await limiter.fetch('/limit', {
    method: 'POST',
    body: JSON.stringify({
      identifier: `api:${orgId}`,
      algorithm: 'tokenBucket',
      maxTokens: 100,
      refillRate: 0.11,
      refillInterval: 1000,
    }),
  })

  const { success, retryAfter } = await result.json()

  if (!success) {
    // Queue or wait
    await scheduler.scheduleAfter(retryAfter, operation)
    throw new RateLimitedError(retryAfter)
  }

  return operation()
}
```

### Pattern 2: Hierarchical Rate Limiting

Combine local burst tolerance with global coordination:

```
┌─────────────────────────────────────────────────────────────┐
│                    Global Rate Limit                         │
│               (DO: rate-limit:salesforce:global)            │
│                    1000 req/hour across all orgs            │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Per-Org Limit  │  │  Per-Org Limit  │  │  Per-Org Limit  │
│  org:abc        │  │  org:xyz        │  │  org:123        │
│  100 req/15min  │  │  100 req/15min  │  │  100 req/15min  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

**Implementation:**
```typescript
// Check both limits
async function checkHierarchicalLimit(orgId: string): Promise<boolean> {
  // Check global limit first (fail fast)
  const globalResult = await rateLimitDO('salesforce:global').limit({
    identifier: 'global',
    limit: 1000,
    window: 3600000, // 1 hour
  })

  if (!globalResult.success) return false

  // Check per-org limit
  const orgResult = await rateLimitDO(`salesforce:${orgId}`).limit({
    identifier: 'org',
    limit: 100,
    window: 900000, // 15 minutes
  })

  return orgResult.success
}
```

### Pattern 3: Local Burst + Async Sync

Use `DistributedRateLimiter` for local bursts with periodic global sync:

```typescript
const limiter = new DistributedRateLimiter(
  { requests: 1000, window: 60000 },
  {
    syncInterval: 1000,   // Sync every second
    localBurst: 10,       // Allow 10 requests before sync
    regionAware: true,    // Partition by region
  },
  new KVStorage(env.RATE_LIMITS),
  `node-${crypto.randomUUID()}`,
  ctx.cf.colo,
)
```

**Trade-offs:**
- Lower latency (local decisions)
- Eventual consistency (may briefly exceed global limit)
- Best for high-throughput scenarios where slight overrun is acceptable

## Connector-Specific Recommendations

### Salesforce

| Limit Type | Value | Strategy |
|------------|-------|----------|
| API requests | 100/15min (per org) | Token bucket with 15-min refill |
| Bulk API | 10 concurrent jobs | Concurrency limiter |
| Composite API | 25 subrequests | Request batching |

```typescript
// Recommended configuration
const salesforceConfig = {
  api: {
    algorithm: 'tokenBucket',
    maxTokens: 100,
    refillRate: 100 / 900, // ~0.11/sec
    refillInterval: 1000,
  },
  bulk: {
    concurrency: 10,
  },
}
```

### GitHub

| Limit Type | Value | Strategy |
|------------|-------|----------|
| REST API (authenticated) | 5000/hour | Token bucket |
| REST API (unauthenticated) | 60/hour | Strict sliding window |
| GraphQL | 5000 points/hour | Cost-based token bucket |

```typescript
// GitHub with cost-based limiting
const githubLimiter = createQuotaManager({
  hourly: 5000, // 5000 points per hour
})

// GraphQL query cost calculation
async function queryGraphQL(query: string, cost: number) {
  await githubLimiter.consume('github:user123', cost)
  return graphqlClient.query(query)
}
```

### Stripe

| Limit Type | Value | Strategy |
|------------|-------|----------|
| Live mode | 100/sec (burst: 200) | Token bucket with burst |
| Test mode | 25/sec | Simple token bucket |
| Read-after-write | Exponential backoff | Retry with backoff |

### Rate Limit Header Parsing

Parse external API rate limit headers to adapt dynamically:

```typescript
// From connector-framework/rate-limiting.ts
const info = parseRateLimitHeaders(response.headers)

if (info.remaining !== undefined && info.remaining < 10) {
  // Slow down requests
  await sleep(1000)
}

if (info.retryAfterSeconds) {
  // API told us to wait
  await sleep(info.retryAfterSeconds * 1000)
}
```

## Architecture Recommendations

### 1. Use Existing Primitives

The codebase already has production-ready rate limiting. Connectors should use:

```typescript
// For most connectors
import { createTokenBucket } from 'dotdo/primitives/rate-limiter'

// For DO-based strong consistency
import { RateLimitDO } from 'examples/compat-upstash/src/RateLimitDO'

// For workflow integration
import { createMockContext } from 'workflows/context/rate-limit'
```

### 2. Standard Connector Rate Limit Interface

Propose a standard interface for connector rate limiting:

```typescript
interface ConnectorRateLimiter {
  // Check if request is allowed
  acquire(cost?: number): Promise<{ allowed: boolean; retryAfter?: number }>

  // Get current status
  getStatus(): Promise<{ remaining: number; resetAt: Date }>

  // Wait for next available slot
  waitForToken(timeout?: number): Promise<void>

  // Parse response headers and update state
  updateFromResponse(headers: Headers): void
}
```

### 3. Rate Limit DO Naming Convention

```
rate-limit:{provider}:{scope}:{identifier}

Examples:
- rate-limit:salesforce:org:abc123
- rate-limit:github:user:octocat
- rate-limit:stripe:account:acct_123
- rate-limit:global:etl-pipeline
```

### 4. Monitoring and Alerting

Integrate rate limiting with observability:

```typescript
// Emit metrics on rate limit events
analytics.track({
  event: 'rate_limit_check',
  properties: {
    provider: 'salesforce',
    orgId: 'abc123',
    allowed: result.success,
    remaining: result.remaining,
    cost: requestCost,
  },
})

// Alert on sustained rate limiting
if (result.remaining === 0) {
  alerting.warn('Rate limit exhausted', {
    provider,
    identifier,
    resetAt: result.resetAt,
  })
}
```

## Implementation Checklist

For new connectors, implement rate limiting as follows:

- [ ] Identify API rate limits (check provider documentation)
- [ ] Choose algorithm (token bucket for burst-tolerant, sliding window for strict)
- [ ] Configure DO-based rate limiter for the provider
- [ ] Parse rate limit headers from responses
- [ ] Implement retry with exponential backoff
- [ ] Add circuit breaker for failure scenarios
- [ ] Emit rate limit metrics to observability
- [ ] Document rate limits in connector README

## Conclusion

The dotdo platform has **comprehensive rate limiting infrastructure** already in place. For ETL connectors:

1. **Use `TokenBucket`** for most external API rate limiting
2. **Use `DORateLimitStore`** when strong consistency is required across isolates
3. **Use `DistributedRateLimiter`** for high-throughput scenarios with local burst tolerance
4. **Parse rate limit headers** to adapt dynamically to API responses
5. **Integrate circuit breakers** for resilience against cascading failures

The connector framework already provides the building blocks; new connectors should leverage these existing primitives rather than implementing custom rate limiting.

## References

- `primitives/rate-limiter/` - Core rate limiting algorithms
- `db/primitives/connector-framework/rate-limiting.ts` - ETL-specific implementation
- `examples/compat-upstash/src/RateLimitDO.ts` - DO-based rate limiter
- `workflows/context/rate-limit.ts` - Workflow context API
- `services/rpc/src/rate-limit.ts` - Storage backends
- `tests/rate-limit/integration.test.ts` - Integration test patterns
