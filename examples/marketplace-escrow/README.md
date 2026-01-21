# Marketplace Escrow

**Trust nobody. Let the code hold the money.**

A complete marketplace escrow system demonstrating multi-party transactions with automatic timeouts and dispute resolution.

## Features

- **Escrow Lifecycle**: Pending -> Funded -> Delivered -> Released state machine
- **Automatic Timeouts**: Auto-refund on delivery timeout, auto-release on inspection timeout
- **Dispute Resolution**: Evidence collection, arbiter workflow, fund distribution
- **Fee Calculation**: Platform and escrow fees with seller payout calculation
- **Event-Driven**: All state transitions emit events for notifications

## Key dotdo Patterns

### State Machine with Timeouts

```typescript
// Auto-refund if seller doesn't deliver
this.$.every.hour(async () => {
  const escrows = await this.things.list({ type: 'Escrow' })
  for (const escrow of escrows) {
    if (escrow.status === 'funded' && escrow.deliveryDeadline < now) {
      await this.refundEscrow(escrow.$id, 'DELIVERY_TIMEOUT')
    }
  }
})

// Auto-release if buyer doesn't dispute
if (escrow.status === 'delivered' && escrow.inspectionDeadline < now) {
  await this.releaseEscrow(escrow.$id)
}
```

### Event Handlers

```typescript
this.$.on.Escrow.funded(async (event) => {
  // Notify seller to ship
})

this.$.on.Dispute.resolved(async (event) => {
  // Distribute funds based on resolution
})
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
| GET | `/escrows/:id/timeline` | Get event history |
| GET | `/escrows/:id/fees` | Calculate fee distribution |

### Disputes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/escrows/:id/dispute` | Open dispute |
| GET | `/disputes/:id` | Get dispute details |
| POST | `/disputes/:id/evidence` | Add evidence |
| POST | `/disputes/:id/resolve` | Resolve dispute (arbiter) |
| GET | `/disputes/:id/timeline` | Get dispute timeline |

## Usage Example

```bash
# Create escrow
curl -X POST http://localhost:8787/escrows \
  -H "Content-Type: application/json" \
  -d '{
    "buyerId": "buyer_alice",
    "sellerId": "seller_bob",
    "amount": 500.00,
    "itemDescription": "Vintage Watch"
  }'

# Fund escrow
curl -X POST http://localhost:8787/escrows/{escrowId}/fund

# Mark delivered
curl -X POST http://localhost:8787/escrows/{escrowId}/deliver \
  -H "Content-Type: application/json" \
  -d '{"trackingNumber": "TRK123", "carrier": "UPS"}'

# Confirm receipt (releases funds)
curl -X POST http://localhost:8787/escrows/{escrowId}/confirm

# Or open dispute
curl -X POST http://localhost:8787/escrows/{escrowId}/dispute \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "ITEM_NOT_AS_DESCRIBED",
    "description": "Watch has scratches not shown in photos"
  }'
```

## Running Locally

```bash
npm install
npm run dev
npm test
```
