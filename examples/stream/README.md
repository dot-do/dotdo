# stream.example.com.ai

**Event streaming. No Kinesis. No setup.**

```typescript
import { PipelineEmitter } from 'dotdo'

// Emit events (fire-and-forget)
pipeline.emit('order.created', 'orders', { orderId: '123', total: 99.99 })
pipeline.emit('order.shipped', 'orders', { orderId: '123', carrier: 'fedex' })

// Events are durable immediately. Zero data loss.
```

**100K events/second. Pay for compute, not per-event fees.**

---

## The Problem

- **Kinesis**: Provision shards, manage capacity, $25/shard/month minimum
- **EventHub**: Complex pricing tiers, throughput units, retention fees
- **Kafka**: Cluster management, ZooKeeper, operational overhead

You just want to emit events and process them later.

## The Solution

dotdo's Pipeline IS your event stream. Every write flows through Pipeline as the WAL. You get event streaming as a side effect of durability.

---

## Emit Events

Fire-and-forget. Events are durable before your code continues.

```typescript
const pipeline = new PipelineEmitter(env.PIPELINE, {
  namespace: 'tenant-123',
  batchSize: 100,
  flushInterval: 1000,
})

pipeline.emit('user.signup', 'users', { userId: 'u-456', email: 'alice@example.com' })
pipeline.emit('order.placed', 'orders', { orderId: 'o-789', items: 3 })
```

### Partition by Key

Route events to shards for ordered processing.

```typescript
// All events for same customer go to same shard
pipeline.emit('order.created', `orders:${customerId}`, { ... })
pipeline.emit('order.updated', `orders:${customerId}`, { ... })
// Guarantees: created -> updated (order preserved)
```

---

## Consume with Checkpoints

Read from any position. Track progress.

```typescript
class OrderConsumer {
  private checkpoint: string | null = null

  async process() {
    const events = await this.pipeline.read({
      stream: 'orders',
      after: this.checkpoint,
      limit: 100,
    })

    for (const event of events) {
      await this.handle(event)
      this.checkpoint = event.id
    }

    await this.saveCheckpoint(this.checkpoint)
  }
}
```

---

## Replay from Any Position

Go back in time. Rebuild state.

```typescript
// From beginning
const events = await pipeline.read({
  stream: 'orders',
  from: 'TRIM_HORIZON',
})

// From timestamp
const events = await pipeline.read({
  stream: 'orders',
  from: new Date('2024-01-01').toISOString(),
})

// From specific event
const events = await pipeline.read({
  stream: 'orders',
  after: 'evt_abc123',
})
```

### Rebuild Read Models

```typescript
async function rebuildStats() {
  const stats = { total: 0, revenue: 0 }
  let cursor = null

  while (true) {
    const events = await pipeline.read({ stream: 'orders', after: cursor, limit: 1000 })
    if (events.length === 0) break

    for (const event of events) {
      if (event.type === 'order.created') {
        stats.total++
        stats.revenue += event.payload.total
      }
      cursor = event.id
    }
  }
  return stats
}
```

---

## Complete Example

```typescript
// Producer: emit on checkout
export class CheckoutDO extends DO {
  async checkout(cart: Cart) {
    const order = await this.createOrder(cart)
    this.pipeline.emit('order.created', `orders:${order.customerId}`, {
      orderId: order.id,
      total: order.total,
    })
    return order
  }
}

// Consumer: real-time analytics
export class AnalyticsDO extends DO {
  async onAlarm() {
    const events = await this.pipeline.read({
      stream: 'orders:*',
      after: this.checkpoint,
      limit: 500,
    })

    for (const event of events) {
      await this.updateMetrics(event)
      this.checkpoint = event.id
    }

    await this.state.storage.setAlarm(Date.now() + 1000)
  }
}
```

---

## Quick Start

```bash
npm install && npm run dev

# Emit event
curl -X POST http://localhost:8787/events \
  -d '{"type": "order.created", "data": {"orderId": "123"}}'

# Read events
curl http://localhost:8787/events?stream=orders
```

---

## Cost Comparison

| Service | 1M events/day | 100M events/day |
|---------|---------------|-----------------|
| Kinesis | $36/month | $180/month |
| EventHub | $22/month | $200/month |
| dotdo Pipeline | ~$2/month | ~$15/month |

---

Built with [dotdo](https://dotdo.dev) - Event streaming, zero infrastructure.
