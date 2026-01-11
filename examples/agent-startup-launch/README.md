# Agent Startup Launch

**Build your 1-Person Unicorn.** Complete AI-driven startup launch workflow with 5 named agents.

```typescript
import { Startup } from 'dotdo'
import { priya, ralph, tom, mark, sally } from 'agents.do'

export class MyStartup extends Startup {
  async launch() {
    const spec = priya`define the MVP for ${this.hypothesis}`
    let app = ralph`build ${spec}`

    do {
      app = ralph`improve ${app} per ${tom}`
    } while (!await tom.approve(app))

    mark`announce the launch`
    sally`start selling`

    // Your business is running.
  }
}
```

You just launched a startup. It took 10 lines of code.

---

## How It Works

This example demonstrates **Business-as-Code**: your entire startup launch process defined in TypeScript, executed by AI agents, with human oversight for critical decisions.

### Promise Pipelining

When you write:

```typescript
const spec = priya`define the MVP`
let app = ralph`build ${spec}`
```

You're making **one** network round trip, not two. The unawaited promise from `priya` flows directly to `ralph`. The server receives the entire pipeline and executes it in one pass.

### The do/while Loop

The iterative refinement pattern:

```typescript
do {
  app = ralph`improve ${app} per ${tom}`
} while (!await tom.approve(app))
```

Ralph builds. Tom reviews. Ralph improves. Repeat until approved. This is how real engineering works, encoded in 3 lines.

### Human Escalation

Critical decisions require humans:

```typescript
await legal`review for compliance`.timeout('4 hours').via('slack')
await ceo`approve the launch`.timeout('24 hours').via('email')
```

The workflow pauses, notifies via Slack/email, and resumes when approved.

### Event Handlers

React to business events:

```typescript
$.on.Customer.signup(async (customer) => {
  mark`send welcome email to ${customer.email}`
  sally`schedule onboarding call`
})

$.on.Payment.failed(async (payment) => {
  sally`reach out about failed payment`
})
```

### Scheduled Jobs

Recurring operations:

```typescript
$.every.monday.at('9am')(() => {
  priya`generate weekly retrospective`
  sally`update sales forecast`
})

$.every('first monday of quarter', async () => {
  const roadmap = await priya`review and update roadmap`
  await ceo`approve quarterly roadmap`
})
```

---

## The Team

| Agent | Role | What They Do |
|-------|------|--------------|
| **Priya** | Product | Defines specs, roadmaps, MVPs. She knows what to build and why. |
| **Ralph** | Engineering | Builds code. Implements features from specifications. |
| **Tom** | Tech Lead | Reviews architecture and code. Approves merges. |
| **Mark** | Marketing | Creates content, announces launches, runs campaigns. |
| **Sally** | Sales | Outreach, demos, closing. Turns leads into customers. |

---

## Running This Example

```bash
# Navigate to the example
cd examples/agent-startup-launch

# Install dependencies
npm install

# Start development server
npm run dev
```

### Start a Launch

```bash
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
```

### Watch Progress

```bash
# Get current state
curl http://localhost:8787/api/state

# Get metrics
curl http://localhost:8787/api/metrics

# Get event history
curl http://localhost:8787/api/events
```

### Emit Business Events

```bash
# Simulate a customer signup
curl -X POST http://localhost:8787/api/emit \
  -H "Content-Type: application/json" \
  -d '{"event": "Customer.signup", "data": {"email": "alice@example.com", "plan": "pro"}}'

# Simulate a payment
curl -X POST http://localhost:8787/api/emit \
  -H "Content-Type: application/json" \
  -d '{"event": "Payment.received", "data": {"amount": 299, "customerId": "cust_123"}}'
```

---

## Launch Phases

The workflow progresses through phases:

1. **Hypothesis** - Starting point with customer, problem, solution
2. **Specification** - Priya defines the MVP
3. **Development** - Ralph builds the first version
4. **Review** - Tom reviews and provides feedback
5. **Development** (repeat) - Ralph improves based on feedback
6. **QA** - Code is tested (uses review results)
7. **Legal Review** - Approval (auto-approved in demo)
8. **CEO Approval** - Final approval (auto-approved in demo)
9. **Marketing** - Mark prepares launch materials
10. **Sales Prep** - Sally creates sales strategy
11. **Launched!** - Business is running

---

## Project Structure

```
agent-startup-launch/
├── README.md               # This file
├── package.json            # Dependencies
├── wrangler.jsonc          # Cloudflare DO config
├── tsconfig.json           # TypeScript config
├── src/
│   ├── index.ts            # Worker entry point
│   ├── StartupLaunchDO.ts  # Main DO with agent orchestration
│   └── agents/
│       ├── index.ts        # Agent exports
│       ├── priya.ts        # Product agent
│       ├── ralph.ts        # Engineering agent
│       ├── tom.ts          # Tech lead agent
│       ├── mark.ts         # Marketing agent
│       └── sally.ts        # Sales agent
├── workflows/
│   └── launch.ts           # Workflow definitions
└── tests/
    └── startup.test.ts     # Test suite
```

---

## Key Patterns

### Template Literal Agents

```typescript
priya`define the MVP for ${hypothesis}`
ralph`build ${spec}`
tom`review ${code}`
```

Not string interpolation. Remote procedure calls. The agent receives your intent and executes.

### Chainable Human Requests

```typescript
await legal`review contract`
  .timeout('4 hours')
  .via('slack')
```

### Parallel Execution

```typescript
// All start executing without awaiting
mark`announce the launch`
mark`post to Product Hunt`
sally`start selling`
sally`reach out to pipeline`
```

### State Machine

Each phase has clear entry/exit criteria. Events are logged. Progress is trackable.

---

## Configuration

The example uses Cloudflare Workers AI for agent calls. This is configured in `wrangler.jsonc`:

```jsonc
"ai": {
  "binding": "AI"
}
```

---

## Running Tests

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npm run typecheck
```

---

## Learn More

- [dotdo Documentation](https://dotdo.dev)
- [agents.do - Named AI Agents](https://agents.do)
- [platform.do - Business-as-Code](https://platform.do)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)

---

[platform.do](https://platform.do) - MIT License
