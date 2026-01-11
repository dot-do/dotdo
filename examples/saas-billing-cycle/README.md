# SaaS Billing Cycle

**Billing that runs itself.**

A complete subscription management system demonstrating multi-DO architecture with event-driven billing, usage metering, and automatic dunning (payment retry logic).

```typescript
// Subscribe a customer to the Pro plan
const sub = await billing.subscribe('cust_123', 'pro', { trialDays: 14 })

// Track API usage throughout the month
await usage.record('api_calls', 1500)

// Automatic billing at period end:
// 1. $.every.day.atmidnight checks for period boundaries
// 2. Invoice.generate includes base + usage overage
// 3. Payment.process attempts charge
// 4. If failed: Retry.scheduled (3d, 7d, 14d backoff)
// 5. If exhausted: Subscription.suspended
```

---

## Architecture

Four Durable Objects coordinate the billing lifecycle:

```
                    ┌─────────────────┐
                    │  SubscriptionDO │
                    │  (per customer) │
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ▼                 ▼                 ▼
   ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
   │    UsageDO    │ │   InvoiceDO   │ │   PaymentDO   │
   │ (per sub)     │ │ (per invoice) │ │ (per customer)│
   └───────────────┘ └───────────────┘ └───────────────┘
```

| DO | Responsibility | Key Features |
|----|----------------|--------------|
| **SubscriptionDO** | Subscription state, plan changes | Trial -> Active -> Cancelled lifecycle |
| **UsageDO** | Metered usage tracking | Per-period aggregation, overage calculation |
| **InvoiceDO** | Invoice generation | Line items, tax, credits |
| **PaymentDO** | Payment processing | Dunning with exponential backoff |

---

## Features

### 1. Subscription Lifecycle

```typescript
// States: trialing -> active -> past_due -> suspended -> cancelled -> ended

// Create with 14-day trial
await subscription.create('cust_123', 'pro', { trialDays: 14 })

// Upgrade (immediate, with proration)
await subscription.changePlan('enterprise')

// Downgrade (effective next period)
await subscription.changePlan('free', { immediate: false })

// Cancel at period end
await subscription.cancel({ atPeriodEnd: true, reason: 'switching_providers' })
```

### 2. Plan Management

Three-tier pricing with metered overages:

```typescript
const PLANS = {
  free: {
    price: 0,
    limits: { apiCalls: 1000, storage: 1, seats: 1 },
  },
  pro: {
    price: 4900, // $49/month
    limits: { apiCalls: 50000, storage: 10, seats: 5 },
    metered: { apiCalls: 50, storage: 100 }, // $0.50/1k, $1/GB
  },
  enterprise: {
    price: 29900, // $299/month
    limits: { apiCalls: Infinity, storage: 100, seats: Infinity },
  },
}
```

### 3. Usage Metering

```typescript
// Record usage events
await usage.record('api_calls', 1500)
await usage.record('storage', 25) // GB

// Get usage summary with overage calculation
const summary = await usage.getSummary('pro')
// {
//   usage: { api_calls: { used: 55000, limit: 50000, overage: 5000 } },
//   overageCharges: { api_calls: 250, total: 250 } // $2.50
// }
```

### 4. Invoice Generation

```typescript
// Automatic at period end with:
// - Base subscription charge
// - Usage overage line items
// - Tax calculation
// - Credits (if any)

const invoice = {
  lineItems: [
    { description: 'Pro plan (monthly)', amount: 4900, type: 'subscription' },
    { description: 'API overage (5,000 calls)', amount: 250, type: 'usage' },
  ],
  subtotal: 5150,
  tax: 412, // 8%
  total: 5562,
}
```

### 5. Dunning (Payment Retry)

Automatic retry with exponential backoff:

```typescript
// Retry schedule: 3 days, 7 days, 14 days
const DUNNING_SCHEDULE = [3, 7, 14]

// After exhausted retries:
// 1. Invoice marked uncollectible
// 2. Subscription suspended
// 3. Customer notified
```

### 6. Scheduled Billing

```typescript
// Daily check for billing events
this.$.every.day.atmidnight(async () => {
  // Check for trial endings
  // Check for period renewals
  // Generate invoices for due subscriptions
})

// Hourly check for payment retries
this.$.every.hour(async () => {
  // Execute scheduled retries
})
```

---

## Quick Start

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Run tests
npm test

# Deploy
npm run deploy
```

---

## API Endpoints

### Plans

| Endpoint | Description |
|----------|-------------|
| `GET /plans` | List available plans |

### Subscriptions

| Endpoint | Description |
|----------|-------------|
| `POST /subscriptions` | Create subscription |
| `GET /subscriptions/:customerId` | Get subscription |
| `PUT /subscriptions/:customerId/plan` | Change plan |
| `DELETE /subscriptions/:customerId` | Cancel subscription |
| `POST /subscriptions/:customerId/reactivate` | Reactivate |

### Usage

| Endpoint | Description |
|----------|-------------|
| `POST /usage` | Record usage event |
| `GET /subscriptions/:customerId/usage` | Current period usage |
| `GET /subscriptions/:customerId/usage/history` | Usage history |

### Payments

| Endpoint | Description |
|----------|-------------|
| `POST /customers/:customerId/payment-methods` | Add payment method |
| `GET /customers/:customerId/payment-methods` | List payment methods |
| `GET /customers/:customerId/payments` | Payment history |

### Invoices

| Endpoint | Description |
|----------|-------------|
| `GET /invoices/:id` | Get invoice details |
| `POST /invoices/:id/pay` | Retry payment |

---

## Example Requests

**Create Subscription with Trial:**
```bash
curl -X POST http://localhost:8787/subscriptions \
  -H "Content-Type: application/json" \
  -d '{"customerId": "cust_123", "planId": "pro", "trialDays": 14}'
```

**Record Usage:**
```bash
curl -X POST http://localhost:8787/usage \
  -H "Content-Type: application/json" \
  -d '{"subscriptionId": "sub_abc123", "metric": "api_calls", "quantity": 1500}'
```

**Upgrade Plan:**
```bash
curl -X PUT http://localhost:8787/subscriptions/cust_123/plan \
  -H "Content-Type: application/json" \
  -d '{"planId": "enterprise"}'
```

**Add Payment Method:**
```bash
curl -X POST http://localhost:8787/customers/cust_123/payment-methods \
  -H "Content-Type: application/json" \
  -d '{"type": "card", "token": "tok_visa4242", "makeDefault": true}'
```

---

## Event Flow

### Subscription Created (Paid Plan)
```
Subscription.created
    -> Invoice.generate
        -> Invoice.requestUsage
            <- Usage.summary
        -> Invoice.created
            -> Payment.process
                -> Payment.succeeded
                    -> Invoice.paid
                    -> Subscription.renewed
                -> Customer.notify
```

### Payment Failed with Retry
```
Payment.failed (attempt 1)
    -> Subscription status: past_due
    -> Retry.scheduled (3 days)
    -> Customer.notify

... 3 days later ...

Retry.execute
    -> Payment.process
        -> Payment.failed (attempt 2)
            -> Retry.scheduled (7 days)
            -> Customer.notify
```

### Payment Exhausted
```
Payment.failed (attempt 4)
    -> Invoice status: uncollectible
    -> Subscription.suspended
    -> Customer.notify
```

---

## File Structure

```
examples/saas-billing-cycle/
├── src/
│   ├── index.ts              # Main worker with HTTP routes
│   └── objects/
│       ├── Subscription.ts   # Per-customer subscription DO
│       ├── Usage.ts          # Per-subscription usage tracking DO
│       ├── Invoice.ts        # Invoice generation DO
│       └── Payment.ts        # Payment processing with dunning
├── tests/
│   └── billing.test.ts       # Comprehensive test suite
├── package.json
├── wrangler.toml
└── README.md
```

---

Built with [dotdo](https://dotdo.dev) | Powered by [workers.do](https://workers.do)
