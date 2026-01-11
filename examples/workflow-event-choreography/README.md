# Order placed. Four services notified. Zero coupling.

```typescript
// OrderDO kicks off the saga
$.send('Payment.requested', { orderId, amount })
$.send('Inventory.reserveRequested', { orderId, items })

// PaymentDO reacts independently
$.on.Payment.requested(async (event) => {
  const result = await processPayment(event.data)
  $.send(result.success ? 'Payment.completed' : 'Payment.failed', result)
})

// InventoryDO reacts independently
$.on.Inventory.reserveRequested(async (event) => {
  const reserved = await reserveStock(event.data.items)
  $.send(reserved ? 'Inventory.reserved' : 'Inventory.reservationFailed', ...)
})

// OrderDO coordinates the responses
$.on.Payment.completed(async (event) => {
  await updateSagaStep('payment', 'completed')
  await checkAndStartShipping()
})

$.on.Payment.failed(async (event) => {
  await startCompensation('Payment failed')
  // Automatically releases inventory, notifies customer
})
```

Four Durable Objects. Zero direct calls. Pure event choreography.

---

## The Problem

Traditional distributed order processing requires:
- A central orchestrator that becomes a bottleneck
- Message queue infrastructure (Kafka, SQS, RabbitMQ)
- Complex retry and dead-letter queue configuration
- Tight coupling between services
- Manual compensation logic for failures

## The Solution: Event Choreography with Saga Pattern

Each service is a separate Durable Object that:
1. Listens for events it cares about
2. Performs its business logic
3. Emits events for other services to consume
4. Handles compensation when things fail

```
Order.placed
  ├─> Payment.requested      (PaymentDO)
  └─> Inventory.reserveRequested  (InventoryDO)

Payment.completed + Inventory.reserved
  └─> Shipment.create        (ShippingDO)

Shipment.dispatched
  └─> Inventory.deducted     (InventoryDO)

Shipment.delivered
  └─> Order.completed        (OrderDO)

ANY FAILURE
  └─> Compensation cascade   (refund, release, cancel)
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        HTTP API                              │
│                     (Hono Worker)                            │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   OrderDO     │   │  InventoryDO  │   │   ShippingDO  │
│               │   │               │   │               │
│ Saga coord    │   │ Stock mgmt    │   │ Shipment      │
│ Order state   │   │ Reservations  │   │ Tracking      │
└───────────────┘   └───────────────┘   └───────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                    ┌───────────────┐
                    │  PaymentDO    │
                    │               │
                    │ Payments      │
                    │ Refunds       │
                    └───────────────┘
                              │
                    Events ($.send)
```

### Durable Objects

| DO | Role | Events Handled |
|----|------|----------------|
| **OrderDO** | Saga coordinator | Payment.completed/failed, Inventory.reserved/failed, Shipment.delivered |
| **PaymentDO** | Payment processing | Payment.requested, Payment.refund |
| **InventoryDO** | Stock management | Inventory.reserveRequested, Inventory.release, Shipment.dispatched |
| **ShippingDO** | Shipment lifecycle | Shipment.create, Shipment.cancel |

## Event Flow

### Happy Path

```
1. POST /orders
   └─> OrderDO.placeOrder()
       ├─> $.send('Order.placed', order)
       ├─> $.send('Payment.requested', {...})
       └─> $.send('Inventory.reserveRequested', {...})

2. PaymentDO
   └─> $.on.Payment.requested
       └─> $.send('Payment.completed', {...})

3. InventoryDO
   └─> $.on.Inventory.reserveRequested
       └─> $.send('Inventory.reserved', {...})

4. OrderDO (receives both responses)
   └─> checkAndStartShipping()
       └─> $.send('Shipment.create', {...})

5. ShippingDO
   └─> $.on.Shipment.create
       ├─> $.send('Shipment.created', {...})
       └─> [auto-dispatch after delay]
           └─> $.send('Shipment.dispatched', {...})

6. InventoryDO
   └─> $.on.Shipment.dispatched
       └─> $.send('Inventory.deducted', {...})

7. ShippingDO [simulated delivery]
   └─> $.send('Shipment.delivered', {...})

8. OrderDO
   └─> $.on.Shipment.delivered
       └─> $.send('Order.completed', {...})
```

### Failure + Compensation

```
1. PaymentDO
   └─> $.on.Payment.requested
       └─> $.send('Payment.failed', {...})

2. OrderDO
   └─> $.on.Payment.failed
       └─> startCompensation()
           ├─> $.send('Inventory.release', {...})
           └─> $.send('Customer.notified', { type: 'cancelled' })

3. InventoryDO
   └─> $.on.Inventory.release
       └─> [stock returned to available]
```

## Running the Example

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev

# Place an order
curl -X POST http://localhost:8787/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_alice",
    "items": [
      { "sku": "WIDGET-001", "name": "Premium Widget", "quantity": 2, "price": 29.99 },
      { "sku": "GADGET-002", "name": "Super Gadget", "quantity": 1, "price": 49.99 }
    ],
    "shippingAddress": {
      "street": "123 Main St",
      "city": "San Francisco",
      "state": "CA",
      "zip": "94105",
      "country": "US"
    }
  }'

# Watch the console for the event cascade:
# [Order:ord_abc123] Order placed. Starting saga...
# [Payment] Processing payment for order ord_abc123: $109.97
# [Inventory] Reserve request for order ord_abc123
# [Payment] Payment pay_xyz789 completed for order ord_abc123
# [Inventory] Reservation res_def456 created for order ord_abc123
# [Order:ord_abc123] Payment + Inventory done. Starting shipping...
# [Shipping] Creating shipment for order ord_abc123
# [Shipping] Shipment ship_ghi012 created with tracking FSABC123...
# [Shipping] Shipment dispatched for order ord_abc123
# [Inventory] Deducting inventory for shipped order ord_abc123
# ...
```

## API Endpoints

### Orders

| Method | Path | Description |
|--------|------|-------------|
| POST | `/orders` | Place a new order |
| GET | `/orders/:customerId` | Get order details |
| GET | `/orders/:customerId/saga` | Get saga state (debugging) |
| DELETE | `/orders/:customerId` | Cancel an order |
| POST | `/orders/:customerId/deliver` | Simulate delivery (testing) |

### Inventory

| Method | Path | Description |
|--------|------|-------------|
| GET | `/inventory` | Get all stock levels |
| GET | `/inventory/:sku` | Get stock for SKU |
| POST | `/inventory/:sku/add` | Add stock (admin) |

### Shipping

| Method | Path | Description |
|--------|------|-------------|
| GET | `/shipping/:orderId` | Get shipment for order |
| GET | `/shipping/track/:trackingNumber` | Track by number |

## Testing Scenarios

### Test Payment Failure

The payment simulator has a 10% failure rate. Place multiple orders to see compensation in action:

```bash
# Run multiple times to trigger a payment failure
for i in {1..10}; do
  curl -X POST http://localhost:8787/orders \
    -H "Content-Type: application/json" \
    -d '{
      "customerId": "test_'$i'",
      "items": [{ "sku": "WIDGET-001", "name": "Widget", "quantity": 1, "price": 10 }],
      "shippingAddress": { "street": "123 St", "city": "NYC", "state": "NY", "zip": "10001", "country": "US" }
    }'
done
```

### Test Out-of-Stock

```bash
# Try to order an out-of-stock item
curl -X POST http://localhost:8787/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_oos",
    "items": [{ "sku": "OUT-OF-STOCK", "name": "Unavailable", "quantity": 1, "price": 10 }],
    "shippingAddress": { "street": "123 St", "city": "NYC", "state": "NY", "zip": "10001", "country": "US" }
  }'

# Watch compensation: Payment refund triggered, customer notified
```

### Test Cancellation

```bash
# Place an order
curl -X POST http://localhost:8787/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_cancel",
    "items": [{ "sku": "WIDGET-001", "name": "Widget", "quantity": 1, "price": 10 }],
    "shippingAddress": { "street": "123 St", "city": "NYC", "state": "NY", "zip": "10001", "country": "US" }
  }'

# Cancel it
curl -X DELETE http://localhost:8787/orders/cust_cancel \
  -H "Content-Type: application/json" \
  -d '{"reason": "Changed my mind"}'

# Watch compensation cascade
```

## Key Concepts

### 1. Event Choreography

Services emit events without knowing who consumes them:

```typescript
// PaymentDO doesn't know what happens after payment completes
$.send('Payment.completed', { paymentId, orderId, amount })
```

### 2. Saga Pattern

The OrderDO tracks saga state for coordinated compensation:

```typescript
const saga: OrderSagaState = {
  orderId,
  status: 'in_progress',
  steps: {
    payment: { name: 'payment', status: 'pending' },
    inventory: { name: 'inventory', status: 'pending' },
    shipping: { name: 'shipping', status: 'pending' },
  }
}
```

### 3. Idempotency

Each service handles duplicate events gracefully:

```typescript
// PaymentDO checks idempotency key before processing
const existingOrderId = index.byIdempotencyKey[request.idempotencyKey]
if (existingOrderId) {
  // Return existing result instead of double-charging
}
```

### 4. Compensation

Failures trigger automatic rollback of completed steps:

```typescript
async startCompensation(reason: string) {
  if (saga.steps.inventory.status === 'completed') {
    $.send('Inventory.release', { orderId, reason: 'ORDER_CANCELLED' })
  }
  if (saga.steps.payment.status === 'completed') {
    $.send('Payment.refund', { orderId, paymentId, amount, reason })
  }
}
```

## Choreography vs Orchestration

| Aspect | Orchestration | Choreography |
|--------|---------------|--------------|
| **Control** | Central coordinator | Decentralized |
| **Coupling** | Orchestrator knows all services | Services are independent |
| **Failure** | Single point of failure | Resilient, each service handles own failures |
| **Scaling** | Orchestrator bottleneck | Each service scales independently |
| **Changes** | Modify orchestrator | Add/remove event handlers |
| **Testing** | Mock entire orchestrator | Test each service in isolation |

## File Structure

```
examples/workflow-event-choreography/
├── index.ts              # HTTP API (Hono worker)
├── events/
│   └── types.ts          # Event type definitions
├── objects/
│   ├── Order.ts          # OrderDO - Saga coordinator
│   ├── Payment.ts        # PaymentDO - Payment processing
│   ├── Inventory.ts      # InventoryDO - Stock management
│   └── Shipping.ts       # ShippingDO - Shipment tracking
├── tests/
│   └── flow.test.ts          # Event flow tests
├── package.json
├── wrangler.jsonc
└── README.md
```

## Deploy

```bash
npm run deploy
```

Your event-driven order system is now running on 300+ edge locations worldwide.

---

Built with [dotdo](https://dotdo.dev) - Business-as-Code for your 1-Person Unicorn.
