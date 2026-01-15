# dotdo API Reference

This document provides a comprehensive reference for the dotdo REST API. The API follows JSON-LD conventions with semantic linked data properties (`$context`, `$type`, `$id`).

## Base URLs

| Environment | URL |
|-------------|-----|
| Production | `https://api.dotdo.dev` |
| Local Development | `http://localhost:8787` |

## Authentication

The API supports multiple authentication methods:

### JWT Bearer Token

Include a JWT token in the Authorization header:

```http
Authorization: Bearer <token>
```

JWT tokens support the following algorithms:
- HMAC: HS256, HS384, HS512
- RSA: RS256, RS384, RS512
- ECDSA: ES256, ES384, ES512

### API Key

Include an API key in the X-API-Key header:

```http
X-API-Key: <api-key>
```

API keys must be at least 10 characters long. They are configured via environment variables (`API_KEYS`) or KV storage.

### Session Cookie

For browser-based authentication, session cookies are supported via the `session` cookie name.

## Rate Limiting

Rate limits are enforced using Cloudflare Rate Limiting. Headers are included in responses:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed |
| `X-RateLimit-Remaining` | Requests remaining in current window |

When rate limited, the API returns HTTP 429 with:

```json
{
  "error": "Too many requests - rate limit exceeded",
  "remaining": 0
}
```

## Response Format

All responses use JSON-LD compatible format with semantic properties:

```json
{
  "$context": "https://schema.org.ai",
  "$type": "https://example.com/customers",
  "$id": "https://example.com/customers/alice",
  "name": "Alice",
  "email": "alice@example.com"
}
```

### Collection Responses

```json
{
  "$context": "https://schema.org.ai",
  "$type": "https://example.com/customers",
  "$id": "https://example.com/customers",
  "items": [...],
  "count": 42,
  "links": {
    "home": "https://example.com",
    "first": "https://example.com/customers",
    "next": "https://example.com/customers?after=cust-10"
  },
  "actions": {
    "create": {
      "method": "POST",
      "href": "https://example.com/customers"
    }
  }
}
```

---

## Health & Status Endpoints

### GET /health

Health check endpoint for load balancers.

**Response**

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

| Status Code | Description |
|-------------|-------------|
| 200 | Service is healthy or degraded |
| 503 | Service is unhealthy |

### GET /api/health

Detailed health status with cache stats and binding availability.

**Response**

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "bindings": {
    "DO": true,
    "R2": true,
    "KV": true
  }
}
```

### GET /api

API information endpoint.

**Response**

```json
{
  "name": "dotdo",
  "version": "0.1.0",
  "endpoints": ["/api/health", "/:collection", "/:collection/:id"]
}
```

---

## REST API (Things)

The REST API provides CRUD operations for "Things" - the core entity type in dotdo.

### GET /

Returns HATEOAS index with available collections.

**Response**

```json
{
  "$context": "https://schema.org.ai",
  "$id": "https://example.com",
  "$type": "https://example.com",
  "ns": "example",
  "links": {
    "self": "https://example.com",
    "customers": "https://example.com/customers",
    "products": "https://example.com/products"
  },
  "collections": {
    "customers": {
      "$id": "https://example.com/customers",
      "$type": "Collection",
      "count": 42
    },
    "products": {
      "$id": "https://example.com/products",
      "$type": "Collection",
      "count": 100
    }
  }
}
```

### GET /:type

List items of a specific type.

**Query Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | integer | Maximum items to return (default: 100) |
| `offset` | integer | Number of items to skip |
| `after` | string | Cursor for pagination (item ID) |

**Example Request**

```http
GET /customers?limit=10&after=cust-5
```

**Response**

```json
{
  "$context": "https://example.com",
  "$type": "https://example.com/customers",
  "$id": "https://example.com/customers",
  "items": [
    {
      "$context": "https://example.com",
      "$type": "https://example.com/customers",
      "$id": "https://example.com/customers/alice",
      "name": "Alice"
    }
  ],
  "count": 42,
  "links": {
    "home": "https://example.com",
    "next": "https://example.com/customers?after=alice"
  }
}
```

### GET /:type/:id

Get a single item by ID.

**Response**

```json
{
  "$context": "https://example.com",
  "$type": "https://example.com/customers",
  "$id": "https://example.com/customers/alice",
  "name": "Alice",
  "email": "alice@example.com",
  "links": {
    "self": "https://example.com/customers/alice",
    "collection": "https://example.com/customers"
  },
  "actions": {
    "update": {
      "method": "PUT",
      "href": "https://example.com/customers/alice"
    },
    "delete": {
      "method": "DELETE",
      "href": "https://example.com/customers/alice"
    }
  }
}
```

| Status Code | Description |
|-------------|-------------|
| 200 | Item found |
| 404 | Item not found |

### POST /:type

Create a new item.

**Headers**

```http
Content-Type: application/json
```

**Request Body**

```json
{
  "name": "Alice",
  "email": "alice@example.com"
}
```

Optionally provide a custom `$id`:

```json
{
  "$id": "alice",
  "name": "Alice",
  "email": "alice@example.com"
}
```

**Response**

```json
{
  "$context": "https://example.com",
  "$type": "https://example.com/customers",
  "$id": "https://example.com/customers/alice",
  "name": "Alice",
  "email": "alice@example.com"
}
```

| Status Code | Description |
|-------------|-------------|
| 201 | Created successfully |
| 400 | Invalid JSON body |
| 409 | Duplicate - item already exists |
| 415 | Unsupported Content-Type |

### PUT /:type/:id

Replace an item entirely.

**Request Body**

```json
{
  "name": "Alice Updated",
  "email": "alice.new@example.com"
}
```

**Response**

Returns the updated item.

| Status Code | Description |
|-------------|-------------|
| 200 | Updated successfully |
| 400 | Invalid JSON body |
| 404 | Item not found |
| 415 | Unsupported Content-Type |

### PATCH /:type/:id

Partially update an item (merge).

**Request Body**

```json
{
  "email": "alice.new@example.com"
}
```

**Response**

Returns the updated item.

| Status Code | Description |
|-------------|-------------|
| 200 | Updated successfully |
| 400 | Invalid JSON body |
| 404 | Item not found |
| 415 | Unsupported Content-Type |

### DELETE /:type/:id

Delete an item.

| Status Code | Description |
|-------------|-------------|
| 204 | Deleted successfully (no content) |
| 404 | Item not found |

---

## Query API

### POST /query

Execute a query with automatic noun config detection.

**Request Body**

```json
{
  "collection": "customers",
  "filter": {
    "status": "active"
  },
  "sort": {
    "field": "createdAt",
    "order": "desc"
  },
  "limit": 100,
  "offset": 0,
  "consistency": "eventual"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `collection` | string | Collection to query (required) |
| `filter` | object | Filter criteria |
| `sort` | object | Sort configuration with `field` and `order` |
| `limit` | integer | Max results (default: 100) |
| `offset` | integer | Results to skip (default: 0) |
| `consistency` | string | `strong`, `eventual`, or `causal` |

**Response**

```json
{
  "results": [...],
  "meta": {
    "total": 250,
    "shards": 3,
    "consistency": "eventual",
    "routed_to_replica": false
  }
}
```

### POST /query/aggregate

Execute aggregation queries across shards.

**Request Body**

```json
{
  "collection": "orders",
  "aggregation": {
    "type": "sum",
    "field": "total",
    "groupBy": "customer_id"
  },
  "filter": {
    "status": "completed"
  }
}
```

| Aggregation Type | Description |
|------------------|-------------|
| `count` | Count matching items |
| `sum` | Sum of field values |
| `avg` | Average of field values |
| `min` | Minimum field value |
| `max` | Maximum field value |

---

## Analytics API

All analytics endpoints are under the `/analytics` prefix.

### GET /analytics/v1/health

Analytics subsystem health check.

**Response**

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "capabilities": {
    "vectorSearch": true,
    "r2Storage": true,
    "d1Database": true
  }
}
```

### POST /analytics/v1/search

Vector similarity search.

**Request Body**

```json
{
  "query": [0.1, 0.2, 0.3, ...],
  "k": 10,
  "metric": "cosine",
  "filters": [
    { "field": "category", "operator": "=", "value": "electronics" }
  ],
  "namespace": "products",
  "includeVectors": false,
  "includeMetadata": true,
  "nprobe": 20
}
```

| Field | Type | Description |
|-------|------|-------------|
| `query` | number[] | Query vector (required) |
| `k` | integer | Number of results (default: 10, max: 1000) |
| `metric` | string | `cosine`, `euclidean`, or `dot_product` |
| `filters` | array | Metadata filters |
| `namespace` | string | Optional namespace |
| `includeVectors` | boolean | Include vectors in results |
| `includeMetadata` | boolean | Include metadata (default: true) |
| `nprobe` | integer | Clusters to search (1-100, default: 20) |

**Response**

```json
{
  "results": [
    {
      "id": "vec-123",
      "score": 0.95,
      "metadata": { "category": "electronics", "name": "Widget" },
      "vector": [...]
    }
  ],
  "timing": {
    "total": 45,
    "centroidSearch": 10,
    "clusterLoad": 20,
    "rerank": 15
  },
  "stats": {
    "clustersSearched": 5,
    "vectorsScanned": 1000,
    "cacheHitRate": 0.8
  }
}
```

### GET /analytics/v1/lookup/:table/:key

Point lookup in Iceberg tables.

**Query Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `ns` | string | Namespace partition |
| `type` | string | Type partition |
| `date` | string | Date partition |

**Example Request**

```http
GET /analytics/v1/lookup/events/evt-123?ns=acme&date=2024-01-01
```

**Response**

```json
{
  "found": true,
  "data": {
    "id": "evt-123",
    "type": "purchase",
    "amount": 99.99
  },
  "timing": {
    "total": 25,
    "metadataLookup": 5,
    "partitionPrune": 3,
    "dataFetch": 17
  },
  "source": {
    "table": "events",
    "partition": "ns=acme/date=2024-01-01",
    "file": "data/events/ns=acme/date=2024-01-01/evt-123.json"
  }
}
```

### POST /analytics/v1/query

Execute SQL queries.

**Request Body**

```json
{
  "sql": "SELECT customer_id, SUM(amount) as total FROM orders GROUP BY customer_id",
  "executionHint": "auto",
  "params": [],
  "limit": 10000,
  "timeout": 30000,
  "clientCapabilities": {
    "duckdbWasm": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sql` | string | SQL query (required) |
| `executionHint` | string | `client`, `server`, or `auto` |
| `params` | array | Query parameters |
| `limit` | integer | Max rows (default: 10000, max: 100000) |
| `timeout` | integer | Timeout in ms (1000-300000, default: 30000) |
| `clientCapabilities` | object | Client capabilities for routing |

**Response (Server Execution)**

```json
{
  "data": [...],
  "columns": [
    { "name": "customer_id", "type": "string" },
    { "name": "total", "type": "number" }
  ],
  "rowCount": 100,
  "truncated": false,
  "timing": {
    "total": 150,
    "planning": 10,
    "execution": 130,
    "serialization": 10
  }
}
```

**Response (Client Execution Plan)**

```json
{
  "plan": {
    "type": "client_execute",
    "dataFiles": ["s3://bucket/data/orders/part-0001.parquet"],
    "optimizedSql": "SELECT ...",
    "estimates": {
      "rowCount": 10000,
      "dataSizeBytes": 5242880,
      "executionTimeMs": 500
    },
    "pushdownFilters": ["customer_id = 'acme'"]
  },
  "timing": {
    "total": 25,
    "planning": 25
  }
}
```

### POST /analytics/v1/classify

Classify a query without executing.

**Request Body**

```json
{
  "sql": "SELECT * FROM orders WHERE customer_id = 'alice'"
}
```

**Response**

```json
{
  "type": "point_lookup",
  "executionPath": "point_lookup",
  "estimatedCost": {
    "computeMs": 100,
    "dataSizeBytes": 1024,
    "monetaryCost": 0.00014
  }
}
```

---

## Events API (Segment-compatible)

The events API provides Segment-compatible endpoints for analytics tracking.

### POST /analytics/v1/track

Record a user action.

**Request Body**

```json
{
  "userId": "user-123",
  "event": "Button Clicked",
  "properties": {
    "button_name": "signup",
    "page": "/home"
  },
  "context": {
    "ip": "1.2.3.4",
    "userAgent": "..."
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `userId` | string | User ID (required if no anonymousId) |
| `anonymousId` | string | Anonymous ID (required if no userId) |
| `event` | string | Event name (required) |
| `properties` | object | Event properties |
| `context` | object | Event context |
| `timestamp` | string | ISO 8601 timestamp |
| `messageId` | string | Unique message ID (auto-generated) |

**Response**

```json
{
  "success": true,
  "messageId": "msg-uuid",
  "receivedAt": "2024-01-01T00:00:01.000Z"
}
```

### POST /analytics/v1/identify

Associate traits with a user.

**Request Body**

```json
{
  "userId": "user-123",
  "traits": {
    "email": "alice@example.com",
    "name": "Alice",
    "plan": "premium"
  }
}
```

### POST /analytics/v1/page

Record a page view.

**Request Body**

```json
{
  "userId": "user-123",
  "name": "Home",
  "category": "Marketing",
  "properties": {
    "url": "https://example.com/",
    "referrer": "https://google.com/"
  }
}
```

### POST /analytics/v1/screen

Record a mobile screen view.

**Request Body**

```json
{
  "userId": "user-123",
  "name": "Dashboard",
  "category": "Main",
  "properties": {
    "section": "overview"
  }
}
```

### POST /analytics/v1/group

Associate user with a group.

**Request Body**

```json
{
  "userId": "user-123",
  "groupId": "group-456",
  "traits": {
    "name": "Acme Corp",
    "plan": "enterprise",
    "employees": 100
  }
}
```

### POST /analytics/v1/alias

Link two user identities.

**Request Body**

```json
{
  "previousId": "anon-123",
  "userId": "user-456"
}
```

### POST /analytics/v1/batch

Send multiple events at once.

**Request Body**

```json
{
  "batch": [
    {
      "type": "track",
      "userId": "user-123",
      "event": "Order Completed",
      "properties": { "orderId": "order-789" }
    },
    {
      "type": "identify",
      "userId": "user-123",
      "traits": { "lifetimeValue": 1000 }
    }
  ]
}
```

**Response**

```json
{
  "success": true,
  "processed": 2,
  "succeeded": 2,
  "failed": 0,
  "events": [
    { "messageId": "msg-1", "success": true },
    { "messageId": "msg-2", "success": true }
  ]
}
```

| Batch Limits |  |
|--------------|--|
| Max events per batch | 100 |
| Max property size | 32KB |

---

## Error Responses

All errors follow a standard format:

```json
{
  "error": {
    "$type": "Error",
    "code": "NOT_FOUND",
    "message": "Customer not found: alice"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `NOT_FOUND` | 404 | Resource not found |
| `BAD_REQUEST` | 400 | Invalid request format |
| `DUPLICATE` | 409 | Resource already exists |
| `CREATE_FAILED` | 500 | Failed to create resource |
| `UPDATE_FAILED` | 500 | Failed to update resource |
| `DELETE_FAILED` | 500 | Failed to delete resource |
| `METHOD_NOT_ALLOWED` | 405 | HTTP method not allowed |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Invalid Content-Type |
| `INTERNAL_ERROR` | 500 | Server error |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |

### Authentication Errors

When authentication fails, the response includes a `WWW-Authenticate` header:

```http
WWW-Authenticate: Bearer realm="dotdo", charset="UTF-8"
```

---

## Content Types

The API supports the following content types:

| Content-Type | Description |
|--------------|-------------|
| `application/json` | Standard JSON |
| `application/ld+json` | JSON-LD linked data |

Request the preferred format via the `Accept` header:

```http
Accept: application/ld+json
```

---

## CORS

The API supports CORS with the following configuration:

| Header | Value |
|--------|-------|
| Access-Control-Allow-Origin | `*` |
| Access-Control-Allow-Methods | GET, POST, PUT, PATCH, DELETE, OPTIONS |
| Access-Control-Allow-Headers | Content-Type, Authorization, X-Request-ID |

---

## Request Tracing

Each request is assigned a unique ID for tracing:

- Include `X-Request-ID` header in your request to use your own ID
- If not provided, a UUID is auto-generated
- The ID is returned in the response header: `X-Request-ID`

---

## OpenAPI Specification

An OpenAPI 3.1 specification is available at `/api/openapi.json`. This can be used with tools like Swagger UI for interactive API exploration.

Key tags in the OpenAPI spec:
- **Things**: CRUD operations for things
- **Health**: Health check and status endpoints
- **Auth**: Authentication endpoints
- **Admin**: Administrative endpoints
- **MCP**: Model Context Protocol endpoints
- **RPC**: Remote Procedure Call endpoints

---

## Multi-Tenancy

The API supports multi-tenancy based on hostname:

```
tenant.api.dotdo.dev -> DO('tenant')
```

The subdomain determines which Durable Object namespace handles the request.

---

## Consistency Modes

For distributed operations, specify consistency mode:

| Mode | Description |
|------|-------------|
| `strong` | Wait for all replicas |
| `eventual` | Return immediately (may be stale) |
| `causal` | Preserve causal ordering |

Include in query requests:

```json
{
  "consistency": "strong"
}
```

---

## WebSocket Support

### RPC WebSocket

Connect to `/rpc` for real-time bidirectional communication:

```javascript
const ws = new WebSocket('wss://api.dotdo.dev/rpc');

ws.onopen = () => {
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'subscribe',
    params: { channel: 'events' }
  }));
};
```

### MCP SSE

For Model Context Protocol, use Server-Sent Events:

```javascript
const eventSource = new EventSource('/mcp', {
  headers: {
    'Mcp-Session-Id': 'session-123'
  }
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('MCP event:', data);
};
```

---

## SDK Libraries

Official client libraries:

- **JavaScript/TypeScript**: `@dotdo/client`
- **React**: `@dotdo/react`
- **RPC**: `@dotdo/rpc`

```bash
npm install @dotdo/client
```

```typescript
import { createClient } from '@dotdo/client';

const client = createClient({
  baseUrl: 'https://api.dotdo.dev',
  apiKey: 'your-api-key'
});

const customers = await client.customers.list({ limit: 10 });
```
