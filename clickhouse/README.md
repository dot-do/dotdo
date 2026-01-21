# @dotdo/clickhouse

ClickHouse WASM analytics client for dotdo - provides high-performance analytics using chdb compiled to WebAssembly.

## Overview

This package wraps the chdb WASM binary with a high-level analytics API designed for Cloudflare Workers and Durable Objects. It provides:

- Event tracking (page views, custom events)
- SQL query execution via ClickHouse WASM
- Pre-built analytics (funnels, cohorts, retention)
- SaaS metrics calculation (MRR, churn, LTV)
- Web analytics
- Product analytics
- A/B testing and experiments

## Installation

```bash
npm install @dotdo/clickhouse
```

## chdb WASM Integration

### Source Repository

The chdb WASM binary is built from `~/projects/clickhouse` (the [chdb-wasm monorepo](https://github.com/dot-do/clickhouse)). This repository contains:

| Package | Description |
|---------|-------------|
| `@dotdo/chdb-wasm` | WASM-compiled chdb optimized for Workers/DOs |
| `@dotdo/chdb` | Unified client (auto-selects WASM or native) |
| `@dotdo/clickhouse` | Full ClickHouse with R2/S3 storage |

### Build Profiles

The WASM binary supports multiple build profiles with different size/feature tradeoffs:

| Profile | Gzipped Size | Table Engines | Formats | Use Case |
|---------|--------------|---------------|---------|----------|
| `minimal` | ~3MB | Memory, URL | JSON, Parquet | Edge queries |
| `standard` | ~10MB | + MergeTree, S3 | + CSV, TSV, Arrow | General analytics |
| `full` | ~20MB | All supported | All supported | Full compatibility |

### Current Status

**WASM Integration: Not Yet Complete**

The `loadChdbModule()` function in `client.ts` currently throws an error indicating the WASM module needs to be bundled. Integration requires:

1. Building the WASM binary from `~/projects/clickhouse/packages/chdb-wasm`
2. Bundling or lazy-loading the WASM file
3. Setting up the VFS bridge for DO storage + R2

### Integration Requirements

#### 1. WASM Binary Acquisition

Option A: Bundle directly (for Workers with static assets)
```typescript
import wasmModule from '@dotdo/chdb-wasm/wasm/chdb.wasm'
```

Option B: Lazy-load from R2/CDN
```typescript
const wasmUrl = 'https://assets.dotdo.dev/wasm/chdb-standard.wasm'
const response = await fetch(wasmUrl)
const module = await WebAssembly.compile(await response.arrayBuffer())
```

#### 2. VFS Bridge Configuration

The VFS bridge connects ClickHouse's file I/O to Cloudflare storage:

```typescript
// Hot data: DO SQLite (recent events, active queries)
const doStorage = ctx.state.storage

// Cold data: R2 (historical data, MergeTree parts)
const r2Storage = new R2Provider({
  bucket: env.ANALYTICS_BUCKET,
  prefix: `analytics/${namespace}`,
  cache: { maxSize: 64 * 1024 * 1024 }
})
```

#### 3. Memory Constraints

Cloudflare Workers/DOs have memory limits:

- Workers: ~128MB total
- Durable Objects: Varies by plan

Configure accordingly:
```typescript
const client = await createClickHouseClient(storage, {
  profile: 'minimal',        // Use smallest WASM for edge
  maxMemory: 64 * 1024 * 1024,  // 64MB max for queries
  cacheSize: 16 * 1024 * 1024,  // 16MB read cache
  writeBufferSize: 256 * 1024   // 256KB write buffer
})
```

## Usage

### Basic Setup

```typescript
import { createClickHouseClient } from '@dotdo/clickhouse'

// In a Durable Object
class AnalyticsDO extends DO {
  private analytics?: AnalyticsClient

  async getAnalytics(): Promise<AnalyticsClient> {
    if (!this.analytics) {
      this.analytics = await createClickHouseClient(this.ctx.storage, {
        profile: 'standard',
        r2: this.env.ANALYTICS_BUCKET
      })
    }
    return this.analytics
  }
}
```

### Event Tracking

```typescript
const analytics = await this.getAnalytics()

// Track custom event
await analytics.track({
  type: 'signup',
  properties: { plan: 'pro', source: 'landing' },
  visitorId: 'visitor-123',
  sessionId: 'session-456'
})

// Track page view
await analytics.pageview({
  url: 'https://example.com/pricing',
  referrer: 'https://google.com',
  visitorId: 'visitor-123'
})

// Batch tracking (more efficient)
await analytics.trackBatch([
  { type: 'click', properties: { button: 'cta' } },
  { type: 'scroll', properties: { depth: 50 } }
])
```

### SQL Queries

```typescript
// Direct SQL execution
const result = await analytics.query<{ day: string; count: number }>(`
  SELECT toDate(timestamp) as day, count() as count
  FROM events
  WHERE type = 'signup'
  GROUP BY day
  ORDER BY day
`)

// Parameterized queries
const result = await analytics.queryWithParams<{ user: string; total: number }>(
  `SELECT visitorId as user, count() as total
   FROM events
   WHERE type = {eventType:String}
   GROUP BY visitorId`,
  { eventType: 'purchase' }
)

// Streaming for large results
for await (const row of analytics.queryStream('SELECT * FROM events')) {
  console.log(row)
}
```

### Pre-built Analytics

```typescript
// Funnel analysis
const funnel = await analytics.funnel([
  { name: 'Visit', event: 'page_view' },
  { name: 'Signup', event: 'signup' },
  { name: 'Subscribe', event: 'subscription.created' }
], { start: new Date('2024-01-01'), end: new Date() })

// Retention analysis
const retention = await analytics.retention(
  'signup',           // Cohort event
  'page_view',        // Return event
  { start: new Date('2024-01-01'), end: new Date() },
  'week'              // Granularity
)

// User segmentation
const segments = await analytics.segment(
  'plan',             // Property to segment by
  'count',            // Metric
  { start: new Date('2024-01-01'), end: new Date() }
)
```

### SaaS Metrics

```typescript
const metrics = await analytics.calculateSaaSMetrics({
  start: new Date('2024-01-01'),
  end: new Date('2024-01-31'),
  granularity: 'month'
})

console.log(metrics.mrr.current)      // Current MRR
console.log(metrics.arr)              // Annual recurring revenue
console.log(metrics.churn.customerChurnRate)  // Churn rate
console.log(metrics.ltv.average)      // Customer lifetime value
console.log(metrics.nrr)              // Net revenue retention
```

### Web Analytics

```typescript
const webStats = await analytics.getWebAnalytics({
  start: new Date('2024-01-01'),
  end: new Date()
})

console.log(webStats.pageViews)
console.log(webStats.uniqueVisitors)
console.log(webStats.bounceRate)
console.log(webStats.topPages)

// Real-time
const activeVisitors = await analytics.getRealTimeVisitors(5) // Last 5 minutes
```

## Storage Architecture

### Two-Tier Storage

The package uses a two-tier storage architecture:

**Hot Storage (DO SQLite)**
- Recent events (last 24-48 hours)
- Active query cache
- Metadata and indexes

**Cold Storage (R2)**
- Historical data as MergeTree parts
- Columnar format for efficient queries
- Automatic tiering based on age

### R2 Provider

The R2Provider implements VFS (Virtual File System) for MergeTree storage:

```typescript
import { R2Provider } from '@dotdo/clickhouse/providers'

const r2 = new R2Provider({
  bucket: env.ANALYTICS_BUCKET,
  prefix: 'analytics/tenant-123',
  cache: {
    enabled: true,
    maxSize: 64 * 1024 * 1024,    // 64MB cache
    maxFileSize: 1024 * 1024,     // Max 1MB per file
    ttl: 5 * 60 * 1000            // 5 minute TTL
  },
  writeBuffer: {
    threshold: 256 * 1024,        // 256KB before flush
    maxCount: 100                 // Max buffered files
  }
})
```

## Types

The package exports comprehensive TypeScript types:

```typescript
import type {
  // Configuration
  BuildProfile,
  ClickHouseConfig,

  // Events
  AnalyticsEvent,
  AnalyticsEventInput,
  PageViewInput,

  // Query
  QueryOptions,
  QueryResult,

  // Analytics
  FunnelStep,
  FunnelResult,
  DateRange,

  // SaaS Metrics
  SaaSMetrics,
  MRRMetrics,
  ChurnMetrics,
  LTVMetrics,

  // Web Analytics
  WebAnalyticsMetrics,

  // Storage
  VFSStorageProvider
} from '@dotdo/clickhouse'
```

## Development

### Building WASM

To build the chdb WASM binary:

```bash
# In ~/projects/clickhouse/packages/chdb-wasm
pnpm install
pnpm build:wasm:minimal   # Minimal profile (~3MB gzipped)
pnpm build:wasm:standard  # Standard profile (~10MB gzipped)
pnpm build:wasm           # All profiles
```

### Testing

```bash
# In this package
npm test                  # Run all tests
npm run typecheck         # TypeScript validation
```

### Local Development

```bash
npm run dev               # Start with Turbo
```

## Roadmap

1. **WASM Integration** (Current Issue: do-az6v)
   - Bundle chdb WASM binary
   - Configure VFS bridge
   - Set up lazy loading for size optimization

2. **MergeTree Support**
   - R2-backed MergeTree parts
   - Automatic compaction
   - Partition pruning

3. **Query Optimization**
   - Result caching
   - Query planning hints
   - Memory-aware execution

4. **Real-time Features**
   - Materialized views
   - Continuous aggregates
   - Event streaming

## Related Packages

- `@dotdo/chdb-wasm` - The underlying WASM binary
- `@dotdo/chdb` - Unified chdb client
- `@dotdo/do` - Durable Object base class (provides storage)
- `@dotdo/api` - Hono API with analytics endpoints

## License

Apache-2.0
