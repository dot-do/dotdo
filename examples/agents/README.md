# agents.example.com.ai

Multi-step agentic workflows with dotdo v2.

## The Problem

You're building AI agents. They need state, retries, and human oversight. Traditional approaches force you to build this infrastructure yourself.

## The Solution

dotdo's cascade execution handles escalation automatically:

```
Code (instant) -> Generative (<1s) -> Agentic (seconds) -> Human (async)
```

## Quick Start

```typescript
import { DO, ai, ReviewQueue } from 'dotdo'

export default DO.extend({
  humanQueue: new ReviewQueue(),

  async classifyTicket(ticket: Ticket) {
    const result = await this.cascade({
      task: 'Classify support ticket',
      tiers: {
        // Tier 1: Deterministic rules
        code: () => {
          if (ticket.subject.includes('URGENT')) {
            return { value: 'critical', confidence: 1.0 }
          }
          return { value: null, confidence: 0 }
        },

        // Tier 2: Single LLM call
        generative: async () => {
          const category = await ai`Classify: ${ticket.body}`
          return { value: category, confidence: 0.85 }
        },

        // Tier 3: Multi-step reasoning
        agentic: async () => {
          const context = await ai`Extract key details: ${ticket.body}`
          const history = await this.Customer(ticket.customerId).history
          const category = await ai`Given ${context} and ${history}, classify.`
          return { value: category, confidence: 0.95 }
        },

        // Tier 4: Human review
        human: async () => {
          const entry = await this.humanQueue.add({
            id: ticket.id,
            type: 'classification',
            title: ticket.subject,
            data: { body: ticket.body },
            createdAt: new Date(),
          })
          return { value: 'pending', confidence: 1.0, queueEntry: entry }
        },
      },
      confidenceThreshold: 0.8,
    })
    return result
  }
})
```

## Cascade Options

```typescript
await this.cascade({
  task: 'Sensitive decision',
  confidenceThreshold: 0.95,  // High bar - likely escalates to human
  skipAutomation: true,       // Go straight to human tier
  timeout: 5000,              // 5s max per tier
  tiers: { ... }
})
```

## Durable Agent Steps

Use `this.do` for steps that must survive failures:

```typescript
async agentWorkflow(task: string) {
  const research = await this.do(
    () => ai`Research: ${task}`,
    { stepId: 'research', maxRetries: 3 }
  )

  const plan = await this.do(
    () => ai`Create action plan: ${research}`,
    { stepId: 'planning' }
  )

  for (const action of plan.steps) {
    await this.do(
      () => executeAction(action),
      { stepId: `action-${action.id}` }
    )
  }
}
```

If the DO restarts mid-workflow, `this.do` replays completed steps from the action log.

## Promise Pipelining (Cap'n Web)

True Cap'n Proto-style pipelining: method calls on stubs batch until `await`, then resolve in a single round-trip.

```typescript
// ❌ Sequential - N round-trips
for (const task of pendingTasks) {
  await this.Agent(task.agentId).assign(task)
}

// ✅ Pipelined - fire and forget
pendingTasks.forEach(task => this.Agent(task.agentId).assign(task))

// ✅ Pipelined - single round-trip for chained access
const status = await this.Agent(id).state.currentTask
```

`this.Noun(id)` returns a pipelined stub. Property access and method calls are recorded, then executed server-side on `await`. Fire-and-forget is valid for side effects like agent assignments.

## Human-in-the-Loop Queue

```typescript
import { ReviewQueue } from 'dotdo'

const queue = new ReviewQueue()

// Add item for review
await queue.add({
  id: 'review-123',
  type: 'content-moderation',
  title: 'Flagged post',
  data: { content: post.body },
  createdAt: new Date(),
}, { priority: 'high' })

// Reviewer claims and completes
const item = await queue.claim('reviewer@company.com')
await queue.complete(item.id, { approved: false, reason: 'Policy violation' })
```

## Approval Workflows

```typescript
import { ApprovalWorkflow } from 'dotdo'

const workflow = new ApprovalWorkflow()

const request = await workflow.request(
  {
    id: 'expense-456',
    type: 'expense',
    title: '$5000 purchase',
    description: 'License renewal',
    amount: 5000,
    requestedBy: 'alice@company.com',
    requestedAt: new Date(),
  },
  ['manager@company.com', 'finance@company.com'],
  { deadline: '24 hours' }
)

await workflow.approve(request.id, 'manager@company.com')  // Advances
await workflow.approve(request.id, 'finance@company.com') // Complete
```

## Event-Driven Agents

```typescript
this.on.Ticket.created(async (event) => {
  await this.cascade({
    task: `Process ticket ${event.data.id}`,
    tiers: {
      code: () => autoRoute(event.data),
      generative: () => ai`Suggest response: ${event.data.body}`,
      human: () => this.humanQueue.add(event.data),
    },
  })
})

this.every.hour(async () => {
  const stale = await this.getStaleTickets()
  for (const ticket of stale) {
    this.send('Ticket.stale', ticket)
  }
})
```

## Execution Visibility

```typescript
const result = await this.cascade({ ... })

result.tier           // 'generative' - which tier succeeded
result.confidence     // 0.92
result.executionPath  // ['code', 'generative'] - tiers attempted
result.timing         // { code: 2, generative: 450 } - ms per tier
```

## Build Your First Agent

1. Define cascade tiers based on task complexity
2. Set confidence thresholds for your domain
3. Implement human queues for edge cases
4. Use `this.do` for steps that must survive failures
5. Monitor execution paths to optimize tier placement
