# ratelimit.example.com.ai

Rate limiting at the edge with microsecond performance.

## The Problem

Your API is getting hammered. Traditional rate limiting requires external Redis, network round-trips on every request, and complex sliding window math.

## The Solution

dotdo's L0 InMemory layer keeps counters in DO memory with O(1) reads. No external services. Microsecond checks at the edge.

```
Request → DO → InMemory Check → Response
              ↓ (exceeded)
         $.on.RateLimit.exceeded
```

## Quick Start

```typescript
import { DO } from 'dotdo'

class RateLimitDO extends DO {
  private windows = new Map<string, { count: number; start: number }>()

  check(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now()
    const window = this.windows.get(key)

    if (!window || now - window.start >= windowMs) {
      this.windows.set(key, { count: 1, start: now })
      return true
    }

    if (window.count >= limit) {
      this.$.send('RateLimit.exceeded', { key, limit, windowMs })
      return false
    }

    window.count++
    return true
  }
}
```

## Sliding Window Algorithm

Fixed windows have edge cases - 100 requests at 11:59:59 and 100 more at 12:00:01. Sliding windows fix this:

```typescript
class SlidingWindowLimiter {
  private windows = new Map<string, { prev: number; curr: number; start: number }>()

  check(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now()
    const w = this.windows.get(key) ?? { prev: 0, curr: 0, start: now }
    const elapsed = now - w.start

    if (elapsed >= windowMs) {
      w.prev = w.curr
      w.curr = 0
      w.start = now - (elapsed % windowMs)
    }

    // Weighted count from previous window + current
    const weight = 1 - (elapsed % windowMs) / windowMs
    const count = w.prev * weight + w.curr

    if (count >= limit) return false

    w.curr++
    this.windows.set(key, w)
    return true
  }
}
```

## Per-Key Configuration

```typescript
const limits = {
  'user:free': { requests: 100, windowMs: 60_000 },
  'user:pro': { requests: 1000, windowMs: 60_000 },
  'ip:anon': { requests: 20, windowMs: 60_000 },
  'apikey:default': { requests: 500, windowMs: 60_000 },
}

class RateLimitDO extends DO {
  private limiter = new SlidingWindowLimiter()

  checkRequest(req: Request): Response | null {
    const key = this.getKey(req)
    const config = this.getConfig(req)

    if (!this.limiter.check(key, config.requests, config.windowMs)) {
      return new Response('Rate limit exceeded', {
        status: 429,
        headers: { 'Retry-After': String(config.windowMs / 1000) },
      })
    }
    return null
  }

  private getKey(req: Request): string {
    const apiKey = req.headers.get('X-API-Key')
    const userId = req.headers.get('X-User-ID')
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
    return apiKey ? `apikey:${apiKey}` : userId ? `user:${userId}` : `ip:${ip}`
  }
}
```

## Event Handling

React to violations with `$.on.RateLimit.exceeded`:

```typescript
class RateLimitDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    this.$.on.RateLimit.exceeded(async ({ data }) => {
      console.log(`Rate limit exceeded: ${data.key}`)

      const violations = this.trackViolation(data.key)
      if (violations > 10) {
        this.$.send('Security.suspiciousActivity', { key: data.key, violations })
      }
    })

    this.$.on.Security.suspiciousActivity(async ({ data }) => {
      if (data.key.startsWith('ip:')) {
        this.blocked.add(data.key)
      }
    })
  }
}
```

## Full Example

```typescript
import { DO } from 'dotdo'

export class RateLimitDO extends DO {
  private limiter = new SlidingWindowLimiter()
  private blocked = new Set<string>()

  async fetch(request: Request): Promise<Response> {
    const key = this.getKey(request)

    if (this.blocked.has(key)) {
      return new Response('Blocked', { status: 403 })
    }

    const config = this.getConfig(request)
    if (!this.limiter.check(key, config.requests, config.windowMs)) {
      this.$.send('RateLimit.exceeded', { key, ...config })
      return new Response('Too Many Requests', { status: 429 })
    }

    return this.handleRequest(request)
  }
}
```

## Why It Works

| Layer | Role | Latency |
|-------|------|---------|
| L0 InMemory | Counter storage | ~1us |
| L1 Pipeline | Event durability | ~10us |
| DO Locality | No network hops | 0ms |

Traditional rate limiting adds 1-10ms per request for Redis lookups. dotdo keeps everything in-memory at the edge.

## Deploy

```bash
npm run deploy
```

Your API is protected. Counters live in DO memory. Checks take microseconds. Events fire on violations.
