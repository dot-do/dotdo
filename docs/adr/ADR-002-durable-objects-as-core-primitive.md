# ADR-002: Durable Objects as Core Primitive

## Status

Accepted

## Date

2026-01-21

## Context

dotdo needs a persistence and compute model that supports:

1. **Stateful workloads**: Long-running workflows, user sessions, entity state
2. **Global distribution**: Low-latency access from anywhere
3. **Strong consistency**: Single-writer guarantees for state mutations
4. **Real-time capabilities**: WebSocket connections, live updates
5. **Serverless scaling**: No server management, pay-per-use

We evaluated several approaches including traditional databases, edge functions with external storage, and Cloudflare Durable Objects.

## Decision

We will use **Cloudflare Durable Objects** as the core compute and storage primitive.

Key architectural principles:

1. **Everything is a DO**: All state lives in Durable Objects. Workers are stateless routers.
2. **DO = Durable Object = Digital Object**: The naming is intentional - DOs represent digital entities.
3. **SQLite storage**: Each DO has its own SQLite database for structured data.
4. **Single writer**: Each DO instance has exclusive access to its state.

The DO class (`@dotdo/do`) implements:
- **Nouns, Verbs, Things, Actions, Relationships**
- **Events, Functions, Workflows**
- **Integrations, Connections**
- **Orgs, Users, API Keys**
- **Analytics**

## Consequences

### Positive

- **Strong consistency**: Single-writer model eliminates distributed coordination problems
- **Colocated compute and storage**: State access is local, not over network
- **Automatic migration**: Cloudflare handles DO instance placement and migration
- **Built-in hibernation**: DOs hibernate when idle, reducing costs
- **WebSocket support**: Native support for persistent connections
- **Real SQLite**: Full SQL capabilities, not a key-value abstraction

### Negative

- **Cloudflare lock-in**: DOs are a Cloudflare-specific primitive
- **Size limits**: 10GB per DO, 128MB SQLite write transaction limit
- **Single-region writes**: Each DO instance runs in one location
- **Learning curve**: Different mental model from traditional databases

### Neutral

- **Pricing**: Based on requests, duration, and storage (competitive with alternatives)
- **Testing**: Miniflare provides local DO emulation for development

## Alternatives Considered

### Edge Functions + External Database

Use Cloudflare Workers with PlanetScale, Neon, or Turso for storage.

**Rejected because:**
- Network latency for every database operation
- No strong consistency guarantees without complex coordination
- WebSocket state would need separate solution

### Traditional Server Architecture

Use containers or VMs with PostgreSQL or similar.

**Rejected because:**
- Manual scaling and region management
- Higher operational burden
- Doesn't fit serverless deployment model

### Cloudflare KV + Workers

Use KV for persistence with Workers for compute.

**Rejected because:**
- KV is eventually consistent, not suitable for all workloads
- No transaction support
- Limited querying capabilities

## References

- [Cloudflare Durable Objects documentation](https://developers.cloudflare.com/durable-objects/)
- [SQLite in Durable Objects](https://developers.cloudflare.com/durable-objects/api/storage-api/#sql-api)
- [Miniflare](https://miniflare.dev/) for local development
