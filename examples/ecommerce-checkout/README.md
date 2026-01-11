# E-Commerce Checkout

**Multi-DO Checkout with Saga/Compensation Patterns**

Complete e-commerce checkout flow demonstrating multi-Durable Object coordination, the saga pattern for distributed transactions, and compensation for failure handling.

```typescript
// Saga: Reserve -> Pay -> Commit -> Create Order
const session = await $.Checkout.createSession(cart)
const reservation = await $.Inventory.reserve(session.items)
const payment = await $.Payment.charge(paymentMethod, totals.total)
await $.Inventory.commit(reservation.id)
const order = await $.Order.create(session, payment)

// Compensation on failure: Release -> Refund
if (failed) {
  await $.Inventory.release(reservation.id)
  await $.Payment.refund(payment.id)
}
```

---

## Architecture

Four specialized Durable Objects coordinate the checkout flow:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Customer                                 │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                       CartDO                                     │
│  Per customer: items, addresses, promo codes                     │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     CheckoutDO                                   │
│  Per session: orchestrates saga, calculates totals               │
└──────────┬──────────────┼──────────────┬────────────────────────┘
           │              │              │
           ▼              ▼              ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ InventoryDO  │  │  (Payment)   │  │   OrderDO    │
│   Global:    │  │   External   │  │  Per order:  │
│  reservations│  │   gateway    │  │   lifecycle  │
└──────────────┘  └──────────────┘  └──────────────┘
```

### CartDO
- One instance per customer (keyed by `customerId`)
- Manages shopping cart state: items, addresses, promo codes
- Emits `Cart.updated` events for analytics

### InventoryDO
- Single global instance for all products
- Tracks stock levels and reservations
- Implements reservation pattern: `reserve -> commit/release`
- Prevents overselling with atomic operations

### CheckoutDO
- One instance per checkout session (keyed by `sessionId`)
- Orchestrates the saga across DOs
- Calculates taxes, shipping, discounts
- Handles compensation on failure

### OrderDO
- One instance per order (keyed by `orderId`)
- Manages order lifecycle: paid -> processing -> shipped -> delivered
- Handles cancellation and refunds
- Schedules post-delivery review requests

---

## Quick Start

```bash
# Install dependencies
npm install

# Seed inventory (optional, for demo)
curl -X POST http://localhost:8787/inventory \
  -H "Content-Type: application/json" \
  -d '{"sku": "WIDGET-001", "name": "Premium Widget", "quantity": 100}'

# Run locally
npm run dev

# Deploy
npm run deploy
```

---

## API Endpoints

### Cart

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/cart` | Get current cart |
| POST | `/cart/items` | Add item to cart |
| PUT | `/cart/items/:sku` | Update item quantity |
| DELETE | `/cart/items/:sku` | Remove item |
| DELETE | `/cart` | Clear cart |
| PUT | `/cart/shipping-address` | Set shipping address |
| PUT | `/cart/billing-address` | Set billing address |
| PUT | `/cart/shipping-method` | Set shipping method |
| POST | `/cart/promo` | Apply promo code |
| DELETE | `/cart/promo` | Remove promo code |

### Inventory

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/inventory` | Get all stock levels |
| GET | `/inventory/:sku` | Get stock for SKU |
| POST | `/inventory` | Set stock level (admin) |
| PUT | `/inventory/:sku` | Adjust stock (admin) |

### Checkout

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/checkout/sessions` | Create checkout session |
| GET | `/checkout/sessions/:id` | Get session details |
| GET | `/checkout/sessions/:id/totals` | Calculate totals |
| POST | `/checkout/sessions/:id/complete` | Complete checkout |
| DELETE | `/checkout/sessions/:id` | Cancel session |
| GET | `/shipping/rates` | Get available shipping rates |

### Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orders/:id` | Get order details |
| GET | `/orders/:id/status` | Get status timeline |
| GET | `/orders/:id/tracking` | Get tracking info |
| POST | `/orders/:id/cancel` | Cancel order |
| POST | `/orders/:id/deliver` | Simulate delivery (testing) |

---

## Complete Checkout Flow

### 1. Build Cart

```bash
# Add items
curl -X POST http://localhost:8787/cart/items \
  -H "Content-Type: application/json" \
  -H "X-Customer-ID: alice" \
  -d '{"sku": "WIDGET-001", "name": "Premium Widget", "price": 29.99, "quantity": 2}'

# Set shipping address
curl -X PUT http://localhost:8787/cart/shipping-address \
  -H "Content-Type: application/json" \
  -H "X-Customer-ID: alice" \
  -d '{
    "street": "123 Main St",
    "city": "San Francisco",
    "state": "CA",
    "zip": "94102",
    "country": "US"
  }'

# Apply promo code
curl -X POST http://localhost:8787/cart/promo \
  -H "Content-Type: application/json" \
  -H "X-Customer-ID: alice" \
  -d '{"code": "SAVE20"}'
```

### 2. Create Checkout Session

```bash
curl -X POST http://localhost:8787/checkout/sessions \
  -H "Content-Type: application/json" \
  -H "X-Customer-ID: alice"
```

Response:
```json
{
  "success": true,
  "session": {
    "id": "ses_abc123",
    "status": "pending",
    "items": [...]
  }
}
```

### 3. Calculate Totals

```bash
curl http://localhost:8787/checkout/sessions/ses_abc123/totals
```

Response:
```json
{
  "subtotal": 59.98,
  "tax": { "rate": 0.0725, "amount": 4.35 },
  "shipping": { "carrier": "FastShip", "method": "ground", "price": 6.49 },
  "discount": { "code": "SAVE20", "type": "percent", "amount": 12.00 },
  "total": 58.82
}
```

### 4. Complete Checkout

```bash
curl -X POST http://localhost:8787/checkout/sessions/ses_abc123/complete \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod": {"type": "card", "token": "tok_visa", "last4": "4242"}}'
```

Response:
```json
{
  "success": true,
  "orderId": "ord_xyz789",
  "paymentId": "pay_abc123",
  "total": 58.82,
  "sagaSteps": [
    "Inventory reserved",
    "Payment processed",
    "Inventory committed",
    "Order created",
    "Cart cleared",
    "Fulfillment started"
  ]
}
```

---

## Saga Pattern

The checkout implements the saga pattern for distributed transactions:

```
┌─────────────────────────────────────────────────────────────────┐
│                       CHECKOUT SAGA                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Reserve Inventory ──────┐                                   │
│         │                   │                                   │
│         ▼                   │ (on failure)                      │
│  2. Process Payment ────────┼──► Release Inventory              │
│         │                   │                                   │
│         ▼                   │                                   │
│  3. Commit Inventory ───────┼──► Refund Payment                 │
│         │                   │    Release Inventory              │
│         ▼                   │                                   │
│  4. Create Order ───────────┴──► Refund Payment                 │
│         │                        Release Inventory              │
│         ▼                                                        │
│  5. Clear Cart                                                   │
│         │                                                        │
│         ▼                                                        │
│    SUCCESS                                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Compensation Events

When a step fails, compensation events are emitted:

```typescript
// Payment failed -> compensate
this.$.send('Inventory.release', { orderId, reason: 'Payment failed' })

// Order creation failed -> compensate
this.$.send('Payment.refund', { paymentId, reason: 'Order creation failed' })
this.$.send('Inventory.release', { orderId, reason: 'Order creation failed' })
```

---

## Event Flow

### Order Placed
```
POST /checkout/sessions/:id/complete
    │
    ├──► Inventory.reserve
    ├──► Payment.process
    ├──► Inventory.commit
    └──► Order.create
          │
          ├──► Order.created
          ├──► Fulfillment.started
          └──► Email.sendConfirmation
```

### Order Shipped
```
Fulfillment.shipped
    │
    ├──► Order.shipped
    └──► Email.sendShipping
```

### Order Delivered
```
Fulfillment.delivered
    │
    ├──► Order.delivered
    └──► (3 days later) Review.requested
```

### Order Cancelled
```
POST /orders/:id/cancel
    │
    ├──► Inventory.release
    ├──► Payment.refund
    └──► Email.sendCancellation
```

---

## Promo Codes

| Code | Type | Value | Description |
|------|------|-------|-------------|
| SAVE10 | fixed | $10 | $10 off any order |
| SAVE20 | percent | 20% | 20% off subtotal |
| FREESHIP | free_shipping | - | Free shipping |
| WELCOME15 | percent | 15% | 15% off for new customers |

---

## Tax Rates

| State | Rate |
|-------|------|
| CA | 7.25% |
| NY | 8.00% |
| TX | 6.25% |
| WA | 6.50% |
| FL | 6.00% |
| Other | 5.00% |

---

## Shipping Rates

| Method | Base Price | Days |
|--------|------------|------|
| Ground | $5.99 + $0.50/lb | 5 |
| Express | $12.99 + $0.50/lb | 2 |
| Overnight | $24.99 + $0.50/lb | 1 |

---

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npm run typecheck
```

---

## Why Multi-DO?

**Single DO Approach:**
- Simple for small apps
- All state in one place
- Limited scalability

**Multi-DO Approach:**
- Each DO handles one domain concern
- Independent scaling per concern
- Clear boundaries and contracts
- Better observability
- Easier testing and maintenance

---

## Key Patterns Demonstrated

1. **Saga Pattern** - Distributed transaction with compensation
2. **Reservation Pattern** - Soft locks for inventory
3. **Event Choreography** - DOs react to events independently
4. **Domain Separation** - Cart, Inventory, Checkout, Order as separate concerns
5. **Idempotency** - Safe to retry operations

---

Built with [dotdo](https://dotdo.dev) | Powered by [workers.do](https://workers.do)
