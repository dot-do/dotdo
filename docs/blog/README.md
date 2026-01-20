# dotdo Blog

Technical articles and case studies for building applications with dotdo Durable Objects.

## Articles

### Introduction

- **[Introducing dotdo](./introducing-dotdo.md)** - A runtime for Durable Digital Objects. Learn the core concepts of dotdo and how it simplifies building modern applications.

### Case Studies

Real-world examples demonstrating dotdo patterns in action:

- **[E-commerce Checkout](./case-study-ecommerce.md)** - Build a complete shopping cart and checkout system with cart management, payment processing, and order tracking. Demonstrates `$.on.Noun.verb` event handlers and `$.every` scheduling.

- **[Real-time Collaboration](./case-study-realtime.md)** - Build a collaborative document editor with WebSockets, presence awareness, cursor tracking, and operational transformation. Demonstrates native WebSocket support and real-time broadcasting.

- **[AI Agent](./case-study-ai-agent.md)** - Build an AI agent with conversation memory, tool execution, and multi-step task orchestration. Demonstrates stateful conversations and tool integration.

## Key Patterns Covered

### WorkflowContext ($)

All case studies demonstrate the `$` context:

```typescript
// Event handlers
$.on.Customer.signup(handler)
$.on.Order.created(handler)
$.on.Payment.completed(handler)

// Scheduling
$.every.day.atmidnight(handler)
$.every.Monday.at9am(handler)
$.every.hour(handler)

// Durability levels
$.send(event)      // Fire-and-forget
$.try(action)      // Single attempt
$.do(action)       // Durable with retries

// Cross-DO RPC
await $.Order(id).ship()
await $.Customer(id).notify()
```

### Things (Entities)

Generic entity storage:

```typescript
// Create
const product = await this.things.create({
  $type: 'Product',
  name: 'Widget',
  price: 29.99
})

// Read
const item = await this.things.get(id)

// Update
await this.things.update(id, { price: 24.99 })

// List
const products = await this.things.list({ type: 'Product' })
```

### Relationships

Graph-style connections:

```typescript
// Add relationship
await this.relationships.add({
  subject: customerId,
  predicate: 'purchased',
  object: orderId
})

// Query related
const orders = await this.relationships.getRelated(customerId, 'purchased')
```

### WebSocket Support

Native real-time communication:

```typescript
// Accept connection
return this.ws.handleWebSocketUpgrade(state, ['tag'], true)

// Broadcast
this.ws.broadcast(state, 'tag', message)

// Register handlers
this.ws.on('message-type', handler)
```

## Quick Links

- [Main Documentation](/docs)
- [Getting Started](/docs/GETTING_STARTED.md)
- [Examples](/examples)
- [GitHub](https://github.com/dotdo)

## Contributing

Have a case study or tutorial to share? We welcome contributions! Open a pull request with your article in this directory.
