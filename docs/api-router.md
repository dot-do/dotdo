# API Router Documentation

The API router is the central routing system that directs incoming HTTP requests to the appropriate Durable Object (DO) instance. It handles tenant extraction, consistency modes, replica routing, and telemetry.

## Overview

The router performs several key functions:

1. **Tenant Extraction** - Determines which tenant namespace to route to based on the hostname
2. **Static Route Matching** - Handles special DO bindings (browsers, sandboxes, obs)
3. **Noun Configuration Lookup** - Retrieves per-noun routing rules from the tenant's DO
4. **Replica Routing** - Routes read requests to geo-local replicas for eventual consistency
5. **Path Normalization** - Normalizes URL segments for consistent routing
6. **Telemetry** - Adds debugging headers and logs routing decisions

## Routing Decision Flow

```
                              Incoming Request
                                     |
                                     v
                    +--------------------------------+
                    |   Extract Tenant from Host    |
                    |   (acme.api.dotdo.dev -> acme) |
                    +--------------------------------+
                                     |
                                     v
                    +--------------------------------+
                    |   Extract Location Info       |
                    |   (CF-Ray, lat/lon, region)   |
                    +--------------------------------+
                                     |
                                     v
                    +--------------------------------+
                    |   Check Static Routes         |
                    |   (browsers, sandboxes, obs)  |
                    +--------------------------------+
                           |              |
                      Found?           Not Found
                           |              |
                           v              v
                    +----------+   +------------------+
                    |  Return  |   | Fetch NounConfig |
                    |  Static  |   | from Tenant DO   |
                    |  Binding |   +------------------+
                    +----------+          |
                                          v
                                   +------------------+
                                   | Noun Config      |
                                   | Found?           |
                                   +------------------+
                                      |          |
                                   Yes          No
                                      |          |
                                      v          v
                              +------------+  +------------+
                              | Apply Noun |  | Use Default|
                              | Strategy   |  | DO Binding |
                              +------------+  +------------+
                                      |          |
                                      v          v
                              +--------------------------------+
                              |   Check Replica Routing        |
                              |   (eventual + GET + replicas)  |
                              +--------------------------------+
                                          |
                                          v
                              +--------------------------------+
                              |   Select Nearest Replica       |
                              |   (Haversine distance calc)    |
                              +--------------------------------+
                                          |
                                          v
                              +--------------------------------+
                              |   Return RoutingResult         |
                              |   (ns, nsName, isReplica, etc) |
                              +--------------------------------+
```

## Consistency Modes

The router supports three consistency modes that control how requests are routed:

### `strong` (Default for Writes)

- **Behavior**: All requests route directly to the primary DO instance
- **Use Case**: Write operations, transactions, operations requiring immediate consistency
- **Trade-off**: Higher latency for geographically distant users

```typescript
// Force strong consistency via header
fetch('/api/customers/123', {
  headers: { 'X-Consistency-Mode': 'strong' }
})

// Or via query parameter
fetch('/api/customers/123?consistency=strong')
```

### `eventual` (Default for Reads)

- **Behavior**: Read requests can route to geo-local replica DOs
- **Use Case**: Read-heavy workloads where slight staleness is acceptable
- **Trade-off**: Lower latency but data may be slightly stale
- **Requirement**: Noun must have `replicaRegions` configured and `REPLICA_DO` binding available

```typescript
// Explicitly request eventual consistency
fetch('/api/customers/123', {
  headers: { 'X-Consistency-Mode': 'eventual' }
})
```

### `causal` (Future)

- **Behavior**: Session affinity - routes to the same replica within a session
- **Use Case**: Read-your-writes consistency within a user session
- **Status**: Not yet implemented

### Consistency Mode Priority

The consistency mode is determined in the following order:

1. `X-Consistency-Mode` request header
2. `?consistency=` query parameter
3. Noun configuration default (`nounConfig.consistencyMode`)
4. System default: `eventual`

## Replica Routing

Replica routing enables low-latency reads by directing requests to geographically nearby DO replicas.

### How It Works

1. Router checks if request is a read operation (GET/HEAD)
2. Checks if noun has `consistencyMode: 'eventual'`
3. Checks if `replicaRegions` array is configured
4. Checks if `REPLICA_DO` binding is available in environment
5. Selects nearest replica using geographic distance calculation

### Geographic Distance Selection

The router uses the Haversine formula to calculate great-circle distance between the user's location (from Cloudflare headers) and each replica region:

```typescript
// User location extracted from Cloudflare cf object
const location = {
  lat: request.cf.latitude,
  lon: request.cf.longitude,
  colo: request.cf.colo,
  region: request.cf.region
}

// Nearest replica selected based on distance
const nearestReplica = selectNearestReplica(
  location.region,
  nounConfig.replicaRegions,
  location.lat,
  location.lon
)
```

### Setting Up Replica Routing

#### 1. Configure Noun in Database

```sql
INSERT INTO nouns (noun, plural, consistencyMode, replicaRegions) VALUES
  ('Customer', 'customers', 'eventual', '["us-west", "us-east", "eu-west"]');
```

#### 2. Add REPLICA_DO Binding in wrangler.toml

```toml
[[durable_objects.bindings]]
name = "REPLICA_DO"
class_name = "ReplicaDO"

[[migrations]]
tag = "v1"
new_classes = ["ReplicaDO"]
```

#### 3. Supported Region Identifiers

The router recognizes these region identifiers:

| Region ID | Location | Coordinates |
|-----------|----------|-------------|
| `us-west` | San Francisco | 37.77, -122.42 |
| `us-west-1` | San Francisco | 37.77, -122.42 |
| `us-west-2` | Portland | 45.52, -122.68 |
| `us-east` | New York | 40.71, -74.01 |
| `us-east-1` | N. Virginia | 38.91, -77.04 |
| `eu-west` | London | 51.51, -0.13 |
| `eu-west-1` | Dublin | 53.35, -6.26 |
| `eu-central-1` | Frankfurt | 50.11, 8.68 |
| `ap-southeast-1` | Singapore | 1.35, 103.82 |
| `ap-northeast-1` | Tokyo | 35.68, 139.65 |

## Noun Configuration Schema

The `NounConfig` interface defines per-noun routing behavior:

```typescript
interface NounConfig {
  // Identity
  noun: string              // Singular name: "Customer"
  plural: string | null     // Plural form: "customers" (used in routes)

  // DO Configuration
  doClass: string | null    // Custom DO class name, or null for default DO

  // Namespace Strategy
  nsStrategy: 'tenant' | 'singleton' | 'sharded'
  sharded: boolean          // Whether sharding is enabled
  shardCount: number        // Number of shards (default: 16)
  shardKey: string | null   // Field to use for sharding

  // Storage Configuration
  storage: string           // Storage tier: 'hot', 'warm', 'cold'
  ttlDays: number | null    // Time-to-live for records

  // Consistency & Replication
  consistencyMode?: 'strong' | 'eventual' | 'causal'
  replicaRegions?: string[] // Regions for replica routing
  replicaCount?: number     // Number of replicas
}
```

### Namespace Strategies

#### `tenant` (Default)

Each tenant gets their own DO namespace. Most common pattern.

```
Request: acme.api.dotdo.dev/customers/123
Namespace: "acme"
```

#### `singleton`

Single shared DO instance across all tenants. Used for global resources.

```
Request: *.api.dotdo.dev/obs/...
Namespace: "obs"
```

#### `sharded`

Distributes load across multiple DO instances using consistent hashing.

```
Request: acme.api.dotdo.dev/events/evt_abc123
Namespace: "events-shard-7" (hash of ID % shardCount)
```

### Storage Tiers

| Tier | Description | Use Case |
|------|-------------|----------|
| `hot` | Frequently accessed, always in memory | Active records, real-time data |
| `warm` | Moderate access, cached | Recent history, lookup tables |
| `cold` | Rarely accessed, archived | Historical data, compliance records |

## Telemetry & Observability

### Response Headers

The router adds debugging headers to responses:

| Header | Description | Example |
|--------|-------------|---------|
| `X-DO-Target` | Target DO binding name | `DO`, `REPLICA_DO` |
| `X-DO-Replica` | Whether routed to replica | `true`, `false` |
| `X-DO-Replica-Region` | Selected replica region | `us-west` |
| `X-DO-Consistency-Mode` | Consistency mode used | `eventual` |
| `X-Location-Colo` | Cloudflare colo | `SJC`, `LHR` |
| `X-Routing-Duration-Ms` | Routing decision time | `2` |

### Structured Logging

Routing events are logged as JSON for tail consumption:

```json
{
  "type": "routing",
  "timestamp": 1704067200000,
  "requestId": "req_abc123",
  "pathname": "/customers/123",
  "method": "GET",
  "colo": "SJC",
  "region": "us-west",
  "lat": 37.7749,
  "lon": -122.4194,
  "nounName": "customers",
  "consistencyMode": "eventual",
  "targetBinding": "REPLICA_DO",
  "isReplica": true,
  "replicaRegion": "us-west",
  "routingDurationMs": 2
}
```

### Using Routing Telemetry

```typescript
import { createRoutingSpan, addRoutingHeaders } from './api/utils/routing-telemetry'

// Create a timing span
const span = createRoutingSpan(requestId, pathname, method)

// ... perform routing ...

// End span and log event
span.end({
  targetBinding: 'REPLICA_DO',
  isReplica: true,
  consistencyMode: 'eventual',
  replicaRegion: 'us-west',
  colo: location?.colo,
})

// Add headers to response
addRoutingHeaders(response.headers, routingEvent)
```

### Debug Mode

For development, use `RoutingDebugInfo` to trace routing decisions:

```typescript
import { RoutingDebugInfo } from './api/utils/routing-telemetry'

const debug = new RoutingDebugInfo('req-123')
debug.recordDecision('checking', 'static-routes')
debug.recordDecision('found', 'noun-config for customers')
debug.recordDecision('routing', 'customers -> REPLICA_DO (us-west)')
debug.print()
```

## Code Examples

### Basic Request Routing

```typescript
import { routeRequest } from './api/utils/router'

export default {
  async fetch(request: Request, env: Env) {
    // Route the request
    const routing = await routeRequest(env, request)

    if (!routing) {
      return new Response('Not Found', { status: 404 })
    }

    // Get DO stub and forward request
    const id = routing.ns.idFromName(routing.nsName)
    const stub = routing.ns.get(id)

    return stub.fetch(request)
  }
}
```

### Custom Routing with Telemetry

```typescript
import { routeRequest, extractLocation } from './api/utils/router'
import { createRoutingSpan, addRoutingHeaders } from './api/utils/routing-telemetry'

export default {
  async fetch(request: Request, env: Env) {
    const requestId = crypto.randomUUID()
    const url = new URL(request.url)

    // Start timing span
    const span = createRoutingSpan(requestId, url.pathname, request.method)

    // Route request
    const routing = await routeRequest(env, request)

    if (!routing) {
      return new Response('Not Found', { status: 404 })
    }

    // Forward to DO
    const id = routing.ns.idFromName(routing.nsName)
    const stub = routing.ns.get(id)
    const response = await stub.fetch(request)

    // Clone response to add headers
    const newResponse = new Response(response.body, response)

    // End span and add telemetry headers
    const location = extractLocation(request)
    span.end({
      targetBinding: routing.isReplica ? 'REPLICA_DO' : 'DO',
      isReplica: routing.isReplica,
      consistencyMode: routing.consistencyMode,
      replicaRegion: routing.replicaRegion,
      colo: location?.colo,
      region: location?.region,
    })

    addRoutingHeaders(newResponse.headers, {
      timestamp: Date.now(),
      requestId,
      pathname: url.pathname,
      method: request.method,
      targetBinding: routing.isReplica ? 'REPLICA_DO' : 'DO',
      isReplica: routing.isReplica,
      consistencyMode: routing.consistencyMode,
      routingDurationMs: 0, // Set by span
    })

    return newResponse
  }
}
```

### Forcing Strong Consistency

```typescript
// Client-side: Force strong consistency for critical reads
const customer = await fetch('https://acme.api.dotdo.dev/customers/123', {
  headers: {
    'X-Consistency-Mode': 'strong'
  }
})

// Or via query param
const customer = await fetch('https://acme.api.dotdo.dev/customers/123?consistency=strong')
```

### Configuring Noun for Replica Routing

```typescript
// In your DO or migration script
await this.ctx.storage.sql.exec(`
  INSERT INTO nouns (noun, plural, consistencyMode, replicaRegions, nsStrategy)
  VALUES (?, ?, ?, ?, ?)
`, [
  'Customer',
  'customers',
  'eventual',
  JSON.stringify(['us-west', 'us-east', 'eu-west']),
  'tenant'
])
```

## Reference Files

- **Main Router**: `/api/utils/router.ts`
- **Consistency Logic**: `/api/utils/consistency.ts`
- **Location Extraction**: `/api/utils/location.ts`
- **Geographic Utilities**: `/api/utils/geo.ts`
- **Routing Telemetry**: `/api/utils/routing-telemetry.ts`
- **Cloudflare Bindings**: `/types/CloudflareBindings.ts`
- **Lookup Utilities**: `/utils/lookup.ts`
