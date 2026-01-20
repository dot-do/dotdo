# Introducing dotdo: A Runtime for Durable Digital Objects

**Published: January 2026**

Building modern applications requires managing state across distributed systems, handling real-time communication, and coordinating asynchronous workflows. Traditional approaches often involve cobbling together multiple services, databases, and message queues. What if there was a simpler way?

**dotdo** is a runtime and framework for building applications using Durable Objects on Cloudflare Workers. Think of it like Node.js, but purpose-built for the edge with built-in persistence, real-time capabilities, and event-driven architecture.

## The Problem with Traditional Architectures

Modern web applications typically require:

- A database for persistence
- A cache for performance
- A message queue for async processing
- WebSocket servers for real-time features
- Scheduled job runners for background tasks
- Multiple services to coordinate

This leads to:
- Complex infrastructure to manage
- Latency from network hops between services
- Consistency issues across distributed systems
- High operational costs

## The dotdo Solution

dotdo consolidates these capabilities into a single programming model based on **Digital Objects** (DOs). Each DO is:

- **Durable**: State persists automatically in SQLite
- **Isolated**: Complete data separation per tenant/entity
- **Consistent**: Strong consistency within each object
- **Real-time**: Native WebSocket support
- **Event-driven**: React to events with the `$` context

## Core Concepts

### Everything is a DO

All state lives in Durable Objects. Workers are stateless routers:

```typescript
// api/index.ts - the entire worker
export { DO } from '../do'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DO.idFromName(ns)
    const stub = env.DO.get(id)

    return stub.fetch(request)
  }
}
```

### The WorkflowContext ($)

The `$` context provides a fluent API for events, scheduling, and cross-DO communication:

```typescript
// Event handlers - infinite Noun.verb combinations via Proxy
$.on.Customer.signup(async (event) => {
  await $.send({ type: 'welcome-email', to: event.email })
})

// Durability levels
$.send(event)              // Fire-and-forget
$.try(action)              // Single attempt
$.do(action)               // Durable with retries

// Scheduling - fluent DSL
$.every.Monday.at('9am')(async () => {
  await generateWeeklyReport()
})

$.every.day.at('6pm')(handler)
$.every.hour(handler)

// Cross-DO RPC
await $.Order('order-123').ship()
await $.Customer(id).notify()
```

### Built-in Entities

The DO class provides built-in abstractions:

- **Things**: Generic entities (Product, Customer, Order, etc.)
- **Relationships**: Graph-style connections between entities
- **Events**: Audit log and event sourcing
- **Actions**: Tracked operations

```typescript
// Create a thing
const customer = await this.things.create({
  $type: 'Customer',
  name: 'Alice',
  email: 'alice@example.com'
})

// Add a relationship
await this.relationships.add({
  subject: customerId,
  predicate: 'purchased',
  object: orderId
})

// Query related things
const orders = await this.relationships.getRelated(customerId, 'purchased')
```

## Who is dotdo For?

dotdo is designed for **infrastructure developers** who need:

- A solid foundation for building SaaS applications
- Multi-tenant isolation out of the box
- Real-time capabilities without managing WebSocket servers
- Event-driven workflows without message queues
- Edge deployment with global distribution

## What You Can Build

- **E-commerce platforms** with shopping carts, checkout, and order tracking
- **Real-time collaboration** tools like document editors
- **AI agents** with memory, tools, and conversation management
- **IoT dashboards** processing sensor data at the edge
- **Multi-tenant SaaS** applications with complete data isolation

## Getting Started

```bash
# Install dotdo
npm install dotdo

# Create a new project
npx dotdo init my-app

# Start development
cd my-app && npm run dev
```

Check out our [case studies](/docs/blog) to see dotdo in action:

- [E-commerce Checkout](/docs/blog/case-study-ecommerce.md) - Shopping cart and payment processing
- [Real-time Collaboration](/docs/blog/case-study-realtime.md) - Document editing with WebSockets
- [AI Agent](/docs/blog/case-study-ai-agent.md) - Conversational AI with memory and tools

## The Future

dotdo is the runtime layer. Built on top of it is **workers.do** - a platform for teams to deploy AI-powered business applications. Together, they form a complete stack for building the next generation of web applications.

We're excited to see what you build. Join us on [GitHub](https://github.com/dotdo) and share your creations!

---

*dotdo is open source and available under the MIT license.*
