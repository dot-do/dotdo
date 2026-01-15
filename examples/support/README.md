# support.example.com.ai

A support ticket system with SLAs and escalation, built on dotdo v2.

## The Problem

Your support team is drowning. Tickets pile up faster than humans can respond. SLA breaches happen because nobody tracks deadlines. Enterprise tools cost $50/seat/month.

## The Solution

dotdo automates the boring parts. Cascade handles first responses. `$.every.hour` catches SLA breaches before they happen.

## Data Model

```typescript
interface Ticket {
  $type: 'Ticket'
  $id: string
  subject: string
  body: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'pending' | 'resolved' | 'closed'
  customerId: string
  assignedTo?: string
  slaDeadline: Date
}

interface Agent {
  $type: 'Agent'
  $id: string
  name: string
  email: string
  available: boolean
}

interface Customer {
  $type: 'Customer'
  $id: string
  name: string
  email: string
  plan: 'free' | 'pro' | 'enterprise'
}
```

## SLA Configuration

```typescript
const SLA_HOURS = { critical: 1, high: 4, medium: 24, low: 72 } as const

function calculateDeadline(priority: keyof typeof SLA_HOURS): Date {
  return new Date(Date.now() + SLA_HOURS[priority] * 60 * 60 * 1000)
}

function isBreached(ticket: Ticket): boolean {
  return ticket.status === 'open' && new Date() > ticket.slaDeadline
}
```

## Event Handlers

```typescript
import { $ } from 'dotdo'

// New ticket: set SLA and attempt auto-response
$.on.Ticket.created(async (event) => {
  const ticket = event.data as Ticket
  ticket.slaDeadline = calculateDeadline(ticket.priority)

  const response = await $.cascade({
    task: `Respond to: ${ticket.subject}`,
    tiers: {
      code: () => findKBArticle(ticket),
      generative: () => generateResponse(ticket),
      human: () => queueForAgent(ticket),
    },
    confidenceThreshold: 0.8,
  })

  if (response.tier !== 'human') {
    await postAutoResponse(ticket, response.value as string)
  }
})

// Escalation: notify on-call
$.on.Ticket.escalated(async (event) => {
  const ticket = event.data as Ticket
  const onCall = await findOnCallAgent(ticket.priority)

  if (onCall) {
    await $.things.Ticket(ticket.$id).update({ assignedTo: onCall.$id })
    await notifyAgent(onCall, ticket)
  }
})
```

## SLA Monitoring

```typescript
// Check every hour for SLA breaches
$.every.hour(async () => {
  const openTickets = await $.things.Ticket.list({ where: { status: 'open' } })

  for (const ticket of openTickets) {
    if (isBreached(ticket)) {
      $.send('Ticket.escalated', { ...ticket, reason: 'sla_breach' })
    }
  }
})

// Daily SLA report at 9am
$.every.day.at('9am')(async () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
  await sendDailyReport({
    resolved: await countResolvedSince(yesterday),
    breached: await countBreachesSince(yesterday),
  })
})
```

## Cascade Auto-Response

```typescript
// Code tier: exact match from knowledge base
function findKBArticle(ticket: Ticket) {
  const kb = knowledgeBase.search(ticket.subject + ' ' + ticket.body)
  if (kb.score > 0.9) {
    return { value: kb.article.summary, confidence: kb.score }
  }
  return null
}

// Generative tier: LLM drafts response
import { ai } from 'dotdo'

async function generateResponse(ticket: Ticket) {
  const response = await ai`
    Draft a support response for:
    Subject: ${ticket.subject}
    Body: ${ticket.body}
  `
  return { value: response, confidence: 0.85 }
}

// Human tier: queue for agent review
function queueForAgent(ticket: Ticket) {
  return {
    value: 'Queued for human review',
    confidence: 1.0,
    queueEntry: { ticketId: ticket.$id, queuedAt: new Date() },
  }
}
```

## Deploy

```typescript
// worker.ts
import { DO } from 'dotdo'
export { DO }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const tenant = new URL(request.url).hostname.split('.')[0]
    return env.DO.get(env.DO.idFromName(tenant)).fetch(request)
  },
}
```

```toml
# wrangler.toml
name = "support-tickets"
main = "worker.ts"

[[durable_objects.bindings]]
name = "DO"
class_name = "DO"
```

```bash
npx wrangler deploy
```

## What You Get

- **Instant responses**: Cascade tries KB, then AI, then queues for humans
- **Zero missed SLAs**: Hourly checks catch at-risk tickets before breach
- **Clear escalation**: Events trigger notifications and reassignment
- **Cost control**: Only pay for AI when deterministic lookup fails
