# ADR-004: Semantic Type System

## Status

Accepted

## Context

Domain modeling in traditional systems requires:
1. Separate entity definitions, event schemas, and relationship models
2. Manual pluralization and verb conjugation for API naming
3. Explicit graph traversal code for relationships
4. Disconnected audit logging from business operations

We needed a unified type system that:
- Reads like natural language
- Automatically derives linguistic forms
- Unifies events, edges, and audit in a single record
- Provides intuitive graph traversal operators

## Decision

Implement a semantic type system with five interconnected concepts:

### Core Concepts

| Concept | Description | Example |
|---------|-------------|---------|
| **Nouns** | Entity type definitions | `Customer`, `Order`, `Product` |
| **Verbs** | Action definitions with tenses | `purchase`, `ship`, `cancel` |
| **Things** | Entity instances with `$id` and `$type` | `{ $id: 'cust-123', $type: 'Customer' }` |
| **Actions** | Unified event + edge + audit records | `Customer.purchased.Order` |
| **Relationships** | Graph traversal operators | `->`, `~>`, `<-`, `<~` |

### Linguistic Automation

Nouns automatically derive plural forms:

```typescript
const Customer = noun('Customer')
// Customer.singular = 'Customer'
// Customer.plural = 'Customers'

const Category = noun('Category')
// Category.plural = 'Categories' (y -> ies rule)
```

Verbs automatically derive all tenses:

```typescript
const create = verb('create')
// create.base = 'create'
// create.past = 'created'
// create.present = 'creates'
// create.gerund = 'creating'

const ship = verb('ship')
// ship.past = 'shipped' (CVC doubling)
// ship.gerund = 'shipping'
```

Override for irregular forms:

```typescript
const buy = verb('buy', { past: 'bought' })
```

### The Thing Model

Every entity is a Thing with required `$id` and `$type`:

```typescript
const customer = thing(Customer, { name: 'Alice' })
// { $id: 'a1b2c3d4-...', $type: 'Customer', name: 'Alice' }
```

### The Action Model

Actions unify three concerns:

```typescript
const result = action(alice, purchase, order)

// result.event - What happened
{ type: 'purchased', subject: 'alice-id', object: 'order-id', timestamp }

// result.edge - Graph connection
{ from: 'alice-id', to: 'order-id', verb: 'purchased' }

// result.audit - Who did what when
{ actor: 'alice-id', verb: 'purchased', target: 'order-id', timestamp }
```

### Relationship Operators

Four operators for graph traversal:

| Operator | Direction | Method | Description |
|----------|-----------|--------|-------------|
| `->` | Forward | Exact | Find things this entity points to |
| `~>` | Forward | Fuzzy | Find semantically similar things |
| `<-` | Backward | Exact | Find things that point to this entity |
| `<~` | Backward | Fuzzy | Find semantically related things |

```typescript
const orders = forward(customer, 'Order')      // customer -> Order
const buyers = backward(order, 'Customer')     // order <- Customer
const similar = await forwardFuzzy(product, 'Product', { threshold: 0.8 })
```

## Consequences

### Positive

- **Natural language DSL** - Code reads like domain language
- **Less boilerplate** - Linguistic automation handles pluralization/conjugation
- **Unified model** - Single action creates event, edge, and audit
- **Intuitive traversal** - Arrow operators match mental model
- **Full type safety** - TypeScript inference throughout

### Negative

- **Learning curve** - Developers must understand the semantic model
- **Linguistic edge cases** - English rules have exceptions
- **Fuzzy search dependency** - `~>` requires vector store configuration
- **Storage overhead** - Actions create 3 records per operation

### Mitigations

- Comprehensive documentation with examples
- Override mechanism for irregular forms
- Graceful degradation when vector store unavailable
- Efficient batching for action records

## API Examples

### Domain Modeling

```typescript
import { noun, verb, thing, action, forward, backward } from '@dotdo/semantic'

// Define vocabulary
const Customer = noun('Customer')
const Order = noun('Order')
const purchase = verb('purchase')

// Create instances
const alice = thing(Customer, { name: 'Alice', email: 'alice@example.com' })
const order = thing(Order, { total: 99.99, status: 'pending' })

// Record action (creates event + edge + audit)
const result = action(alice, purchase, order)

// Navigate relationships
const aliceOrders = forward(alice, 'Order')     // All orders Alice purchased
const orderBuyers = backward(order, 'Customer') // All customers who bought this order
```

### DOSemantic Usage

```typescript
class MyDO extends DOSemantic {
  async createOrder(customerId: string, items: Item[]) {
    const customer = await this.getThing(customerId)
    const order = this.createThing('Order', { items, total: calculateTotal(items) })

    // Unified action creates event, edge, and audit
    this.createAction(customer.$id, 'purchase', order.$id)

    return order
  }

  async getCustomerOrders(customerId: string) {
    return this.forward(customerId, 'Order')
  }
}
```

## References

- `/docs/semantic/index.mdx` - Semantic type system overview
- `/docs/semantic/nouns-verbs.mdx` - Linguistic automation details
- `/docs/semantic/things.mdx` - Thing model documentation
- `/docs/semantic/actions.mdx` - Action unification
- `/docs/semantic/relationships.mdx` - Graph traversal operators
