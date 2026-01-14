# WebSocket Protocol Specification

**Version:** 1.0
**Status:** Stable
**Module:** `unified-storage/ws-protocol`

## Overview

The Unified Storage WebSocket protocol enables real-time CRUD operations with Pipeline-as-WAL durability. This document specifies the message formats, error codes, and subscription patterns.

## Cost Advantage

WebSocket messages are **20:1 cheaper** than HTTP requests:
- WebSocket: $0.0075 per million messages
- HTTP: $0.15 per million requests

## Message Format

All messages are JSON objects with these common fields:

```typescript
interface BaseMessage {
  id: string      // Unique message ID for request/response correlation
  type: string    // Message type
}
```

### Message IDs

Message IDs should be unique within a connection session. The protocol provides a helper:

```typescript
const id = WSProtocol.generateMessageId() // "msg-550e8400-e29b-41d4-a716-446655440000"
```

## Request Message Types

### create

Creates a new thing in storage.

```json
{
  "id": "msg-1",
  "type": "create",
  "$type": "Customer",
  "data": {
    "name": "Alice Smith",
    "email": "alice@example.com"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Message ID for correlation |
| `type` | string | Yes | Must be `"create"` |
| `$type` | string | Yes | Entity type (e.g., "Customer", "Order") |
| `data` | object | Yes | Entity data to store |

### read

Reads one or more things by ID.

```json
{
  "id": "msg-2",
  "type": "read",
  "$ids": ["customer_123", "customer_456"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Message ID for correlation |
| `type` | string | Yes | Must be `"read"` |
| `$ids` | string[] | Yes | Array of entity IDs to read (non-empty) |

### update

Updates an existing thing.

```json
{
  "id": "msg-3",
  "type": "update",
  "$id": "customer_123",
  "data": {
    "name": "Alice Johnson"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Message ID for correlation |
| `type` | string | Yes | Must be `"update"` |
| `$id` | string | Yes | ID of entity to update |
| `data` | object | Yes | Fields to merge into entity |

### delete

Deletes a thing by ID.

```json
{
  "id": "msg-4",
  "type": "delete",
  "$id": "customer_123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Message ID for correlation |
| `type` | string | Yes | Must be `"delete"` |
| `$id` | string | Yes | ID of entity to delete |

### batch

Groups multiple operations into a single message.

```json
{
  "id": "msg-5",
  "type": "batch",
  "operations": [
    {
      "id": "op-1",
      "type": "create",
      "$type": "Order",
      "data": { "total": 100 }
    },
    {
      "id": "op-2",
      "type": "update",
      "$id": "customer_123",
      "data": { "orderCount": 5 }
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Message ID for correlation |
| `type` | string | Yes | Must be `"batch"` |
| `operations` | array | Yes | Array of create/update/delete operations |

**Limits:**
- Maximum 1,000 operations per batch

### subscribe

Subscribe to real-time updates.

```json
{
  "id": "msg-6",
  "type": "subscribe",
  "topic": "Customer.*",
  "filter": {
    "status": "active"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Message ID for correlation |
| `type` | string | Yes | Must be `"subscribe"` |
| `topic` | string | Yes | Topic pattern (supports wildcards) |
| `filter` | object | No | Optional filter for subscribed events |

**Topic Patterns:**
- `Customer` - All Customer events
- `Customer.*` - All Customer events (explicit wildcard)
- `order_123` - Specific entity by ID

### unsubscribe

Cancel a subscription.

```json
{
  "id": "msg-7",
  "type": "unsubscribe",
  "subscriptionId": "sub_abc123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Message ID for correlation |
| `type` | string | Yes | Must be `"unsubscribe"` |
| `subscriptionId` | string | Yes | ID of subscription to cancel |

## Response Message Types

### ack

Acknowledgement for create/update/delete operations.

```json
{
  "type": "ack",
  "id": "msg-1",
  "result": {
    "$id": "customer_789",
    "$version": 1
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"ack"` |
| `id` | string | Correlates to request message ID |
| `result` | object | Optional - contains `$id` and `$version` |

### read_response

Response to a read request.

```json
{
  "type": "read_response",
  "id": "msg-2",
  "things": {
    "customer_123": {
      "$id": "customer_123",
      "$type": "Customer",
      "$version": 3,
      "name": "Alice Smith"
    },
    "customer_456": null
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"read_response"` |
| `id` | string | Correlates to request message ID |
| `things` | object | Map of `$id` to thing (or `null` if not found) |

### error

Error response for any failed request.

```json
{
  "type": "error",
  "id": "msg-3",
  "code": "NOT_FOUND",
  "message": "Entity customer_999 not found",
  "details": {
    "requestedId": "customer_999"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"error"` |
| `id` | string | Correlates to request message ID |
| `code` | string | Error code (see Error Codes) |
| `message` | string | Human-readable error message |
| `details` | object | Optional additional details |

### subscription_update

Pushed to clients when subscribed data changes.

```json
{
  "type": "subscription_update",
  "subscriptionId": "sub_abc123",
  "event": "updated",
  "thing": {
    "$id": "customer_123",
    "$type": "Customer",
    "$version": 4,
    "name": "Alice Johnson"
  },
  "delta": {
    "name": "Alice Johnson"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"subscription_update"` |
| `subscriptionId` | string | ID of the matching subscription |
| `event` | string | `"created"`, `"updated"`, or `"deleted"` |
| `thing` | object | The full entity state |
| `delta` | object | Optional - only changed fields (for updates) |

## Error Codes

| Code | HTTP Equivalent | Description |
|------|-----------------|-------------|
| `NOT_FOUND` | 404 | Entity not found |
| `VALIDATION_ERROR` | 400 | Invalid message structure or data |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Access denied |
| `CONFLICT` | 409 | Version conflict or duplicate |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `RATE_LIMITED` | 429 | Too many requests |
| `PAYLOAD_TOO_LARGE` | 413 | Message exceeds size limit |

## Subscription Patterns

### By Type

Subscribe to all entities of a type:

```typescript
broadcaster.subscribe(ws, { $type: 'Customer' })
```

Receives updates when any Customer is created, updated, or deleted.

### By ID

Subscribe to a specific entity:

```typescript
broadcaster.subscribe(ws, { $id: 'customer_123' })
```

Receives updates only for that specific entity.

### Wildcard

Subscribe to all updates:

```typescript
broadcaster.subscribe(ws, { wildcard: true })
```

Receives all entity changes. Use sparingly.

### With Options

```typescript
broadcaster.subscribe(ws, {
  $type: 'Order',
  includePayload: true,    // Include full entity (default: true)
  backfill: true,          // Send historical events
  backfillLimit: 50,       // Max backfill events (default: 100)
  coalesce: false,         // Disable message coalescing
})
```

## Message Coalescing

When `coalesceWindowMs` is configured, rapid updates to the same entity are combined:

1. First update is sent immediately
2. Subsequent updates within the window are buffered
3. At window end, a single coalesced message is sent

Coalesced messages include metadata:

```json
{
  "type": "subscription_update",
  "subscriptionId": "sub_abc123",
  "event": "updated",
  "thing": { ... },
  "coalesced": true,
  "coalescedCount": 5
}
```

## Backfill

When `backfill: true` is set, historical events are sent after subscription:

```json
{
  "type": "subscription_update",
  "subscriptionId": "sub_abc123",
  "event": "created",
  "thing": { ... },
  "backfill": true,
  "historical": true
}
```

Backfill messages are marked with `backfill: true` and `historical: true`.

## Binary Encoding

For bandwidth-sensitive scenarios, use binary encoding:

```typescript
const binary = WSProtocol.serialize(message, { binary: true })
ws.send(binary)
```

Binary messages are UTF-8 encoded JSON in an ArrayBuffer.

## Payload Limits

| Limit | Value |
|-------|-------|
| Maximum payload size | 10 MB |
| Maximum batch operations | 1,000 |

## Example Flows

### CRUD Flow

```
Client                          Server
  |                                |
  |-- create { $type: "Customer" } -->
  |                                |
  |<-- ack { $id, $version } ------|
  |                                |
  |-- read { $ids: ["customer_123"] } -->
  |                                |
  |<-- read_response { things: {...} } --|
  |                                |
  |-- update { $id, data } ------->|
  |                                |
  |<-- ack { $version: 2 } --------|
  |                                |
  |-- delete { $id } ------------->|
  |                                |
  |<-- ack { } --------------------|
```

### Subscription Flow

```
Client                          Server
  |                                |
  |-- subscribe { topic: "Order" } -->
  |                                |
  |<-- ack { subscriptionId } -----|
  |                                |
  |                    [Order created]
  |<-- subscription_update --------|
  |                                |
  |                    [Order updated]
  |<-- subscription_update --------|
  |                                |
  |-- unsubscribe { subscriptionId } -->
  |                                |
  |<-- ack {} ---------------------|
```

### Batch Flow

```
Client                          Server
  |                                |
  |-- batch {                      |
  |     operations: [              |
  |       { type: "create", ... }, |
  |       { type: "update", ... }, |
  |     ]                          |
  |   } -------------------------->|
  |                                |
  |<-- batch_response {            |
  |     results: [                 |
  |       { success: true, $id },  |
  |       { success: true, $version }, |
  |     ]                          |
  |   } ---------------------------|
```

## Type Guards

Use type guards to safely handle responses:

```typescript
if (WSProtocol.isAckResponse(response)) {
  console.log('Created:', response.result?.$id)
}

if (WSProtocol.isErrorResponse(response)) {
  console.error('Error:', response.code, response.message)
}

if (WSProtocol.isSubscriptionUpdate(response)) {
  console.log('Update:', response.event, response.thing.$id)
}
```

## See Also

- [README.md](../README.md) - Component overview
- [ws-protocol.ts](../ws-protocol.ts) - TypeScript implementation
- [websocket-integration.ts](../examples/websocket-integration.ts) - Client example
