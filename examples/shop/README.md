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
import { $ } from 'dotdo'

$.on.Order.placed(async (event) => {
  const order = event.data
  // Reserve inventory
  for (const item of order.items) {
    await store.things.update(item.sku, {
      inventory: { decrement: item.qty }
    })
  }
  // Notify customer
  await $.Customer(order.customer).notify({
    template: 'order-confirmation',
    order
  })
})

$.on.Inventory.low(async (event) => {
  await $.send('Alert.inventory', {
    message: `${event.data.sku} low: ${event.data.current} units`,
    priority: 'high'
  })
})
```

## Durable Checkout with $.do

```typescript
async function checkout(customerId: string, cartId: string) {
  const cart = await store.l0.get(`cart:${cartId}`)

  // Validate inventory (retriable)
  await $.do(async () => {
    for (const item of cart.items) {
      const p = await store.things.get('Product', item.sku)
      if (p.inventory < item.qty) throw new Error(`Out of stock: ${item.sku}`)
    }
  }, { stepId: 'validate' })

  // Charge payment (retriable, idempotent)
  const charge = await $.do(async () => {
    return payments.charge({
      customer: customerId,
      amount: cart.total,
      idempotencyKey: `checkout-${cartId}`
    })
  }, { stepId: 'charge' })

  // Create order (retriable)
  const order = await $.do(async () => {
    return store.things.create({
      $type: 'Order',
      customer: customerId,
      items: cart.items,
      total: cart.total,
      chargeId: charge.id,
      status: 'paid'
    })
  }, { stepId: 'create-order' })

  $.send('Cart.cleared', { cartId })
  $.send('Order.placed', order)
  return order
}
```

`$.do` retries with exponential backoff. If the DO restarts mid-checkout, replay resumes from the last completed step.

## Scheduling

```typescript
// Daily inventory check
$.every.day.at('6am')(async () => {
  const lowStock = await store.things.list({
    $type: 'Product',
    inventory: { lt: 10 }
  })
  for (const p of lowStock) {
    $.send('Inventory.low', { sku: p.$id, current: p.inventory, threshold: 10 })
  }
})

// Weekly archive to Iceberg
$.every.Sunday.at('2am')(async () => {
  const old = await store.things.list({
    $type: 'Order',
    status: 'fulfilled',
    updatedAt: { lt: Date.now() - 30 * 24 * 60 * 60 * 1000 }
  })
  for (const order of old) {
    await store.l3.archive(order)
    await store.things.delete('Order', order.$id)
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
- **Event-driven** - $.on.Order.placed, $.on.Inventory.low
- **Automatic retries** - $.do handles failures

## Next Steps

1. Add products: `store.things.create({ $type: 'Product', ... })`
2. Integrate payments: Stripe, Square, any provider
3. Add events: `$.on.Order.refunded`, `$.on.Customer.signup`

---

Built with [dotdo v2](https://github.com/dot-do/dotdo)
