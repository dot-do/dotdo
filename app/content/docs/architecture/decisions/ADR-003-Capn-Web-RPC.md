# ADR-003: Cap'n Web RPC

## Status

Accepted

## Context

Cross-Durable Object communication is fundamental to building complex applications, but traditional RPC approaches have limitations:

1. **Round-trip latency** - Each method call requires a network round-trip
2. **No capability security** - Any caller can invoke any method
3. **Weak type safety** - Types lost across RPC boundaries
4. **No introspection** - Clients can't discover available methods at runtime

We needed an RPC system that provides efficient communication, capability-based security, full type preservation, and runtime discoverability.

## Decision

Implement Cap'n Web RPC, inspired by [Cap'n Proto](https://capnproto.org/) but designed for the web and Cloudflare Workers runtime.

### Core Features

1. **Promise Pipelining** - Chain operations without intermediate round-trips
2. **Capability-based Security** - Unforgeable references with attenuation
3. **$meta Introspection** - Runtime schema and method discovery
4. **Type-safe Execution** - Full TypeScript preservation across RPC

### Architecture

```
RPC Client
  ├── $meta Interface (schema, methods, capabilities, version)
  ├── Pipeline Builder (then, execute)
  └── Capability System (attenuate, revoke, verify)
           ↓
Transport Layer (JSON/binary serialization)
           ↓
HTTP/fetch or DO Stub (direct)
           ↓
Target Durable Object
```

### Promise Pipelining

Traditional RPC requires sequential round-trips:

```typescript
// 3 round trips
const customer = await stub.getCustomer(id)
const orders = await stub.getOrders(customer.id)
const total = await stub.sumOrders(orders)
```

Cap'n Web pipelines all operations into a single request:

```typescript
// 1 round trip
const result = await pipeline(stub)
  .then('getCustomer', id)
  .then('getOrders')
  .then('sumOrders')
  .execute()
```

### Capability-based Security

Capabilities provide unforgeable, attenuatable references:

```typescript
// Full access capability
const fullCap = createCapability(customerDO)

// Attenuate to read-only methods
const readOnlyCap = fullCap.attenuate(['getProfile', 'getOrders'])

// Invoke through capability
await readOnlyCap.invoke('getOrders')  // Works
await readOnlyCap.invoke('delete')     // Throws: not authorized
```

### $meta Introspection

Every RPC client exposes runtime discoverability:

```typescript
const schema = await client.$meta.schema()
// { name: 'Customer', fields: [...] }

const methods = await client.$meta.methods()
// [{ name: 'charge', params: [...], returns: 'Promise<Receipt>' }]

const caps = await client.$meta.capabilities()
// ['read', 'write', 'admin']
```

## Consequences

### Positive

- **Reduced latency** - Pipeline eliminates sequential round-trips
- **Secure by default** - Capabilities prevent unauthorized access
- **Discoverable APIs** - Clients can inspect available methods
- **Type safety** - Full TypeScript inference across RPC
- **Flexible transport** - Works with HTTP URLs or direct DO stubs

### Negative

- **Learning curve** - Capability model differs from traditional RPC
- **Pipeline complexity** - Chained operations harder to debug
- **Serialization overhead** - JSON/binary encoding adds ~1% latency
- **$meta overhead** - First call to $meta.schema() fetches full schema

### Mitigations

- Comprehensive documentation with examples
- Pipeline visualization in dev tools
- Schema caching after first fetch
- Binary format option for performance-critical paths

## API Examples

### Creating Clients

```typescript
// URL-based client
const customer = createRPCClient<CustomerDO>({
  target: 'https://customer.api.dotdo.dev/cust-123',
  timeout: 5000
})

// Stub-based client (no network hop)
const stub = env.CUSTOMER.get(id)
const customer = createRPCClient<CustomerDO>({ target: stub })
```

### Using Capabilities

```typescript
// Create with permissions
const cap = createCapability(customer, {
  methods: ['getProfile', 'updateProfile'],
  expiry: Date.now() + 3600000  // 1 hour
})

// Serialize for external use
const token = serializeCapability(cap)

// Verify and use
const verified = await verifyCapability(token)
await verified.invoke('getProfile')
```

## References

- `/docs/rpc/index.mdx` - Cap'n Web RPC overview
- `/docs/rpc/capabilities.mdx` - Capability system details
- `/docs/rpc/pipelining.mdx` - Promise pipelining guide
- `/docs/rpc/serialization.mdx` - JSON/binary formats
- [Cap'n Proto](https://capnproto.org/) - Original inspiration
