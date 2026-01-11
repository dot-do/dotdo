# SPIKE Results: libSQL/Turso in Cloudflare Workers (workerd)

**Issue:** `dotdo-a4pgw`
**Date:** 2026-01-11
**Decision:** GO - libSQL works in workerd with @libsql/client/web

## Executive Summary

libSQL (Turso) is **fully compatible** with Cloudflare Workers using the `@libsql/client/web` subpath import. This enables stateless DOs to externalize state to Turso cloud with acceptable latency.

## Key Findings

### Q1: Can @libsql/client run in workerd?

**Answer: YES (with web subpath)**

```typescript
// CRITICAL: Must use /web subpath for Workers compatibility
import { createClient } from '@libsql/client/web'

const client = createClient({
  url: env.TURSO_URL,      // libsql://*.turso.io or https://*.turso.io
  authToken: env.TURSO_TOKEN,
})
```

The default `@libsql/client` import includes Node.js native bindings that fail in workerd. The `/web` subpath uses pure HTTP/WebSocket transport.

### Q2: Protocol Support

| Protocol | Transport | Use Case |
|----------|-----------|----------|
| `libsql://` | WebSocket (Hrana) | Preferred - lower latency for multiple queries |
| `https://` | HTTP (fetch-based) | Fallback - simpler, works everywhere |

Both protocols work in Workers. Hrana (WebSocket) is recommended for DOs with multiple queries per request.

### Q3: Connection Latency

From benchmark results (simulated edge conditions):

| Metric | Value |
|--------|-------|
| Cold connect | ~55-60ms |
| Warm query (P50) | ~15-20ms |
| Warm query (P99) | ~90-100ms |

**Note:** Real-world latency depends on proximity to Turso regions.

### Q4: Memory Footprint

Estimated ~12KB per connection:
- URL string: ~200 bytes
- Auth token: ~100 bytes
- HTTP client state: ~1KB
- Response buffers: ~10KB typical
- Promise queues: ~500 bytes

Workers have 128MB limit, so this supports many concurrent connections.

### Q5: Concurrent Connections

The web client supports parallel queries:

```typescript
// Parallel queries work correctly
const [users, orders, metrics] = await Promise.all([
  db.execute('SELECT * FROM users WHERE id = ?', [userId]),
  db.execute('SELECT * FROM orders WHERE user_id = ?', [userId]),
  db.execute('SELECT COUNT(*) FROM metrics'),
])
```

## Integration Pattern for Stateless DOs

```typescript
import { createClient, type Client } from '@libsql/client/web'

export class StatelessDO implements DurableObject {
  private db: Client

  constructor(state: DurableObjectState, env: Env) {
    this.db = createClient({
      url: env.TURSO_URL,
      authToken: env.TURSO_TOKEN,
    })
  }

  async fetch(request: Request): Promise<Response> {
    // State is loaded on-demand from libSQL
    const doId = new URL(request.url).pathname.split('/')[1]

    const result = await this.db.execute({
      sql: 'SELECT state FROM do_state WHERE id = ?',
      args: [doId],
    })

    const state = JSON.parse(result.rows[0]?.state ?? '{}')
    // Process request with state...
  }
}
```

## Verified API Surface

| Method | Works | Notes |
|--------|-------|-------|
| `createClient()` | Yes | Use /web import |
| `client.execute()` | Yes | Single queries |
| `client.batch()` | Yes | Multiple queries in one round-trip |
| `client.transaction()` | Yes | ACID transactions |
| `client.close()` | Yes | Cleanup |
| Custom fetch | Yes | Can pass custom fetch implementation |

## Files Created

| File | Purpose |
|------|---------|
| `db/spikes/libsql-worker-poc.ts` | POC implementation |
| `db/spikes/libsql-workerd-verify.ts` | Standalone verification worker |
| `db/spikes/libsql-workerd-spike-results.md` | This document |

## Recommendation

**GO** - Proceed with libSQL/Turso as the hot state storage layer for stateless DOs.

### Production Checklist

- [ ] Use `@libsql/client/web` import (not default)
- [ ] Use `libsql://` protocol for WebSocket efficiency
- [ ] Implement connection caching within DO lifecycle
- [ ] Add retry logic for transient failures
- [ ] Monitor query latency with Workers Analytics

## References

- [Cloudflare + Turso Tutorial](https://developers.cloudflare.com/workers/tutorials/connect-to-turso-using-workers/)
- [@libsql/client npm](https://www.npmjs.com/package/@libsql/client)
- [Turso Documentation](https://docs.turso.tech/)
