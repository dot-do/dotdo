# Observability Reference

This document provides comprehensive technical documentation for dotdo's observability infrastructure, covering the actual implementation details of metrics collection, distributed tracing, health checks, and integration with external monitoring systems.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Metrics System](#metrics-system)
3. [OpenTelemetry Tracing](#opentelemetry-tracing)
4. [Health Check Endpoints](#health-check-endpoints)
5. [Prometheus Export](#prometheus-export)
6. [Grafana Integration](#grafana-integration)
7. [Datadog Integration](#datadog-integration)
8. [Alerting Recommendations](#alerting-recommendations)
9. [Shard Metrics and Hot Spot Detection](#shard-metrics-and-hot-spot-detection)

---

## Architecture Overview

dotdo's observability stack is built on three pillars:

```
                                    +--------------------+
                                    |  External Systems  |
                                    |  (Grafana/Datadog) |
                                    +--------------------+
                                             ^
                                             |
+------------------+    +-------------------+|+------------------+
|  OtelTracer      |    |   Prometheus      |||  Health Check    |
|  (Distributed    |--->|   Exporter        ||+->  Manager        |
|   Tracing)       |    |   (/metrics)      ||    (/health/*)    |
+------------------+    +-------------------+|+------------------+
         ^                       ^          |         ^
         |                       |          |         |
         +----------+------------+----------+---------+
                    |
            +----------------+
            | MetricsCollector|
            | (Unified Store) |
            +----------------+
                    ^
                    |
    +---------------+---------------+
    |               |               |
+--------+    +---------+    +----------+
| State  |    | Pipeline|    | Checkpoint|
| Manager|    | Emitter |    | Manager   |
+--------+    +---------+    +----------+
```

**Key Files:**
- `/objects/unified-storage/metrics.ts` - Core metrics collection
- `/objects/unified-storage/otel-tracer.ts` - OpenTelemetry tracing
- `/objects/unified-storage/prometheus-exporter.ts` - Prometheus format export
- `/objects/unified-storage/health-check.ts` - Health check endpoints
- `/objects/unified-storage/shard-metrics.ts` - Shard-level metrics and hot spot detection

---

## Metrics System

### MetricsCollector

The `MetricsCollector` class (`/objects/unified-storage/metrics.ts`) provides comprehensive metrics for unified storage components.

#### Metric Types

**Counter** - Monotonically increasing values:
```typescript
interface Counter {
  value: number
  inc(amount?: number): void
  reset(): void
}
```

**Gauge** - Values that can increase or decrease:
```typescript
interface Gauge {
  value: number
  set(value: number): void
  inc(amount?: number): void
  dec(amount?: number): void
}
```

**Histogram** - Distribution tracking with percentiles:
```typescript
interface Histogram {
  observe(value: number): void
  count: number
  sum: number
  mean: number
  min: number
  max: number
  percentile(p: number): number  // p: 0-100
  reset(): void
}
```

#### Available Metrics

##### State Manager Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `entriesCount` | Gauge | Current number of entries in memory |
| `entriesBytes` | Gauge | Current memory usage in bytes |
| `dirtyCount` | Gauge | Entries pending checkpoint to SQLite |
| `cacheHits` | Counter | Cache hit count |
| `cacheMisses` | Counter | Cache miss count |
| `evictionsCount` | Counter | Total evictions performed |
| `evictionsBytes` | Counter | Total bytes evicted |

##### Pipeline Emitter Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `eventsEmitted` | Counter | Total events emitted to pipeline |
| `eventsBatched` | Gauge | Events waiting in buffer |
| `flushCount` | Counter | Number of flush operations |
| `flushLatency` | Histogram | Flush duration in milliseconds |
| `errorsCount` | Counter | Failed emission count |
| `dlqCount` | Counter | Dead letter queue sends |
| `retryCount` | Counter | Retry attempts |

##### Checkpoint Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `checkpointCount` | Counter | Total checkpoints performed |
| `checkpointLatency` | Histogram | Checkpoint duration in ms |
| `rowsWritten` | Counter | SQLite rows written |
| `bytesWritten` | Counter | Bytes written to SQLite |
| `columnarWrites` | Counter | Efficient single-row collection writes |
| `normalizedWrites` | Counter | Individual row writes |
| `triggerCounts` | Record | Checkpoints by trigger type |

**Checkpoint Trigger Types:**
- `timer` - Scheduled checkpoint
- `threshold` - Dirty count threshold exceeded
- `hibernation` - DO hibernation event
- `manual` - Explicit flush call
- `count` - Entry count trigger
- `memory` - Memory pressure trigger

##### Recovery Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `duration` | Histogram | Cold start recovery duration |
| `sourceCount` | Record | Recoveries by source type |
| `thingsLoaded` | Counter | Entities loaded from recovery |
| `eventsReplayed` | Counter | Events replayed from Iceberg |
| `errorsCount` | Counter | Recovery errors |

**Recovery Sources:**
- `sqlite` - Recovered from local SQLite
- `iceberg` - Recovered from Iceberg data lake
- `empty` - Fresh start with no data

#### Usage Example

```typescript
import { MetricsCollector } from './metrics'

const metrics = new MetricsCollector()

// Record state manager metrics
metrics.state.entriesCount.set(100)
metrics.state.cacheHits.inc()

// Record pipeline metrics
metrics.pipeline.eventsEmitted.inc(10)
metrics.pipeline.flushLatency.observe(15.5)

// Record checkpoint metrics
metrics.checkpoint.checkpointCount.inc()
metrics.checkpoint.triggerCounts.timer.inc()

// Get snapshot for export
const snapshot = metrics.snapshot()
console.log(snapshot.state.cache.hitRate)  // Calculated hit ratio
```

#### Metrics Snapshot Format

```typescript
interface MetricsSnapshot {
  timestamp: number
  state: {
    entries: { count: number; bytes: number }
    dirty: { count: number }
    cache: { hits: number; misses: number; hitRate: number }
    evictions: { count: number; bytes: number }
  }
  pipeline: {
    events: { emitted: number; batched: number }
    flushes: {
      count: number
      latency: { mean: number; p50: number; p95: number; p99: number }
    }
    errors: { count: number; dlq: number; retries: number }
  }
  checkpoint: {
    count: number
    latency: { mean: number; p50: number; p95: number; p99: number }
    rows: { written: number; columnar: number; normalized: number }
    bytes: number
    triggers: Record<MetricCheckpointTrigger, number>
  }
  recovery: {
    latency: { mean: number; p50: number; p95: number; p99: number }
    sources: Record<MetricRecoverySource, number>
    things: number
    events: number
    errors: number
  }
}
```

---

## OpenTelemetry Tracing

### OtelTracer

The `OtelTracer` class (`/objects/unified-storage/otel-tracer.ts`) provides OpenTelemetry-compatible distributed tracing.

#### Configuration

```typescript
interface TracerConfig {
  serviceName: string           // Required: identifies the service
  namespace?: string            // Optional: tenant/namespace (default: 'default')
  exporter?: SpanExporter       // Optional: custom span exporter
  samplingRate?: number         // Optional: 0.0-1.0 (default: 1.0)
  defaultAttributes?: Record<string, string>  // Optional: attributes on all spans
  batchSize?: number            // Optional: export batch size (default: 100)
}
```

#### Creating a Tracer

```typescript
import { createUnifiedStorageTracer, OtelTracer } from './otel-tracer'

const tracer = createUnifiedStorageTracer({
  serviceName: 'unified-storage',
  namespace: 'tenant-1',
  samplingRate: 0.1,  // 10% sampling
  defaultAttributes: {
    'deployment.environment': 'production',
  },
})
```

#### Creating Spans

**Manual Span Management:**
```typescript
const span = tracer.startSpan('operation-name', {
  kind: 'server',  // 'internal' | 'client' | 'server' | 'producer' | 'consumer'
  attributes: {
    'custom.attribute': 'value',
  },
})

span.setAttribute('result.count', 42)
span.addEvent('checkpoint', { entries: 100 })

try {
  // ... operation ...
  span.setStatus('ok')
} catch (error) {
  span.setStatus('error')
  span.addEvent('exception', {
    'exception.type': error.name,
    'exception.message': error.message,
  })
} finally {
  span.end()
}
```

**Automatic Tracing with `traced()`:**
```typescript
const result = await tracer.traced('database-query', async (span) => {
  span.setAttribute('db.operation', 'SELECT')
  span.setAttribute('db.table', 'things')

  const rows = await db.query('SELECT * FROM things')
  span.setAttribute('db.rows_affected', rows.length)

  return rows
})
// Span automatically ends with 'ok' status on success
// Span automatically records exception and 'error' status on failure
```

#### Context Propagation

**W3C Trace Context (traceparent header):**
```typescript
// Extract context from incoming request
const context = tracer.extractContext({
  traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
})

// Create child span with parent context
const span = tracer.startSpan('child-operation', { context })

// Inject context for outgoing requests
const headers = tracer.injectContext(span)
// { traceparent: '00-0af7651916cd43dd8448eb211c80319c-<new-span-id>-01' }
```

**Pipeline Event Enrichment:**
```typescript
// Add trace context to domain events
const enrichedEvent = tracer.enrichPipelineEvent(event, span)
// { ...event, traceId: '...', spanId: '...' }

// Extract context from enriched events
const context = tracer.extractFromPipelineEvent(enrichedEvent)
```

#### Span Data Structure

```typescript
interface CollectedSpan {
  traceId: string           // 32 hex characters
  spanId: string            // 16 hex characters
  parentSpanId?: string     // 16 hex characters (if child span)
  name: string              // Operation name
  kind: 'internal' | 'client' | 'server' | 'producer' | 'consumer'
  startTimeMs: number       // Unix timestamp in milliseconds
  endTimeMs?: number        // Unix timestamp in milliseconds
  status: 'ok' | 'error' | 'unset'
  attributes: Record<string, string | number | boolean>
  events: SpanEvent[]       // Named events with timestamps
}
```

#### Custom Span Exporter

```typescript
interface SpanExporter {
  export(spans: CollectedSpan[]): Promise<void>
  shutdown(): Promise<void>
}

// Example: Console exporter for development
const consoleExporter: SpanExporter = {
  async export(spans) {
    for (const span of spans) {
      console.log(`[TRACE] ${span.name} (${span.endTimeMs - span.startTimeMs}ms)`)
    }
  },
  async shutdown() {
    // Cleanup
  }
}

const tracer = createUnifiedStorageTracer({
  serviceName: 'my-service',
  exporter: consoleExporter,
})
```

---

## Health Check Endpoints

### HealthCheckManager

The `HealthCheckManager` class (`/objects/unified-storage/health-check.ts`) provides Kubernetes-compatible health check endpoints.

#### Endpoints

| Endpoint | Purpose | Response Time | Use Case |
|----------|---------|---------------|----------|
| `/health/live` | Liveness probe | Instant | Is the DO running? |
| `/health/ready` | Readiness probe | Fast | Can it serve requests? |
| `/health` | Detailed health | May be slow | Full component status |

#### Configuration

```typescript
interface HealthCheckConfig {
  stateManager: StateManager         // Required: state manager instance
  pipelineEmitter: PipelineEmitter   // Required: pipeline emitter instance
  sqlStorage: SqlStorage             // Required: SQL storage instance
  replicationManager?: ReplicationManager  // Optional: replication manager
  doId?: string                      // Optional: DO identifier for responses
  thresholds?: HealthThresholds      // Optional: custom thresholds
  cacheStatusMs?: number             // Optional: cache duration (default: 1000ms)
  customCheckTimeoutMs?: number      // Optional: custom check timeout (default: 5000ms)
  overallTimeoutMs?: number          // Optional: overall timeout (default: 5000ms)
}
```

#### Threshold Configuration

```typescript
interface HealthThresholds {
  pipelinePendingWarning?: number     // Default: 1000
  pipelinePendingCritical?: number    // Default: 5000
  dirtyCountWarning?: number          // Default: 1000
  dirtyCountCritical?: number         // Default: 50000
  checkpointAgeWarningMs?: number     // Default: 30000 (30s)
  checkpointAgeCriticalMs?: number    // Default: 120000 (2min)
  replicationLagWarningMs?: number    // Default: 5000 (5s)
  replicationLagCriticalMs?: number   // Default: 30000 (30s)
}
```

#### Health Status Levels

| Status | HTTP Code | Meaning |
|--------|-----------|---------|
| `healthy` | 200 | All systems operational |
| `degraded` | 200 | Non-critical issues detected |
| `unhealthy` | 503 | Critical issues, cannot serve requests |
| `unknown` | 503 | Unable to determine status |

#### Response Formats

**Liveness Probe (`/health/live`):**
```json
{
  "alive": true,
  "timestamp": "2024-01-15T14:32:00.000Z",
  "doId": "do_abc123",
  "uptimeMs": 3600000
}
```

**Readiness Probe (`/health/ready`):**
```json
{
  "ready": true,
  "loadDurationMs": 150
}
```

Or when not ready:
```json
{
  "ready": false,
  "reason": "State is loading during cold start recovery",
  "recoveryProgress": {
    "phase": "loading_things",
    "loaded": 5000,
    "total": 10000,
    "elapsedMs": 2500,
    "percentComplete": 50
  }
}
```

**Detailed Health (`/health`):**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T14:32:00.000Z",
  "uptimeMs": 3600000,
  "components": {
    "state": {
      "status": "healthy",
      "loaded": true,
      "thingCount": 10000,
      "dirtyCount": 50
    },
    "pipeline": {
      "status": "healthy",
      "connected": true,
      "pendingEvents": 10,
      "errorCount": 0
    },
    "sql": {
      "status": "healthy",
      "pendingWrites": 0,
      "avgQueryLatencyMs": 5,
      "lastCheckpointAgeMs": 5000
    }
  },
  "replication": {
    "role": "leader",
    "lagMs": 0,
    "followerCount": 2,
    "status": "healthy"
  }
}
```

#### Custom Health Checks

```typescript
const healthManager = new HealthCheckManager(config)

// Register custom health check
healthManager.registerHealthCheck('external-api', async () => {
  const start = Date.now()
  try {
    const response = await fetch('https://api.example.com/health')
    return {
      status: response.ok ? 'healthy' : 'unhealthy',
      name: 'external-api',
      latencyMs: Date.now() - start,
      statusCode: response.status,
    }
  } catch (error) {
    return {
      status: 'unhealthy',
      name: 'external-api',
      error: error.message,
    }
  }
})

// Unregister when no longer needed
healthManager.unregisterHealthCheck('external-api')
```

---

## Prometheus Export

### PrometheusExporter

The `PrometheusExporter` class (`/objects/unified-storage/prometheus-exporter.ts`) exports metrics in Prometheus text exposition format.

#### Configuration

```typescript
interface PrometheusExporterConfig {
  namespace: string                    // Required: DO namespace/tenant identifier
  maxEntityTypeCardinality?: number    // Optional: max entity_type labels (default: 50)
}
```

#### Available Prometheus Metrics

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `dotdo_info` | gauge | `namespace`, `version` | Instance information |
| `dotdo_writes_total` | counter | `namespace`, `operation_type`, `entity_type` | Write operations |
| `dotdo_reads_total` | counter | `namespace`, `entity_type`, `cache_status` | Read operations |
| `dotdo_cache_hits_total` | counter | `namespace` | Cache hits |
| `dotdo_events_emitted_total` | counter | `namespace`, `event_type` | Events emitted |
| `dotdo_checkpoints_total` | counter | `namespace`, `trigger_type` | Checkpoint operations |
| `dotdo_operation_duration_seconds` | histogram | `namespace`, `operation_type`, `entity_type` | Operation latency |
| `dotdo_batch_size` | histogram | `namespace`, `batch_type` | Batch sizes |
| `dotdo_checkpoint_duration_seconds` | histogram | `namespace`, `trigger_type` | Checkpoint latency |
| `dotdo_recovery_duration_seconds` | histogram | `namespace`, `recovery_source` | Recovery latency |
| `dotdo_buffer_size` | gauge | `namespace`, `buffer_type` | Buffer sizes |
| `dotdo_dirty_entries_count` | gauge | `namespace` | Dirty entry count |
| `dotdo_entries_count` | gauge | `namespace` | Total entry count |
| `dotdo_entries_bytes` | gauge | `namespace` | Memory usage |
| `dotdo_replication_lag_seconds` | gauge | `namespace` | Replication lag |
| `dotdo_cache_hit_ratio` | gauge | `namespace` | Cache hit ratio (0-1) |

#### Histogram Buckets

**Latency Buckets (seconds):**
```
0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10
```

**Batch Size Buckets:**
```
1, 5, 10, 25, 50, 100, 250, 500, 1000
```

#### Usage Example

```typescript
import { PrometheusExporter } from './prometheus-exporter'
import { MetricsCollector } from './metrics'

const metrics = new MetricsCollector()
const exporter = new PrometheusExporter(metrics, {
  namespace: 'tenant-1',
  maxEntityTypeCardinality: 50,
})

// Track operations with labels
exporter.trackOperation('create', 'Customer', 0.005)  // 5ms
exporter.trackOperation('read', 'Order', 0.002)       // 2ms cache hit
exporter.trackRead('Order', true)  // cache hit
exporter.trackRead('Product', false)  // cache miss

// Track events
exporter.trackEvent('thing.created')
exporter.trackEvent('thing.updated')

// Track checkpoints
exporter.trackCheckpoint('timer', 0.150)  // 150ms
exporter.trackBatch('checkpoint', 100)    // 100 entries

// Export all metrics
const prometheusText = exporter.export()
```

#### Output Example

```prometheus
# HELP dotdo_info Information about the dotdo instance
# TYPE dotdo_info gauge
dotdo_info{namespace="tenant-1",version="1.0.0"} 1

# HELP dotdo_writes_total Total number of write operations to the unified store
# TYPE dotdo_writes_total counter
dotdo_writes_total{namespace="tenant-1",operation_type="create",entity_type="Customer"} 150
dotdo_writes_total{namespace="tenant-1",operation_type="update",entity_type="Order"} 89

# HELP dotdo_operation_duration_seconds Duration of operations in seconds by operation type
# TYPE dotdo_operation_duration_seconds histogram
dotdo_operation_duration_seconds_bucket{namespace="tenant-1",operation_type="create",entity_type="Customer",le="0.001"} 10
dotdo_operation_duration_seconds_bucket{namespace="tenant-1",operation_type="create",entity_type="Customer",le="0.005"} 120
dotdo_operation_duration_seconds_bucket{namespace="tenant-1",operation_type="create",entity_type="Customer",le="0.01"} 145
dotdo_operation_duration_seconds_bucket{namespace="tenant-1",operation_type="create",entity_type="Customer",le="+Inf"} 150
dotdo_operation_duration_seconds_sum{namespace="tenant-1",operation_type="create",entity_type="Customer"} 0.425
dotdo_operation_duration_seconds_count{namespace="tenant-1",operation_type="create",entity_type="Customer"} 150

# HELP dotdo_cache_hit_ratio Current cache hit ratio between 0 and 1
# TYPE dotdo_cache_hit_ratio gauge
dotdo_cache_hit_ratio{namespace="tenant-1"} 0.85
```

#### Hibernation Survival

The exporter supports serialization for DO hibernation:

```typescript
// Before hibernation
const state = exporter.serialize()
await storage.put('prometheus_state', state)

// After wake
const savedState = await storage.get('prometheus_state')
if (savedState) {
  exporter.deserialize(savedState)
}
```

---

## Grafana Integration

### Prometheus Data Source

Configure Grafana to scrape your `/metrics` endpoint:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'dotdo'
    scrape_interval: 15s
    static_configs:
      - targets: ['your-worker.your-domain.workers.dev']
    metrics_path: /metrics
    scheme: https
```

### Dashboard JSON

Save this as a Grafana dashboard:

```json
{
  "title": "dotdo Unified Storage",
  "uid": "dotdo-unified-storage",
  "tags": ["dotdo", "durable-objects"],
  "timezone": "browser",
  "refresh": "30s",
  "panels": [
    {
      "title": "Request Rate",
      "type": "timeseries",
      "gridPos": { "x": 0, "y": 0, "w": 12, "h": 8 },
      "targets": [
        {
          "expr": "sum(rate(dotdo_writes_total[5m])) by (operation_type)",
          "legendFormat": "{{operation_type}}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "reqps"
        }
      }
    },
    {
      "title": "Operation Latency (p99)",
      "type": "timeseries",
      "gridPos": { "x": 12, "y": 0, "w": 12, "h": 8 },
      "targets": [
        {
          "expr": "histogram_quantile(0.99, sum(rate(dotdo_operation_duration_seconds_bucket[5m])) by (le, operation_type))",
          "legendFormat": "{{operation_type}} p99"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "s"
        }
      }
    },
    {
      "title": "Cache Hit Ratio",
      "type": "gauge",
      "gridPos": { "x": 0, "y": 8, "w": 6, "h": 6 },
      "targets": [
        {
          "expr": "dotdo_cache_hit_ratio"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percentunit",
          "min": 0,
          "max": 1,
          "thresholds": {
            "mode": "percentage",
            "steps": [
              { "value": 0, "color": "red" },
              { "value": 50, "color": "yellow" },
              { "value": 80, "color": "green" }
            ]
          }
        }
      }
    },
    {
      "title": "Dirty Entries",
      "type": "stat",
      "gridPos": { "x": 6, "y": 8, "w": 6, "h": 6 },
      "targets": [
        {
          "expr": "dotdo_dirty_entries_count"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "thresholds": {
            "steps": [
              { "value": 0, "color": "green" },
              { "value": 1000, "color": "yellow" },
              { "value": 5000, "color": "red" }
            ]
          }
        }
      }
    },
    {
      "title": "Checkpoint Duration",
      "type": "timeseries",
      "gridPos": { "x": 12, "y": 8, "w": 12, "h": 6 },
      "targets": [
        {
          "expr": "histogram_quantile(0.99, sum(rate(dotdo_checkpoint_duration_seconds_bucket[5m])) by (le))",
          "legendFormat": "p99"
        },
        {
          "expr": "histogram_quantile(0.50, sum(rate(dotdo_checkpoint_duration_seconds_bucket[5m])) by (le))",
          "legendFormat": "p50"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "s"
        }
      }
    },
    {
      "title": "Events Emitted Rate",
      "type": "timeseries",
      "gridPos": { "x": 0, "y": 14, "w": 12, "h": 6 },
      "targets": [
        {
          "expr": "sum(rate(dotdo_events_emitted_total[5m])) by (event_type)",
          "legendFormat": "{{event_type}}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "evtps"
        }
      }
    },
    {
      "title": "Buffer Sizes",
      "type": "timeseries",
      "gridPos": { "x": 12, "y": 14, "w": 12, "h": 6 },
      "targets": [
        {
          "expr": "dotdo_buffer_size",
          "legendFormat": "{{buffer_type}}"
        }
      ]
    },
    {
      "title": "Checkpoints by Trigger",
      "type": "piechart",
      "gridPos": { "x": 0, "y": 20, "w": 8, "h": 8 },
      "targets": [
        {
          "expr": "sum(dotdo_checkpoints_total) by (trigger_type)",
          "legendFormat": "{{trigger_type}}"
        }
      ]
    },
    {
      "title": "Recovery Duration",
      "type": "timeseries",
      "gridPos": { "x": 8, "y": 20, "w": 16, "h": 8 },
      "targets": [
        {
          "expr": "histogram_quantile(0.99, sum(rate(dotdo_recovery_duration_seconds_bucket[5m])) by (le, recovery_source))",
          "legendFormat": "{{recovery_source}} p99"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "s"
        }
      }
    }
  ]
}
```

### Key Queries for Grafana

**Error Rate:**
```promql
sum(rate(dotdo_writes_total{operation_type!="read"}[5m])) by (entity_type)
/ sum(rate(dotdo_writes_total[5m]))
```

**Cache Efficiency:**
```promql
sum(dotdo_cache_hits_total) / (sum(dotdo_cache_hits_total) + sum(dotdo_reads_total{cache_status="miss"}))
```

**Checkpoint Throughput:**
```promql
sum(rate(dotdo_checkpoints_total[5m]))
```

**Average Operation Latency:**
```promql
sum(rate(dotdo_operation_duration_seconds_sum[5m]))
/ sum(rate(dotdo_operation_duration_seconds_count[5m]))
```

---

## Datadog Integration

### Metrics Submission

Use the Datadog API to submit metrics from your worker:

```typescript
async function submitToDatadog(metrics: MetricsSnapshot, config: {
  apiKey: string
  site?: string  // 'datadoghq.com' | 'datadoghq.eu' | 'us3.datadoghq.com'
}) {
  const site = config.site || 'datadoghq.com'
  const now = Math.floor(Date.now() / 1000)

  const series = [
    {
      metric: 'dotdo.entries.count',
      type: 'gauge',
      points: [[now, metrics.state.entries.count]],
      tags: ['env:production'],
    },
    {
      metric: 'dotdo.cache.hit_ratio',
      type: 'gauge',
      points: [[now, metrics.state.cache.hitRate]],
      tags: ['env:production'],
    },
    {
      metric: 'dotdo.checkpoint.count',
      type: 'count',
      points: [[now, metrics.checkpoint.count]],
      tags: ['env:production'],
    },
    {
      metric: 'dotdo.checkpoint.latency.p99',
      type: 'gauge',
      points: [[now, metrics.checkpoint.latency.p99]],
      tags: ['env:production'],
    },
  ]

  await fetch(`https://api.${site}/api/v2/series`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'DD-API-KEY': config.apiKey,
    },
    body: JSON.stringify({ series }),
  })
}
```

### Trace Submission (APM)

```typescript
async function submitTraceToDatadog(spans: CollectedSpan[], config: {
  apiKey: string
  site?: string
}) {
  const site = config.site || 'datadoghq.com'

  const traces = spans.map(span => ({
    trace_id: BigInt(`0x${span.traceId.slice(16)}`).toString(),
    span_id: BigInt(`0x${span.spanId}`).toString(),
    parent_id: span.parentSpanId ? BigInt(`0x${span.parentSpanId}`).toString() : '0',
    name: span.name,
    service: 'dotdo-unified-storage',
    resource: span.name,
    type: span.kind === 'server' ? 'web' : 'custom',
    start: span.startTimeMs * 1000000,  // nanoseconds
    duration: ((span.endTimeMs || span.startTimeMs) - span.startTimeMs) * 1000000,
    error: span.status === 'error' ? 1 : 0,
    meta: Object.fromEntries(
      Object.entries(span.attributes)
        .filter(([_, v]) => typeof v === 'string')
    ),
    metrics: Object.fromEntries(
      Object.entries(span.attributes)
        .filter(([_, v]) => typeof v === 'number')
    ),
  }))

  await fetch(`https://trace.agent.${site}/v0.4/traces`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/msgpack',
      'X-Datadog-Trace-Count': traces.length.toString(),
    },
    body: msgpack.encode([traces]),
  })
}
```

---

## Alerting Recommendations

### Critical Alerts (PagerDuty)

| Alert | Condition | Severity | Response |
|-------|-----------|----------|----------|
| Health Check Failed | `/health/ready` returns 503 for 2min | Critical | Investigate DO state, check logs |
| High Error Rate | `error_rate > 5%` for 5min | Critical | Check error logs, recent deployments |
| Recovery Timeout | `recovery_duration > 60s` | Critical | Check Iceberg connectivity, data corruption |
| Checkpoint Backlog | `dirty_entries > 50000` | Critical | Force checkpoint, scale horizontally |

### Warning Alerts (Slack)

| Alert | Condition | Severity | Response |
|-------|-----------|----------|----------|
| Degraded Cache | `cache_hit_ratio < 0.5` for 10min | Warning | Review access patterns, increase cache size |
| Slow Checkpoints | `checkpoint_p99 > 1s` for 10min | Warning | Check SQLite health, batch sizes |
| High Pipeline Backlog | `events_batched > 1000` | Warning | Check pipeline connectivity |
| Replication Lag | `replication_lag > 5s` | Warning | Check follower health |

### Prometheus Alerting Rules

```yaml
groups:
  - name: dotdo
    rules:
      - alert: DotdoHighErrorRate
        expr: |
          sum(rate(dotdo_writes_total{status=~"error.*"}[5m]))
          / sum(rate(dotdo_writes_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate in dotdo ({{ $value | humanizePercentage }})"

      - alert: DotdoLowCacheHitRate
        expr: dotdo_cache_hit_ratio < 0.5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Low cache hit rate ({{ $value | humanizePercentage }})"

      - alert: DotdoCheckpointBacklog
        expr: dotdo_dirty_entries_count > 50000
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Checkpoint backlog too high ({{ $value }} entries)"

      - alert: DotdoSlowCheckpoints
        expr: |
          histogram_quantile(0.99,
            sum(rate(dotdo_checkpoint_duration_seconds_bucket[5m])) by (le)
          ) > 1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Checkpoint p99 latency too high ({{ $value | humanizeDuration }})"
```

---

## Shard Metrics and Hot Spot Detection

### ShardMetricsCollector

The `ShardMetricsCollector` class (`/objects/unified-storage/shard-metrics.ts`) provides per-shard metrics for routing operations.

#### Configuration

```typescript
const collector = new ShardMetricsCollector({
  shardCount: 16,              // Number of shards
  windowMs: 60000,             // Sliding window (default: 1 minute)
  maxLatencySamples: 1000,     // Max samples per shard
})
```

#### Recording Operations

```typescript
// Record operation: shardIndex, type, bytes, latencyMs
collector.recordOperation(5, 'read', 1024, 15.5)
collector.recordOperation(5, 'write', 2048, 25.0)
```

#### Shard Metrics Snapshot

```typescript
interface ShardMetricsSnapshot {
  shardIndex: number
  requestCount: number
  readCount: number
  writeCount: number
  bytesTransferred: number
  averageLatencyMs: number
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  lastActivityAt: number
}

const snapshot = collector.getShardSnapshot(5)
const allSnapshots = collector.snapshot()
```

### HotSpotDetector

Identifies overloaded shards for rebalancing:

```typescript
const detector = new HotSpotDetector(collector, {
  hotThresholdMultiplier: 2.0,      // 2x average = hot
  minRequestsForHotDetection: 10,   // Minimum data before detection
  windowMs: 60000,                  // Analysis window
  enableAlerts: true,               // Enable callbacks
})

// Subscribe to hot spot events
detector.onHotSpot((event) => {
  console.log(`${event.type}: ${event.details}`)
})

// Get current hot shards
const hotShards = detector.getHotShards()
// [{ shardIndex: 5, requestCount: 1500, loadRatio: 2.5, reason: 'request_count' }]

// Get distribution score (0-1, 1 = perfectly uniform)
const distribution = detector.getDistributionScore()
// { score: 0.85, coefficientOfVariation: 0.15, hottestShard: 5, coldestShard: 2 }

// Check if rebalancing needed
if (detector.needsRebalancing()) {
  // Trigger rebalancing logic
}
```

### Instrumented Forwarding

```typescript
import { createInstrumentedForward } from './shard-metrics'

const instrumentedForward = createInstrumentedForward(
  (key, req) => router.forward(key, req),  // Original forward function
  (key) => router.getShardIndex(key),       // Shard index resolver
  collector                                  // Metrics collector
)

// Use instrumented forward - automatically records metrics
const response = await instrumentedForward('customer-123', request)
```

---

## Best Practices

### 1. Label Cardinality

Keep label cardinality low to prevent metric explosion:

```typescript
// Good: Low cardinality
trackOperation('create', 'Customer', duration)  // ~5-10 entity types

// Bad: High cardinality
trackOperation('create', `Customer-${customerId}`, duration)  // Millions of series
```

### 2. Sampling Strategy

For high-volume systems:

```typescript
const tracer = createUnifiedStorageTracer({
  serviceName: 'high-volume-service',
  samplingRate: 0.01,  // 1% sampling
})

// Always trace errors regardless of sampling
if (error) {
  const span = tracer.startSpan('error-handling')
  span.setStatus('error')
  // ...
}
```

### 3. Health Check Caching

Avoid expensive health checks on every request:

```typescript
const healthManager = new HealthCheckManager({
  ...config,
  cacheStatusMs: 1000,  // Cache for 1 second
  customCheckTimeoutMs: 5000,  // Timeout slow checks
})
```

### 4. Metric Naming Conventions

Follow consistent naming:
- Use `dotdo_` prefix for all metrics
- Use snake_case
- Include units in name: `_seconds`, `_bytes`, `_total`
- Use labels for dimensions, not metric names

### 5. Alerting Thresholds

Set thresholds based on historical data:

```typescript
// Query historical p99 to set baseline
const baseline = await queryPrometheus(`
  quantile_over_time(0.99,
    dotdo_checkpoint_duration_seconds[7d]
  )
`)

// Set alert at 2x baseline
const alertThreshold = baseline * 2
```

---

## Related Documentation

- [Observability Overview](/docs/observability/index.mdx) - High-level concepts
- [Logging](/docs/observability/logging.mdx) - Structured logging
- [Metrics](/docs/observability/metrics.mdx) - Business metrics
- [Tracing](/docs/observability/tracing.mdx) - Distributed tracing
- [Dashboards](/docs/observability/dashboards.mdx) - Dashboard setup
