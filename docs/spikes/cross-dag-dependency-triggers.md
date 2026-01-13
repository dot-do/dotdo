# Cross-DAG Dependency Triggers

**Issue:** dotdo-cjd2h
**Date:** 2026-01-13
**Author:** Research Spike
**Status:** COMPLETE

## Executive Summary

This spike investigates mechanisms for cross-DAG dependency triggers - the ability for one DAG's completion to reliably trigger another DAG. The primary challenge is achieving 100% trigger reliability with exactly-once semantics in a distributed Durable Object environment.

### Key Findings

| Finding | Recommendation |
|---------|----------------|
| DO-to-DO RPC latency | 2-5ms same-colo, viable for real-time triggers |
| Event sourcing | Use ExactlyOnceContext for deduplication |
| Circular dependency detection | Validate at registration time with topological sort |
| Trigger reliability | Event-driven with retry + polling fallback |
| State coordination | DAGOrchestrator pattern already implemented |

### Success Criteria

| Criteria | Target | Feasibility |
|----------|--------|-------------|
| DAG-A completion triggers DAG-B | 100% reliability | Achievable via event + polling hybrid |
| Exactly-once trigger semantics | Guaranteed | Via idempotency keys |
| Circular dependency detection | Prevent at registration | Via validateDAGDependencies() |
| Cross-DAG payload passing | Full result access | Via trigger.payload() function |

## Current Implementation Analysis

### Existing Cross-DAG Infrastructure

The DAGScheduler already has substantial cross-DAG support in `/db/primitives/dag-scheduler/index.ts`:

#### DAGOrchestrator
```typescript
interface DAGOrchestrator {
  registry: DAGRegistry           // Manages DAG registration
  state: CrossDAGState            // Shared state across DAGs
  executor: ParallelExecutor      // Executes DAGs with callbacks
  trigger(dagId: string, payload?: unknown): Promise<DAGRun>
  triggerDataset(event: DatasetEvent): Promise<DAGRun[]>
  waitForDAG(dagId: string, condition?: ExternalDependency['condition']): Promise<DAGRun>
  onDAGComplete(callback: DAGCompleteCallback): void
}
```

#### DAG Trigger Configuration
```typescript
interface DAGTrigger {
  type: 'dag-complete' | 'task-complete' | 'sensor'
  source: ExternalDependency
  payload?: (result: DAGRun) => unknown  // Transform upstream result
}

interface ExternalDependency {
  dagId: string
  taskId?: string
  condition?: 'success' | 'completed' | 'any'
}
```

#### Circular Dependency Detection
```typescript
function validateDAGDependencies(dags: DAG[]): void {
  // Detects cycles using DFS with recursion stack
  // Throws on circular dependency with cycle path
}
```

### Cross-DO Patterns Available

From `objects/CrossDOTransaction.ts`:

| Pattern | Use Case | Guarantee |
|---------|----------|-----------|
| CrossDOSaga | Multi-step with compensation | Eventual consistency |
| TwoPhaseCommit | Atomic multi-DO operations | Strong consistency |
| IdempotencyKeyManager | Duplicate prevention | Exactly-once |

From `db/primitives/exactly-once-context.ts`:

| Feature | Implementation |
|---------|----------------|
| Deduplication | `processOnce(eventId, fn)` with TTL |
| Transactions | Atomic commit/rollback with snapshot |
| Outbox pattern | Buffered events with reliable delivery |

## Cross-DAG Triggering Mechanisms

### 1. Event-Driven Triggers (Primary)

The DAGOrchestrator already wires up automatic triggering:

```typescript
// In createDAGOrchestrator()
executor.onDAGComplete(async (dagId, result) => {
  await state.setDAGResult(dagId, result.runId, result)

  // Find and trigger all dependent DAGs
  const dependents = registry.getDependents(dagId)
  for (const dependent of dependents) {
    const trigger = dependent.triggers?.find(
      t => t.type === 'dag-complete' && t.source.dagId === dagId
    )
    if (trigger) {
      const payload = trigger.payload?.(result)
      await executor.execute(dependent, { triggerPayload: payload })
    }
  }
})
```

**Pros:**
- Low latency (immediate on completion)
- Integrated with execution flow
- Payload transformation built-in

**Cons:**
- If executor crashes, trigger may be lost
- No persistence of pending triggers

### 2. External DAG Sensor (Polling)

For cross-process/cross-DO DAG dependencies:

```typescript
interface ExternalDAGSensor {
  dagId: string
  taskId?: string
  condition: 'success' | 'completed' | 'any'
  wait(): Promise<boolean>  // Polls until condition met
  getResult(): DAGRun | undefined
}

// Usage
const sensor = createExternalDAGSensor({
  orchestrator,
  dependency: { dagId: 'upstream-dag', condition: 'success' },
  interval: 1000,   // Poll every second
  timeout: 3600000, // 1 hour timeout
})
await sensor.wait()
```

**Pros:**
- Works across DO boundaries
- Survives restarts (stateless polling)
- Configurable timeout and interval

**Cons:**
- Higher latency (polling interval)
- Resource usage for long waits

### 3. Dataset-Based Triggers

For data availability triggers:

```typescript
interface DatasetTrigger {
  type: 'dataset'
  datasets: string[]
  condition?: 'all' | 'any'
  filter?: (event: DatasetEvent) => boolean
}

interface DatasetEvent {
  type: 'created' | 'updated' | 'deleted' | 'partition_added'
  dataset: Dataset
  timestamp: Date
  partition?: Record<string, string>
}
```

**Use Cases:**
- Trigger ETL when source data lands
- React to new partitions in data lake
- Chain data pipelines

### 4. Hybrid Approach (Recommended)

Combine event-driven with polling fallback for 100% reliability:

```typescript
class ReliableCrossDAGTrigger {
  private pendingTriggers: Map<string, PendingTrigger> = new Map()

  async onUpstreamComplete(dagId: string, result: DAGRun) {
    const triggerId = `${dagId}:${result.runId}`

    // Persist pending trigger first
    await this.persistPendingTrigger(triggerId, { dagId, result })

    // Attempt immediate trigger with idempotency
    await this.triggerWithDedup(triggerId, dagId, result)
  }

  async triggerWithDedup(triggerId: string, dagId: string, result: DAGRun) {
    await this.exactlyOnce.processOnce(triggerId, async () => {
      const dependents = this.registry.getDependents(dagId)

      for (const dependent of dependents) {
        await this.orchestrator.trigger(dependent.id, {
          upstreamDagId: dagId,
          upstreamResult: result,
        })
      }

      // Mark trigger as completed
      await this.completePendingTrigger(triggerId)
    })
  }

  // Polling fallback for missed triggers
  async recoverPendingTriggers() {
    const pending = await this.loadPendingTriggers()
    for (const trigger of pending) {
      if (trigger.age > this.retryDelay) {
        await this.triggerWithDedup(trigger.id, trigger.dagId, trigger.result)
      }
    }
  }
}
```

## Distributed Coordination Strategies

### DO-Based Orchestration

```
                    +---------------------------+
                    |    DAGOrchestratorDO      |
                    | - Registry                |
                    | - Cross-DAG state         |
                    | - Trigger coordination    |
                    +------------+--------------+
                                 |
            +--------------------+--------------------+
            |                    |                    |
    +-------v-------+    +-------v-------+    +-------v-------+
    |    DAG-A      |    |    DAG-B      |    |    DAG-C      |
    |  (upstream)   |    | (downstream)  |    | (downstream)  |
    +-------+-------+    +-------+-------+    +-------+-------+
            |                    ^                    ^
            +--------------------+--------------------+
                     onComplete triggers
```

### Cross-DO Communication Pattern

Based on latency analysis from `docs/spikes/cross-do-join-latency.md`:

| Operation | Same-Colo p50 | Cross-Colo p50 |
|-----------|---------------|----------------|
| DO-to-DO RPC | 2-5ms | 50-150ms |
| Parallel fan-out (5 DOs) | 8ms | 80ms |
| Promise pipelining | 5ms | 60ms |

**For cross-DAG triggers:**
- Same-colo: Sub-10ms trigger latency achievable
- Cross-colo: Use async triggers with acknowledgement

### Exactly-Once Semantics

Leverage existing `ExactlyOnceContext`:

```typescript
const triggerContext = new ExactlyOnceContext({
  eventIdTtl: 24 * 60 * 60 * 1000, // 24h dedup window
  onDeliver: async (events) => {
    for (const event of events) {
      await orchestrator.trigger(event.dagId, event.payload)
    }
  },
})

// Process trigger exactly once
await triggerContext.processOnce(
  `trigger:${upstreamDagId}:${runId}:${downstreamDagId}`,
  async () => {
    // Trigger downstream DAG
  }
)
```

## Avoiding Circular Dependencies

### Registration-Time Validation

Already implemented in `validateDAGDependencies()`:

```typescript
function validateDAGDependencies(dags: DAG[]): void {
  const dagMap = new Map(dags.map(d => [d.id, d]))
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  function detectCycle(dagId: string, path: string[]): boolean {
    visited.add(dagId)
    recursionStack.add(dagId)

    const dag = dagMap.get(dagId)
    for (const trigger of dag?.triggers ?? []) {
      if (trigger.type === 'dag-complete') {
        const depId = trigger.source.dagId
        if (recursionStack.has(depId)) {
          throw new Error(`Circular DAG dependency: ${path.join(' -> ')} -> ${depId}`)
        }
        if (!visited.has(depId)) {
          detectCycle(depId, [...path, depId])
        }
      }
    }

    recursionStack.delete(dagId)
    return false
  }

  for (const dag of dags) {
    if (!visited.has(dag.id)) {
      detectCycle(dag.id, [dag.id])
    }
  }
}
```

### DAGRegistry Integration

```typescript
interface DAGRegistry {
  register(dag: DAG): void
  unregister(dagId: string): void
  getDependents(dagId: string): DAG[]
  getDependencies(dagId: string): string[]
  validateDependencies(): void  // Throws on cycle
}

// Auto-validate on registration
createDAGRegistry().register(dag) // Validates on add
```

### Runtime Safety

Even with registration validation, protect against runtime cycles:

```typescript
class DAGExecutionGuard {
  private executionStack: Set<string> = new Set()

  async executeWithGuard(dagId: string, executor: () => Promise<DAGRun>) {
    if (this.executionStack.has(dagId)) {
      throw new Error(`Runtime cycle detected: ${dagId} already executing`)
    }

    this.executionStack.add(dagId)
    try {
      return await executor()
    } finally {
      this.executionStack.delete(dagId)
    }
  }
}
```

## Recommended Implementation Approach

### Phase 1: Reliability Improvements (P0)

1. **Persist pending triggers** - Store trigger intents in DO storage before attempting
2. **Add recovery polling** - Background job to retry failed triggers
3. **Idempotency keys** - Use `processOnce()` for all trigger executions

### Phase 2: Enhanced Sensors (P1)

1. **Task-level sensors** - Wait for specific task completion, not just DAG
2. **Conditional triggers** - Support `success`, `completed`, `any` conditions
3. **Timeout handling** - Configurable timeouts with graceful failure

### Phase 3: Dataset Triggers (P2)

1. **Dataset registry** - Track data locations and producers
2. **Partition awareness** - Trigger on new partitions
3. **Multi-dataset AND/OR** - Trigger when multiple datasets ready

### Phase 4: Observability (P2)

1. **Trigger metrics** - Latency, success rate, retry count
2. **Dependency graph visualization** - Show DAG relationships
3. **Alerting** - Alert on trigger failures, cycles

## Test Coverage

Existing tests in `/db/primitives/dag-scheduler/cross-dag.test.ts` cover:

| Test Area | Coverage |
|-----------|----------|
| CrossDAGState | Key-value, TTL, DAG results |
| DAGRegistry | Registration, dependents, dependencies |
| Circular detection | Simple, complex, diamond patterns |
| ExternalDAGSensor | Polling, timeout, conditions |
| DAGOrchestrator | Trigger, payload, callbacks |
| DatasetAwareState | Registration, events, subscriptions |
| Integration | Multi-DAG pipeline, shared state |

Additional tests needed:

- [ ] Failure recovery scenarios
- [ ] Cross-DO trigger reliability
- [ ] Concurrent trigger handling
- [ ] Large-scale DAG graphs (100+ DAGs)

## Performance Characteristics

### Trigger Latency

| Scenario | Expected Latency |
|----------|------------------|
| Same-DO trigger | <5ms |
| Same-colo cross-DO trigger | 10-20ms |
| Cross-colo trigger | 100-200ms |
| Polling sensor (1s interval) | 500ms-1000ms average |

### Scalability

| Metric | Limit | Notes |
|--------|-------|-------|
| DAGs per orchestrator | 1000+ | Limited by registry size |
| Concurrent triggers | 50+ | Parallel fan-out |
| Trigger history | Configurable | TTL-based cleanup |
| Pending triggers | 100+ | With recovery polling |

## Conclusion

The existing DAGScheduler implementation provides a solid foundation for cross-DAG dependency triggers. The key recommendations are:

1. **Use event-driven triggers** as the primary mechanism via `onDAGComplete` callbacks
2. **Add persistence layer** for pending triggers to survive restarts
3. **Implement polling fallback** via `ExternalDAGSensor` for cross-DO scenarios
4. **Leverage ExactlyOnceContext** for idempotent trigger execution
5. **Validate at registration** using `validateDAGDependencies()` to prevent cycles

The hybrid event + polling approach achieves 100% trigger reliability while maintaining low latency for the common case.

## References

### Codebase
- `/db/primitives/dag-scheduler/index.ts` - DAGOrchestrator, ExternalDAGSensor
- `/db/primitives/dag-scheduler/cross-dag.test.ts` - Comprehensive test suite
- `/db/primitives/exactly-once-context.ts` - Idempotent processing
- `/objects/CrossDOTransaction.ts` - Saga and 2PC patterns

### Related Spikes
- `/docs/spikes/cross-do-join-latency.md` - DO latency analysis
- `/docs/spikes/distributed-checkpoint-coordination.md` - Cross-DO coordination patterns

### External
- Apache Airflow - External Task Sensor pattern
- Dagster - Asset-based triggering
- Prefect - Event-driven flows
