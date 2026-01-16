# Examples Deployment Guide

This document describes how to deploy and manage examples at `example.org.ai`.

## Architecture Overview

Examples are **NOT separate worker deployments**. They are namespaces within the main `DOFull` Durable Object, accessible via subdomains:

```
crm.example.org.ai      -> DOFull('crm')
redis.example.org.ai    -> DOFull('redis')
chat.example.org.ai     -> DOFull('chat')
workflow.example.org.ai -> DOFull('workflow')
...
```

The worker entry point (`objects/index.ts`) extracts the namespace from the hostname:

```typescript
const hostParts = url.hostname.split('.')
const ns = hostParts.length > 2 ? hostParts[0] : 'default'
const stub = env.DOFull.get(env.DOFull.idFromName(ns))
return stub.fetch(request)
```

## Directory Structure

```
examples/
├── DEPLOYMENT.md                    # This file
├── minimal/                         # Standalone deployable example
│   ├── src/index.ts
│   └── wrangler.toml
├── crm.example.org.ai/             # Namespace example (README only)
│   └── README.md
├── redis.example.org.ai/
│   └── README.md
├── chat.example.org.ai/
│   └── README.md
└── ... (30 total examples)
```

## Example Types

### 1. Namespace Examples (*.example.org.ai/)

These are documentation-only. They demonstrate how to use `DOFull` features via a specific subdomain. Each folder contains:

- `README.md` - Documentation with code examples, API usage, and architecture diagrams

No deployment needed - they're served by the main `DOFull` worker.

### 2. Standalone Examples (e.g., minimal/)

Self-contained workers with their own `wrangler.toml`. These are for learning/development:

```bash
cd examples/minimal
npm install
npm run dev      # Local development
npm run deploy   # Deploy to workers.dev
```

## Deployment

### Prerequisites

1. **Cloudflare Account** with `example.org.ai` zone configured
2. **Wrangler authenticated**: `wrangler login`
3. **DNS configured** for `example.org.ai`:
   - Wildcard CNAME: `*.example.org.ai -> workers.dev`
   - Or proxied A record pointing to Cloudflare

### Deploy to example.org.ai

Deploy using the examples-specific wrangler config:

```bash
# From repository root
wrangler deploy --config wrangler.examples.jsonc
```

This deploys the main `DOFull` worker with routes for `*.example.org.ai`.

### Verify Deployment

```bash
# Health check
curl https://crm.example.org.ai/health
curl https://redis.example.org.ai/health

# Run E2E tests
EXAMPLES_DOMAIN=example.org.ai npm run test:e2e
```

## Configuration Files

| File | Purpose |
|------|---------|
| `wrangler.jsonc` | Main dotdo-v2 deployment (api.dotdo.dev) |
| `wrangler.examples.jsonc` | Examples deployment (*.example.org.ai) |
| `wrangler.static.jsonc` | Docs static site (docs.dotdo.dev) |

## DNS Setup

For `example.org.ai` to work, configure DNS in Cloudflare dashboard:

1. Add zone `example.org.ai`
2. Create DNS records:

```
Type    Name    Content                 Proxy
CNAME   *       dotdo-examples.workers.dev   Proxied
CNAME   @       dotdo-examples.workers.dev   Proxied
```

Or use Workers Routes in the Cloudflare dashboard:
- Pattern: `*.example.org.ai/*`
- Worker: `dotdo-examples`

## Current Examples (30)

| Subdomain | Category | Description |
|-----------|----------|-------------|
| `crm` | Application | Multi-tenant CRM with semantic primitives |
| `redis` | Compatibility | Redis-compatible cache and pub/sub |
| `chat` | Real-time | Chat rooms with WebSocket streaming |
| `workflow` | Events | Event-driven workflow automation |
| `pipeline` | Streaming | Event pipeline with L0-L3 storage |
| `cron` | Scheduling | Cron-like scheduled tasks |
| `agents` | AI | Agent SDK demonstration |
| `ai` | AI | LLM template literals and routing |
| `analytics` | Data | Real-time analytics aggregation |
| `blog` | Content | Content management with versioning |
| `docs` | Content | Documentation with search |
| `forms` | Input | Form builder and submissions |
| `game` | Real-time | Multiplayer game state |
| `iceberg` | Storage | Cold storage with Apache Iceberg |
| `invoices` | Application | Invoice generation and tracking |
| `kafka` | Compatibility | Kafka-compatible message streaming |
| `kanban` | Application | Kanban board with drag-drop |
| `marketplace` | Application | Multi-vendor marketplace |
| `mongo` | Compatibility | MongoDB-compatible document store |
| `notes` | Application | Note-taking with collaboration |
| `postgres` | Compatibility | PostgreSQL-compatible queries |
| `queue` | Messaging | Job queue with priorities |
| `ratelimit` | Infrastructure | Rate limiting primitives |
| `saas` | Application | Multi-tenant SaaS boilerplate |
| `shop` | Application | E-commerce with inventory |
| `sqlite` | Storage | Raw SQLite access patterns |
| `stream` | Real-time | Event streaming with cursors |
| `support` | Application | Support ticket system |
| `wiki` | Content | Wiki with revision history |

## Testing

### Local Testing

```bash
# Start local dev server
npm run dev

# In another terminal, test with host header
curl -H "Host: crm.example.org.ai" http://localhost:8787/health
```

### E2E Testing

```bash
# Test deployed examples
EXAMPLES_DOMAIN=example.org.ai npm run test:e2e

# Or run specific example tests
npx vitest run tests/e2e/examples.e2e.test.ts -t "crm"
```

## Adding New Examples

1. Create directory: `examples/{name}.example.org.ai/`
2. Add `README.md` with:
   - Problem description
   - Solution overview
   - Data model
   - Code examples
   - API documentation
3. Example is automatically available at `{name}.example.org.ai` after deploy

## Troubleshooting

### "DNS resolution failed"

Ensure DNS is configured:
```bash
dig crm.example.org.ai
```

Should return Cloudflare proxy IPs.

### "Worker not found"

Verify deployment:
```bash
wrangler deployments list --config wrangler.examples.jsonc
```

### "404 on subdomain"

Check the worker is receiving the request:
```bash
wrangler tail --config wrangler.examples.jsonc
```

Then access the subdomain and watch logs.

## Security Considerations

- Each namespace is isolated within its own DO instance
- No cross-namespace data access without explicit configuration
- Rate limiting applied via `RATE_LIMITER` binding
- OAuth available via `OAUTH_KV` for protected endpoints

## Cost Optimization

All examples share:
- Same worker deployment (no per-example worker costs)
- Same DO class definitions
- Same R2 bucket for cold storage
- Same Pipeline for event streaming

Storage costs scale per-namespace based on actual usage.
