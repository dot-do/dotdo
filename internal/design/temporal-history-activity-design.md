---
title: "Design Proposal: Temporal Workflow History & Activity Routing"
description: Documentation for design
---

# Design Proposal: Temporal Workflow History & Activity Routing

**Author:** Temporal Purist
**Date:** 2026-01-10
**Issues:** [dotdo-ligao](History Tracking), [dotdo-rdzrh](Activity Routing)
**Priority:** P0 - Critical for Temporal Compatibility

## Executive Summary

The Temporal compat layer (now moved to the compat repo at `@dotdo/compat-temporal`) provides API compatibility but lacks two foundational Temporal semantics:

1. **Workflow History Tracking** - No durable event log for deterministic replay
2. **Activity Worker Routing** - Activities execute inline instead of on separate workers

This design proposes faithful implementations that match Temporal's behavior. Users migrating from Temporal should have zero surprises.

---

## Part 1: Workflow History Tracking

### How Temporal Does It

Temporal uses an **event-sourced architecture** where every workflow action generates events that are durably persisted before execution proceeds.

#### Event Types (Complete List)

From [Temporal Events Reference](https://docs.temporal.io/references/events):

**Workflow Lifecycle:**
- `WorkflowExecutionStarted` - Initial event with workflow args
- `WorkflowExecutionCompleted` - Terminal success
- `WorkflowExecutionFailed` - Terminal failure
- `WorkflowExecutionTimedOut` - Terminal timeout
- `WorkflowExecutionCanceled` - Terminal cancellation
- `WorkflowExecutionTerminated` - Forced termination
- `WorkflowExecutionContinuedAsNew` - Reset history

**Workflow Tasks:**
- `WorkflowTaskScheduled` - Task queued for worker
- `WorkflowTaskStarted` - Worker picked up task
- `WorkflowTaskCompleted` - Worker finished (with Commands)
- `WorkflowTaskTimedOut` - Worker took too long
- `WorkflowTaskFailed` - Worker crashed/errored

**Activities:**
- `ActivityTaskScheduled` - Activity queued (includes input, timeouts)
- `ActivityTaskStarted` - Worker picked up activity (NOT written until completion to avoid retry pollution)
- `ActivityTaskCompleted` - Activity succeeded (includes output)
- `ActivityTaskFailed` - Activity failed (includes error)
- `ActivityTaskTimedOut` - Activity timed out
- `ActivityTaskCancelRequested` - Cancellation requested
- `ActivityTaskCanceled` - Activity canceled

**Timers:**
- `TimerStarted` - Timer scheduled (includes duration)
- `TimerFired` - Timer elapsed
- `TimerCanceled` - Timer cancelled

**Child Workflows:**
- `StartChildWorkflowExecutionInitiated`
- `StartChildWorkflowExecutionFailed`
- `ChildWorkflowExecutionStarted`
- `ChildWorkflowExecutionCompleted`
- `ChildWorkflowExecutionFailed`
- `ChildWorkflowExecutionCanceled`
- `ChildWorkflowExecutionTimedOut`
- `ChildWorkflowExecutionTerminated`

**Signals & Updates:**
- `WorkflowExecutionSignaled` - Signal delivered
- `WorkflowExecutionUpdateAccepted` - Update started
- `WorkflowExecutionUpdateCompleted` - Update finished

**Markers (for determinism):**
- `MarkerRecorded` - Side effect, version, etc.

#### The Replay Algorithm

1. Worker receives Workflow Task from server
2. Worker downloads Event History (or uses sticky cache)
3. Worker re-executes workflow code from the beginning
4. For each workflow operation (activity call, timer, etc.):
   - Check if corresponding event exists in history
   - If yes: return the recorded result (skip actual execution)
   - If no: this is new work, generate a Command
5. Compare generated Commands against expected Events
6. If mismatch: **Non-Determinism Error** - workflow code changed incompatibly
7. Send new Commands to server for recording

#### History Limits & Archival

From [Temporal Workflow Limits](https://docs.temporal.io/workflow-execution/limits):

| Limit | Warning | Error |
|-------|---------|-------|
| Event Count | 10,240 | 51,200 |
| History Size | 10 MB | 50 MB |
| Concurrent Activities | - | 2,000 |
| Concurrent Child Workflows | - | 2,000 |

When limits approach, use **Continue-As-New** to atomically:
1. Complete current workflow
2. Start new workflow with same ID, fresh history
3. Pass state via arguments

### How to Replicate on Cloudflare

#### Storage Options

| Option | Pros | Cons |
|--------|------|------|
| **Durable Object Storage** | <1ms latency, 128KB/key, transactional | 1MB total soft limit |
| **R2** | Unlimited size, cheap, append-friendly | Higher latency (~50ms), no transactions |
| **D1** | SQL queries, indexed, good for list/search | Higher latency (~10ms), 10MB row limit |
| **KV** | Fast reads, 25MB values | Eventual consistency, no transactions |

**Recommended: Hybrid Approach**

```
Hot Path (DO Storage):
  - Recent events (last N or last 100KB)
  - Workflow metadata
  - Sticky execution state

Cold Path (R2):
  - Full history (append-only log)
  - Archived/completed workflows
  - History > DO limits

Index (D1):
  - Workflow queries
  - Search by status/type/time
  - Event count tracking
```

#### Proposed Event Schema

```typescript
interface HistoryEvent {
  eventId: number           // Monotonic, 1-indexed
  eventType: EventType      // From list above
  eventTime: number         // Unix timestamp ms
  workflowId: string
  runId: string

  // Type-specific attributes (union)
  attributes:
    | ActivityTaskScheduledAttributes
    | ActivityTaskCompletedAttributes
    | TimerStartedAttributes
    | TimerFiredAttributes
    // ... etc
}

interface ActivityTaskScheduledAttributes {
  activityId: string
  activityType: string
  taskQueue: string
  input: unknown            // Serialized args
  scheduleToCloseTimeout: number
  scheduleToStartTimeout: number
  startToCloseTimeout: number
  heartbeatTimeout: number
  retryPolicy?: RetryPolicy
}

interface ActivityTaskCompletedAttributes {
  scheduledEventId: number  // Links to scheduled event
  startedEventId: number    // Links to started event
  result: unknown           // Serialized result
}
```

#### Implementation Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Workflow DO Instance                      │
├─────────────────────────────────────────────────────────────┤
│  HistoryManager                                             │
│  ├─ append(event): Promise<eventId>                         │
│  ├─ getHistory(startEventId?): AsyncIterable<HistoryEvent>  │
│  ├─ getLastEventId(): number                                │
│  ├─ shouldContinueAsNew(): boolean                          │
│  └─ archive(): Promise<void>                                │
│                                                             │
│  ReplayEngine                                               │
│  ├─ replay(workflowFn, history): Promise<Commands>          │
│  ├─ validateDeterminism(expected, actual): void             │
│  └─ getEventResult(eventType, attributes): unknown | null   │
│                                                             │
│  WorkflowExecutor                                           │
│  ├─ execute(args): Promise<result>                          │
│  ├─ signal(name, args): Promise<void>                       │
│  └─ query(name, args): result                               │
└─────────────────────────────────────────────────────────────┘
         │                    │
         │ Hot Events         │ Cold History
         ▼                    ▼
┌─────────────────┐  ┌─────────────────┐
│   DO Storage    │  │       R2        │
│   (recent)      │  │  (full log)     │
└─────────────────┘  └─────────────────┘
```

#### Replay Implementation

```typescript
class ReplayEngine {
  private historyIndex = 0
  private history: HistoryEvent[]

  async scheduleActivity(
    activityType: string,
    args: unknown[],
    options: ActivityOptions
  ): Promise<unknown> {
    // Look for matching scheduled event in history
    const scheduledEvent = this.findNextEvent('ActivityTaskScheduled', {
      activityType,
      // Note: Don't match on args - they should be identical due to determinism
    })

    if (scheduledEvent) {
      // Replay mode - find completion event
      const completedEvent = this.findEventByScheduledId(
        'ActivityTaskCompleted',
        scheduledEvent.eventId
      )

      if (completedEvent) {
        // Already completed - return recorded result
        return completedEvent.attributes.result
      }

      const failedEvent = this.findEventByScheduledId(
        'ActivityTaskFailed',
        scheduledEvent.eventId
      )

      if (failedEvent) {
        // Already failed - throw recorded error
        throw deserializeError(failedEvent.attributes.failure)
      }

      // Activity was scheduled but not completed - still in progress
      // This can happen if worker crashed mid-activity
      throw new ActivityNotCompletedError(scheduledEvent.eventId)
    }

    // New activity - generate command (will be recorded after execution)
    return this.generateCommand({
      type: 'ScheduleActivityTask',
      attributes: {
        activityType,
        input: args,
        ...options
      }
    })
  }
}
```

#### Critical: Non-Determinism Detection

```typescript
function validateReplayDeterminism(
  expectedEvent: HistoryEvent,
  actualCommand: Command
): void {
  // Map command types to expected event types
  const expectedEventType = commandToEventType(actualCommand.type)

  if (expectedEvent.eventType !== expectedEventType) {
    throw new NonDeterministicError(
      `Workflow code changed: expected ${expectedEvent.eventType} ` +
      `but got ${actualCommand.type}. ` +
      `This usually means the workflow code was modified in a ` +
      `non-backward-compatible way.`
    )
  }

  // Validate attributes match (for determinism-critical fields)
  validateAttributes(expectedEvent.attributes, actualCommand.attributes)
}
```

---

## Part 2: Activity Worker Routing

### How Temporal Does It

Temporal separates workflow and activity execution into distinct processes:

#### Task Queue Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Temporal Server                           │
├─────────────────────────────────────────────────────────────┤
│  Task Queue: "order-processing"                             │
│  ├─ Workflow Tasks: [WFT-1, WFT-2, ...]                     │
│  └─ Activity Tasks: [AT-1, AT-2, AT-3, ...]                 │
│                                                             │
│  Task Queue: "payment-activities"                           │
│  └─ Activity Tasks: [AT-4, AT-5, ...]                       │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐          ┌─────────────────┐
│  Worker Pool A  │          │  Worker Pool B  │
│  (order-proc)   │          │  (payment)      │
│  - WF + Activity│          │  - Activity only│
│  - 10 instances │          │  - 5 instances  │
└─────────────────┘          └─────────────────┘
```

#### Long Polling

Workers don't get pushed tasks - they **poll**:

1. Worker calls `PollActivityTaskQueue(taskQueue, timeout=30s)`
2. Server blocks until task available or timeout
3. Worker receives task with:
   - Activity type & input
   - Timeouts
   - Retry state
   - Heartbeat token
4. Worker executes activity
5. Worker reports result via `RespondActivityTaskCompleted`

#### Activity Heartbeating

For long-running activities (>10 seconds recommended):

```typescript
// Activity implementation
async function processLargeFile(ctx: ActivityContext, fileUrl: string) {
  const file = await downloadFile(fileUrl)

  for (let i = 0; i < file.chunks.length; i++) {
    await processChunk(file.chunks[i])

    // Report progress - server knows we're alive
    ctx.heartbeat({ progress: i / file.chunks.length })

    // Check if we should stop (workflow cancelled)
    if (ctx.cancelled) {
      throw new CancellationError()
    }
  }

  return { processed: file.chunks.length }
}
```

If heartbeat not received within `heartbeatTimeout`:
1. Server marks activity as failed
2. Workflow gets `ActivityTaskTimedOut` with `timeoutType: HEARTBEAT`
3. Retry policy kicks in (if configured)

#### Timeout Types (Critical!)

| Timeout | What it means | Default |
|---------|---------------|---------|
| `scheduleToCloseTimeout` | Total time from scheduling to completion (including retries) | Required (or startToClose) |
| `scheduleToStartTimeout` | Time waiting for a worker to pick up the task | Unlimited |
| `startToCloseTimeout` | Time for single attempt execution | scheduleToCloseTimeout |
| `heartbeatTimeout` | Max time between heartbeats | None (no heartbeat required) |

**Critical Semantic:** If no worker is polling the task queue, `scheduleToStartTimeout` will eventually fire. This is how Temporal detects "no workers available".

### How to Replicate on Cloudflare

#### Option A: Durable Object Per Task Queue

```
┌─────────────────────────────────────────────────────────────┐
│                TaskQueueDO("order-processing")               │
├─────────────────────────────────────────────────────────────┤
│  Pending Activity Tasks (DO Storage)                        │
│  ├─ AT-1: {type: "sendEmail", input: [...], timeouts: ...}  │
│  ├─ AT-2: {type: "chargeCard", input: [...], timeouts: ...} │
│  └─ AT-3: {type: "updateInventory", ...}                    │
│                                                             │
│  Active Heartbeats                                          │
│  ├─ AT-1: {workerToken: "w-123", lastBeat: 1704844800000}   │
│  └─ AT-2: {workerToken: "w-456", lastBeat: 1704844799000}   │
│                                                             │
│  Timeout Alarms (DO Alarm API)                              │
│  └─ Next: AT-3 scheduleToStart at 1704844810000             │
└─────────────────────────────────────────────────────────────┘
         │
         │ WebSocket or Long-Poll HTTP
         ▼
┌─────────────────┐
│  Activity Worker│
│  (CF Worker)    │
│  - Polls queue  │
│  - Executes     │
│  - Heartbeats   │
└─────────────────┘
```

#### Option B: Cloudflare Queues

```typescript
// Producer (Workflow DO)
await env.ACTIVITY_QUEUE.send({
  taskId: 'at-123',
  workflowId: 'wf-456',
  activityType: 'sendEmail',
  input: [recipient, subject, body],
  timeouts: { startToClose: 30000 },
})

// Consumer (Activity Worker)
export default {
  async queue(batch: MessageBatch, env: Env) {
    for (const message of batch.messages) {
      const task = message.body as ActivityTask
      try {
        const result = await executeActivity(task)
        await reportCompletion(env, task.workflowId, task.taskId, result)
        message.ack()
      } catch (error) {
        await reportFailure(env, task.workflowId, task.taskId, error)
        message.retry() // Will retry per queue config
      }
    }
  }
}
```

**Cloudflare Queues Limitations:**
- No true long-polling (batch delivery)
- Max 12 retries
- No built-in heartbeat mechanism
- No schedule-to-start timeout

#### Recommended: Hybrid DO + Queue Approach

```typescript
// TaskQueueDO manages state, Queues handle delivery

class TaskQueueDO {
  private pendingTasks = new Map<string, ActivityTask>()
  private activeHeartbeats = new Map<string, HeartbeatState>()

  // Called by workflow to schedule activity
  async scheduleActivity(task: ActivityTask): Promise<void> {
    // 1. Persist task
    await this.storage.put(`task:${task.id}`, task)
    this.pendingTasks.set(task.id, task)

    // 2. Set timeout alarm
    await this.updateTimeoutAlarm()

    // 3. Enqueue for worker pickup
    await this.env.ACTIVITY_QUEUE.send({
      taskQueueDO: this.id,
      taskId: task.id,
    })
  }

  // Called by worker to start activity
  async startActivity(taskId: string, workerToken: string): Promise<ActivityTask> {
    const task = await this.storage.get<ActivityTask>(`task:${taskId}`)
    if (!task) throw new TaskNotFoundError(taskId)

    // Record start
    task.startedAt = Date.now()
    await this.storage.put(`task:${taskId}`, task)

    // Start heartbeat tracking
    this.activeHeartbeats.set(taskId, {
      workerToken,
      lastBeat: Date.now(),
    })

    // Update alarms for heartbeat timeout
    await this.updateTimeoutAlarm()

    return task
  }

  // Called by worker during long-running activity
  async heartbeat(taskId: string, workerToken: string, details?: unknown): Promise<void> {
    const heartbeat = this.activeHeartbeats.get(taskId)
    if (!heartbeat || heartbeat.workerToken !== workerToken) {
      throw new InvalidHeartbeatError(taskId)
    }

    heartbeat.lastBeat = Date.now()
    heartbeat.details = details

    // Check if workflow was cancelled
    const task = await this.storage.get<ActivityTask>(`task:${taskId}`)
    if (task?.cancelRequested) {
      throw new ActivityCancellationError(taskId)
    }
  }

  // Called by worker on completion
  async completeActivity(
    taskId: string,
    workerToken: string,
    result: unknown
  ): Promise<void> {
    // Validate this worker owns the task
    const heartbeat = this.activeHeartbeats.get(taskId)
    if (!heartbeat || heartbeat.workerToken !== workerToken) {
      throw new InvalidCompletionError(taskId)
    }

    // Clean up
    await this.storage.delete(`task:${taskId}`)
    this.pendingTasks.delete(taskId)
    this.activeHeartbeats.delete(taskId)

    // Notify workflow DO
    const task = await this.storage.get<ActivityTask>(`task:${taskId}`)
    const workflowDO = this.env.WORKFLOW_DO.get(
      this.env.WORKFLOW_DO.idFromName(task!.workflowId)
    )
    await workflowDO.activityCompleted(taskId, result)
  }

  // DO alarm handler - process timeouts
  async alarm(): Promise<void> {
    const now = Date.now()

    for (const [taskId, task] of this.pendingTasks) {
      // Check schedule-to-start timeout
      if (!task.startedAt && task.scheduleToStartTimeout) {
        if (now - task.scheduledAt > task.scheduleToStartTimeout) {
          await this.timeoutActivity(taskId, 'SCHEDULE_TO_START')
          continue
        }
      }

      // Check start-to-close timeout
      if (task.startedAt && task.startToCloseTimeout) {
        if (now - task.startedAt > task.startToCloseTimeout) {
          await this.timeoutActivity(taskId, 'START_TO_CLOSE')
          continue
        }
      }

      // Check heartbeat timeout
      if (task.heartbeatTimeout) {
        const heartbeat = this.activeHeartbeats.get(taskId)
        if (heartbeat && now - heartbeat.lastBeat > task.heartbeatTimeout) {
          await this.timeoutActivity(taskId, 'HEARTBEAT')
          continue
        }
      }
    }

    await this.updateTimeoutAlarm()
  }
}
```

---

## Part 3: Semantic Gaps Analysis

### MUST Have (Temporal Core Semantics)

| Feature | Current State | Required For |
|---------|---------------|--------------|
| Event history persistence | Missing | Replay, Durability |
| Replay algorithm | Missing | Crash recovery |
| Non-determinism detection | Partial (warnings) | Migration safety |
| Activity task queues | Inline execution | Scalability |
| Heartbeat timeout | Not implemented | Long-running activities |
| Schedule-to-start timeout | Not implemented | Worker availability |
| Start-to-close timeout | Partially (via retry) | Activity execution limits |
| Activity retry with backoff | Via runtime | Fault tolerance |
| Timer persistence | Via sleep() | Durable delays |
| Signal delivery | In-memory handlers | External communication |
| Continue-As-New | Throws error, not implemented | Long-running workflows |

### Should Have (Important for Parity)

| Feature | Current State | Notes |
|---------|---------------|-------|
| Workflow Task batching | Not implemented | Performance |
| Sticky execution | Not implemented | Replay optimization |
| History archival | Not implemented | Compliance, debugging |
| Workflow versioning (patched) | Basic implementation | Code evolution |
| Search attributes (indexed) | In-memory only | Visibility |
| Workflow queries | Basic implementation | Observability |

### Nice to Have (Advanced Features)

| Feature | Current State | Notes |
|---------|---------------|-------|
| Activity sessions | Not implemented | Worker affinity |
| Cron workflows | Not implemented | Scheduling |
| Nexus task queues | Not implemented | Cross-namespace |
| Data converter | Pass-through | Encryption, compression |
| Interceptors | Not implemented | Cross-cutting concerns |

### Migration Blockers

For a user to literally copy Temporal code:

1. **History tracking** - Without this, no crash recovery
2. **Determinism enforcement** - Non-deterministic code fails on replay
3. **Activity routing** - Activities block workflows if inline
4. **Timeout semantics** - Different timeout behavior = different failure modes
5. **Continue-As-New** - Long-running workflows will hit limits

---

## Part 4: Complexity Estimate

### Why This Is Hard

#### 1. Distributed State Consistency

Temporal's server is a distributed system with consensus. We're mapping to:
- Single DO instance per workflow (simpler but different failure modes)
- Separate DO per task queue (coordination required)
- R2 for archival (eventually consistent)

**Complexity:** Ensuring exactly-once semantics for activity completion when:
- Worker completes activity
- Completion message to workflow DO
- DO might have restarted
- Need idempotency tokens

**Estimated effort:** 2-3 weeks for core, 1-2 weeks for edge cases

#### 2. Replay Engine

Building a correct replay engine requires:
- Matching event indices precisely
- Handling partial progress (activity scheduled but not completed)
- Detecting non-determinism
- Supporting workflow code changes (versioning)

**Complexity:** The replay algorithm has subtle edge cases:
- What if activity was scheduled twice due to retry?
- What if timer duration changed between versions?
- What if signal arrived during replay?

**Estimated effort:** 3-4 weeks

#### 3. Activity Worker Infrastructure

Options and tradeoffs:

| Approach | Effort | Fidelity | Scalability |
|----------|--------|----------|-------------|
| CF Queues only | 1 week | Low | Medium |
| DO-based polling | 3 weeks | High | High |
| Hybrid | 4 weeks | High | High |

**Estimated effort:** 3-4 weeks for full fidelity

#### 4. Timeout State Machines

Each activity has 4 timeout types that can fire at different times:
- scheduleToClose (absolute)
- scheduleToStart (if not started)
- startToClose (if started)
- heartbeat (recurring)

Plus interactions with:
- Retries (reset timeouts)
- Cancellation (stop timeouts)
- Workflow termination (cleanup)

**Estimated effort:** 2 weeks

### Total Estimate

| Component | Weeks | Risk |
|-----------|-------|------|
| History storage (DO + R2) | 2 | Low |
| Event schema & serialization | 1 | Low |
| Replay engine | 4 | High |
| Activity task queue DO | 3 | Medium |
| Worker polling/heartbeat | 2 | Medium |
| Timeout handling | 2 | Medium |
| Continue-As-New | 1 | Low |
| Integration & testing | 3 | Medium |
| **Total** | **18 weeks** | |

**Reduced scope option:** 10 weeks for MVP without:
- R2 archival
- Sticky execution
- Full timeout matrix
- Worker affinity

---

## Part 5: Migration Compatibility

### Can Users Literally Copy Temporal Code?

**Today: No**

```typescript
// This Temporal code WILL NOT work correctly today:
import { proxyActivities, sleep, condition } from '@dotdo/temporal'

const { sendEmail } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
})

export async function orderWorkflow(orderId: string) {
  // Problem 1: No history - if workflow restarts, starts from scratch
  await sendEmail(orderId, 'Order received')

  // Problem 2: Activity runs inline - blocks workflow
  // Problem 3: Timeout is advisory only

  await sleep('7 days')  // Problem 4: If DO hibernates, might not wake

  // Problem 5: Condition polling in-memory only
  await condition(() => isApproved, '30 days')
}
```

### After Implementation: Mostly Yes

With this design implemented:

```typescript
// This WILL work:
import { proxyActivities, sleep, condition, defineSignal, setHandler } from '@dotdo/temporal'

const { sendEmail, chargeCard } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 3 },
})

export async function orderWorkflow(orderId: string) {
  // History tracked - survives restart
  await sendEmail(orderId, 'Order received')

  // Activity routed to worker pool
  // Timeout enforced by task queue DO

  // Signal handling works via DO storage
  const approved = defineSignal('approved')
  let isApproved = false
  setHandler(approved, () => { isApproved = true })

  // Sleep persisted - DO alarm wakes it
  await sleep('7 days')

  // Condition polls until signal or timeout
  const gotApproval = await condition(() => isApproved, '30 days')

  if (gotApproval) {
    await chargeCard(orderId)
  }
}
```

### Remaining Gaps After Implementation

| Feature | Temporal | dotdo | Workaround |
|---------|----------|-------|------------|
| Activity cancellation | Full support | Basic | Use heartbeat details |
| Workflow queries | Synchronous | Async | Accept Promise |
| Update handlers | Sync validation | None | Validate in signal |
| Local activities | Same-worker | Same-DO | Use try() |
| Worker sessions | Built-in | Manual | Explicit task queue |

---

## Recommendations

### Phase 1: Foundation (6 weeks)

1. Implement `HistoryManager` with DO storage
2. Implement basic `ReplayEngine`
3. Add history events for activities, timers, signals
4. Enforce determinism at runtime (not just warnings)

### Phase 2: Activities (4 weeks)

1. Implement `TaskQueueDO`
2. Add heartbeat mechanism
3. Implement timeout state machine
4. Worker polling via Durable Object WebSocket

### Phase 3: Polish (4 weeks)

1. Continue-As-New implementation
2. R2 archival for large histories
3. Sticky execution optimization
4. Search attribute indexing

### Phase 4: Migration Tools (2 weeks)

1. History import from Temporal
2. Compatibility test suite
3. Migration guide documentation

---

## Sources

- [Events and Event History](https://docs.temporal.io/workflow-execution/event)
- [Temporal Events Reference](https://docs.temporal.io/references/events)
- [Event History Encyclopedia](https://docs.temporal.io/encyclopedia/event-history)
- [Activity Timeouts Blog](https://temporal.io/blog/activity-timeouts)
- [Detecting Activity Failures](https://docs.temporal.io/encyclopedia/detecting-activity-failures)
- [Task Queues](https://docs.temporal.io/task-queue)
- [Worker Performance](https://docs.temporal.io/develop/worker-performance)
- [Sticky Execution](https://docs.temporal.io/sticky-execution)
- [Workflow Execution Limits](https://docs.temporal.io/workflow-execution/limits)
- [Managing Long-Running Workflows](https://temporal.io/blog/very-long-running-workflows)
