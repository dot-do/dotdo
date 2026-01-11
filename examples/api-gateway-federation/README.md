# API Gateway Federation

**One gateway. Infinite services. Zero latency.**

Federate multiple Durable Objects behind a single API gateway with intelligent routing, aggregation, rate limiting, and circuit breakers. Build microservice architectures where each service runs in its own DO with sub-millisecond communication.

```typescript
import { GatewayDO } from './src'

// The gateway federates requests across service DOs
const response = await gateway.aggregate({
  user: $.User(userId),           // UserDO
  orders: $.Orders.recent(5),     // OrderDO
  inventory: $.Inventory.check(), // InventoryDO
  recommendations: $.AI.suggest() // RecommendationDO
})

// All four calls execute in parallel, responses merge automatically
// Rate limited per tenant, cached intelligently, circuit-broken on failure
```

## How It Works

### Route-Based DO Dispatching

The gateway routes requests to different Durable Objects based on path patterns:

```typescript
// Path-based routing configuration
const routes = {
  '/api/v1/users/*':     'USER_DO',
  '/api/v1/orders/*':    'ORDER_DO',
  '/api/v1/products/*':  'PRODUCT_DO',
  '/api/v1/analytics/*': 'ANALYTICS_DO',
  '/api/v2/*':           'V2_DO',  // API versioning
}
```

### Request Aggregation

Combine responses from multiple DOs in a single request:

```typescript
// POST /api/aggregate
{
  "calls": [
    { "service": "users", "method": "get", "args": ["user-123"] },
    { "service": "orders", "method": "list", "args": [{ "userId": "user-123" }] },
    { "service": "inventory", "method": "check", "args": ["SKU-001"] }
  ]
}

// Response: all results merged, executed in parallel
{
  "users": { "id": "user-123", "name": "Alice" },
  "orders": [{ "id": "ord-1", "total": 99 }],
  "inventory": { "sku": "SKU-001", "stock": 42 }
}
```

### Rate Limiting Per Tenant

Tenant-aware rate limiting with configurable tiers:

```typescript
const rateLimits = {
  free:       { rpm: 100,   burst: 10  },
  starter:    { rpm: 1000,  burst: 50  },
  pro:        { rpm: 10000, burst: 200 },
  enterprise: { rpm: 100000, burst: 1000 },
}
```

### Circuit Breakers

Protect downstream services with automatic circuit breaking:

```typescript
const circuitBreaker = {
  threshold: 5,        // failures before opening
  timeout: 30_000,     // ms to wait before half-open
  halfOpenMax: 3,      // test requests in half-open state
}
```

### GraphQL Federation

Federate GraphQL schemas across service DOs:

```typescript
// Each DO exposes its own schema fragment
// UserDO
type User @key(fields: "id") {
  id: ID!
  name: String!
  orders: [Order!]! @requires(fields: "id")
}

// OrderDO
type Order @key(fields: "id") {
  id: ID!
  total: Float!
  user: User! @provides(fields: "id")
}

// Gateway composes the federated schema
```

## Features

| Feature | Description |
|---------|-------------|
| Route dispatching | Path-pattern routing to service DOs |
| Aggregation | Parallel multi-DO calls in single request |
| Rate limiting | Per-tenant limits with burst allowance |
| Circuit breakers | Auto-fail-fast on downstream issues |
| Response caching | Edge caching with tenant-aware keys |
| Auth middleware | JWT validation, API key auth |
| API versioning | Version-based routing (`/v1/`, `/v2/`) |
| GraphQL federation | Composed schemas across DOs |

## Quick Start

```bash
cd examples/api-gateway-federation
npm install
npm run dev
```

Test the gateway:

```bash
# Route to UserDO
curl http://localhost:8787/api/v1/users/alice

# Aggregate multiple services
curl -X POST http://localhost:8787/api/aggregate \
  -H "Content-Type: application/json" \
  -d '{"calls":[{"service":"users","method":"get","args":["alice"]}]}'

# Check rate limit status
curl http://localhost:8787/api/rate-limit/status

# GraphQL query
curl -X POST http://localhost:8787/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ user(id: \"alice\") { name orders { total } } }"}'
```

## Architecture

```
                    ┌─────────────────────────────────────────────────┐
                    │                  GatewayDO                      │
                    │  ┌─────────┐ ┌──────────┐ ┌────────────────┐   │
  Request ──────────┼─►│ Router  │─│ Rate     │─│ Circuit        │   │
                    │  │         │ │ Limiter  │ │ Breaker        │   │
                    │  └────┬────┘ └──────────┘ └───────┬────────┘   │
                    │       │                           │            │
                    │       ▼                           ▼            │
                    │  ┌─────────────────────────────────────────┐   │
                    │  │              Service Router             │   │
                    │  └────┬────────────┬────────────┬──────────┘   │
                    └───────┼────────────┼────────────┼──────────────┘
                            │            │            │
                    ┌───────▼───┐ ┌──────▼──────┐ ┌───▼──────┐
                    │  UserDO   │ │  OrderDO    │ │ ProductDO│
                    │  (users)  │ │  (orders)   │ │ (catalog)│
                    └───────────┘ └─────────────┘ └──────────┘
```

## Configuration

```typescript
// wrangler.jsonc bindings
{
  "durable_objects": {
    "bindings": [
      { "name": "GATEWAY_DO", "class_name": "GatewayDO" },
      { "name": "USER_DO", "class_name": "UserServiceDO" },
      { "name": "ORDER_DO", "class_name": "OrderServiceDO" },
      { "name": "PRODUCT_DO", "class_name": "ProductServiceDO" }
    ]
  }
}
```

## Learn More

- [dotdo Documentation](https://dotdo.dev/docs)
- [Durable Objects Guide](https://developers.cloudflare.com/durable-objects/)
- [API Gateway Patterns](https://microservices.io/patterns/apigateway.html)

---

Built with [dotdo](https://dotdo.dev) - Build your 1-Person Unicorn
