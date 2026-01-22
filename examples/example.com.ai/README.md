# example.com.ai - Hierarchical DO Architecture

This example demonstrates a **parent-child DO architecture** where:

- **Parent DO** (`example.com.ai`) aggregates events from all children and streams to R2
- **Child DOs** (`crm.example.com.ai/:tenant`) phone home to the parent

## Architecture

```
example.com.ai (Parent DO)
    |
    +-- $.on['*']['*']       # Receives ALL events from ALL children
    +-- $.r2.buffer()        # Buffers events for R2 streaming
    +-- $.query.global()     # Global search across all children
    +-- $.children.list()    # Discover and list child DOs
    +-- $.context            # Shared context for children
    |
    +-- crm.example.com.ai/tenant-abc (Child DO)
    |       +-- $context.emit()       # Send events to parent
    |       +-- $context.getParent()  # Access parent context
    |       +-- $context.heartbeat()  # Keep-alive to parent
    |
    +-- crm.example.com.ai/tenant-xyz (Child DO)
            +-- ...
```

## Key Features

### 1. CDC (Change Data Capture)

Parent receives ALL events from ALL children via wildcard handler:

```typescript
parent.$.on['*']['*'](async (event) => {
  // All events from all children
  console.log(`Received ${event.type} from ${event.childId}`)
  await parent.$.r2.buffer(event)
})
```

### 2. R2 Event Streaming

Efficient batching of events before writing to R2:

```typescript
// Configure buffer for cost efficiency
parent.$.r2.configure({
  maxBufferSize: 1000,
  flushIntervalMs: 60000, // 1 minute
  batchSize: 100,
})

// Buffer events
await parent.$.r2.buffer(event)

// Manual flush if needed
const result = await parent.$.r2.flush()
console.log(`Wrote ${result.written} events, batch: ${result.batchId}`)
```

### 3. Global Query

Search across ALL children from the parent:

```typescript
// Find all customers across all tenants
const customers = await parent.$.query.global({
  $type: 'Customer',
  filters: { plan: 'premium' },
  limit: 100,
})

// Query specific child
const tenantCustomers = await parent.$.query.child('tenant-abc', {
  $type: 'Customer',
})
```

### 4. Shared Context

Children can access parent context:

```typescript
// In child DO
const parentContext = await child.$context.getParent()
console.log(parentContext.config.apiKey)

// Emit event to parent
await child.$context.emit({
  type: 'Customer.signup',
  payload: { email: 'new@example.com' },
})
```

### 5. Child Discovery

Parent can discover and list all children:

```typescript
const children = await parent.$.children.list()
const count = await parent.$.children.count()

// Discover new children
const discovered = await parent.$.children.discover()

// Get specific child info
const child = await parent.$.children.get('tenant-abc')
console.log(`Last seen: ${new Date(child.lastSeen)}`)
```

## Running Tests

```bash
# Run tests (will fail until implementation exists - this is TDD RED phase)
npx vitest run examples/example.com.ai/tests/

# Run with watch mode
npx vitest examples/example.com.ai/tests/
```

## Implementation Status

- [ ] Parent DO base class
- [ ] Wildcard event handlers for children
- [ ] R2 buffer and streaming
- [ ] Global query across children
- [ ] Child discovery and listing
- [ ] Shared $context for children
- [ ] Child heartbeat mechanism

## Related Issues

- `do-r9zcd.1`: RED - Write failing tests for parent DO (this file)
- `do-r9zcd.2`: GREEN - Implement parent DO with R2 streaming
- `do-r9zcd.3`: REFACTOR - Optimize and clean up
