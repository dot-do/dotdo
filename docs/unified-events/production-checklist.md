# Production Deployment Checklist

A comprehensive checklist for deploying Unified Events to production. Follow each section methodically to ensure a secure, scalable, and observable deployment.

---

## Table of Contents

1. [Wrangler Configuration](#wrangler-configuration)
2. [Durable Object Bindings](#durable-object-bindings)
3. [R2 and Iceberg Setup](#r2-and-iceberg-setup)
4. [Authentication Setup](#authentication-setup)
5. [Monitoring and Alerting](#monitoring-and-alerting)
6. [Scaling Considerations](#scaling-considerations)
7. [Security Checklist](#security-checklist)
8. [Pre-Launch Verification](#pre-launch-verification)

---

## Wrangler Configuration

### Base Configuration

Ensure your `wrangler.jsonc` includes all required bindings:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "your-app-name",
  "main": "api/index.ts",
  "compatibility_date": "2026-01-08",
  "compatibility_flags": ["nodejs_compat"],

  // Required for SQL file imports
  "rules": [
    { "type": "Text", "globs": ["**/*.sql"] }
  ]
}
```

### Checklist

- [ ] **Compatibility date** is set to a recent date (within last 6 months)
- [ ] **`nodejs_compat`** flag is enabled if using Node.js APIs
- [ ] **SQL rules** are configured for schema file imports
- [ ] **Worker name** follows your naming convention (e.g., `myapp-prod`, `myapp-staging`)
- [ ] **Main entrypoint** points to correct file

### Environment-Specific Configuration

```jsonc
{
  "vars": {
    "ENVIRONMENT": "production"
  },
  "env": {
    "staging": {
      "vars": {
        "ENVIRONMENT": "staging"
      }
    },
    "dev": {
      "vars": {
        "ENVIRONMENT": "development"
      }
    }
  }
}
```

- [ ] Production environment variables defined
- [ ] Staging environment configured for pre-production testing
- [ ] Development environment configured for local testing

---

## Durable Object Bindings

### Required DO Configuration

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "DO",
        "class_name": "DO"
      },
      {
        "name": "EVENT_STREAM_DO",
        "class_name": "EventStreamDO"
      }
    ]
  },

  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["DO", "EventStreamDO"]
    }
  ]
}
```

### Checklist

- [ ] **DO binding** configured with correct class name
- [ ] **EventStreamDO binding** configured for real-time streaming
- [ ] **SQLite migrations** defined with appropriate tags
- [ ] **Migration versioning** follows semantic versioning (v1, v2, etc.)
- [ ] **Class names** match exported classes in code

### Migration Strategy

- [ ] Test migrations in staging before production
- [ ] Backup strategy defined for rollback scenarios
- [ ] Migration scripts tested with production-like data volumes

---

## R2 and Iceberg Setup

### R2 Bucket Configuration

```jsonc
{
  "r2_buckets": [
    {
      "binding": "R2",
      "bucket_name": "your-app-lake"
    },
    {
      "binding": "EVENTS_ICEBERG_BUCKET",
      "bucket_name": "events-iceberg"
    }
  ]
}
```

### Checklist

- [ ] **Primary R2 bucket** created and bound
- [ ] **Iceberg bucket** created for cold tier storage
- [ ] **Bucket naming** follows convention (e.g., `<app>-<env>-lake`)
- [ ] **CORS configuration** set if direct browser access needed
- [ ] **Lifecycle rules** configured for data retention

### Pipeline Configuration

```jsonc
{
  "pipelines": [
    {
      "pipeline": "unified_events",
      "binding": "UNIFIED_EVENTS_PIPELINE"
    }
  ]
}
```

- [ ] **Pipeline created** via `wrangler pipelines create unified_events`
- [ ] **Pipeline binding** matches configuration
- [ ] **Destination configured** (R2 Iceberg bucket)
- [ ] **Schema validated** against UnifiedEvent type

### Cold Tier Setup

- [ ] Iceberg table schema matches UnifiedEvent (165 columns)
- [ ] Partition strategy defined (by `day`, `event_type`, `ns`)
- [ ] Compaction schedule configured
- [ ] Data retention policy defined (e.g., 90 days hot, 1 year cold)

---

## Authentication Setup

### Secrets Configuration

Set production secrets via `wrangler secret put`:

```bash
# Authentication
wrangler secret put BETTER_AUTH_SECRET

# OAuth Providers
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# AI Providers
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY

# External Services
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

### Checklist

- [ ] **`BETTER_AUTH_SECRET`** generated with `openssl rand -base64 32`
- [ ] **OAuth credentials** configured for production domains
- [ ] **OAuth callback URLs** registered with providers
- [ ] **API keys** rotated and unique per environment
- [ ] **Secrets never in version control** (use `.env.example` as template)

### EventStreamDO Authentication

Configure authentication requirements in EventStreamDO:

```typescript
const config: EventStreamConfig = {
  requireAuth: true,          // Require authentication for connections
  tokenTTL: 3600,             // Token expiry in seconds (1 hour)
  rateLimit: {
    messagesPerSecond: 1000,  // Rate limit per connection
    burstSize: 1000           // Burst allowance
  }
}
```

- [ ] **`requireAuth: true`** enabled for production
- [ ] **Token TTL** configured appropriately
- [ ] **Rate limiting** configured per connection
- [ ] **Token validator** implemented for custom auth

### OAuth Domain Configuration

```typescript
const authConfig: AuthConfig = {
  authDomain: 'auth.yourdomain.com',
  allowedDomainPatterns: [
    '*.yourdomain.com',
    'yourdomain.com'
  ]
}
```

- [ ] **Auth domain** configured correctly
- [ ] **Allowed domain patterns** whitelist production domains
- [ ] **Open redirect prevention** tested

---

## Monitoring and Alerting

### Metrics Endpoints

EventStreamDO exposes metrics at `/metrics`:

```typescript
interface Metrics {
  activeConnections: number
  totalConnections: number
  messagesSent: number
  messagesPerSecond: number
  errorCount: number
  topicStats: Record<string, { subscribers: number }>
  latencyP50?: number
  latencyP95?: number
  latencyP99?: number
}
```

### Checklist

- [ ] **Metrics endpoint** accessible (protected by auth)
- [ ] **Prometheus scraping** configured (if using)
- [ ] **Grafana dashboards** created for key metrics
- [ ] **Alert thresholds** defined for:
  - [ ] Connection count exceeding limits
  - [ ] Error rate above threshold (e.g., > 1%)
  - [ ] Latency P99 exceeding SLA (e.g., > 100ms)
  - [ ] Message queue backpressure

### External Observability

```bash
# Set observability secrets
wrangler secret put SENTRY_DSN
wrangler secret put AXIOM_TOKEN
wrangler secret put AXIOM_DATASET
```

- [ ] **Sentry configured** for error tracking
- [ ] **Axiom/Logs service** configured for log aggregation
- [ ] **Trace sampling** configured (e.g., 10% in production)
- [ ] **Source maps** uploaded for error debugging

### Health Checks

Implement health check endpoint:

```typescript
// GET /health
{
  status: 'healthy',
  version: '1.0.0',
  uptime: 12345,
  connections: 150,
  lastEventAt: '2024-01-15T12:00:00Z'
}
```

- [ ] **Health endpoint** returns 200 when healthy
- [ ] **Uptime monitoring** configured (e.g., Better Uptime, Pingdom)
- [ ] **Incident response runbook** documented

---

## Scaling Considerations

### Connection Limits

EventStreamDO default limits:

| Setting | Default | Recommended Production |
|---------|---------|----------------------|
| `maxConnections` | 10,000 | Adjust based on load |
| `maxTopics` | 10,000 | Adjust based on use case |
| `maxPendingMessages` | 100 | Lower for memory-constrained |

### Checklist

- [ ] **Connection limits** tuned for expected load
- [ ] **Topic limits** set appropriately
- [ ] **Pending message limits** configured for backpressure
- [ ] **Hibernation** enabled for idle connections

### Rate Limiting

```typescript
const config: EventStreamConfig = {
  rateLimit: {
    messagesPerSecond: 1000,  // Per-connection limit
    burstSize: 1000           // Burst capacity
  }
}
```

- [ ] **Per-connection rate limits** configured
- [ ] **Global rate limits** considered for DDoS protection
- [ ] **Backpressure handling** tested under load

### Hot Tier Configuration

```typescript
const config: EventStreamConfig = {
  hotTierRetentionMs: 5 * 60 * 1000,  // 5 minutes default
  cleanupIntervalMs: 60_000,           // Cleanup every minute
  dedupWindowMs: 60_000                // 1 minute dedup window
}
```

- [ ] **Retention window** balanced between query needs and memory
- [ ] **Cleanup interval** configured for timely garbage collection
- [ ] **Deduplication window** set for expected event patterns

### Fan-Out Configuration

For high subscriber counts:

```typescript
const config: EventStreamConfig = {
  fanOut: {
    batchSize: 100,        // Subscribers per batch
    yieldIntervalMs: 10    // Yield between batches
  }
}
```

- [ ] **Batch size** tuned for connection patterns
- [ ] **Yield intervals** prevent blocking event loop

---

## Security Checklist

### Network Security

- [ ] **HTTPS only** - no HTTP endpoints exposed
- [ ] **TLS 1.2+** minimum version
- [ ] **CORS configured** with explicit allowed origins
- [ ] **CSP headers** configured for frontend

### Authentication & Authorization

- [ ] **All endpoints require authentication** in production
- [ ] **Token validation** implemented for WebSocket connections
- [ ] **Session management** with appropriate TTLs
- [ ] **Role-based access** for admin endpoints
- [ ] **API key rotation** schedule established

### Input Validation

- [ ] **SQL injection prevention** - parameterized queries only
- [ ] **Topic name validation** - no path traversal or injection
- [ ] **Event payload validation** - schema enforcement
- [ ] **Size limits** on request bodies

### Secret Management

- [ ] **No secrets in code** - use `wrangler secret put`
- [ ] **Secrets rotated** on schedule (e.g., quarterly)
- [ ] **Separate secrets per environment**
- [ ] **Access logged** for secret retrieval

### Data Protection

- [ ] **PII handling** documented and compliant
- [ ] **Data encryption** at rest (R2 automatic) and in transit (TLS)
- [ ] **Retention policies** enforced automatically
- [ ] **GDPR/CCPA compliance** verified if applicable

---

## Pre-Launch Verification

### Functional Testing

- [ ] **WebSocket connections** establish successfully
- [ ] **Event broadcast** works end-to-end
- [ ] **Hot tier queries** return expected results
- [ ] **Cold tier writes** flowing to Iceberg
- [ ] **Authentication** blocks unauthenticated requests
- [ ] **Rate limiting** enforces limits correctly

### Load Testing

Run load tests before production launch:

```bash
# Example: 1000 concurrent WebSocket connections
npm run test:load -- --connections=1000 --duration=60s
```

- [ ] **Connection test** - max concurrent connections
- [ ] **Throughput test** - messages per second capacity
- [ ] **Latency test** - P50/P95/P99 under load
- [ ] **Memory test** - no leaks over extended run
- [ ] **Recovery test** - behavior after DO restart

### Deployment Verification

```bash
# Deploy to production
wrangler deploy --env production

# Verify deployment
curl https://your-app.workers.dev/health
```

- [ ] **Deployment successful** - no errors
- [ ] **Health check passing**
- [ ] **Metrics endpoint accessible**
- [ ] **Sample events flowing**

### Rollback Plan

- [ ] **Previous version tagged** in git
- [ ] **Rollback command documented**: `wrangler rollback --env production`
- [ ] **Database rollback** procedure if schema changed
- [ ] **Incident communication** template ready

### Documentation

- [ ] **Runbook updated** with production URLs and commands
- [ ] **On-call rotation** established
- [ ] **Escalation path** documented
- [ ] **Architecture diagram** reflects production setup

---

## Quick Reference

### Essential Commands

```bash
# Deploy to production
wrangler deploy --env production

# Set a secret
wrangler secret put SECRET_NAME --env production

# View logs
wrangler tail --env production

# Rollback deployment
wrangler rollback --env production

# Check deployment status
wrangler deployments list
```

### Key URLs

| Endpoint | Purpose |
|----------|---------|
| `/health` | Health check |
| `/metrics` | Prometheus metrics |
| `/events` | WebSocket event stream |
| `/broadcast` | HTTP event broadcast |
| `/query` | Hot tier SQL queries |
| `/query/unified` | Typed event queries |

### Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `BETTER_AUTH_SECRET` | Yes | Session signing secret |
| `ENVIRONMENT` | Yes | `production`, `staging`, `development` |
| `GITHUB_CLIENT_ID` | If using | GitHub OAuth |
| `GITHUB_CLIENT_SECRET` | If using | GitHub OAuth |
| `GOOGLE_CLIENT_ID` | If using | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | If using | Google OAuth |
| `OPENAI_API_KEY` | If using AI | OpenAI integration |
| `ANTHROPIC_API_KEY` | If using AI | Anthropic integration |
| `SENTRY_DSN` | Recommended | Error tracking |
| `AXIOM_TOKEN` | Recommended | Log aggregation |

---

## Next Steps

After completing this checklist:

1. **Monitor for 24 hours** - Watch metrics and logs closely
2. **Gradual traffic ramp** - Use percentage-based rollout if available
3. **Document learnings** - Update runbooks with any issues found
4. **Schedule review** - Plan post-launch retrospective

For additional guidance, see:

- [Getting Started Guide](./getting-started.md)
- [Schema Reference](./schema-reference.md)
- [EventStreamDO Configuration](/streaming/event-stream-do.ts)
