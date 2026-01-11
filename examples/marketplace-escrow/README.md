# Marketplace Escrow

**Trust nobody. Let the code hold the money.**

```typescript
import { DO } from 'dotdo'

export class EscrowDO extends DO {
  async createEscrow(buyer: string, seller: string, amount: number) {
    const escrow = await $.Escrow.create({
      buyer,
      seller,
      amount,
      arbiter: 'platform',
      status: 'funded',
      inspectionDeadline: $.time.in('3 days'),
    })

    // Auto-release if buyer doesn't dispute
    $.at(escrow.inspectionDeadline)(() => {
      if (escrow.status === 'funded') {
        $.send('Escrow.released', escrow)
      }
    })

    return escrow
  }
}
```

**Buyer funds. Seller delivers. Platform arbitrates. Everybody wins.**

---

## The Problem

Marketplace transactions are trust nightmares. Buyers fear paying for goods that never arrive. Sellers fear chargebacks after delivery. Traditional escrow is slow, expensive, and requires lawyers.

Every edge case is a fraud vector:
- Buyer claims non-delivery (but received goods)
- Seller claims delivery (but shipped empty box)
- Both parties dispute (he said, she said)
- Funds stuck in limbo (nobody knows what to do)

## The Solution

Three Durable Objects coordinate the complete escrow lifecycle:

| DO | Responsibility |
|----|---------------|
| **EscrowDO** | Escrow lifecycle, fund custody, state machine |
| **OrderDO** | Shipment tracking, delivery confirmation |
| **DisputeDO** | Evidence collection, arbiter workflow, resolution |

All state transitions are atomic and auditable. Automatic timeouts ensure funds never get stuck.

---

## Quick Start

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Deploy
npm run deploy
```

## API Endpoints

### Escrow

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/escrows` | Create new escrow |
| GET | `/escrows/:id` | Get escrow details |
| POST | `/escrows/:id/fund` | Fund the escrow (buyer) |
| POST | `/escrows/:id/deliver` | Mark as delivered (seller) |
| POST | `/escrows/:id/confirm` | Confirm receipt (buyer) |
| POST | `/escrows/:id/cancel` | Cancel escrow |
| GET | `/escrows/:id/timeline` | Get escrow event history |
| GET | `/escrows/:id/fees` | Calculate fee distribution |

### Disputes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/escrows/:id/dispute` | Open dispute |
| GET | `/disputes/:id` | Get dispute details |
| POST | `/disputes/:id/evidence` | Add evidence |
| POST | `/disputes/:id/respond` | Seller response |
| POST | `/disputes/:id/resolve` | Resolve dispute (arbiter) |
| POST | `/disputes/:id/escalate` | Escalate dispute |
| GET | `/disputes/:id/timeline` | Get dispute timeline |

### Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orders/:id` | Get order details |
| GET | `/orders/:id/tracking` | Get tracking info |

---

## How It Works

### 1. Escrow Creation

Buyer and seller agree on terms. Escrow is created with:
- Amount held
- Inspection period (default: 3 days)
- Delivery deadline (default: 5 days)
- Arbiter (platform by default)

```typescript
const escrow = await createEscrow({
  buyer: 'buyer_alice',
  seller: 'seller_bob',
  amount: 500.00,
  currency: 'USD',
  itemDescription: 'Vintage Watch',
  inspectionDays: 3,
})
// Returns: { id: 'esc_abc123', status: 'pending', ... }
```

### 2. Funding

Buyer funds the escrow. Funds are held by the platform.

```typescript
await fundEscrow(escrowId, {
  paymentMethod: { type: 'card', token: 'tok_visa' },
})
// Escrow status: 'pending' -> 'funded'
// Delivery deadline timer starts
```

### 3. Delivery

Seller ships the item and marks as delivered with tracking.

```typescript
await markDelivered(escrowId, {
  trackingNumber: 'TRK123456',
  carrier: 'UPS',
})
// Escrow status: 'funded' -> 'delivered'
// Inspection period starts
```

### 4. Confirmation or Dispute

**Happy path:** Buyer confirms receipt within inspection period.

```typescript
await confirmReceipt(escrowId, { rating: 5 })
// Escrow status: 'delivered' -> 'released'
// Funds transferred to seller (minus fees)
```

**Dispute path:** Buyer opens dispute within inspection period.

```typescript
await openDispute(escrowId, {
  reason: 'ITEM_NOT_AS_DESCRIBED',
  description: 'Watch has scratches not shown in photos',
  evidence: [{ type: 'photo', url: '...', description: '...' }],
})
// Escrow status: 'delivered' -> 'disputed'
// Arbiter notified, evidence period begins
```

### 5. Resolution

If dispute opened, arbiter reviews evidence and decides:

```typescript
await resolveDispute(disputeId, {
  decision: 'PARTIAL_REFUND',
  buyerAmount: 200.00,  // Refund for damage
  sellerAmount: 300.00, // Partial payment for item
  notes: 'Item had undisclosed damage. Partial refund awarded.',
})
// Funds distributed per decision
// Escrow status: 'disputed' -> 'resolved'
```

---

## State Machine

```
PENDING -> FUNDED -> DELIVERED -> RELEASED
              |          |
              v          v
          CANCELLED  DISPUTED -> RESOLVED
              |          |
              v          v
          REFUNDED   (REFUNDED or RELEASED based on decision)
```

### Valid Transitions

| From | To | Trigger |
|------|-----|---------|
| pending | funded | Buyer funds |
| pending | cancelled | Either party cancels |
| funded | delivered | Seller ships |
| funded | disputed | Buyer disputes before delivery |
| funded | cancelled | Either party cancels |
| funded | refunded | Delivery timeout |
| delivered | released | Buyer confirms OR inspection timeout |
| delivered | disputed | Buyer disputes |
| disputed | resolved | Arbiter decides |

---

## Automatic Timeouts

```typescript
// Auto-refund if seller doesn't deliver within deadline
$.at(escrow.deliveryDeadline)(() => {
  if (escrow.status === 'funded') {
    $.send('Escrow.refunded', { reason: 'DELIVERY_TIMEOUT' })
  }
})

// Auto-release if buyer doesn't dispute within inspection period
$.at(escrow.inspectionDeadline)(() => {
  if (escrow.status === 'delivered') {
    $.send('Escrow.released', escrow)
  }
})

// Auto-escalate unresolved disputes
$.at(dispute.escalationDeadline)(() => {
  if (dispute.status === 'under_review') {
    $.send('Dispute.escalated', { to: 'senior-arbiter' })
  }
})
```

---

## Fee Structure

```typescript
const fees = {
  platformFee: 0.025,      // 2.5% to platform
  escrowFee: 0.005,        // 0.5% for escrow service
}

// Example: $500 escrow
// Platform fee: $12.50
// Escrow fee: $2.50
// Seller receives: $485.00
```

---

## Multi-Party Roles

| Role | Permissions |
|------|------------|
| **Buyer** | Fund, Confirm, Dispute, Cancel (before delivery) |
| **Seller** | Deliver, Respond to dispute, Cancel (before delivery) |
| **Arbiter** | View all, Resolve disputes, Escalate |

---

## Dispute Evidence

Rich evidence collection for fair resolution:

```typescript
interface Evidence {
  type: 'photo' | 'video' | 'document' | 'message' | 'tracking' | 'screenshot'
  url: string
  description: string
  submittedBy: 'buyer' | 'seller'
  submittedAt: string
}
```

Both parties have 7 days to submit evidence. After evidence period closes, arbiter has 14 days to resolve before auto-escalation.

---

## Event Flow

```
POST /escrows (create)
    |
    v
Escrow.created
    |
POST /escrows/:id/fund
    |
    v
Escrow.funded
    |
    +---> Email to seller
    +---> Delivery deadline set (5 days)
    |
POST /escrows/:id/deliver
    |
    v
Escrow.delivered
    |
    +---> Email to buyer
    +---> Inspection deadline set (3 days)
    |
    +--- (buyer confirms) ---> Escrow.released ---> Payment to seller
    |
    +--- (buyer disputes) ---> Dispute.opened ---> Arbiter notified
    |                               |
    |                               v
    |                         Dispute.resolved
    |                               |
    |                               +---> Funds distributed
    |
    +--- (timeout) ---> Escrow.released ---> Payment to seller
```

---

## Architecture

```
src/
├── index.ts           # Main worker entry point + API routes
├── types.ts           # Shared type definitions
└── objects/
    ├── Escrow.ts      # Escrow lifecycle DO
    ├── Order.ts       # Order tracking DO
    └── Dispute.ts     # Dispute resolution DO

tests/
└── escrow.test.ts     # Comprehensive test suite
```

---

## Why This Works

1. **Atomic state** - All escrow transitions are single-writer, no race conditions
2. **Durable timers** - Timeouts survive restarts, never lost
3. **Event-driven** - All parties notified instantly via events
4. **Auditable** - Complete timeline of every state change
5. **Edge deployment** - Escrow runs in 300+ cities for low latency
6. **Multi-DO coordination** - Clean separation of concerns

---

Built with [dotdo](https://dotdo.dev) | Powered by [workers.do](https://workers.do)
