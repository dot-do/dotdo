# Multi-Vendor Marketplace

**Scale to thousands of vendors. Query across all of them in milliseconds.**

```typescript
// Each vendor is a Durable Object. Fanout aggregates them all.
const results = await coordinator.query<Product>(
  'SELECT * FROM products WHERE category = ? ORDER BY rating DESC LIMIT 10',
  ['electronics']
)
// Results merged from 1000+ vendor DOs in <100ms
```

---

## The Problem

Marketplaces need vendor isolation, aggregate queries across all vendors, and order routing - all at scale. Traditional databases leak data between vendors. Microservices create coordination nightmares.

## The Solution

Each vendor is a Durable Object with complete isolation. Fanout queries aggregate across all of them in parallel.

```
Customer Query: "Show me top electronics"
                    │
                    ▼
           QueryCoordinator
          (scatter to all vendors)
          /         │         \
    VendorDO   VendorDO   VendorDO  ... (1000+ DOs)
     acme       widgets    gadgets
          \         │         /
                    ▼
           Merge + Sort + Limit
                    │
                    ▼
           Top 10 products (global)
```

---

## Things

```typescript
const Vendor = noun('Vendor')   // One DO per vendor
const Product = noun('Product') // Lives within vendor DO
const Order = noun('Order')     // Routes to correct vendor
const Review = noun('Review')   // Attached to product
```

---

## Vendor Isolation

Each vendor gets their own DO with complete data isolation:

```typescript
export class VendorDO extends DO {
  async createProduct(data: ProductData) {
    return this.things.create({ $type: 'Product', vendorId: this.vendorId, ...data })
  }

  async listProducts(category?: string) {
    return this.sql.exec(
      'SELECT * FROM things WHERE $type = ? AND category = ?',
      ['Product', category]
    )
  }
}
```

---

## Fanout Queries

Query across all vendors in parallel:

```typescript
import { QueryCoordinator } from 'dotdo'

const scanners = vendorIds.map((id) => ({
  id,
  execute: (sql, params) => env.VENDOR.get(env.VENDOR.idFromName(id)).query(sql, params),
}))

const coordinator = new QueryCoordinator(scanners)

// Search products across ALL vendors
const results = await coordinator.query<Product>(
  'SELECT * FROM products WHERE name LIKE ?',
  ['%wireless%']
)

// Aggregates handled automatically
const stats = await coordinator.query('SELECT COUNT(*) as count FROM products')
// COUNT/SUM/AVG merged correctly across all vendors
```

---

## Order Routing

Route orders to the correct vendor DO:

```typescript
export class MarketplaceDO extends DO {
  constructor(state, env) {
    super(state, env)

    this.$.on.Order.placed(async (event) => {
      const { vendorId, orderId, items, customer } = event.data
      const vendor = this.env.VENDOR.get(this.env.VENDOR.idFromName(vendorId))
      await vendor.handleOrder({ orderId, items, customer })
    })
  }

  async placeOrder(cart: Cart) {
    const byVendor = groupBy(cart.items, 'vendorId')

    return Promise.all(
      Object.entries(byVendor).map(async ([vendorId, items]) => {
        const order = await this.things.create({
          $type: 'Order', vendorId, items, customer: cart.customerId
        })
        this.$.send('Order.placed', { orderId: order.$id, vendorId, items })
        return order
      })
    )
  }
}
```

---

## Sharding for Scale

For 10,000+ vendors, use consistent hashing:

```typescript
import { ConsistentHashRing } from 'dotdo'

const ring = new ConsistentHashRing({ virtualNodes: 150 })
shardIds.forEach((id) => ring.addNode(id))

// Route vendor to correct shard
const shardId = ring.getNode(vendorId)

// Query with shard key optimization (routes to single shard)
const results = await coordinator.query(
  'SELECT * FROM products WHERE vendorId = ?',
  [vendorId],
  { shardKey: vendorId }
)
```

---

## Quick Start

```bash
npm install dotdo
```

```typescript
// 1. Define vendor DO
export class VendorDO extends DO { /* ... */ }

// 2. Set up fanout coordinator
const coordinator = new QueryCoordinator(vendorScanners)

// 3. Query across all vendors
const products = await coordinator.query('SELECT * FROM products LIMIT 100')

// 4. Onboard your first vendor
await env.VENDOR.get(env.VENDOR.idFromName('acme')).initialize({
  name: 'Acme Electronics'
})
```

---

## Promise Pipelining

Promises are stubs. Chain freely, await only when needed.

```typescript
// ❌ Sequential - N round-trips
for (const vendorId of vendorIds) {
  await $.Vendor(vendorId).notify(order)
}

// ✅ Fire-and-forget - no await needed for side effects
vendorIds.forEach(id => $.Vendor(id).notify(order))

// ✅ Pipelined - single round-trip for chained access
const stock = await $.Vendor(id).inventory().available('SKU-123')
```

Only `await` at exit points when you actually need the value. Notifications, logging, and side effects don't need to block.

---

## Why This Works

| Challenge | Solution |
|-----------|----------|
| Vendor isolation | Each vendor = separate DO with own SQLite |
| Cross-vendor queries | Fanout with parallel scatter-gather |
| Order routing | `$.on.Order.placed` routes to vendor DO |
| Scale | Consistent hashing distributes load |

One architecture. One to one million vendors.

---

Built with [dotdo](https://dotdo.dev)
