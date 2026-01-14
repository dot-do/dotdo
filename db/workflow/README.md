# Workflow Primitives

> Temporal-inspired durable execution with activities, timers, and signals

## Overview

Workflow primitives provide Temporal-compatible durable execution on top of DO SQLite. They enable long-running processes with automatic persistence, retry policies, and human-in-the-loop patterns.

## Features

- **Durable execution** - Workflows survive crashes and restarts
- **Activities** - Units of work with retry policies
- **Timers** - Durable sleep and scheduled execution
- **Signals** - External events that influence workflow
- **Queries** - Read workflow state without mutation
- **Child workflows** - Composition and fan-out
- **Three-tier storage** - Hot/warm/cold automatic tiering

## Three-Tier Storage

```
┌─────────────────────────────────────────────────────────────────┐
│ HOT: DO SQLite                                                  │
│ • Active workflow state and history                             │
│ • Pending activities and timers                                 │
│ • Signal queues                                                 │
│ Access: <1ms                                                    │
├─────────────────────────────────────────────────────────────────┤
│ WARM: R2 Parquet                                                │
│ • Completed workflow histories (for replay)                     │
│ • Activity results cache                                        │
│ • Timer schedules                                               │
│ Access: ~50ms                                                   │
├─────────────────────────────────────────────────────────────────┤
│ COLD: R2 Iceberg Archive                                        │
│ • Full workflow execution history                               │
│ • Audit trail for compliance                                    │
│ • Cross-DO workflow analytics                                   │
│ Access: ~100ms                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Core Concepts

### Workflow Definition

```typescript
import { workflow, activity, sleep, signal } from 'dotdo/db/workflow'

// Define a workflow
const orderWorkflow = workflow('processOrder', async (ctx, order: Order) => {
  // Activity: Reserve inventory
  const reserved = await ctx.activity('reserveInventory', {
    input: order.items,
    retry: { maxAttempts: 3, backoff: 'exponential' },
  })

  // Timer: Wait for payment (with timeout)
  const payment = await ctx.waitForSignal('payment', {
    timeout: '24h',
    default: null,
  })

  if (!payment) {
    // Cancel reservation
    await ctx.activity('cancelReservation', { input: reserved.id })
    return { status: 'cancelled', reason: 'payment_timeout' }
  }

  // Activity: Ship order
  const shipment = await ctx.activity('shipOrder', {
    input: { orderId: order.id, address: order.shipping },
  })

  return { status: 'completed', trackingNumber: shipment.tracking }
})
```

### Starting a Workflow

```typescript
import { WorkflowClient } from 'dotdo/db/workflow'

const client = new WorkflowClient(env.DO)

// Start workflow
const handle = await client.start(orderWorkflow, {
  workflowId: `order-${orderId}`,
  input: order,
  taskQueue: 'orders',
})

// Get result (blocks until complete)
const result = await handle.result()

// Query state
const status = await handle.query('status')

// Send signal
await handle.signal('payment', { amount: 99.99, method: 'card' })

// Cancel
await handle.cancel()
```

### Activities

```typescript
import { defineActivity } from 'dotdo/db/workflow'

// Define activity implementation
const reserveInventory = defineActivity('reserveInventory', async (items) => {
  // Call external inventory service
  const response = await fetch('https://inventory.api/reserve', {
    method: 'POST',
    body: JSON.stringify(items),
  })
  return response.json()
})

// Activity options
ctx.activity('reserveInventory', {
  input: items,
  retry: {
    maxAttempts: 5,
    initialInterval: '1s',
    maxInterval: '1m',
    backoffCoefficient: 2,
  },
  timeout: '30s',
  heartbeatTimeout: '10s',
})
```

### Timers and Scheduling

```typescript
// Durable sleep
await ctx.sleep('1h')

// Wait until specific time
await ctx.sleepUntil('2024-02-01T00:00:00Z')

// Periodic execution (cron-like)
const subscription = workflow('monthlyBilling', async (ctx, customerId) => {
  while (true) {
    await ctx.activity('processPayment', { input: customerId })
    await ctx.sleep('30d')
  }
})
```

### Signals and Queries

```typescript
// Wait for signal
const approval = await ctx.waitForSignal('managerApproval', {
  timeout: '7d',
})

// Define query handler
ctx.setQueryHandler('status', () => ({
  step: ctx.currentStep,
  startedAt: ctx.startTime,
}))

// Send signal from outside
await handle.signal('managerApproval', { approved: true, by: 'manager@co.com' })

// Query from outside
const status = await handle.query('status')
```

### Child Workflows

```typescript
const parentWorkflow = workflow('processOrders', async (ctx, orders) => {
  // Fan-out: Start child workflow for each order
  const handles = await Promise.all(
    orders.map(order =>
      ctx.startChild(orderWorkflow, {
        workflowId: `order-${order.id}`,
        input: order,
      })
    )
  )

  // Wait for all children
  const results = await Promise.all(handles.map(h => h.result()))

  return { processed: results.length }
})
```

## API

```typescript
import {
  WorkflowClient,
  WorkflowWorker,
  workflow,
  activity,
} from 'dotdo/db/workflow'

// Start worker to execute workflows
const worker = new WorkflowWorker({
  taskQueue: 'orders',
  workflows: [orderWorkflow, subscriptionWorkflow],
  activities: [reserveInventory, processPayment, shipOrder],
})

await worker.run()

// Client operations
const client = new WorkflowClient(env.DO)

// List workflows
const workflows = await client.list({
  status: 'running',
  taskQueue: 'orders',
})

// Describe workflow
const info = await client.describe('order-123')

// Terminate workflow
await client.terminate('order-123', 'Admin cancellation')
```

## Schema

```sql
-- Workflow executions
CREATE TABLE workflows (
  workflow_id TEXT PRIMARY KEY,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'running', 'completed', 'failed', 'cancelled'
  input JSON,
  result JSON,
  error TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  task_queue TEXT NOT NULL
);

-- Workflow history (event sourced)
CREATE TABLE workflow_history (
  workflow_id TEXT NOT NULL,
  event_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSON,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (workflow_id, event_id)
);

-- Pending activities
CREATE TABLE workflow_activities (
  activity_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  input JSON,
  status TEXT NOT NULL,
  attempt INTEGER DEFAULT 0,
  scheduled_at INTEGER,
  started_at INTEGER,
  FOREIGN KEY (workflow_id) REFERENCES workflows(workflow_id)
);

-- Pending timers
CREATE TABLE workflow_timers (
  timer_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  fire_at INTEGER NOT NULL,
  data JSON,
  FOREIGN KEY (workflow_id) REFERENCES workflows(workflow_id)
);

-- Signal queue
CREATE TABLE workflow_signals (
  signal_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  signal_name TEXT NOT NULL,
  payload JSON,
  received_at INTEGER NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflows(workflow_id)
);

CREATE INDEX idx_workflows_status ON workflows(status, task_queue);
CREATE INDEX idx_timers_fire ON workflow_timers(fire_at);
CREATE INDEX idx_activities_scheduled ON workflow_activities(scheduled_at);
```

## CDC Events

```typescript
// On workflow start
{
  type: 'workflow.started',
  workflowId: 'order-123',
  workflowType: 'processOrder',
  taskQueue: 'orders'
}

// On activity complete
{
  type: 'workflow.activity_completed',
  workflowId: 'order-123',
  activityType: 'reserveInventory',
  attempt: 1
}

// On workflow complete
{
  type: 'workflow.completed',
  workflowId: 'order-123',
  status: 'completed',
  durationMs: 86400000
}
```

## When to Use

| Use Workflow | Use Stream |
|--------------|------------|
| Long-running processes | Event processing |
| Human-in-the-loop | Fire-and-forget |
| Saga orchestration | Fan-out |
| Scheduled jobs | Real-time analytics |

## Dependencies

None. Uses only native SQLite.

## Related

- [`workflows/`](../../workflows/) - WorkflowContext ($) and DSL
- [`do/primitives/`](../../do/primitives/) - Core primitives
- Temporal documentation for compatibility details

## Implementation Status

| Feature | Status |
|---------|--------|
| Workflow definition | See `workflows/` |
| Activities | TBD |
| Timers | TBD |
| Signals | TBD |
| Queries | TBD |
| Child workflows | TBD |
| History replay | TBD |
| Hot → Warm tiering | TBD |
| CDC integration | TBD |
