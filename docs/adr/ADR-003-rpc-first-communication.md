# ADR-003: RPC-First Communication

## Status

Accepted

## Date

2026-01-21

## Context

dotdo has multiple communication boundaries:

1. **Client to Worker**: Browser/CLI to Cloudflare Worker
2. **Worker to DO**: Worker routing requests to Durable Objects
3. **DO to DO**: Cross-DO communication for workflows and relationships

We needed a consistent communication model that works across all these boundaries while providing type safety, efficiency, and developer ergonomics.

## Decision

We will use **Cap'n Web RPC** (`@dotdo/rpc`) as the primary communication mechanism across all boundaries.

Key principles:

1. **RPC-first**: All operations are RPC calls, not REST endpoints
2. **Type-safe**: Full TypeScript support with inference
3. **Transport agnostic**: Same interface over HTTP, WebSocket, or direct calls
4. **Bi-directional**: Support for streaming and server-push patterns

The `$` WorkflowContext provides the developer-facing API:

```typescript
// Cross-DO RPC
await $.Order('order-123').ship()
await $.Customer(id).notify()

// Event-driven communication
$.on.Customer.signup(async (event) => {
  await $.send({ type: 'welcome-email', to: event.email })
})
```

## Consequences

### Positive

- **Unified model**: Same patterns work everywhere (client, worker, DO)
- **Type safety**: TypeScript catches errors at compile time
- **Efficient**: Binary serialization, connection multiplexing
- **Flexible transports**: Easy to switch between HTTP, WebSocket, direct calls
- **Natural DO interface**: RPC aligns with Cloudflare's DO stub interface

### Negative

- **Non-standard**: Not REST, requires client library or code generation
- **Debugging complexity**: Binary protocol harder to inspect than JSON/HTTP
- **Learning curve**: Developers familiar with REST need to adapt

### Neutral

- **HTTP compatibility**: Can expose REST-like endpoints for external consumers
- **Streaming**: Bi-directional streams are possible but add complexity

## Alternatives Considered

### REST API

Use traditional REST endpoints with JSON over HTTP.

**Rejected because:**
- Verbose for complex operations (multiple round trips)
- No type safety without code generation
- Awkward fit for DO-to-DO communication
- WebSocket streaming requires separate protocol

### GraphQL

Use GraphQL for flexible querying.

**Rejected because:**
- Overkill for DO-centric architecture where state is colocated
- Query complexity concerns with untrusted clients
- Adds resolver layer between client and DO
- Poor fit for mutations and real-time updates

### tRPC

Use tRPC for TypeScript-first RPC.

**Rejected because:**
- HTTP-centric, designed for Next.js patterns
- Doesn't handle DO-to-DO or WebSocket cases well
- Would need significant adaptation for our use case

### gRPC

Use gRPC with Protocol Buffers.

**Rejected because:**
- Heavy runtime, not optimized for edge deployment
- Browser support requires gRPC-Web proxy
- Schema-first approach conflicts with TypeScript-first goals

## References

- [Cap'n Proto](https://capnproto.org/) - Inspiration for Cap'n Web
- [Cloudflare Durable Objects RPC](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-from-a-worker/#call-rpc-methods) - Native RPC support
- [@dotdo/rpc package](../rpc/) - Implementation
