# invoices.example.com.ai

**Stop chasing payments. Start getting paid.**

You're a freelancer. You finish the project, send an invoice, and... wait. Days pass. You awkwardly follow up. They forgot. You follow up again. Repeat until paid or exhausted.

Invoice tools charge $10-20/month for the privilege of sending PDFs. Building your own means wrestling with reminders, payment processing, and state management.

With dotdo, invoices are just Things. Payments are events. Reminders are `this.every.day.at('9am')`. Payment processing is `this.do` (durable, retried automatically). Deploy once, invoice forever.

```typescript
const invoice = await this.Invoice.create({
  customer: 'acme-corp',
  items: [{ description: 'Website Redesign', amount: 5000 }],
  dueDate: '2025-02-15',
})
// Overdue reminders and payment retries happen automatically.
```

---

## Setup

```typescript
import { DO, ai } from 'dotdo'
```

---

## Things

```typescript
interface Customer {
  $type: 'Customer'
  $id: string
  name: string
  email: string
  paymentMethod?: { type: 'card'; last4: string; token: string }
}

interface Invoice {
  $type: 'Invoice'
  $id: string
  customerId: string
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void'
  items: LineItem[]
  total: number
  dueDate: string
}

interface LineItem {
  $type: 'LineItem'
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

interface Payment {
  $type: 'Payment'
  $id: string
  invoiceId: string
  amount: number
  status: 'pending' | 'succeeded' | 'failed'
}
```

---

## Event Handlers

```typescript
this.on.Invoice.sent(async ({ invoice }) => {
  console.log(`Invoice ${invoice.$id} sent to ${invoice.customerId}`)
})

this.on.Payment.received(async ({ payment }) => {
  await this.Invoice.update(payment.invoiceId, {
    status: 'paid',
    paidAt: new Date().toISOString(),
  })
})

this.on.Payment.failed(async ({ payment }) => {
  console.log(`Payment failed: ${payment.failureReason}`)
})
```

---

## Scheduled Reminders

```typescript
this.every.day.at('9am')(async () => {
  const overdue = await this.Invoice.list({
    status: 'sent',
    dueDate: { $lt: new Date().toISOString() },
  })

  for (const invoice of overdue) {
    await this.Invoice.update(invoice.$id, { status: 'overdue' })
    this.send('Invoice.overdue', { invoice })
  }
})

this.on.Invoice.overdue(async ({ invoice }) => {
  const customer = await this.Customer.get(invoice.customerId)
  console.log(`Reminder sent to ${customer.email}`)
})
```

---

## Durable Payment Processing

```typescript
async processPayment(invoiceId: string) {
  const invoice = await this.Invoice.get(invoiceId)
  const customer = await this.Customer.get(invoice.customerId)

  // this.do = durable execution with automatic retries
  await this.do(async () => {
    return await stripe.charges.create({
      amount: invoice.total * 100,
      currency: 'usd',
      source: customer.paymentMethod.token,
      metadata: { invoiceId },
    })
  }, { stepId: 'charge-card' })

  await this.Payment.create({
    invoiceId,
    amount: invoice.total,
    status: 'succeeded',
    attemptedAt: new Date().toISOString(),
  })

  this.send('Payment.received', { payment: { invoiceId, amount: invoice.total } })
}
```

---

## Promise Pipelining (Cap'n Web)

True Cap'n Proto-style pipelining: method calls on stubs batch until `await`, then resolve in a single round-trip.

```typescript
// ❌ Sequential - N round-trips
for (const invoice of overdueInvoices) {
  await this.Customer(invoice.customerId).sendReminder(invoice)
}

// ✅ Pipelined - fire and forget (no await needed for side effects)
overdueInvoices.forEach(inv => this.Customer(inv.customerId).sendReminder(inv))

// ✅ Pipelined - single round-trip for chained access
const balance = await this.Customer(invoice.customerId).account.balance
```

`this.Noun(id)` returns a pipelined stub. Property access and method calls are recorded, then executed server-side on `await`. Reminders, notifications, and logging are fire-and-forget - let them run without blocking.

---

## Quick Start

```bash
npm install && npm run dev

# Create customer
curl -X POST http://localhost:8787/customers \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Corp", "email": "billing@acme.com"}'

# Create and send invoice
curl -X POST http://localhost:8787/invoices \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_abc123",
    "items": [{"description": "Website Redesign", "quantity": 1, "unitPrice": 5000}],
    "dueDate": "2025-02-15"
  }'

curl -X POST http://localhost:8787/invoices/inv_xyz789/send

# Deploy
npm run deploy
```

---

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/customers` | Create customer |
| POST | `/invoices` | Create invoice |
| POST | `/invoices/:id/send` | Send invoice |
| POST | `/invoices/:id/pay` | Process payment |
| GET | `/invoices?status=overdue` | List overdue |

---

## Event Flow

```
Invoice.create ──► Invoice.send ──► Invoice.sent
                                        |
                           this.every.day.at('9am') checks overdue
                                        |
                              Invoice.overdue ──► Send reminder

Payment.process (this.do)
    |
    ├─► success ──► Payment.received ──► Invoice.paid
    └─► failure ──► auto-retry via this.do
```

---

| Traditional | dotdo |
|-------------|-------|
| Cron jobs on separate servers | `this.every.day.at('9am')` |
| Payment webhooks + retry logic | `this.do` with automatic retries |
| Database + cache + queue | SQLite in Durable Object |
| $10-20/month invoice tools | Deploy once, free forever |

Built with [dotdo](https://dotdo.dev)
