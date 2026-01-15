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
import { $, ai, DO, noun, verb } from 'dotdo'

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
const acme = $.things.create('Company', {
  name: 'Acme Corp',
  industry: 'Manufacturing'
})

const alice = $.things.create('Contact', {
  name: 'Alice Chen',
  email: 'alice@acme.com',
  role: 'VP Engineering'
})

const deal = $.things.create('Deal', {
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
$.on.Deal.won(async ({ deal, $, ai }) => {
  await $.things.create('Activity', {
    type: 'deal_won',
    dealId: deal.$id,
    value: deal.value
  })

  await $.send({
    type: 'slack.message',
    channel: '#wins',
    text: ai`Celebrate: ${deal.name} closed for $${deal.value}!`
  })
})

$.on.Deal.lost(async ({ deal, $ }) => {
  // Schedule follow-up in 90 days
  await $.schedule(
    new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    { type: 'Deal.followup', dealId: deal.$id }
  )
})
```

## Scheduled Reports

### Weekly Pipeline

```typescript
$.every.Monday.at9am(async ({ $ }) => {
  const deals = await $.things.list('Deal', {
    where: { stage: { $ne: 'closed' } }
  })

  const totalValue = deals.reduce((sum, d) => sum + d.value, 0)

  await $.send({
    type: 'email',
    to: 'team@startup.com',
    subject: `Pipeline: $${totalValue.toLocaleString()}`
  })
})
```

### Daily Stale Check

```typescript
$.every.day.at('8am')(async ({ $ }) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const staleDeals = await $.things.list('Deal', {
    where: {
      stage: { $ne: 'closed' },
      updatedAt: { $lt: thirtyDaysAgo }
    }
  })

  for (const deal of staleDeals) {
    await $.send({
      type: 'slack.dm',
      user: deal.ownerId,
      text: `"${deal.name}" needs attention`
    })
  }
})
```

## Pipeline Transitions

```typescript
$.on.Deal.updated(async ({ deal, prev, $ }) => {
  if (deal.stage === prev.stage) return

  await $.things.create('Activity', {
    type: 'stage_change',
    dealId: deal.$id,
    from: prev.stage,
    to: deal.stage
  })
})
```

## Promise Pipelining

Promises are stubs. Chain freely, await only when needed.

```typescript
// ❌ Sequential - N round-trips
for (const id of contactIds) {
  await $.Contact(id).sendEmail(campaign)
}

// ✅ Pipelined - fire and forget
contactIds.forEach(id => $.Contact(id).sendEmail(campaign))

// ✅ Pipelined - single round-trip for chained access
const companyName = await $.Contact(id).getCompany().name

// ✅ Batch deal updates - no await needed for side effects
staleDeals.forEach(deal => $.Deal(deal.$id).nudgeOwner())
```

Only `await` at exit points when you need the value.

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
