# @dotdo/finance

Finance module for dotdo Business-as-Code. Provides a unified interface for financial operations with Stripe integration, including customer management, subscriptions, invoices, payments, and SaaS metrics.

## Installation

```bash
npm install @dotdo/finance
```

## Basic Usage

```typescript
import { createStripeClient } from '@dotdo/finance'

const finance = createStripeClient({
  apiKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
})

// Create a customer
const customer = await finance.customers.create({
  email: 'alice@example.com',
  name: 'Alice Smith'
})

// Create a subscription
const subscription = await finance.subscriptions.create({
  customerId: customer.id,
  priceId: 'price_xxx'
})

// Get SaaS metrics
const metrics = await finance.metrics.getSaaSMetrics()
console.log(`MRR: $${metrics.mrr / 100}`)
console.log(`ARR: $${metrics.arr / 100}`)
```

## API Overview

### Creating a Client

```typescript
import { createStripeClient } from '@dotdo/finance'

const finance = createStripeClient({
  apiKey: 'sk_...',           // Stripe secret key (required)
  webhookSecret: 'whsec_...'  // Webhook signing secret (optional)
})
```

### Customer Operations

```typescript
// Create
const customer = await finance.customers.create({
  email: 'alice@example.com',
  name: 'Alice Smith',
  metadata: { plan: 'pro' }
})

// Get
const customer = await finance.customers.get('cus_xxx')

// Update
const updated = await finance.customers.update('cus_xxx', {
  name: 'Alice Johnson'
})

// Delete
await finance.customers.delete('cus_xxx')

// List
const { data, hasMore } = await finance.customers.list({
  limit: 10,
  startingAfter: 'cus_xxx'
})
```

### Subscription Operations

```typescript
// Create
const subscription = await finance.subscriptions.create({
  customerId: 'cus_xxx',
  priceId: 'price_xxx',
  quantity: 1,
  trialPeriodDays: 14,
  metadata: { source: 'signup' }
})

// Get
const subscription = await finance.subscriptions.get('sub_xxx')

// Update
const updated = await finance.subscriptions.update('sub_xxx', {
  priceId: 'price_yyy',  // Change plan
  quantity: 5
})

// Cancel
const canceled = await finance.subscriptions.cancel('sub_xxx', true) // cancel at period end

// List
const { data } = await finance.subscriptions.list({
  customerId: 'cus_xxx'
})
```

### Invoice Operations

```typescript
// Create
const invoice = await finance.invoices.create({
  customerId: 'cus_xxx',
  autoAdvance: true,
  collectionMethod: 'charge_automatically'
})

// Get
const invoice = await finance.invoices.get('in_xxx')

// Finalize
const finalized = await finance.invoices.finalize('in_xxx')

// Pay
const paid = await finance.invoices.pay('in_xxx')

// Void
const voided = await finance.invoices.void('in_xxx')

// List
const { data } = await finance.invoices.list({
  customerId: 'cus_xxx',
  subscriptionId: 'sub_xxx'
})
```

### Payment Operations

```typescript
// Create
const payment = await finance.payments.create({
  amount: 2000,  // $20.00 in cents
  currency: 'usd',
  customerId: 'cus_xxx',
  confirm: true
})

// Get
const payment = await finance.payments.get('pi_xxx')

// Refund
const refunded = await finance.payments.refund('pi_xxx', 1000) // partial refund

// List
const { data } = await finance.payments.list({
  customerId: 'cus_xxx'
})
```

### SaaS Metrics

```typescript
// Get MRR
const mrr = await finance.metrics.getMRR()

// Get ARR
const arr = await finance.metrics.getARR()

// Get all SaaS metrics
const metrics = await finance.metrics.getSaaSMetrics()
// {
//   mrr: 50000,
//   arr: 600000,
//   activeSubscriptions: 100,
//   totalCustomers: 150,
//   churnRate: 0.02,
//   averageRevenuePerUser: 500,
//   lifetimeValue: 25000,
//   currency: 'usd',
//   calculatedAt: Date
// }

// Get MRR breakdown
const breakdown = await finance.metrics.getMRRBreakdown(
  new Date('2024-01-01'),
  new Date('2024-01-31')
)
// {
//   total: 50000,
//   newBusiness: 10000,
//   expansion: 5000,
//   contraction: -2000,
//   churn: -3000,
//   reactivation: 1000,
//   currency: 'usd',
//   periodStart: Date,
//   periodEnd: Date
// }
```

### Webhook Handling

```typescript
// Handle incoming webhook
const event = await finance.webhooks.handleWebhook(
  requestBody,
  signatureHeader
)

// Register event handlers
finance.webhooks.on('subscription.created', async (event) => {
  console.log('New subscription:', event.data)
})

finance.webhooks.on('invoice.paid', async (event) => {
  console.log('Invoice paid:', event.data)
})

// Remove handler
finance.webhooks.off('subscription.created', handler)
```

## Types

### Core Entities

```typescript
interface Customer {
  id: string
  email: string
  name?: string
  metadata?: Record<string, string>
  createdAt: Date
  updatedAt: Date
}

interface Subscription {
  id: string
  customerId: string
  status: SubscriptionStatus
  priceId: string
  productId: string
  quantity: number
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
  canceledAt?: Date
  endedAt?: Date
  trialStart?: Date
  trialEnd?: Date
  metadata?: Record<string, string>
  createdAt: Date
  updatedAt: Date
}

interface Invoice {
  id: string
  customerId: string
  subscriptionId?: string
  status: InvoiceStatus
  currency: string
  amountDue: number
  amountPaid: number
  amountRemaining: number
  subtotal: number
  tax?: number
  total: number
  hostedInvoiceUrl?: string
  invoicePdf?: string
  dueDate?: Date
  paidAt?: Date
  periodStart?: Date
  periodEnd?: Date
  metadata?: Record<string, string>
  createdAt: Date
}

interface Payment {
  id: string
  customerId?: string
  invoiceId?: string
  amount: number
  currency: string
  status: PaymentStatus
  paymentMethod?: string
  receiptUrl?: string
  failureMessage?: string
  metadata?: Record<string, string>
  createdAt: Date
}
```

### Status Types

```typescript
type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'paused'

type InvoiceStatus =
  | 'draft'
  | 'open'
  | 'paid'
  | 'uncollectible'
  | 'void'

type PaymentStatus =
  | 'succeeded'
  | 'pending'
  | 'failed'
  | 'canceled'
  | 'requires_action'
  | 'requires_payment_method'
```

### Webhook Event Types

```typescript
type WebhookEventType =
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.deleted'
  | 'subscription.trial_will_end'
  | 'invoice.created'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'invoice.finalized'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded'
```

## License

MIT
