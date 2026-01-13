# Autonomous Startup Example

End-to-end example demonstrating the complete autonomous startup lifecycle from hypothesis to revenue.

## Overview

This example implements the core Business-as-Code pattern from dotdo:

```typescript
import { Startup } from 'dotdo'
import { priya, ralph, tom, mark, sally } from 'agents.do'
import { ceo, legal } from 'humans.do'

export class MyStartup extends Startup {
  async launch() {
    const spec = priya`define the MVP for ${this.hypothesis}`
    let app = ralph`build ${spec}`

    do {
      app = ralph`improve ${app} per ${tom}`
    } while (!await tom.approve(app))

    mark`announce the launch`
    sally`start selling`
  }
}
```

## Features Demonstrated

### 1. Typed Agent Results (`agent.as(Schema)`)

Get structured, validated outputs from AI agents using Zod schemas:

```typescript
import { z } from 'zod'

const ProductSpecSchema = z.object({
  name: z.string(),
  features: z.array(z.string()),
  timeline: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
})

// Priya returns a typed ProductSpec
const spec = await priya.as(ProductSpecSchema)`
  Define the MVP for:
  Customer: ${hypothesis.customer}
  Problem: ${hypothesis.problem}
`

// spec.content.features is string[]
// spec.content.priority is 'low' | 'medium' | 'high'
console.log(spec.content.name, spec.content.features)
```

### 2. Do/While Review Loop

Iterate development until Tom (tech lead) approves:

```typescript
let app = await ralph.as(ApplicationSchema)`build ${spec}`
let review: AgentResult<CodeReview>

do {
  review = await tom.as(CodeReviewSchema)`review ${app.content.code}`

  if (!review.content.approved) {
    app = await ralph.as(ApplicationSchema)`
      improve ${app} based on:
      ${JSON.stringify(review.content.issues)}
    `
  }
} while (!review.content.approved && iterations < maxIterations)
```

### 3. Human Escalation (`humans.do`)

Await human approval for critical decisions:

```typescript
import { ceo, legal, HumanTimeoutError } from 'humans.do'

// Legal review with 4-hour SLA
try {
  const legalResult = await legal`
    Review ${productName} for compliance
  `.timeout('4 hours')

  if (!legalResult.approved) {
    throw new Error(`Legal rejected: ${legalResult.reason}`)
  }
} catch (error) {
  if (error instanceof HumanTimeoutError) {
    // Handle timeout - escalate or auto-approve
  }
}

// CEO approval with channel routing
const ceoResult = await ceo`approve the launch`.timeout('24 hours').via('slack')
```

### 4. Event Handlers (`$.on.Noun.verb`)

React to business events:

```typescript
import { on } from 'dotdo/workflows'

// Handle new customer signups
on.Customer.signup(async (customer) => {
  metrics.signups++
  await mark`send welcome email to ${customer.email}`
  await sally`schedule onboarding call for ${customer.email}`
})

// Handle payment failures
on.Payment.failed(async (payment) => {
  await sally`reach out to ${payment.customerId} about failed payment`
})

// Handle feature requests
on.Feature.requested(async (request) => {
  if (request.votes >= 10) {
    await priya`evaluate feature request: ${request.feature}`
  }
})
```

### 5. Scheduling (`$.every`)

Schedule recurring tasks with natural language:

```typescript
import { every } from 'dotdo/workflows'

// Daily standup at 9am
every.day.at9am(() => {
  console.log('Daily standup:', metrics)
})

// Weekly retrospective on Monday
every.Monday.at10am(async () => {
  await priya`generate weekly retrospective from ${events}`
})

// Hourly metrics check
every.hour(() => {
  trackMetrics({ mrr, customers, churn })
})
```

## Project Structure

```
examples/autonomous-startup/
  src/
    AutonomousStartup.ts   # Main startup class with full workflow
    index.ts               # HTTP API entry point
  tests/
    autonomous-startup.test.ts  # Integration tests
  package.json
  tsconfig.json
  vitest.config.ts
  wrangler.jsonc
  README.md
```

## Running the Example

### Development

```bash
# Navigate to the example
cd examples/autonomous-startup

# Install dependencies
npm install

# Start development server
npm run dev

# The server will start at http://localhost:8787
```

### API Usage

```bash
# Start a launch (mock mode)
curl -X POST http://localhost:8787/api/launch \
  -H "Content-Type: application/json" \
  -d '{
    "hypothesis": {
      "customer": "Freelance developers",
      "problem": "Tax season takes 20+ hours",
      "solution": "AI-powered tax automation",
      "differentiator": "AI does 95%, CPA reviews edge cases"
    }
  }'

# Get current state
curl http://localhost:8787/api/state

# Get metrics
curl http://localhost:8787/api/metrics

# Get events
curl http://localhost:8787/api/events

# Emit an event
curl -X POST http://localhost:8787/api/emit \
  -H "Content-Type: application/json" \
  -d '{"event": "Customer.signup", "data": {"email": "alice@example.com", "plan": "pro"}}'
```

### Running Tests

```bash
# Run tests once
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npm run typecheck
```

## Agents Used

| Agent | Role | Capabilities |
|-------|------|--------------|
| Priya | Product | Specs, roadmaps, MVP definition |
| Ralph | Engineering | Builds code, implements features |
| Tom | Tech Lead | Architecture, code review |
| Quinn | QA | Testing, quality assurance |
| Mark | Marketing | Content, launches, announcements |
| Sally | Sales | Outreach, pitches, closing deals |

## Schemas

The example defines typed schemas for all agent outputs:

- `HypothesisSchema` - Startup hypothesis (customer, problem, solution)
- `ProductSpecSchema` - Product specification from Priya
- `ApplicationSchema` - Built application from Ralph
- `CodeReviewSchema` - Code review from Tom
- `QAResultSchema` - Test results from Quinn
- `LaunchMaterialsSchema` - Marketing content from Mark
- `SalesStrategySchema` - Sales strategy from Sally

## Configuration Options

When calling `launch()`:

```typescript
await startup.launch(hypothesis, {
  maxIterations: 5,        // Max review iterations (default: 5)
  skipHumanApproval: true, // Skip legal/CEO approval (default: false)
  mockMode: true,          // Use mock responses (default: false)
})
```

## Error Handling

The example includes comprehensive error handling:

- Agent parse failures are caught and logged
- Human timeout errors trigger auto-approval (configurable)
- All errors are tracked in `state.errors`
- Non-fatal phases (QA, marketing, sales) continue on error

## Related

- [CLAUDE.md](../../CLAUDE.md) - Core documentation
- [agents.do](https://agents.do) - Named agent documentation
- [humans.do](https://humans.do) - Human escalation documentation
- [platform.do](https://platform.do) - Platform documentation
