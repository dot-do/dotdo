# Workflow Event Choreography

**Order placed. Four services notified. Zero coupling.**

A complete order processing system demonstrating the event choreography pattern with saga-based compensation.

## Architecture

Four Durable Objects coordinate via events, not direct calls:

```
┌─────────────────────────────────────────────────────────────┐
│                        HTTP API                              │
│                     (Hono Worker)                            │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        v                     v                     v
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

## Event Flow

### Happy Path

```
1. POST /orders
   └─> OrderDO.placeOrder()
       ├─> $.send('Payment.requested', {...})
       └─> $.send('Inventory.reserveRequested', {...})

2. PaymentDO reacts independently
   └─> $.on.Payment.requested
       └─> $.send('Payment.completed', {...})

3. InventoryDO reacts independently
   └─> $.on.Inventory.reserveRequested
       └─> $.send('Inventory.reserved', {...})

4. OrderDO receives both completions
   └─> checkAndStartShipping()
       └─> $.send('Shipment.create', {...})

5. ShippingDO creates shipment
   └─> $.send('Shipment.created', {...})
   └─> $.send('Shipment.dispatched', {...})

6. ShippingDO delivers
   └─> $.send('Shipment.delivered', {...})

7. OrderDO completes
   └─> $.send('Order.completed', {...})
```

### Failure + Compensation

```
PaymentDO: Payment.failed
    └─> OrderDO receives failure
        └─> startCompensation()
            ├─> $.send('Inventory.release', {...})
            └─> $.send('Order.cancelled', {...})
```

## Key dotdo Patterns

### Event Choreography

Services emit events without knowing who consumes them:

```typescript
// PaymentDO doesn't know what happens after
$.send('Payment.completed', { orderId, paymentId, transactionId })

// OrderDO reacts to it
$.on.Payment.completed(async (event) => {
  await updateSagaStep('payment', 'completed')
  await checkAndStartShipping()
})
```

### Saga Pattern

OrderDO tracks saga state for coordinated compensation:

```typescript
const saga: SagaState = {
  steps: {
    payment: { name: 'payment', status: 'completed' },
    inventory: { name: 'inventory', status: 'completed' },
    shipping: { name: 'shipping', status: 'in_progress' },
  }
}
```

### Compensation Logic

Failures trigger automatic rollback:

```typescript
async startCompensation(reason: string) {
  if (saga.steps.inventory.status === 'completed') {
    $.send('Inventory.release', { orderId, reason })
  }
  if (saga.steps.payment.status === 'completed') {
    $.send('Payment.refund', { orderId, amount, reason })
  }
}
```

## API Endpoints

### Orders

| Method | Path | Description |
|--------|------|-------------|
| POST | `/orders` | Place a new order |
| GET | `/orders/:id` | Get order details |
| GET | `/orders/:id/saga` | Get saga state |
| DELETE | `/orders/:id` | Cancel an order |

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
| POST | `/shipping/:orderId/deliver` | Simulate delivery |

## Usage Example

```bash
# Place an order
curl -X POST http://localhost:8787/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_alice",
    "items": [
      { "sku": "WIDGET-001", "name": "Premium Widget", "quantity": 2, "price": 2999 }
    ],
    "shippingAddress": {
      "street": "123 Main St",
      "city": "San Francisco",
      "state": "CA",
      "zip": "94105",
      "country": "US"
    }
  }'

# Watch the event cascade in logs...

# Simulate delivery
curl -X POST http://localhost:8787/shipping/{orderId}/deliver

# Check order completion
curl http://localhost:8787/orders/{orderId}
```

## Choreography vs Orchestration

| Aspect | Orchestration | Choreography |
|--------|---------------|--------------|
| Control | Central coordinator | Decentralized |
| Coupling | Tight | Loose |
| Failure | Single point | Resilient |
| Scaling | Bottleneck | Independent |

## Running Locally

```bash
npm install
npm run dev
npm test
```
