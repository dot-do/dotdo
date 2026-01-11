# DuckDB Analytics

**OLAP on the edge. Milliseconds, not minutes.**

```typescript
import { DuckDB } from '@dotdo/duckdb'

export class AnalyticsDO extends DO {
  private db = new DuckDB(this.ctx)

  async getDailyActiveUsers(days: number) {
    return this.db.query(`
      SELECT DATE_TRUNC('day', timestamp) as day,
             COUNT(DISTINCT user_id) as dau
      FROM events
      WHERE timestamp > NOW() - INTERVAL '${days} days'
      GROUP BY 1 ORDER BY 1
    `)
  }
}
```

**10 million rows. 50ms. On a V8 isolate.**

---

## The Problem

Your analytics dashboard is slow. Users wait 30 seconds for a chart to load. Your data warehouse costs $50k/month and still can't keep up with real-time demands.

Traditional OLAP means:
- Separate data warehouse infrastructure
- ETL pipelines that lag behind reality
- Cold starts measured in seconds
- Per-query costs that add up fast

## The Solution

DuckDB on Cloudflare Workers. Analytics at the edge with:

- **Sub-100ms queries** on millions of rows
- **Zero infrastructure** - runs in V8 isolates
- **Real-time ingestion** - query data as it arrives
- **Parquet from R2** - historical data on demand
- **Per-tenant isolation** - each customer gets their own DO

---

## Features

### Time-Series Aggregations

```typescript
// Daily Active Users
async getDailyActiveUsers(days: number) {
  return this.db.query(`
    SELECT DATE_TRUNC('day', timestamp) as day,
           COUNT(DISTINCT user_id) as dau
    FROM events
    WHERE timestamp > NOW() - INTERVAL '${days} days'
    GROUP BY 1 ORDER BY 1
  `)
}

// Monthly Active Users
async getMonthlyActiveUsers(months: number) {
  return this.db.query(`
    SELECT DATE_TRUNC('month', timestamp) as month,
           COUNT(DISTINCT user_id) as mau
    FROM events
    WHERE timestamp > NOW() - INTERVAL '${months} months'
    GROUP BY 1 ORDER BY 1
  `)
}
```

### Funnel Analysis

```typescript
async getFunnelConversion(steps: string[]) {
  return this.db.query(`
    WITH funnel AS (
      SELECT user_id,
             MAX(CASE WHEN event_type = '${steps[0]}' THEN 1 END) as step_1,
             MAX(CASE WHEN event_type = '${steps[1]}' THEN 1 END) as step_2,
             MAX(CASE WHEN event_type = '${steps[2]}' THEN 1 END) as step_3
      FROM events
      WHERE timestamp > NOW() - INTERVAL '30 days'
      GROUP BY user_id
    )
    SELECT
      COUNT(*) FILTER (WHERE step_1 = 1) as started,
      COUNT(*) FILTER (WHERE step_2 = 1) as engaged,
      COUNT(*) FILTER (WHERE step_3 = 1) as converted
    FROM funnel
  `)
}
```

### Cohort Retention

```typescript
async getCohortRetention(cohortType: string, periods: number) {
  return this.db.query(`
    WITH user_cohorts AS (
      SELECT user_id,
             DATE_TRUNC('month', MIN(timestamp)) as cohort
      FROM events
      WHERE event_type = '${cohortType}'
      GROUP BY user_id
    ),
    retention AS (
      SELECT c.cohort,
             DATEDIFF('month', c.cohort, DATE_TRUNC('month', e.timestamp)) as period,
             COUNT(DISTINCT e.user_id) as retained
      FROM events e
      JOIN user_cohorts c ON e.user_id = c.user_id
      GROUP BY 1, 2
    )
    SELECT cohort, period, retained,
           retained::DECIMAL / FIRST_VALUE(retained) OVER (PARTITION BY cohort ORDER BY period) as retention_rate
    FROM retention
    WHERE period < ${periods}
    ORDER BY cohort DESC, period
  `)
}
```

### Log Analysis

```typescript
async searchLogs(query: string, options: { level?: string; service?: string }) {
  return this.db.query(`
    SELECT timestamp, level, service, message
    FROM logs
    WHERE message ILIKE '%${query}%'
      ${options.level ? `AND level = '${options.level}'` : ''}
      ${options.service ? `AND service = '${options.service}'` : ''}
    ORDER BY timestamp DESC
    LIMIT 100
  `)
}

async getErrorRates(lookback: string) {
  return this.db.query(`
    SELECT service,
           COUNT(*) as total,
           SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) as errors,
           errors::DECIMAL / total * 100 as error_rate
    FROM logs
    WHERE timestamp > NOW() - INTERVAL '${lookback}'
    GROUP BY service
    ORDER BY error_rate DESC
  `)
}
```

### Real-Time Dashboard

```typescript
async getDashboardMetrics() {
  const [activeUsers, topEvents, errorRate, rps] = await Promise.all([
    this.db.query(`
      SELECT
        COUNT(DISTINCT CASE WHEN timestamp > NOW() - INTERVAL '1 minute' THEN user_id END) as last_minute,
        COUNT(DISTINCT CASE WHEN timestamp > NOW() - INTERVAL '1 hour' THEN user_id END) as last_hour,
        COUNT(DISTINCT CASE WHEN timestamp > NOW() - INTERVAL '1 day' THEN user_id END) as last_day
      FROM events
    `),
    this.db.query(`
      SELECT event_type, COUNT(*) as count
      FROM events
      WHERE timestamp > NOW() - INTERVAL '1 hour'
      GROUP BY event_type ORDER BY count DESC LIMIT 10
    `),
    this.db.query(`
      SELECT SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END)::DECIMAL / COUNT(*) * 100
      FROM logs WHERE timestamp > NOW() - INTERVAL '1 hour'
    `),
    this.db.query(`
      SELECT COUNT(*) / 60.0 FROM events WHERE timestamp > NOW() - INTERVAL '1 minute'
    `)
  ])

  return { activeUsers, topEvents, errorRate, rps }
}
```

### Iceberg/Parquet Integration

```typescript
// Load Parquet from R2
async loadHistoricalData(key: string) {
  const object = await this.env.DATA_BUCKET.get(key)
  const buffer = await object.arrayBuffer()
  await this.db.registerBuffer('historical.parquet', buffer)
}

// Query Parquet directly
async queryHistorical(sql: string) {
  return this.db.query(`
    SELECT * FROM parquet_scan('historical.parquet')
    WHERE ${sql}
  `)
}

// Aggregate across time ranges
async aggregateHistorical(column: string, groupBy: string) {
  return this.db.query(`
    SELECT ${groupBy}, SUM(${column}) as total
    FROM parquet_scan('historical.parquet')
    GROUP BY ${groupBy}
    ORDER BY total DESC
  `)
}
```

---

## Quick Start

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy
npm run deploy
```

## API Endpoints

### Time-Series

| Endpoint | Description |
|----------|-------------|
| `GET /api/dau?days=30` | Daily Active Users |
| `GET /api/mau?months=12` | Monthly Active Users |
| `GET /api/timeseries/:event?interval=day` | Event timeseries |

### Analysis

| Endpoint | Description |
|----------|-------------|
| `POST /api/funnel` | Funnel conversion analysis |
| `POST /api/cohort` | Cohort retention analysis |
| `GET /api/dashboard` | Real-time metrics |

### Logs

| Endpoint | Description |
|----------|-------------|
| `GET /api/logs/search?q=error` | Full-text log search |
| `GET /api/errors` | Error rates by service |

### Ingestion

| Endpoint | Description |
|----------|-------------|
| `POST /api/events` | Ingest events (single or batch) |
| `POST /api/logs` | Ingest logs (single or batch) |

### Parquet

| Endpoint | Description |
|----------|-------------|
| `POST /api/parquet/load` | Load Parquet from R2 |
| `POST /api/parquet/query` | Query Parquet files |
| `POST /api/parquet/aggregate` | Aggregate historical data |

### Raw SQL

| Endpoint | Description |
|----------|-------------|
| `POST /api/query` | Execute arbitrary SQL |

### High-Throughput Streaming (EventsDO)

For high-throughput event ingestion with automatic aggregation and materialized views:

| Endpoint | Description |
|----------|-------------|
| `POST /api/stream/events` | Buffered event ingestion (auto-flushes at 1000 events or 5s) |
| `POST /api/stream/flush` | Force flush event buffer to storage |
| `GET /api/stream/stats` | Ingestion statistics (buffer size, totals) |
| `GET /api/stream/hourly?start=&end=` | Pre-aggregated hourly event counts |
| `GET /api/stream/daily?start=&end=` | Pre-aggregated daily event counts |
| `GET /api/stream/types` | Event type distribution from materialized views |
| `GET /api/stream/views` | List materialized views with row counts |

The streaming endpoints use a separate EventsDO that provides:
- **Buffered writes** - Events are batched before writing to reduce storage operations
- **Auto-aggregation** - Hourly, daily, and event type counts are updated on flush
- **Materialized views** - Pre-computed aggregations for instant queries
- **Alarm-based flushing** - Periodic flush every 5 seconds via DO alarms

---

## Multi-Tenant

Each tenant gets an isolated DuckDB instance. Pass `?tenant=acme` to any endpoint:

```bash
# Tenant-specific DAU
curl https://analytics.example.com/api/dau?tenant=acme

# Tenant-specific ingestion
curl -X POST https://analytics.example.com/api/events?tenant=acme \
  -H "Content-Type: application/json" \
  -d '[{"id":"1","timestamp":"2024-01-01T00:00:00Z","user_id":"alice","event_type":"signup"}]'
```

---

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Cold start | <500ms | First WASM load |
| Warm queries | <10ms | Cached instance |
| 1M row aggregation | ~50ms | GROUP BY + SUM |
| 10M row scan | ~200ms | Filter + COUNT |
| Parquet load (10MB) | ~100ms | R2 fetch + register |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Worker                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Request ──▶ Hono Router ──▶ AnalyticsDO ──▶ DuckDB WASM          │
│                                    │              │                 │
│                                    ▼              ▼                 │
│                                R2 Bucket     In-Memory              │
│                               (Parquet)      Analysis               │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│   Hot Tier        │   Warm Tier      │   Cold Tier                 │
│   (DuckDB)        │   (R2 Parquet)   │   (Archive)                 │
│   Real-time       │   Historical     │   Compliance                │
│   Sub-ms query    │   ~100ms load    │   On-demand                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Configuration

### wrangler.jsonc

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "ANALYTICS_DO", "class_name": "AnalyticsDO" }]
  },
  "r2_buckets": [
    { "binding": "DATA_BUCKET", "bucket_name": "analytics-data" }
  ]
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ENVIRONMENT` | `production` or `development` |

---

## Why DuckDB?

DuckDB is an in-process OLAP database optimized for analytical workloads:

- **Columnar storage** - Only reads columns you SELECT
- **Vectorized execution** - Processes data in batches
- **Zero dependencies** - Embedded in your application
- **SQL standard** - Window functions, CTEs, aggregations

On Workers, we use a custom WASM build that runs in V8 isolates without the GOT.func/GOT.mem imports that standard builds require.

---

## Comparison

| Feature | This Example | Traditional DW | Serverless DW |
|---------|--------------|----------------|---------------|
| Cold start | <500ms | N/A | 5-30s |
| Query latency | 10-100ms | 100ms-10s | 1-30s |
| Cost | Per-request | $1k+/mo | Per-query |
| Real-time | Yes | ETL lag | Minutes |
| Multi-tenant | Native | Schema isolation | Query tagging |

---

Built with [dotdo](https://dotdo.dev) | Powered by [DuckDB](https://duckdb.org)
