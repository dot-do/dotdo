# crm.example.com.ai

A multi-tenant CRM built on dotdo semantic primitives.

## The Problem

You're a startup founder tracking sales in spreadsheets. Enterprise CRMs cost $150/user/month. Building your own means months of work.

## The Solution

dotdo gives you a CRM in semantic primitives. Define your sales model. Events handle automation.

```
https://crm.example.com.ai/:tenant
```

## Data Model

```typescript
import { DO, noun, verb } from 'dotdo'

// Nouns
const Contact = noun('Contact')
const Company = noun('Company')
const Deal = noun('Deal')
const Activity = noun('Activity')

// Verbs
const own = verb('own')
const win = verb('win', { past: 'won' })
const lose = verb('lose', { past: 'lost' })
```

### Creating Things

```typescript
// Inside DO class methods:
const acme = this.things.create('Company', {
  name: 'Acme Corp',
  industry: 'Manufacturing'
})

const alice = this.things.create('Contact', {
  name: 'Alice Chen',
  email: 'alice@acme.com',
  role: 'VP Engineering'
})

const deal = this.things.create('Deal', {
  name: 'Acme Enterprise',
  value: 50000,
  stage: 'discovery'
})

// Relationships
acme.owns(alice)
alice.owns(deal)
```

### Traversal

```typescript
const contacts = await acme -> 'Contact'   // All contacts at Acme
const deals = await alice -> 'Deal'        // Alice's deals
const company = await alice <- 'Company'   // Alice's company
```

## Event Handlers

```typescript
// Inside DO.extend({ init() { ... } })
this.on.Deal.won(async ({ deal }) => {
  await this.things.create('Activity', {
    type: 'deal_won',
    dealId: deal.$id,
    value: deal.value
  })

  await this.send({
    type: 'slack.message',
    channel: '#wins',
    text: `Celebrate: ${deal.name} closed for $${deal.value}!`
  })
})

this.on.Deal.lost(async ({ deal }) => {
  // Schedule follow-up in 90 days
  await this.schedule(
    new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    { type: 'Deal.followup', dealId: deal.$id }
  )
})
```

## Scheduled Reports

### Weekly Pipeline

```typescript
this.every.Monday.at('9am')(async () => {
  const deals = await this.things.list('Deal', {
    where: { stage: { $ne: 'closed' } }
  })

  const totalValue = deals.reduce((sum, d) => sum + d.value, 0)

  await this.send({
    type: 'email',
    to: 'team@startup.com',
    subject: `Pipeline: $${totalValue.toLocaleString()}`
  })
})
```

### Daily Stale Check

```typescript
this.every.day.at('8am')(async () => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const staleDeals = await this.things.list('Deal', {
    where: {
      stage: { $ne: 'closed' },
      updatedAt: { $lt: thirtyDaysAgo }
    }
  })

  for (const deal of staleDeals) {
    await this.send({
      type: 'slack.dm',
      user: deal.ownerId,
      text: `"${deal.name}" needs attention`
    })
  }
})
```

## Pipeline Transitions

```typescript
this.on.Deal.updated(async ({ deal, prev }) => {
  if (deal.stage === prev.stage) return

  await this.things.create('Activity', {
    type: 'stage_change',
    dealId: deal.$id,
    from: prev.stage,
    to: deal.stage
  })
})
```

## Promise Pipelining (Cap'n Web)

True Cap'n Proto-style pipelining: method calls on stubs batch until `await`, then resolve in a single round-trip.

```typescript
// ❌ Sequential - N round-trips
for (const id of contactIds) {
  await this.Contact(id).sendEmail(campaign)
}

// ✅ Pipelined - fire and forget
contactIds.forEach(id => this.Contact(id).sendEmail(campaign))

// ✅ Pipelined - single round-trip for chained access
const companyName = await this.Contact(id).company.name

// ✅ Batch deal updates - no await needed for side effects
staleDeals.forEach(deal => this.Deal(deal.$id).nudgeOwner())
```

`this.Noun(id)` returns a pipelined stub. Property access and method calls are recorded, then executed server-side on `await`.

## Multi-Tenant URLs

```
GET  /acme/contacts
POST /acme/deals
GET  /startup/deals?stage=proposal
```

Tenant from path. Each routes to `DO(tenant)`.

## API

```bash
# Create contact
curl -X POST crm.example.com.ai/acme/contacts \
  -d '{"name": "Bob", "email": "bob@acme.com"}'

# Update deal
curl -X PATCH crm.example.com.ai/acme/deals/deal-456 \
  -d '{"stage": "proposal"}'

# Mark won
curl -X POST crm.example.com.ai/acme/deals/deal-456/win
```

## Deploy

```bash
npx dotdo create crm mycompany
npm run deploy
# Live at: crm.example.com.ai/mycompany
```

## What You Get

- Contact/company management
- Deal pipeline with stages
- Activity logging
- Relationship graphs
- Weekly reports
- Stale deal alerts
- Win/loss automation
- Multi-tenant isolation
- Zero infrastructure

No servers. No database provisioning. Just semantic primitives.
