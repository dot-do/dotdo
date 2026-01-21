# SaaS Billing Cycle

**Billing that runs itself.**

A complete subscription management system with usage metering, automatic invoicing, and dunning (payment retry logic).

## Features

- **Subscription Lifecycle**: Trial -> Active -> Past Due -> Suspended
- **Plan Management**: Free, Pro, Enterprise tiers with usage limits
- **Usage Metering**: Track API calls, storage, seats with overage billing
- **Invoice Generation**: Automatic invoices with usage line items
- **Dunning**: Automatic payment retries with exponential backoff

## Key dotdo Patterns

### Scheduled Billing

```typescript
// Daily billing cycle check
this.$.every.day.atmidnight(async () => {
  const subscriptions = await this.things.list({ type: 'Subscription' })
  for (const sub of subscriptions) {
    if (sub.trialEndsAt && new Date(sub.trialEndsAt) <= now) {
      await this.endTrial(sub.$id)
    }
    if (sub.status === 'active' && new Date(sub.currentPeriodEnd) <= now) {
      await this.renewSubscription(sub.$id)
    }
  }
})

// Hourly payment retries
this.$.every.hour(async () => {
  await this.processPaymentRetries()
})
```

### Dunning Schedule

```typescript
const DUNNING_SCHEDULE = [3, 7, 14] // Days after initial failure

// After 4 failed attempts (initial + 3 retries):
// 1. Invoice marked uncollectible
// 2. Subscription suspended
// 3. Customer notified
```

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

### Payments

| Endpoint | Description |
|----------|-------------|
| `POST /customers/:customerId/payment-methods` | Add payment method |
| `GET /customers/:customerId/payment-methods` | List payment methods |
| `GET /customers/:customerId/payments` | Payment history |
| `GET /invoices/:id` | Get invoice details |
| `POST /invoices/:id/pay` | Retry payment |

## Usage Example

```bash
# Create subscription with trial
curl -X POST http://localhost:8787/subscriptions \
  -H "Content-Type: application/json" \
  -d '{"customerId": "cust_123", "planId": "pro", "trialDays": 14}'

# Record usage
curl -X POST http://localhost:8787/usage \
  -H "Content-Type: application/json" \
  -d '{"subscriptionId": "sub_abc", "metric": "apiCalls", "quantity": 1500}'

# Check usage summary
curl http://localhost:8787/subscriptions/cust_123/usage

# Add payment method
curl -X POST http://localhost:8787/customers/cust_123/payment-methods \
  -H "Content-Type: application/json" \
  -d '{"type": "card", "token": "tok_visa4242", "makeDefault": true}'

# Upgrade plan
curl -X PUT http://localhost:8787/subscriptions/cust_123/plan \
  -H "Content-Type: application/json" \
  -d '{"planId": "enterprise"}'
```

## Plan Structure

```typescript
const PLANS = {
  free: {
    price: 0,
    limits: { apiCalls: 1000, storage: 1, seats: 1 },
  },
  pro: {
    price: 4900, // $49/month
    limits: { apiCalls: 50000, storage: 10, seats: 5 },
    metered: { apiCalls: 50, storage: 100 }, // Per 1k calls, per GB
  },
  enterprise: {
    price: 29900, // $299/month
    limits: { apiCalls: Infinity, storage: 100, seats: Infinity },
  },
}
```

## Running Locally

```bash
npm install
npm run dev
npm test
```
