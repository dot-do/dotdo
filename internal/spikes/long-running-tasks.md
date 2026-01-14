# Long-Running Task Coordination (>30s)

**Issue:** dotdo-ff8iu
**Date:** 2026-01-13
**Author:** Research Spike

## Executive Summary

This spike investigates coordination strategies for long-running tasks (>30s) in the Durable Objects model. Key findings:

- **CPU time is the constraint, not wall clock** - Workers/DOs can run indefinitely waiting on I/O
- **CPU limits are now configurable up to 5 minutes** per invocation via `limits.cpu_ms`
- **Cloudflare Workflows provide native solution** for durable multi-step execution
- **Existing codebase has solid foundations** - step persistence, retry policies, alarm-based scheduling
- **Recommended strategy:** Hybrid approach using CF Workflows for long/sleeping tasks, DOs for real-time

## Cloudflare Workers/DO Limits

### CPU Time Limits (The Real Constraint)

| Plan | Default | Max Configurable | Notes |
|------|---------|------------------|-------|
| Free | 10 ms | 10 ms | Minimal compute |
| Paid | 30 s | 5 minutes | Configure via `limits.cpu_ms` |
| Cron Triggers | 30 s / 15 min | - | Depends on interval |
| DO Alarm | Same as DO | 5 minutes | Configured per DO class |

**Configuration (wrangler.toml):**
```toml
[limits]
cpu_ms = 300000  # 5 minutes in milliseconds
```

### Wall Clock Duration (Not a Limit)

| Invocation Type | Wall Clock Limit |
|-----------------|------------------|
| HTTP Request | **Unlimited** (until client disconnects) |
| DO RPC | **Unlimited** (while caller connected) |
| WebSocket | **Unlimited** (while connected) |
| Cron Trigger | 15 minutes |
| DO Alarm | 15 minutes |
| Workflows (outside step) | 30 minutes |
| Workflows (inside step) | Unlimited (default 5 min) |

**Key Insight:** CPU time measures actual processing work. Waiting on fetch(), storage calls, or I/O does NOT count. Most Workers use <1-2ms of CPU time.

### Durable Objects Specific Behavior

- Each incoming HTTP request or WebSocket message **resets CPU time to 30s**
- If consuming >30s CPU between network requests, heightened eviction risk
- No hard limit on duration - DO can live indefinitely with activity
- SQLite storage: 10 GB per DO, 2 MB per key/value

## Existing Codebase Analysis

### WorkflowRuntime (`objects/WorkflowRuntime.ts`)

Current implementation provides:

```typescript
// Step registration with timeout and retry support
registerStep(name: string, handler: Function, config?: WorkflowStepConfig)

interface WorkflowStepConfig {
  timeout?: string | number    // Per-step timeout
  retries?: number            // Retry count
  retryDelay?: string | number // Delay between retries
  modifiers?: Modifier[]      // Input/output transformation
}
```

**Capabilities:**
- State machine: pending -> running -> paused -> completed/failed
- Step-level persistence to DO storage
- Retry logic with configurable backoff
- Parallel step execution via `ParallelStepExecutor`
- Event-driven pauses via `WaitForEventManager`
- DO storage persistence across hibernation

### DurableWorkflowRuntime (`workflows/runtime.ts`)

Three execution modes:

| Mode | Durability | Blocking | Retries | Use Case |
|------|-----------|----------|---------|----------|
| `$.send` | None | No | No | Fire-and-forget events |
| `$.try` | None | Yes | No | Quick, non-critical operations |
| `$.do` | Full | Yes | Yes | Durable, retriable work |

```typescript
// Step result persistence
interface StepResult {
  stepId: string
  status: 'pending' | 'completed' | 'failed'
  result?: unknown
  error?: string
  attempts: number
  createdAt: number
  completedAt?: number
}
```

### CFWorkflowsBackend (`workflows/compat/backends/cloudflare-workflows.ts`)

Native CF Workflows integration already exists:

```typescript
// CF Workflows is 100-1000x cheaper than pure DO for background jobs
// because you only pay for CPU time, not wall-clock duration.

async step<T>(name: string, fn: () => T, options?: StepOptions): Promise<T>
async sleep(name: string, duration: string): Promise<void>
async waitForEvent<T>(name: string, options?: WaitForEventOptions): Promise<T | null>
```

**HybridWorkflowBackend** already implements automatic backend selection:
- CF Workflows for: long sleeps, waitForEvent, batch processing
- DO for: real-time requirements, frequent state access, WebSocket

### Alarm-Based Scheduling

`ScheduleManager` and `WaitForEventManager` both use DO alarms:

```typescript
// Set alarm for next scheduled time
await this.storage.setAlarm(nextRunAt)

// Handle alarm in DO
async alarm(): Promise<void> {
  await this._scheduleManager.handleAlarm()
}
```

## Cloudflare Workflows Deep Dive

### Architecture

CF Workflows is a durable execution engine using:
- Durable Objects for state persistence
- `scheduler.wait()` + DO alarms for sleeping
- SQLite for strongly consistent state transitions
- Automatic retry with exponential backoff

### Limits (Workflows-Specific)

| Limit | Free | Paid |
|-------|------|------|
| Max steps per workflow | 1024 | 1024 |
| CPU time per step | 10 ms | 30 s (up to 5 min) |
| State per step | 1 MiB | 1 MiB |
| Total state per instance | 100 MB | 1 GB |
| Concurrent instances | 25 | 10,000 |
| Max sleep duration | 365 days | 365 days |
| Instance retention | 3 days | 30 days |

### Rules of Workflows

1. **Determinism Required:**
   - Step names must be deterministic (no random, no timestamps)
   - Conditions must use event payload or step returns only
   - Non-deterministic code belongs inside `step.do()`

2. **State Management:**
   - State persists ONLY via step returns
   - Variables outside steps lost on hibernation
   - Event payload is immutable

3. **Idempotency:**
   - Steps may execute multiple times (retries)
   - Check preconditions before non-idempotent operations
   - Design for at-least-once delivery

4. **Promise Handling:**
   - Always `await step.do()` and `step.sleep()`
   - Unawaited promises create race conditions
   - Wrap `Promise.race()`/`Promise.any()` in `step.do()`

## Coordination Strategies for Long-Running Tasks

### Strategy 1: Chunked Execution (DO-Native)

Break long tasks into chunks that complete within CPU limits:

```typescript
interface ChunkedTaskState {
  taskId: string
  totalItems: number
  processedItems: number
  checkpoint: unknown  // Last processed position
  startedAt: number
  estimatedCompletion: number
}

async processChunk(state: ChunkedTaskState): Promise<ChunkedTaskState> {
  const CHUNK_SIZE = 100
  const CHUNK_TIMEOUT_MS = 20000  // 20s of CPU, leave 10s buffer

  const startCpu = performance.now()
  let processed = 0

  while (processed < CHUNK_SIZE) {
    if (performance.now() - startCpu > CHUNK_TIMEOUT_MS) {
      // Save checkpoint and schedule continuation
      break
    }

    await processItem(state.checkpoint + processed)
    processed++
  }

  return {
    ...state,
    processedItems: state.processedItems + processed,
    checkpoint: state.checkpoint + processed,
  }
}

// Schedule next chunk via alarm
async scheduleNextChunk(state: ChunkedTaskState) {
  if (state.processedItems < state.totalItems) {
    await this.storage.put('chunked-task', state)
    await this.storage.setAlarm(Date.now() + 100)  // Immediate continuation
  }
}
```

**Pros:**
- Works within existing DO infrastructure
- Full control over checkpointing
- No additional service dependency

**Cons:**
- Complex state management
- Must handle edge cases (resumption, failures)
- Pay for wall-clock time during waits

### Strategy 2: Cloudflare Workflows (Recommended for New Code)

Use native CF Workflows for durable execution:

```typescript
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'

export class ProcessingWorkflow extends WorkflowEntrypoint {
  async run(event: WorkflowEvent<{ items: string[] }>, step: WorkflowStep) {
    const items = event.payload.items

    // Process each item as a separate step (individually retriable)
    for (let i = 0; i < items.length; i++) {
      await step.do(`process-item-${i}`, async () => {
        return await this.env.PROCESSOR.processItem(items[i])
      })

      // Optional: rate limiting between items
      if (i % 100 === 99) {
        await step.sleep('rate-limit-pause', '1 second')
      }
    }

    // Wait for external approval (FREE while waiting)
    const approval = await step.waitForEvent('manager-approval', { timeout: '24 hours' })

    // Continue based on approval
    return approval ? 'completed' : 'rejected'
  }
}
```

**Pros:**
- Native durable execution
- FREE while sleeping/waiting (no wall-clock billing)
- Automatic retry with backoff
- Built-in observability
- Step-level persistence

**Cons:**
- Additional service to manage
- 1024 step limit per workflow
- 1 MiB state limit per step

### Strategy 3: Hybrid DO + Workflows (Best of Both)

Use existing `HybridWorkflowBackend` pattern:

```typescript
// In DO, delegate to CF Workflows for long-running tasks
async handleLongTask(input: TaskInput) {
  if (this.estimatedDuration(input) > 30_000) {
    // Offload to CF Workflows
    const workflow = await this.env.LONG_TASK_WORKFLOW.create({
      params: input,
      id: `task-${input.id}`,
    })
    return { workflowId: workflow.id, status: 'processing' }
  } else {
    // Execute in-DO for quick tasks
    return await this.executeTask(input)
  }
}
```

**Decision Matrix:**

| Task Type | Duration | Recommendation |
|-----------|----------|----------------|
| Data transformation | <30s CPU | Execute in DO |
| Batch processing | Variable | CF Workflows with per-item steps |
| Long waits (approval) | Hours/days | CF Workflows (free while waiting) |
| Real-time response | <100ms | DO with WebSocket |
| Complex DAG | Multi-step | CF Workflows |

### Strategy 4: Extended CPU Limits

For compute-intensive tasks, configure higher CPU limits:

```toml
# wrangler.toml
[durable_objects]
[[durable_objects.bindings]]
name = "HEAVY_COMPUTE"
class_name = "HeavyComputeDO"

[[durable_objects.classes]]
name = "HeavyComputeDO"
limits = { cpu_ms = 300000 }  # 5 minutes
```

**Use Cases:**
- Cryptographic hashing of large files
- Complex data aggregations
- ML inference (within limits)

**Constraints:**
- Still limited to 5 minutes max
- Higher cost (pay per GB-second)
- Should be last resort, not first choice

## Progress Tracking and Resumption

### Progress Storage Schema

```typescript
interface TaskProgress {
  taskId: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'

  // Progress metrics
  totalUnits: number
  completedUnits: number
  percentComplete: number

  // Timing
  startedAt: number
  lastUpdatedAt: number
  estimatedCompletionAt?: number
  completedAt?: number

  // Checkpointing
  checkpointVersion: number
  checkpoint: unknown  // Serialized state for resumption

  // Error tracking
  lastError?: {
    message: string
    stack?: string
    occurredAt: number
    retryCount: number
  }
}
```

### Resumption Patterns

**Pattern 1: Cursor-Based Resumption**

```typescript
interface CursorCheckpoint {
  cursor: string | number  // Position marker
  processedCount: number
  lastProcessedId: string
}

async resumeFromCheckpoint(checkpoint: CursorCheckpoint) {
  const remaining = await this.db.query(
    'SELECT * FROM items WHERE id > ? ORDER BY id LIMIT 1000',
    [checkpoint.lastProcessedId]
  )
  // Continue processing...
}
```

**Pattern 2: Idempotency Keys**

```typescript
async processWithIdempotency(items: Item[]) {
  for (const item of items) {
    const key = `processed:${item.id}`

    if (await this.storage.get(key)) {
      continue  // Already processed
    }

    await this.processItem(item)
    await this.storage.put(key, { processedAt: Date.now() })
  }
}
```

**Pattern 3: Saga Pattern for Compensations**

```typescript
interface SagaStep {
  name: string
  execute: () => Promise<unknown>
  compensate: (result: unknown) => Promise<void>
}

async executeSaga(steps: SagaStep[]) {
  const completedSteps: { step: SagaStep; result: unknown }[] = []

  try {
    for (const step of steps) {
      const result = await step.execute()
      completedSteps.push({ step, result })
    }
  } catch (error) {
    // Compensate in reverse order
    for (const { step, result } of completedSteps.reverse()) {
      await step.compensate(result)
    }
    throw error
  }
}
```

## Recommendations

### For New Development

1. **Default to Cloudflare Workflows** for any task that:
   - May exceed 30 seconds CPU time
   - Involves waiting (human approval, external webhooks)
   - Requires guaranteed completion
   - Benefits from per-step observability

2. **Use existing `HybridWorkflowBackend`** which already implements optimal routing

3. **Design for idempotency** from the start - assume steps may execute multiple times

### For Existing Code

1. **Audit long-running handlers** - identify any that may exceed CPU limits

2. **Refactor into steps** - break monolithic operations into discrete, retriable units

3. **Add progress tracking** - implement `TaskProgress` schema for visibility

4. **Consider CPU limit increases** as short-term fix while refactoring

### Implementation Priority

| Priority | Action | Effort | Impact |
|----------|--------|--------|--------|
| P0 | Audit existing workflows for CPU-heavy operations | Low | High |
| P0 | Configure `cpu_ms = 300000` for known heavy DOs | Low | Immediate |
| P1 | Add progress tracking to batch operations | Medium | High |
| P1 | Implement cursor-based resumption in processors | Medium | High |
| P2 | Migrate batch processing to CF Workflows | Medium | High |
| P2 | Add observability for long-running tasks | Medium | Medium |

### Test Plan for Spike Validation

1. **Execute 5-minute task across multiple invocations:**
   ```typescript
   // Test chunked execution
   await testChunkedExecution({
     totalItems: 10000,
     chunkSize: 100,
     processingTimePerItem: 10,  // ms
   })
   ```

2. **Verify progress preservation:**
   - Kill DO mid-execution
   - Restore and verify checkpoint integrity
   - Resume from last checkpoint

3. **Measure overhead:**
   - Checkpointing latency
   - Storage costs
   - Cold start impact

## Sources

- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Run Workers for up to 5 minutes of CPU-time](https://developers.cloudflare.com/changelog/2025-03-25-higher-cpu-limits/)
- [Cloudflare Workflows Overview](https://developers.cloudflare.com/workflows/)
- [Cloudflare Workflows Limits](https://developers.cloudflare.com/workflows/reference/limits/)
- [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [Sleeping and Retrying in Workflows](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
- [Workflows GA: Production-Ready Durable Execution](https://blog.cloudflare.com/workflows-ga-production-ready-durable-execution/)

## Conclusion

The dotdo codebase already has solid foundations for long-running task coordination:

1. **`HybridWorkflowBackend`** intelligently routes between DO and CF Workflows
2. **`WorkflowRuntime`** provides step persistence, retries, and state management
3. **`ScheduleManager` and `WaitForEventManager`** use DO alarms for scheduling

The primary recommendation is to:
- **Leverage CF Workflows** for tasks with long waits or many steps
- **Configure higher CPU limits** (`cpu_ms = 300000`) for compute-intensive DOs
- **Implement progress tracking** for visibility and resumption
- **Design all long operations for idempotency** from the start

This hybrid approach provides the best balance of cost efficiency (CF Workflows for waiting), latency (DO for real-time), and reliability (step-level durability).

---

## See Also

### Related Spikes

- [Cron Hibernation](./cron-hibernation.md) - Alarm-based scheduling for long-running coordination
- [Exactly-Once Hibernation](./exactly-once-hibernation.md) - Idempotency patterns for task resumption
- [Checkpoint Size Limits](./checkpoint-size-limits.md) - State persistence for chunked execution
- [Distributed Checkpoint Coordination](./distributed-checkpoint-coordination.md) - Multi-step task checkpointing

### Related Architecture Documents

- [Architecture Overview](../architecture.md) - Main architecture documentation
- [DOBase Decomposition](../architecture/dobase-decomposition.md) - ActionsModule for execution modes

### Spikes Index

- [All Spikes](./README.md) - Complete index of research spikes
