# Sharding Patterns for Durable Objects

This guide documents the sharding strategies available in dotdo for distributing workloads across multiple Durable Object instances.

## Overview

Durable Objects provide strong consistency with single-threaded execution, which means each DO can handle only one request at a time. For high-throughput scenarios, you need to distribute load across multiple DO instances. This is called **sharding**.

```
                           ┌─────────────────────────────────────────┐
                           │              Worker                      │
                           │  ┌────────────────────────────────┐     │
   Request                 │  │         ShardRouter            │     │
   tenant.api.dotdo.dev    │  │                                │     │
   /users/user-123         │  │  namespace: 'tenant'           │     │
          │                │  │  entityType: 'users'           │     │
          │                │  │  entityId: 'user-123'          │     │
          ▼                │  │           │                    │     │
      ┌───────┐            │  │           ▼                    │     │
      │ Route │ ──────────►│  │  hash('user-123') % 32 = 7    │     │
      └───────┘            │  │           │                    │     │
                           │  │           ▼                    │     │
                           │  │  DO('tenant:users:shard-7')    │     │
                           │  └────────────────────────────────┘     │
                           │                   │                      │
                           └───────────────────┼──────────────────────┘
                                               │
                   ┌───────────────────────────┼───────────────────────────┐
                   │                           │                           │
                   ▼                           ▼                           ▼
          ┌─────────────┐             ┌─────────────┐             ┌─────────────┐
          │   shard-0   │             │   shard-7   │             │  shard-31   │
          │  (Users A-C)│             │  (Users M-P)│             │  (Users Y-Z)│
          └─────────────┘             └─────────────┘             └─────────────┘
```

## Basic Sharding with ShardRouter

The `ShardRouter` class provides consistent hashing to route requests to specific shards.

### Installation

```typescript
import {
  ShardRouter,
  createShardRouter,
  type ShardContext,
  type ShardResult
} from '@dotdo/do'
```

### Basic Configuration

```typescript
const router = new ShardRouter({
  defaultShardCount: 16,
  entityShards: {
    'users': 32,      // Users sharded across 32 DOs
    'orders': 64,     // Orders across 64 DOs (high volume)
    'analytics': 4,   // Analytics across 4 DOs (aggregation)
  },
  separator: ':',     // DO name separator (default)
  enabled: true       // Enable/disable sharding
})
```

### Routing Requests

```typescript
const result = router.route({
  namespace: 'acme',           // From subdomain
  path: '/users/user-123',     // Request path
  entityType: 'users',         // Entity type (optional, auto-extracted)
  entityId: 'user-123',        // Entity ID (optional, auto-extracted)
})

console.log(result)
// {
//   doName: 'acme:users:shard-7',
//   shardIndex: 7,
//   sharded: true,
//   key: 'user-123'
// }
```

### Worker Integration

```typescript
// api/index.ts
import { ShardRouter } from '@dotdo/do'

export { DO } from '../do/DO'

const router = new ShardRouter({
  defaultShardCount: 16,
  entityShards: { users: 32, orders: 64 }
})

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const namespace = hostParts.length > 2 ? hostParts[0] : 'default'

    const { doName } = router.route({
      namespace,
      path: url.pathname,
    })

    const id = env.DO.idFromName(doName)
    const stub = env.DO.get(id)
    return stub.fetch(request)
  }
}
```

### Factory Methods

```typescript
// Using factory method
const router = createShardRouter({
  defaultShardCount: 32,
  entityShards: { products: 16 }
})

// Using fetch handler shortcut
export default {
  fetch: router.createFetchHandler('DO')
}
```

## Consistent Hashing

Sharding uses FNV-1a hashing to ensure:

1. **Consistency**: Same key always routes to same shard
2. **Distribution**: Keys are spread evenly across shards
3. **Stability**: Adding/removing shards minimally affects existing keys

```typescript
import { fnv1aHash, getShardIndex } from '@dotdo/do'

// Get shard index for a key
const shardIndex = getShardIndex('user-123', 32)
// Returns: 0-31, deterministic for same key
```

### Key Extraction Priority

The router extracts shard keys in this order:

1. Explicit `shardKey` in context
2. Custom key extractor matching the path pattern
3. `entityId` if provided
4. Path-based extraction (last ID-like segment)

```typescript
// Custom key extractors
const router = new ShardRouter({
  defaultShardCount: 16,
  keyExtractors: {
    '/api/*/search': (ctx) => ctx.params?.get('tenant_id'),
    '/api/*': extractUserIdFromHeader,
  }
})

// Built-in extractors
import { extractUserIdFromHeader, extractShardFromQuery } from '@dotdo/do'

const router = new ShardRouter({
  keyExtractors: {
    '/api/*': extractUserIdFromHeader,           // X-User-ID or Authorization header
    '/search': extractShardFromQuery('tenant'),  // ?tenant=xxx query param
  }
})
```

## Load-Balanced Sharding

For new entity creation or list operations (where no specific entity ID exists), use `LoadBalancedRouter` to distribute across shards based on current load.

### Strategies

| Strategy | Use Case | Description |
|----------|----------|-------------|
| `least-loaded` | General purpose | Routes to shard with lowest recorded load |
| `round-robin` | Even distribution | Cycles through shards sequentially |
| `weighted` | Heterogeneous capacity | Considers shard capacity weights |

### Load-Balanced Router

```typescript
import { LoadBalancedRouter, LoadMetricsStore } from '@dotdo/do'

const metricsStore = new LoadMetricsStore()

const router = new LoadBalancedRouter({
  defaultShardCount: 16,
  metricsStore,
  strategy: 'least-loaded',  // or 'round-robin', 'weighted'
  onTelemetry: (event) => {
    // Track load balancing decisions
    console.log('Selected shard:', event.selectedShard)
    console.log('Load snapshot:', event.loadSnapshot)
  }
})

// Route with load balancing for new entities
const result = router.route({
  namespace: 'acme',
  path: '/users',        // No entity ID - triggers load balancing
  entityType: 'users',
})

// Route with consistent hashing for existing entities
const result2 = router.route({
  namespace: 'acme',
  path: '/users/user-123',
  entityType: 'users',
  entityId: 'user-123',  // Has ID - uses consistent hash
})
```

### Tracking Load Metrics

```typescript
const metricsStore = new LoadMetricsStore({
  loadWeights: {
    requests: 1,
    connections: 10,
    memory: 0.1,
  },
  decayFactor: 0.9,      // Decay multiplier
  decayIntervalMs: 60000 // Apply decay every minute
})

// Record load from DO health reports
metricsStore.recordLoad('acme:users:shard-0', 150)
metricsStore.recordRequest('acme:users:shard-0')

// Record multiple metric types
metricsStore.recordMetric('acme:users:shard-0', 'requests', 100)
metricsStore.recordMetric('acme:users:shard-0', 'connections', 50)
metricsStore.recordMetric('acme:users:shard-0', 'memory', 256)

// Get composite load
const load = metricsStore.getCompositeLoad('acme:users:shard-0')
// (100 * 1) + (50 * 10) + (256 * 0.1) = 625.6

// Find least loaded shard
const { shardIndex, doName, load } = metricsStore.findLeastLoaded('acme', 'users', 4)

// Apply time-based decay
metricsStore.applyDecay()  // Called periodically
```

### Weighted Load Balancing

```typescript
const router = new LoadBalancedRouter({
  defaultShardCount: 4,
  metricsStore,
  strategy: 'weighted',
  weights: {
    'acme:users:shard-0': 2.0,  // Double capacity (larger instance)
    'acme:users:shard-1': 1.0,
    'acme:users:shard-2': 1.0,
    'acme:users:shard-3': 0.5,  // Half capacity (smaller instance)
  }
})
```

## Health-Aware Routing

The `HealthAwareRouter` combines load balancing with health monitoring to avoid unhealthy shards.

### Health Monitoring

```typescript
import { ShardHealthMonitor, HealthAwareRouter } from '@dotdo/do'

const healthMonitor = new ShardHealthMonitor({
  // Latency thresholds (milliseconds)
  latencyDegradedThreshold: 500,
  latencyUnhealthyThreshold: 2000,

  // Error rate thresholds (0-1)
  errorRateDegradedThreshold: 0.05,  // 5%
  errorRateUnhealthyThreshold: 0.2,  // 20%

  // Storage thresholds (0-1)
  storageDegradedThreshold: 0.7,   // 70% full
  storageUnhealthyThreshold: 0.9,  // 90% full

  // Sliding windows
  latencyWindowSize: 100,
  errorWindowSize: 100,
})

// Record health metrics (called from DO health reports)
healthMonitor.recordLatency('acme:users:shard-0', 150)
healthMonitor.recordSuccess('acme:users:shard-0')
healthMonitor.recordError('acme:users:shard-0')
healthMonitor.recordStorage('acme:users:shard-0', 500 * 1024 * 1024, 0.5)
healthMonitor.recordConnections('acme:users:shard-0', 50)
healthMonitor.recordRequestsPerSecond('acme:users:shard-0', 100)

// Get health metrics
const metrics = healthMonitor.getHealthMetrics('acme:users:shard-0')
// {
//   shardId: 'acme:users:shard-0',
//   latencyMs: 150,
//   errorRate: 0.02,
//   storageBytes: 524288000,
//   storagePercent: 0.5,
//   activeConnections: 50,
//   requestsPerSecond: 100,
//   healthScore: 85,        // 0-100 composite score
//   status: 'healthy',      // 'healthy' | 'degraded' | 'unhealthy'
//   lastUpdatedAt: 1706000000000
// }

// Query shards by health
const unhealthy = healthMonitor.getUnhealthyShards()
const degraded = healthMonitor.getDegradedShards()  // Includes unhealthy
const healthiest = healthMonitor.getHealthiestShard(['shard-0', 'shard-1', 'shard-2'])
```

### Health-Aware Router

```typescript
const router = new HealthAwareRouter({
  defaultShardCount: 4,
  metricsStore,
  healthMonitor,
  skipUnhealthyShards: true,     // Avoid unhealthy shards
  preferHealthierShards: true,   // Among healthy, prefer healthiest
})

// Routes automatically avoid unhealthy shards
const result = router.route({
  namespace: 'acme',
  path: '/users',
  entityType: 'users',
})

// Access health monitor
const monitor = router.getHealthMonitor()
const metrics = router.getMetricsStore()
```

## Dynamic Shard Rebalancing

For long-running systems, shards may become imbalanced over time. The `ShardRebalancer` provides recommendations for rebalancing.

### Shard Registry

```typescript
import { ShardRebalancer, LoadMetricsStore, ShardHealthMonitor } from '@dotdo/do'

const rebalancer = new ShardRebalancer({
  minShardCount: 4,
  maxShardCount: 64,
  splitThreshold: 2.0,   // Split if load > 200% of average
  mergeThreshold: 0.1,   // Merge if load < 10% of average
  cooldownMs: 60000,     // Wait 1 minute between rebalances
})

// Register existing shards
for (let i = 0; i < 4; i++) {
  rebalancer.registerShard({
    shardId: `acme:users:shard-${i}`,
    namespace: 'acme',
    entityType: 'users',
    shardIndex: i,
    status: 'active',  // 'active' | 'draining' | 'inactive' | 'migrating'
  })
}

// Update shard status
rebalancer.setShardStatus('acme:users:shard-0', 'draining')

// Get active shards
const activeShards = rebalancer.getActiveShards('acme', 'users')
```

### Analyzing and Rebalancing

```typescript
const metricsStore = new LoadMetricsStore()
const healthMonitor = new ShardHealthMonitor()

// Record current state
metricsStore.recordLoad('acme:users:shard-0', 50)
metricsStore.recordLoad('acme:users:shard-1', 300)  // Hot spot!
metricsStore.recordLoad('acme:users:shard-2', 45)
metricsStore.recordLoad('acme:users:shard-3', 5)   // Cold

// Analyze for rebalancing recommendations
const decisions = rebalancer.analyze(metricsStore, healthMonitor)

for (const decision of decisions) {
  console.log(`Action: ${decision.action.type}`)
  console.log(`Reason: ${decision.reason}`)
  console.log(`Priority: ${decision.priority}`)  // 'critical' | 'high' | 'medium' | 'low'

  switch (decision.action.type) {
    case 'split':
      console.log(`Split ${decision.action.sourceShardId} into ${decision.action.newShardCount} shards`)
      break
    case 'merge':
      console.log(`Merge ${decision.action.sourceShardIds.join(', ')} into ${decision.action.targetShardId}`)
      break
    case 'drain':
      console.log(`Drain ${decision.action.shardId} to ${decision.action.targetShardId}`)
      break
  }
}
```

### Migration Task Tracking

```typescript
// Start a migration
const task = rebalancer.startMigration(
  'acme:users:shard-1',  // Source (draining)
  'acme:users:shard-0',  // Target
  ['user-123', 'user-456', 'user-789']  // Keys to migrate
)

console.log(task.id)       // 'migration-1706000000000-abc123'
console.log(task.status)   // 'pending'

// Update progress
rebalancer.updateMigrationProgress(task.id, 2)  // 2 of 3 keys migrated
console.log(rebalancer.getMigration(task.id)?.status)  // 'in_progress'

// Complete migration
rebalancer.completeMigration(task.id)
console.log(rebalancer.getMigration(task.id)?.status)  // 'completed'

// Or fail migration
rebalancer.completeMigration(task.id, 'Network timeout')
console.log(rebalancer.getMigration(task.id)?.status)  // 'failed'

// Get active migrations
const activeMigrations = rebalancer.getActiveMigrations()
```

## Hono Middleware Integration

Use the sharding middleware with Hono for automatic shard context injection.

```typescript
import { Hono } from 'hono'
import { ShardRouter, shardMiddleware } from '@dotdo/do'

const router = new ShardRouter({ defaultShardCount: 16 })
const app = new Hono()

// Add shard middleware
app.use('*', shardMiddleware(router))

// Access shard context in handlers
app.get('/users/:id', (c) => {
  const shardResult = c.get('shard')
  const shardContext = c.get('shardContext')

  return c.json({
    doName: shardResult.doName,
    shardIndex: shardResult.shardIndex,
    key: shardResult.key,
  })
})
```

## Common Sharding Patterns

### Pattern 1: Multi-Tenant SaaS

Each tenant gets their own namespace, with entity-based sharding within.

```typescript
const router = new ShardRouter({
  defaultShardCount: 16,
  entityShards: {
    'users': 32,
    'documents': 64,
    'projects': 16,
  }
})

// Routes:
// acme.app.do/users/user-123     -> acme:users:shard-N
// beta.app.do/users/user-456     -> beta:users:shard-M
// acme.app.do/documents/doc-789  -> acme:documents:shard-K
```

### Pattern 2: High-Write Workload

Maximize parallelism for high-throughput writes.

```typescript
const router = new LoadBalancedRouter({
  defaultShardCount: 128,  // High shard count
  strategy: 'round-robin',  // Even distribution for new writes
  entityShards: {
    'events': 256,  // Very high for event streams
    'logs': 512,    // Maximum parallelism for logs
  }
})
```

### Pattern 3: Read-Heavy with Analytics

Fewer shards for analytics to simplify aggregation.

```typescript
const router = new ShardRouter({
  defaultShardCount: 16,
  entityShards: {
    'users': 32,       // Normal sharding
    'orders': 64,      // High volume
    'analytics': 4,    // Low shard count for easier aggregation
    'reports': 1,      // Single shard for global reports
  }
})
```

### Pattern 4: Graceful Degradation

Automatically route around unhealthy shards.

```typescript
const router = new HealthAwareRouter({
  defaultShardCount: 8,
  skipUnhealthyShards: true,
  preferHealthierShards: true,

  // Configure health thresholds for your SLA
  healthMonitor: new ShardHealthMonitor({
    latencyUnhealthyThreshold: 1000,
    errorRateUnhealthyThreshold: 0.1,
  })
})

// Monitor for degradation
setInterval(() => {
  const unhealthy = router.getHealthMonitor().getUnhealthyShards()
  if (unhealthy.length > 0) {
    console.warn('Unhealthy shards:', unhealthy.map(s => s.shardId))
  }
}, 30000)
```

### Pattern 5: Zero-Downtime Shard Migration

Gradually migrate data between shards.

```typescript
async function migrateShardData(
  source: DurableObjectStub,
  target: DurableObjectStub,
  rebalancer: ShardRebalancer,
  keys: string[]
) {
  const task = rebalancer.startMigration(source.id.toString(), target.id.toString(), keys)

  // Set source to draining (no new writes)
  rebalancer.setShardStatus(source.id.toString(), 'draining')

  // Migrate keys in batches
  const batchSize = 100
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize)

    // Read from source, write to target
    for (const key of batch) {
      const data = await source.get(key)
      await target.put(key, data)
    }

    rebalancer.updateMigrationProgress(task.id, Math.min(i + batchSize, keys.length))

    // Allow other operations between batches
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  rebalancer.completeMigration(task.id)
  rebalancer.setShardStatus(source.id.toString(), 'inactive')
}
```

## Telemetry and Monitoring

### Load Balance Telemetry

```typescript
const router = new LoadBalancedRouter({
  defaultShardCount: 4,
  onTelemetry: (event) => {
    // Send to your monitoring system
    metrics.gauge('shard.selected', event.selectedShard, {
      namespace: event.namespace,
      entityType: event.entityType || 'default',
      strategy: event.strategy,
    })

    // Log load snapshot
    for (const [doName, load] of Object.entries(event.loadSnapshot)) {
      metrics.gauge('shard.load', load, { shard: doName })
    }
  }
})
```

### Health Monitoring Dashboard

```typescript
app.get('/admin/shards/health', async (c) => {
  const monitor = router.getHealthMonitor()

  const allMetrics = monitor.getAllHealthMetrics()
  const summary = {
    total: allMetrics.size,
    healthy: 0,
    degraded: 0,
    unhealthy: 0,
    shards: [] as ShardHealthMetrics[],
  }

  for (const metrics of allMetrics.values()) {
    summary.shards.push(metrics)
    switch (metrics.status) {
      case 'healthy': summary.healthy++; break
      case 'degraded': summary.degraded++; break
      case 'unhealthy': summary.unhealthy++; break
    }
  }

  return c.json(summary)
})
```

## Best Practices

### 1. Choose Shard Count Carefully

- Start with power-of-2 shard counts (16, 32, 64)
- Shard count should be >= expected peak concurrent users
- Leave headroom: if expecting 100 concurrent, use 128 shards

### 2. Use Consistent Keys

- Always use stable, unique identifiers as shard keys
- Avoid temporal keys (timestamps) that cause hot spots
- Consider using hash of multiple fields for compound keys

### 3. Monitor and Adjust

- Track shard load distribution regularly
- Set up alerts for imbalanced shards
- Plan for periodic rebalancing operations

### 4. Handle Shard Failures Gracefully

- Use `HealthAwareRouter` in production
- Implement circuit breakers for shard calls
- Cache fallback responses for read operations

### 5. Plan for Growth

- Design for 10x expected load
- Document shard expansion procedures
- Test rebalancing in staging environments

## API Reference

### ShardRouter

```typescript
class ShardRouter {
  constructor(config?: Partial<ShardRouterConfig>)

  getShardCount(entityType?: string): number
  extractKey(ctx: ShardContext): string | undefined
  route(ctx: ShardContext): ShardResult
  getStub<T>(env: Record<string, T>, ctx: ShardContext, binding?: string): DurableObjectStub
  createFetchHandler(binding?: string): FetchHandler
}
```

### LoadBalancedRouter

```typescript
class LoadBalancedRouter extends ShardRouter {
  constructor(config?: Partial<LoadBalancedRouterConfig>)

  route(ctx: ShardContext): LoadBalancedShardResult
  getMetricsStore(): LoadMetricsStore
}
```

### HealthAwareRouter

```typescript
class HealthAwareRouter extends LoadBalancedRouter {
  constructor(config?: Partial<HealthAwareRouterConfig>)

  route(ctx: ShardContext): LoadBalancedShardResult
  getHealthMonitor(): ShardHealthMonitor
}
```

### ShardHealthMonitor

```typescript
class ShardHealthMonitor {
  constructor(config?: ShardHealthConfig)

  recordLatency(shardId: string, latencyMs: number): void
  recordSuccess(shardId: string): void
  recordError(shardId: string): void
  recordStorage(shardId: string, bytes: number, percent: number): void
  recordConnections(shardId: string, count: number): void
  recordRequestsPerSecond(shardId: string, rps: number): void

  getHealthMetrics(shardId: string): ShardHealthMetrics | undefined
  getAllHealthMetrics(): Map<string, ShardHealthMetrics>
  getUnhealthyShards(): ShardHealthMetrics[]
  getDegradedShards(): ShardHealthMetrics[]
  getHealthiestShard(candidates: string[]): string | undefined
  isShardHealthy(shardId: string): boolean
  reset(): void
}
```

### ShardRebalancer

```typescript
class ShardRebalancer {
  constructor(config?: ShardRebalancerConfig)

  registerShard(entry: ShardRegistryEntry): void
  getShardEntry(shardId: string): ShardRegistryEntry | undefined
  updateShardActivity(shardId: string): void
  setShardStatus(shardId: string, status: ShardStatus): void
  getActiveShards(namespace: string, entityType?: string): ShardRegistryEntry[]

  analyze(metricsStore: LoadMetricsStore, healthMonitor?: ShardHealthMonitor): RebalanceDecision[]
  recordRebalance(): void
  getCooldownRemaining(): number

  startMigration(sourceShardId: string, targetShardId: string, keys: string[]): MigrationTask
  updateMigrationProgress(taskId: string, keysMigrated: number): void
  completeMigration(taskId: string, error?: string): void
  getMigration(taskId: string): MigrationTask | undefined
  getActiveMigrations(): MigrationTask[]
  reset(): void
}
```

### LoadMetricsStore

```typescript
class LoadMetricsStore {
  constructor(config?: LoadMetricsStoreConfig)

  recordLoad(doName: string, load: number): void
  recordRequest(doName: string): void
  getLoad(doName: string): number

  recordMetric(doName: string, metricType: string, value: number): void
  getMetric(doName: string, metricType: string): number
  getCompositeLoad(doName: string): number

  getShardLoads(namespace: string, entityType: string, shardCount: number): Record<string, number>
  findLeastLoaded(namespace: string, entityType: string, shardCount: number): LeastLoadedResult

  applyDecay(): void
  reset(): void
  getSnapshot(): Record<string, number>
}
```

## Related Documentation

- [LIMITATIONS.md](./LIMITATIONS.md) - Platform limits and constraints
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment configuration
- [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error handling patterns
- [HEALTH_CHECKS.md](./HEALTH_CHECKS.md) - Health check configuration
