# Temporal Workflows. Edge Deployment. Zero Infrastructure.

> Drop-in replacement for `@temporalio/workflow` that runs on Cloudflare's global network.

```typescript
// Before: import { proxyActivities, sleep } from '@temporalio/workflow'
import { proxyActivities, defineSignal, setHandler, sleep, condition } from 'dotdo/workflows/compat/temporal'

const { sendEmail, chargeCard } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10s',
  retry: { maximumAttempts: 3 },
})

export async function orderWorkflow(order: Order) {
  const approved = defineSignal<[boolean]>('approve')
  let isApproved = false

  setHandler(approved, (approval) => {
    isApproved = approval
  })

  // Wait up to 7 days for human approval (durable - survives restarts)
  await condition(() => isApproved, '7d')

  await chargeCard(order.cardToken, order.amount)
  await sendEmail(order.email, 'Order confirmed!')

  return { status: 'completed' }
}
```

## The Problem

Temporal is the gold standard for durable execution, but running it requires:

- **A Temporal cluster** (self-hosted or Temporal Cloud)
- **Worker processes** that must run 24/7
- **Complex infrastructure** for high availability
- **Significant operational overhead**

## The Solution

Same API. Zero ops. Runs on 300+ edge cities with <1ms cold starts.

| Feature | Native Temporal | dotdo Temporal Compat |
|---------|-----------------|----------------------|
| Infrastructure | Cluster + workers | None (edge-native) |
| Cold Start | 100ms-2s | <1ms |
| Global Distribution | Manual setup | Automatic (300+ cities) |
| Pricing | Server costs + hosting | Pay-per-execution |
| Sleep Cost | Worker memory | Free (durable timers) |

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                     Your Temporal Workflow Code                  │
│   import { proxyActivities, sleep } from 'dotdo/...temporal'    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Temporal Compatibility Layer                   │
│                                                                  │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│   │ Signals  │  │ Queries  │  │ Timers   │  │  Activities  │   │
│   └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              Durable Workflow Runtime                    │   │
│   │              (Step Memoization + Replay)                 │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Durable Objects                             │
│                                                                  │
│   • SQLite storage for workflow state                           │
│   • Automatic replication across 300+ cities                    │
│   • <1ms cold starts via V8 isolates                            │
│   • Durable timers (sleep is free)                              │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Clone and install
cd examples/workflow-compat-temporal
pnpm install

# Run locally
pnpm dev

# Deploy to Cloudflare
pnpm deploy
```

## API Comparison

### Activities

```typescript
// Temporal SDK
import { proxyActivities } from '@temporalio/workflow'

// dotdo (identical)
import { proxyActivities } from 'dotdo/workflows/compat/temporal'

const activities = proxyActivities<OrderActivities>({
  startToCloseTimeout: '30s',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ValidationError'],
  },
})

await activities.chargePayment(orderId, amount)
```

### Signals & Queries

```typescript
import { defineSignal, defineQuery, setHandler } from 'dotdo/workflows/compat/temporal'

// Define signal (fire-and-forget message)
const approvalSignal = defineSignal<[boolean, string?]>('approve')

// Define query (read state)
const getStatusQuery = defineQuery<OrderStatus>('getStatus')

export async function orderWorkflow() {
  let status = 'pending'
  let approved = false

  // Register handlers
  setHandler(approvalSignal, (isApproved, reason) => {
    approved = isApproved
    status = isApproved ? 'approved' : 'rejected'
  })

  setHandler(getStatusQuery, () => status)

  // Wait for human decision
  await condition(() => approved, '24h')
}
```

### Durable Sleep

```typescript
import { sleep } from 'dotdo/workflows/compat/temporal'

export async function subscriptionWorkflow() {
  while (true) {
    await billCustomer()

    // Sleep 30 days - durable, survives restarts, FREE
    await sleep('30d')
  }
}
```

### Child Workflows

```typescript
import { startChild, executeChild } from 'dotdo/workflows/compat/temporal'

export async function parentWorkflow(orders: Order[]) {
  // Start all child workflows in parallel
  const handles = await Promise.all(
    orders.map(order =>
      startChild(processOrderWorkflow, {
        workflowId: `order-${order.id}`,
        args: [order],
      })
    )
  )

  // Wait for all to complete
  return Promise.all(handles.map(h => h.result()))
}
```

### Workflow Versioning

```typescript
import { patched, deprecatePatch } from 'dotdo/workflows/compat/temporal'

export async function orderWorkflow() {
  // Safe migration: new code path for new executions
  if (patched('v2-warehouse-notification')) {
    await notifyWarehouse(order)
  }

  // After all v1 workflows complete, deprecate the patch
  deprecatePatch('v1-legacy-path')
}
```

### Cancellation Scopes

```typescript
import { CancellationScope } from 'dotdo/workflows/compat/temporal'

export async function orderWorkflow() {
  let chargeId: string | null = null

  try {
    chargeId = await chargePayment(order)
    await fulfillOrder(order)
  } catch (error) {
    // Cleanup always runs, even on cancellation
    await CancellationScope.nonCancellable(async () => {
      if (chargeId) {
        await refundPayment(chargeId)
      }
    })
    throw error
  }
}
```

## Demo Endpoints

```bash
# Start a workflow
curl -X POST http://localhost:8787/start \
  -H "Content-Type: application/json" \
  -d '{"workflowType": "orderWorkflow", "input": {...}}'

# Get workflow status
curl http://localhost:8787/workflow/abc-123

# Send signal (human approval)
curl -X POST http://localhost:8787/signal/abc-123/approve \
  -H "Content-Type: application/json" \
  -d '{"args": [true, "Approved by manager"]}'

# Query workflow state
curl http://localhost:8787/query/abc-123/getStatus

# List all workflows
curl http://localhost:8787/workflows
```

## Features Demonstrated

| Feature | Description |
|---------|-------------|
| **Activities** | External operations with automatic retries and timeouts |
| **Signals** | Human-in-the-loop approval flow |
| **Queries** | Read workflow state without mutation |
| **Durable Sleep** | Wait hours/days without consuming resources |
| **Child Workflows** | Compose complex flows from simpler ones |
| **Versioning** | Safe migrations with `patched()` |
| **Cancellation** | Proper cleanup on failure |
| **Determinism** | `uuid4()`, `random()`, `workflowNow()` for replay safety |

## Performance

- **<5ms** workflow start latency (vs 50-200ms native)
- **<2ms** signal delivery (vs 10-50ms native)
- **<1ms** query response (vs 5-20ms native)
- **Zero cold starts** (Durable Objects)
- **Global distribution** (300+ Cloudflare locations)

## Learn More

- [temporal.do](https://temporal.do) - Full documentation
- [workflows.do](https://workflows.do) - Workflow primitives
- [dotdo.dev](https://dotdo.dev) - Build your 1-Person Unicorn
