# Vercel Edge Deployment for dotdo

Deploy stateless Durable Objects to Vercel Edge Functions with Turso/libSQL for state persistence.

## Overview

This deployment adapter enables dotdo's stateless DO architecture to run on Vercel's Edge Runtime:

- **State**: Turso/libSQL (external, globally replicated)
- **Consistency**: ConsistencyGuard with fencing tokens
- **Routing**: Edge function with consistent hashing
- **Cold Start**: < 500ms (edge functions are fast)

## Prerequisites

1. **Turso Database**
   ```bash
   turso db create my-dotdo-db
   turso db tokens create my-dotdo-db
   ```

2. **Vercel CLI**
   ```bash
   npm i -g vercel
   ```

## Quick Start

### 1. Create Edge Function

Create `api/do.ts`:

```typescript
import { edgeRouter } from 'dotdo/deploy/vercel'
import { Business, Agent, Worker } from 'dotdo/objects'

export const config = {
  runtime: 'edge',
}

export default edgeRouter({
  classes: {
    Business,
    Agent,
    Worker,
  },
  defaultClass: Business,
})
```

### 2. Configure Environment

Set up Vercel secrets:

```bash
vercel secrets add turso_url "libsql://my-db-username.turso.io"
vercel secrets add turso_token "your-turso-auth-token"
```

### 3. Deploy

```bash
vercel deploy
```

## Configuration

### vercel.json

```json
{
  "functions": {
    "api/**/*.ts": {
      "runtime": "edge",
      "maxDuration": 30
    }
  },
  "rewrites": [
    {
      "source": "/do/:id/:path*",
      "destination": "/api/do?id=:id&path=:path*"
    }
  ],
  "env": {
    "TURSO_URL": "@turso_url",
    "TURSO_TOKEN": "@turso_token"
  },
  "regions": ["iad1", "sfo1", "cdg1", "hnd1", "syd1"]
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TURSO_URL` | Yes | Turso database URL |
| `TURSO_TOKEN` | Yes | Turso auth token |
| `ENABLE_CONSISTENCY_GUARD` | No | Enable lock coordination (default: true) |
| `LOCK_TTL_MS` | No | Lock TTL in milliseconds (default: 30000) |
| `DEBUG` | No | Enable debug logging (default: false) |

## URL Patterns

### Path-based routing (default)

```
GET /do/{id}/health
GET /do/{id}/things
POST /do/{id}/action
```

### Type + ID routing

```
GET /do/Business/acme-corp/health
GET /do/Agent/sales-bot/tasks
```

### Header-based routing

```bash
curl -H "X-DO-ID: acme-corp" \
     -H "X-DO-Type: Business" \
     https://your-app.vercel.app/api/do/health
```

## Middleware

Add middleware for common patterns:

```typescript
import {
  edgeRouter,
  corsMiddleware,
  loggingMiddleware,
  rateLimitMiddleware,
  authMiddleware,
} from 'dotdo/deploy/vercel'

export default edgeRouter({
  classes: { Business },
  middleware: [
    corsMiddleware({
      origins: ['https://app.example.com'],
    }),
    loggingMiddleware(),
    rateLimitMiddleware({
      limit: 100,
      window: 60000, // 1 minute
    }),
    authMiddleware({
      validate: async (token) => {
        // Validate JWT or API key
        return { valid: true, user: { id: 'user-123' } }
      },
    }),
  ],
})
```

## Local Development

### Using Vercel CLI

```bash
cd deploy/vercel
vercel dev
```

### Test requests

```bash
# Health check
curl http://localhost:3000/do/test-123/health

# Create a thing
curl -X POST http://localhost:3000/do/test-123/things \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Item", "type": "task"}'

# List things
curl http://localhost:3000/do/test-123/things
```

## Architecture

```
Request
   │
   ▼
Vercel Edge Function (global)
   │
   ├── Parse DO ID from path/header
   │
   ├── Select DO class
   │
   ▼
ConsistencyGuard (optional)
   │
   ├── Acquire lock (libSQL)
   │
   ├── Execute DO handler
   │
   ├── Release lock
   │
   ▼
Turso/libSQL (state)
   │
   └── Globally replicated
```

## Consistency Model

### With ConsistencyGuard (default)

- Single-writer guarantee per DO ID
- Fencing tokens prevent stale writes
- TTL-based lock expiry for crash recovery
- Safe for concurrent requests from multiple edge regions

### Without ConsistencyGuard

```bash
ENABLE_CONSISTENCY_GUARD=false
```

- Optimistic concurrency only
- Higher throughput
- Use when eventual consistency is acceptable

## Comparison: Cloudflare DO vs Vercel Edge

| Feature | Cloudflare DO | Vercel Edge |
|---------|--------------|-------------|
| Single instance | Native | Via ConsistencyGuard |
| State | In-memory + SQLite | External libSQL |
| Hibernation | Yes | No |
| Alarms | Yes | No (use external scheduler) |
| Cold start | ~0ms | < 500ms |
| Global routing | Anycast | CDN + rewrites |

## Limitations

1. **No Alarms**: Use external schedulers (Vercel Cron, Upstash) for scheduled tasks
2. **No Hibernation**: Edge functions restart on each request
3. **No WebSockets**: Use Vercel's Edge Config or external PubSub for real-time
4. **Lock Overhead**: ConsistencyGuard adds ~10-50ms per request

## Troubleshooting

### "Lock acquisition failed"

The DO is being accessed concurrently. Options:
- Increase `LOCK_TTL_MS`
- Enable lock waiting in handler
- Disable ConsistencyGuard if eventual consistency is OK

### "TURSO_URL is required"

Set environment variables:
```bash
vercel env add TURSO_URL
vercel env add TURSO_TOKEN
```

### High latency

1. Check Turso database region matches Vercel regions
2. Consider disabling ConsistencyGuard
3. Use read replicas for read-heavy workloads

## Migration from Cloudflare

1. Export state from DO SQLite
2. Import into Turso
3. Update imports:
   ```diff
   - import { DO } from 'dotdo'
   + import { DO } from 'dotdo/objects'
   ```
4. Deploy to Vercel

## Related

- [Turso Documentation](https://docs.turso.tech)
- [Vercel Edge Functions](https://vercel.com/docs/functions/edge-functions)
- [dotdo Documentation](https://dotdo.dev/docs)
