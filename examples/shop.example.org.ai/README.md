# shop.example.com.ai

An e-commerce shop built on dotdo v2.

## The Problem

You want to sell products online. Traditional platforms take 3-15% of every sale. Building custom e-commerce means weeks of infrastructure: databases, caching, payments, inventory.

## The Solution

dotdo gives you e-commerce in semantic primitives. Define your domain (Product, Cart, Order, Customer), and the 4-layer storage handles the rest: fast carts in memory, durable orders in SQLite, infinite history in Iceberg.

```bash
npm create dotdo@latest shop.example.com.ai
```

## Domain Model

```typescript
import { noun } from 'dotdo'

const Product = noun('Product')
const Cart = noun('Cart')
const Order = noun('Order')
const Customer = noun('Customer')
```

## Storage Layers

| Layer | Store | Use Case | Latency |
|-------|-------|----------|---------|
| L0 | InMemory | Shopping carts | <1ms |
| L1 | Pipeline | WAL durability | instant ACK |
| L2 | SQLite | Products, orders | <10ms |
| L3 | Iceberg | Order history | seconds |

### L0: Cart in Memory

```typescript
await store.l0.set('cart:alice', {
  items: [{ sku: 'hoodie-m', qty: 2, price: 4900 }],
  total: 9800
})

const cart = await store.l0.get('cart:alice')  // O(1)
```

### L2: Products in SQLite

```typescript
await store.things.create({
  $type: 'Product',
  $id: 'hoodie-m',
  name: 'Hoodie (M)',
  price: 4900,
  inventory: 42
})
```

### L3: Order History in Iceberg

```typescript
// Active orders in L2, archived orders query L3
const q1Orders = await store.l3.query({
  $type: 'Order',
  customer: 'alice',
  timestamp: { gte: '2024-01-01', lt: '2024-04-01' }
})
```

## Event Handlers

```typescript
import { DO } from 'dotdo'

export default DO.extend({
  init() {
    this.on.Order.placed(async (event) => {
      const order = event.data
      // Reserve inventory
      for (const item of order.items) {
        await this.things.update(item.sku, {
          inventory: { decrement: item.qty }
        })
      }
      // Notify customer
      await this.Customer(order.customer).notify({
        template: 'order-confirmation',
        order
      })
    })

    this.on.Inventory.low(async (event) => {
      await this.send('Alert.inventory', {
        message: `${event.data.sku} low: ${event.data.current} units`,
        priority: 'high'
      })
    })
  }
})
```

## Durable Checkout with this.do

```typescript
async checkout(customerId: string, cartId: string) {
  const cart = await this.store.l0.get(`cart:${cartId}`)

  // Validate inventory (retriable)
  await this.do(async () => {
    for (const item of cart.items) {
      const p = await this.things.get('Product', item.sku)
      if (p.inventory < item.qty) throw new Error(`Out of stock: ${item.sku}`)
    }
  }, { stepId: 'validate' })

  // Charge payment (retriable, idempotent)
  const charge = await this.do(async () => {
    return payments.charge({
      customer: customerId,
      amount: cart.total,
      idempotencyKey: `checkout-${cartId}`
    })
  }, { stepId: 'charge' })

  // Create order (retriable)
  const order = await this.do(async () => {
    return this.things.create({
      $type: 'Order',
      customer: customerId,
      items: cart.items,
      total: cart.total,
      chargeId: charge.id,
      status: 'paid'
    })
  }, { stepId: 'create-order' })

  this.send('Cart.cleared', { cartId })
  this.send('Order.placed', order)
  return order
}
```

`this.do` retries with exponential backoff. If the DO restarts mid-checkout, replay resumes from the last completed step.

## Promise Pipelining (Cap'n Web)

True Cap'n Proto-style pipelining: method calls on stubs batch until `await`, then resolve in a single round-trip.

```typescript
// ❌ Sequential - N round-trips
for (const item of cart.items) {
  await this.Inventory(item.sku).reserve(item.qty)
}

// ✅ Pipelined - parallel execution
cart.items.forEach(item => this.Inventory(item.sku).reserve(item.qty))

// ✅ Pipelined with collection
const reservations = await Promise.all(
  cart.items.map(item => this.Inventory(item.sku).reserve(item.qty))
)

// ✅ Fire-and-forget for side effects (no await needed)
this.Customer(order.customer).trackView(product.$id)
```

`this.Noun(id)` returns a pipelined stub. Property access and method calls are recorded, then executed server-side on `await`. Side effects like analytics, notifications, and logging don't require awaiting.

## Scheduling

```typescript
// Daily inventory check
this.every.day.at('6am')(async () => {
  const lowStock = await this.things.list({
    $type: 'Product',
    inventory: { lt: 10 }
  })
  for (const p of lowStock) {
    this.send('Inventory.low', { sku: p.$id, current: p.inventory, threshold: 10 })
  }
})

// Weekly archive to Iceberg
this.every.Sunday.at('2am')(async () => {
  const old = await this.things.list({
    $type: 'Order',
    status: 'fulfilled',
    updatedAt: { lt: Date.now() - 30 * 24 * 60 * 60 * 1000 }
  })
  for (const order of old) {
    await this.store.l3.archive(order)
    await this.things.delete('Order', order.$id)
  }
})
```

## Deploy

```bash
npm run deploy
```

## What You Get

- **Zero platform fees** - Own your infrastructure
- **Sub-ms cart ops** - L0 in-memory
- **Durable orders** - Pipeline-as-WAL, no data loss
- **Infinite history** - L3 Iceberg with time travel
- **Event-driven** - this.on.Order.placed, this.on.Inventory.low
- **Automatic retries** - this.do handles failures

## Next Steps

1. Add products: `this.things.create({ $type: 'Product', ... })`
2. Integrate payments: Stripe, Square, any provider
3. Add events: `this.on.Order.refunded`, `this.on.Customer.signup`

---

Built with [dotdo v2](https://github.com/dot-do/dotdo)
