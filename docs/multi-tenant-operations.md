# Multi-Tenant Operations Guide

This guide provides comprehensive operational documentation for multi-tenant deployments on the dotdo platform. It covers tenant provisioning, isolation verification, resource management, monitoring, migration procedures, and troubleshooting.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tenant Provisioning and Onboarding](#tenant-provisioning-and-onboarding)
3. [Tenant Isolation Verification](#tenant-isolation-verification)
4. [Resource Quotas and Limits](#resource-quotas-and-limits)
5. [Monitoring Per-Tenant Metrics](#monitoring-per-tenant-metrics)
6. [Tenant Migration Procedures](#tenant-migration-procedures)
7. [Troubleshooting Guide](#troubleshooting-guide)

---

## Architecture Overview

dotdo's multi-tenant architecture provides **physical isolation** through Durable Objects. Each tenant gets their own DO instance with dedicated SQLite storage, eliminating the need for Row-Level Security (RLS) policies and preventing cross-tenant data leakage.

### Core Isolation Mechanisms

```
Request
   |
   v
+------------------+
|   Hono Router    |  Extracts tenant from hostname/path
+------------------+
   |
   | tenant.api.dotdo.dev -> tenant
   v
+------------------+
|  DO Namespace    |  env.DO.idFromName(tenant)
+------------------+
   |
   | Each tenant = isolated DO instance
   v
+------------------+
|  Durable Object  |  Dedicated SQLite per tenant
|  (per tenant)    |  Complete data isolation
+------------------+
   |
   v
+------------------+
|    SQLite DB     |  Physical isolation
|   (per tenant)   |  No RLS needed
+------------------+
```

### How Tenant Routing Works

Tenant identification is derived from the request hostname:

```typescript
// From api/utils/router.ts
export function getTenantFromHostname(hostname: string): string {
  const hostParts = hostname.split('.')
  // If 3+ parts (e.g., tenant.api.dotdo.dev), use first part
  return hostParts.length > 2 ? (hostParts[0] ?? 'default') : 'default'
}
```

**Examples:**
| Hostname | Tenant |
|----------|--------|
| `acme.api.dotdo.dev` | `acme` |
| `globex.api.dotdo.dev` | `globex` |
| `api.dotdo.dev` | `default` |
| `localhost:8787` | `default` |

### Namespace Strategy Types

| Strategy | Use Case | Configuration |
|----------|----------|---------------|
| `tenant` | Standard multi-tenant (hostname-based) | Default behavior |
| `singleton` | Global shared resources | Single DO for all tenants |
| `sharded` | High-volume tenants | Distribute across multiple DOs |

---

## Tenant Provisioning and Onboarding

### Step 1: Create Tenant Infrastructure

Creating a tenant is as simple as making the first request to their namespace. The DO is automatically instantiated:

```bash
# First request to a tenant creates the DO
curl -X POST https://new-tenant.api.dotdo.dev/things \
  -H "Content-Type: application/json" \
  -d '{"$type": "Customer", "name": "First Customer"}'
```

### Step 2: Programmatic Tenant Setup

For production deployments, use a tenant management pattern:

```typescript
interface TenantConfig {
  id: string
  name: string
  slug: string
  plan: 'starter' | 'pro' | 'enterprise'
  settings: {
    branding: { logo?: string; primaryColor: string; companyName: string }
    features: string[]
    limits: { users: number; storage: number; apiCalls: number }
  }
  billing: {
    customerId: string
    subscriptionId?: string
    status: 'active' | 'past_due' | 'cancelled' | 'trialing'
  }
  createdAt: Date
}

// Create tenant
async function createTenant(data: {
  name: string
  slug: string
  adminEmail: string
  plan?: TenantConfig['plan']
}): Promise<TenantConfig> {
  const tenantId = `tenant_${crypto.randomUUID()}`

  // Initialize the tenant DO
  const id = env.DO.idFromName(data.slug)
  const stub = env.DO.get(id)

  // Set up initial configuration
  const config = await stub.fetch('https://internal/setup', {
    method: 'POST',
    body: JSON.stringify({
      tenantId,
      name: data.name,
      plan: data.plan ?? 'starter',
      adminEmail: data.adminEmail,
    }),
  })

  return config.json()
}
```

### Step 3: DNS and Subdomain Configuration

Configure your DNS for wildcard subdomains:

```
# DNS Configuration
*.api.yourdomain.com -> your-worker.your-subdomain.workers.dev

# Cloudflare Workers route
routes:
  - pattern: "*.api.yourdomain.com/*"
    script: "your-worker"
```

### Step 4: Custom Domain Support

For enterprise tenants requiring custom domains:

```typescript
// Register custom domain mapping
async function registerCustomDomain(slug: string, domain: string): Promise<void> {
  // Store domain -> tenant mapping
  const router = env.DO.get(env.DO.idFromName('global-router'))
  await router.fetch('https://internal/register', {
    method: 'POST',
    body: JSON.stringify({ slug, customDomain: domain }),
  })

  // Configure Cloudflare Custom Hostname
  // (requires Cloudflare for SaaS)
}
```

### Onboarding Checklist

- [ ] Tenant slug validated (unique, URL-safe)
- [ ] Initial admin user created
- [ ] Billing customer created (if applicable)
- [ ] Welcome email sent
- [ ] DNS propagated (for custom domains)
- [ ] SSL certificate provisioned
- [ ] Rate limits configured
- [ ] Resource quotas set

---

## Tenant Isolation Verification

### Automated Isolation Tests

Run these tests to verify tenant isolation:

```typescript
import { describe, it, expect } from 'vitest'

describe('Multi-Tenant Isolation', () => {
  it('tenant A data is not visible to tenant B', async () => {
    // Create data in tenant A
    const createA = await tenantAStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({
        id: 'secret-data',
        type: 'Secret',
        data: { apiKey: 'sk_live_tenant_a_xxx' },
      }),
    })
    expect(createA.status).toBe(201)

    // Verify tenant B cannot see it
    const getB = await tenantBStub.fetch('http://fake/things/secret-data')
    expect(getB.status).toBe(404)
  })

  it('both tenants can have items with same IDs', async () => {
    const sharedId = 'user-123'

    // Create with same ID in both tenants
    await tenantAStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id: sharedId, type: 'User', data: { owner: 'A' } }),
    })

    await tenantBStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id: sharedId, type: 'User', data: { owner: 'B' } }),
    })

    // Each tenant sees their own version
    const getA = await tenantAStub.fetch(`http://fake/things/${sharedId}`)
    const dataA = await getA.json()
    expect(dataA.data.owner).toBe('A')

    const getB = await tenantBStub.fetch(`http://fake/things/${sharedId}`)
    const dataB = await getB.json()
    expect(dataB.data.owner).toBe('B')
  })

  it('stats reflect only tenant-specific data', async () => {
    const statsA = await tenantAStub.fetch('http://fake/stats')
    const baseA = await statsA.json()

    // Add items to tenant A only
    for (let i = 0; i < 5; i++) {
      await tenantAStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({ id: `item-${i}`, type: 'TestItem', data: {} }),
      })
    }

    // Verify counts
    const statsAAfter = await tenantAStub.fetch('http://fake/stats')
    const afterA = await statsAAfter.json()
    expect(afterA.thingCount).toBe(baseA.thingCount + 5)

    // Tenant B unchanged
    const statsB = await tenantBStub.fetch('http://fake/stats')
    const afterB = await statsB.json()
    expect(afterB.thingCount).toBe(0) // Or baseline
  })
})
```

### Manual Verification Commands

```bash
# 1. Create test data in Tenant A
curl -X POST https://tenant-a.api.dotdo.dev/things \
  -H "Content-Type: application/json" \
  -d '{"$type": "Secret", "data": "tenant-a-secret"}'

# 2. Verify Tenant B cannot access
curl https://tenant-b.api.dotdo.dev/things/secret-data
# Expected: 404 Not Found

# 3. Verify Tenant B list is empty
curl https://tenant-b.api.dotdo.dev/things?type=Secret
# Expected: { "items": [], "count": 0 }

# 4. Verify tenant stats are isolated
curl https://tenant-a.api.dotdo.dev/stats
curl https://tenant-b.api.dotdo.dev/stats
# Expected: Different counts
```

### Isolation Audit Checklist

| Check | Command | Expected Result |
|-------|---------|-----------------|
| Cross-tenant read | `GET /tenant-b/things/{tenant-a-id}` | 404 |
| Cross-tenant list | `GET /tenant-b/things?type=*` | Empty or tenant-b only |
| Cross-tenant relationship | `GET /tenant-b/relationships?from={tenant-a-id}` | Empty |
| Stats isolation | Compare `/stats` endpoints | Different values |
| ID collision | Same ID in both tenants | No conflict |

---

## Resource Quotas and Limits

### Rate Limiting Configuration

Rate limits are configured per-tenant using the `TenantRateLimiter`:

```typescript
import { TenantRateLimiter } from './objects/unified-storage/rate-limiter'

const rateLimiter = new TenantRateLimiter({
  storage: memoryStorage,
  defaultConfig: {
    requestsPerWindow: 1000,   // Requests per window
    windowMs: 60_000,          // 1 minute window
    readLimit: 5000,           // Higher limit for reads
    writeLimit: 500,           // Lower limit for writes
    windowStrategy: 'sliding', // 'fixed' | 'sliding' | 'sliding-log'
  },
  tenantConfigs: {
    'enterprise-tenant': {
      requestsPerWindow: 10000,
      windowMs: 60_000,
      readLimit: 50000,
      writeLimit: 5000,
    },
  },
  adminTenants: ['internal-admin'], // Bypass rate limits
  warningThreshold: 0.8,            // Alert at 80% usage
})
```

### Plan-Based Limits

| Plan | Users | Storage (GB) | API Calls/Month | Features |
|------|-------|--------------|-----------------|----------|
| Starter | 5 | 5 | 10,000 | Basic analytics, email support |
| Pro | 25 | 50 | 100,000 | + Advanced analytics, API access, custom branding |
| Enterprise | Unlimited | 500 | 1,000,000 | + SSO, audit logs, dedicated support, SLA |

### Implementing Resource Limits

```typescript
class TenantManager {
  async checkLimit(
    resource: 'users' | 'storage' | 'apiCalls',
    amount: number = 1
  ): Promise<{
    allowed: boolean
    current: number
    limit: number
    remaining: number
  }> {
    const config = await this.getConfig()
    const stats = await this.getStats()

    const limit = config.settings.limits[resource]
    const current = stats[resource]
    const remaining = limit - current

    // -1 means unlimited
    if (limit === -1) {
      return { allowed: true, current, limit: Infinity, remaining: Infinity }
    }

    return {
      allowed: current + amount <= limit,
      current,
      limit,
      remaining: Math.max(0, remaining),
    }
  }

  async incrementUsage(
    resource: 'users' | 'storage' | 'apiCalls',
    amount: number = 1
  ): Promise<void> {
    this.stats[resource] += amount
    this.stats.lastActiveAt = new Date()
  }
}
```

### Cost Attribution

Track costs per tenant using the `CostMetricsCollector`:

```typescript
import { CostMetricsCollector } from './objects/unified-storage/cost-attribution'

const collector = new CostMetricsCollector(tenantId)

// Track operations
collector.trackWrite('create', 'Customer', 1024)  // 1KB write
collector.trackRead('Customer', 512, true)        // 512B read, cache hit
collector.trackPipelineEvent('thing.created', 256)
collector.trackSqliteOp(1, 1024)                  // 1 query, 1KB

// Get cost report
const report = collector.getTenantReport(tenantId)
// {
//   tenantId: 'tenant-123',
//   totalCost: 0.000125,
//   writes: { count: 1, bytes: 1024, cost: 0.0000102 },
//   reads: { count: 1, bytes: 512, cost: 0.00000051 },
//   ...
// }

// Set up cost alerts
collector.setAlertConfig({
  tenantId,
  thresholds: { warning: 10, critical: 100 },  // dollars
  enabled: true,
})

collector.onAlert((event) => {
  console.log(`[${event.level}] Tenant ${event.tenantId} cost: $${event.currentCost}`)
})
```

### Admin Override for Rate Limits

```typescript
// Temporary increase for a specific tenant
await rateLimiter.setOverride('tenant-123', {
  type: 'increase',
  multiplier: 2.0,           // Double the limits
  expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  reason: 'Scheduled data migration',
})

// Bypass rate limits entirely
await rateLimiter.setOverride('tenant-456', {
  type: 'bypass',
  reason: 'Enterprise SLA - unlimited access',
})

// View active overrides
const overrides = await rateLimiter.getActiveOverrides()
```

---

## Monitoring Per-Tenant Metrics

### Prometheus Metrics Export

Export tenant-specific metrics in Prometheus format:

```typescript
const exporter = new PrometheusExporter(metrics, {
  namespace: tenantId,
  maxEntityTypeCardinality: 50,
})

// Track operations with labels
exporter.trackOperation('create', 'Customer', 0.005)
exporter.trackRead('Order', true)  // cache hit

// Export metrics
const prometheusText = exporter.export()
```

**Available Metrics:**

| Metric | Type | Description |
|--------|------|-------------|
| `dotdo_tenant_cost_total` | gauge | Total cost incurred |
| `dotdo_tenant_writes_cost` | gauge | Cost of writes |
| `dotdo_tenant_reads_cost` | gauge | Cost of reads |
| `dotdo_writes_total` | counter | Total write operations |
| `dotdo_reads_total` | counter | Total read operations |
| `dotdo_cache_hit_ratio` | gauge | Cache efficiency (0-1) |
| `dotdo_entries_count` | gauge | Total entries |
| `dotdo_entries_bytes` | gauge | Memory usage |
| `dotdo_dirty_entries_count` | gauge | Pending checkpoints |
| `dotdo_checkpoint_duration_seconds` | histogram | Checkpoint latency |

### Grafana Dashboard Queries

**Per-Tenant Request Rate:**
```promql
sum(rate(dotdo_writes_total[5m])) by (namespace, operation_type)
```

**Cost by Tenant:**
```promql
dotdo_tenant_cost_total{namespace=~"tenant-.*"}
```

**Top 10 Tenants by API Usage:**
```promql
topk(10, sum(rate(dotdo_writes_total[1h])) by (namespace))
```

**Cache Hit Ratio by Tenant:**
```promql
dotdo_cache_hit_ratio{namespace=~"$tenant"}
```

### Health Check Endpoints

```bash
# Per-tenant health
GET https://tenant-123.api.dotdo.dev/health

# Response:
{
  "status": "healthy",
  "timestamp": "2024-01-15T14:32:00.000Z",
  "uptimeMs": 3600000,
  "components": {
    "state": { "status": "healthy", "thingCount": 10000 },
    "pipeline": { "status": "healthy", "pendingEvents": 10 },
    "sql": { "status": "healthy", "avgQueryLatencyMs": 5 }
  }
}
```

### Per-Tenant Alerting

```yaml
# Prometheus alerting rules
groups:
  - name: tenant-alerts
    rules:
      - alert: TenantHighCost
        expr: dotdo_tenant_cost_total > 100
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "Tenant {{ $labels.namespace }} cost exceeds $100"

      - alert: TenantRateLimitApproaching
        expr: |
          rate_limit_remaining{tenant=~".*"}
          / rate_limit_total{tenant=~".*"} < 0.2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Tenant {{ $labels.tenant }} approaching rate limit"

      - alert: TenantHighErrorRate
        expr: |
          sum(rate(dotdo_writes_total{status="error"}[5m])) by (namespace)
          / sum(rate(dotdo_writes_total[5m])) by (namespace) > 0.05
        for: 5m
        labels:
          severity: critical
```

---

## Tenant Migration Procedures

### Migrating Tenant Data Between Regions

For geo-distribution or disaster recovery:

```typescript
import { ShardMigration } from './objects/unified-storage/shard-migration'

const migration = new ShardMigration({
  router,
  iceberg: icebergReader,
  timeout: 300_000,  // 5 minutes
  rollbackOnFailure: true,
  onProgress: (progress) => {
    console.log(`Phase: ${progress.phase}`)
    console.log(`Events: ${progress.eventsProcessed}/${progress.totalEvents}`)
  },
})

// 1. Plan the migration
const plan = await migration.planMigration({
  source: 'us-east-1',
  target: 'eu-west-1',
  tenantIds: ['tenant-123'],
})

console.log(`Will migrate ${plan.partitionKeysToMove.length} partition keys`)
console.log(`Estimated duration: ${plan.estimatedDuration}ms`)

// 2. Validate the plan
const validation = await migration.validatePlan(plan)
if (!validation.valid) {
  console.error('Plan errors:', validation.errors)
  return
}

// 3. Execute migration
const result = await migration.execute(plan)

if (result.success) {
  console.log(`Migration complete`)
  console.log(`Events replayed: ${result.eventsReplayed}`)
  console.log(`Duration: ${result.durationMs}ms`)
} else {
  console.error(`Migration failed, rolled back: ${result.rolledBack}`)
}
```

### Migrating Tenant to Dedicated Infrastructure

For enterprise tenants requiring dedicated resources:

```bash
# 1. Create new dedicated DO binding
# wrangler.toml
[[durable_objects.bindings]]
name = "ENTERPRISE_TENANT_DO"
class_name = "DO"

# 2. Export tenant data
curl https://tenant-enterprise.api.dotdo.dev/export \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -o tenant-export.jsonl

# 3. Import to dedicated infrastructure
curl -X POST https://dedicated.enterprise-tenant.com/import \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/jsonl" \
  --data-binary @tenant-export.jsonl

# 4. Update DNS routing
# Old: tenant-enterprise.api.dotdo.dev -> shared worker
# New: tenant-enterprise.api.dotdo.dev -> dedicated worker
```

### Tenant Offboarding

```typescript
async function offboardTenant(tenantId: string): Promise<void> {
  // 1. Disable tenant access
  await rateLimiter.setOverride(tenantId, {
    type: 'bypass',
    multiplier: 0, // Block all requests
    reason: 'Tenant offboarding',
  })

  // 2. Export data for legal retention
  const exportUrl = await exportTenantData(tenantId, {
    format: 'jsonl',
    includeMetadata: true,
    encrypt: true,
  })

  // 3. Queue for deletion after retention period
  await scheduler.schedule({
    action: 'delete-tenant-data',
    tenantId,
    executeAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  })

  // 4. Cancel billing subscription
  await billing.cancelSubscription(tenantId)

  // 5. Send confirmation
  await notifications.send({
    to: adminEmail,
    template: 'tenant-offboarding-complete',
    data: { tenantId, exportUrl },
  })
}
```

### Zero-Downtime Tenant Rename

```typescript
async function renameTenant(
  oldSlug: string,
  newSlug: string
): Promise<void> {
  // 1. Verify new slug is available
  const router = await TenantRouter.get('global')
  if (!await router.isSlugAvailable(newSlug)) {
    throw new Error(`Slug "${newSlug}" is already taken`)
  }

  // 2. Register new route pointing to same tenant
  const existingRoute = await router.resolve(oldSlug + '.api.dotdo.dev')
  await router.register(newSlug, existingRoute.tenantId)

  // 3. Set up redirect from old to new
  await router.addRedirect(oldSlug, newSlug)

  // 4. Wait for DNS propagation
  await sleep(300_000) // 5 minutes

  // 5. Remove old route
  await router.unregister(oldSlug)
}
```

---

## Troubleshooting Guide

### Common Issues and Solutions

#### Issue: Tenant Cannot Access Their Data

**Symptoms:**
- All requests return 404
- Previously existing data appears missing

**Diagnosis:**
```bash
# Check if tenant DO exists
curl https://tenant-name.api.dotdo.dev/health

# Check routing
curl -v https://tenant-name.api.dotdo.dev/things 2>&1 | grep "X-Tenant"
```

**Solutions:**
| Cause | Solution |
|-------|----------|
| DNS not propagated | Wait for propagation, check with `dig` |
| Wrong hostname | Verify `tenant.api.yourdomain.com` format |
| DO hibernated | First request wakes DO, may be slow |
| Rate limited | Check `X-RateLimit-*` headers |

#### Issue: Cross-Tenant Data Visible

**Symptoms:**
- Tenant A can see Tenant B's data
- List operations return foreign data

**Diagnosis:**
```bash
# Run isolation test
npm run test -- tests/e2e/multi-tenant/multi-tenant.test.ts

# Check tenant ID extraction
curl -v https://tenant-a.api.dotdo.dev/things 2>&1 | grep "X-Tenant-ID"
```

**Solutions:**
| Cause | Solution |
|-------|----------|
| Hostname parsing bug | Check `getTenantFromHostname()` |
| Shared DO binding | Verify each tenant has unique DO instance |
| Cache pollution | Clear noun config cache |

#### Issue: Rate Limits Too Restrictive

**Symptoms:**
- Legitimate requests getting 429 responses
- Business operations blocked

**Diagnosis:**
```typescript
const status = await rateLimiter.getUsageStatus(tenantId)
console.log(`Used: ${status.used}/${status.limit} (${status.percentUsed}%)`)
console.log(`Resets at: ${new Date(status.windowResetsAt)}`)
```

**Solutions:**
```typescript
// Temporary override
await rateLimiter.setOverride(tenantId, {
  type: 'increase',
  multiplier: 2.0,
  expiresAt: Date.now() + 4 * 60 * 60 * 1000, // 4 hours
  reason: 'Temporary increase for data migration',
})

// Permanent upgrade
await rateLimiter.setTenantConfig(tenantId, {
  requestsPerWindow: 5000,
  windowMs: 60_000,
  readLimit: 25000,
  writeLimit: 2500,
})
```

#### Issue: High Latency for Specific Tenant

**Symptoms:**
- One tenant experiencing slow requests
- Other tenants unaffected

**Diagnosis:**
```bash
# Check tenant metrics
curl https://tenant-slow.api.dotdo.dev/metrics | grep latency

# Check DO health
curl https://tenant-slow.api.dotdo.dev/health
```

**Solutions:**
| Cause | Solution |
|-------|----------|
| Large data volume | Consider sharding the tenant |
| Complex queries | Add indexes, optimize query patterns |
| Cold start | Pre-warm DO with periodic health checks |
| Hot shard | Rebalance data across shards |

#### Issue: Tenant Migration Failed

**Symptoms:**
- Migration reports `rolledBack: true`
- Partial data in target location

**Diagnosis:**
```typescript
const result = await migration.addShard(newShard, { rebalance: true })

if (result.rolledBack) {
  console.error('Migration failed and was rolled back')
  console.error('Error:', result.error)
  console.error('Phase:', result.failedAtPhase)
  console.error('Events processed:', result.eventsProcessed)
}
```

**Solutions:**
| Cause | Solution |
|-------|----------|
| Timeout | Increase `timeout` or batch smaller |
| Iceberg unavailable | Check R2/storage connectivity |
| Network error | Enable retry with backoff |
| Schema mismatch | Validate schema compatibility |

### Diagnostic Commands

```bash
# Check tenant isolation
curl -X POST https://tenant-a.api.dotdo.dev/things \
  -d '{"id":"test","type":"Test"}' && \
curl https://tenant-b.api.dotdo.dev/things/test
# Expected: 404 from tenant-b

# Check rate limits
curl -I https://tenant.api.dotdo.dev/things | grep X-RateLimit

# Check tenant stats
curl https://tenant.api.dotdo.dev/stats

# Check health
curl https://tenant.api.dotdo.dev/health

# Export tenant metrics
curl https://tenant.api.dotdo.dev/metrics

# Verify DO binding
wrangler tail --format=json | jq 'select(.event.doId)'
```

### Emergency Procedures

#### Isolate Compromised Tenant

```typescript
// Immediately block all access
await rateLimiter.setOverride(tenantId, {
  type: 'increase',
  multiplier: 0,
  reason: 'Security incident - access revoked',
})

// Revoke all API keys
await apiKeys.revokeAllForTenant(tenantId)

// Log incident
await audit.log({
  action: 'tenant_isolated',
  tenantId,
  reason: 'Security incident',
  timestamp: new Date(),
})
```

#### Force Checkpoint During Incident

```typescript
// Force immediate checkpoint of all dirty data
await stub.fetch('https://internal/checkpoint', {
  method: 'POST',
  headers: { 'X-Admin-Key': ADMIN_KEY },
})
```

#### Export Data for Forensics

```bash
# Export with full audit trail
curl -X POST https://tenant.api.dotdo.dev/export \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Include-Audit: true" \
  -H "X-Include-Metadata: true" \
  -o forensics-export.jsonl
```

---

## Appendix: Configuration Reference

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_REQUESTS` | Default requests per window | 1000 |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window (ms) | 60000 |
| `COST_ALERT_WARNING` | Cost warning threshold ($) | 10 |
| `COST_ALERT_CRITICAL` | Cost critical threshold ($) | 100 |
| `MIGRATION_TIMEOUT_MS` | Migration timeout (ms) | 300000 |

### Wrangler Configuration

```toml
# wrangler.toml
name = "dotdo-multi-tenant"

[[durable_objects.bindings]]
name = "DO"
class_name = "DO"

[[durable_objects.bindings]]
name = "REPLICA_DO"
class_name = "DO"

[[routes]]
pattern = "*.api.yourdomain.com/*"
zone_name = "yourdomain.com"
```

---

## Related Documentation

- [CLAUDE.md](/CLAUDE.md) - Project overview and architecture
- [Sharding Guide](/objects/unified-storage/docs/sharding-guide.md) - Horizontal scaling
- [Observability Reference](/docs/observability.md) - Monitoring and alerting
- [Multi-Tenant Tutorial](/docs/internal/tutorials/multi-tenant.mdx) - Step-by-step guide
- [Multi-Tenant Semantic Isolation](/docs/internal/spikes/multi-tenant-semantic-isolation.md) - Isolation patterns
