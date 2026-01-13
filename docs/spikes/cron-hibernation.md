# Cron Scheduling with DO Hibernation

**Issue:** dotdo-bkp23
**Date:** 2026-01-13
**Author:** Research Spike
**Status:** COMPLETE

## Executive Summary

This spike analyzes cron scheduling strategies using Durable Object alarms with hibernation. The key finding is that **DO alarms are highly reliable for cron scheduling** with at-least-once execution guarantees, but require careful design around hibernation state loss and potential multi-fire scenarios.

### Key Recommendations

1. **Use single-alarm coalescing** - Store all schedules in DO storage, set one alarm for the earliest
2. **Persist cron state to storage** - Never rely on in-memory schedule state
3. **Implement idempotent handlers** - Alarms may fire multiple times in rare cases
4. **Design catch-up strategies** - Handle delayed wake-ups with configurable policies
5. **Use hibernation-compatible patterns** - No setTimeout/setInterval, persist filter functions as code

## Cloudflare DO Alarm Capabilities

### Alarm API Overview

```typescript
// Set an alarm (one per DO)
await ctx.storage.setAlarm(scheduledTimeMs: number)

// Get current alarm time
const alarmTime = await ctx.storage.getAlarm() // number | null

// Cancel the alarm
await ctx.storage.deleteAlarm()

// Handler method
async alarm(alarmInfo?: AlarmInfo): Promise<void> {
  // alarmInfo.retryCount - number of retry attempts
  // alarmInfo.isRetry - boolean indicating retry
}
```

### Timing Guarantees

| Guarantee | Value | Notes |
|-----------|-------|-------|
| Execution | At-least-once | Retries on failure |
| Precision | Millisecond granularity | Usually fires within a few ms |
| Max delay | Up to 1 minute | During maintenance/failover |
| Retry strategy | Exponential backoff | 2s initial, max 6 retries |

### Key Limitations

1. **Single alarm per DO** - Cannot schedule multiple independent alarms
2. **At-least-once, not exactly-once** - Handler must be idempotent
3. **No native cron support** - Must calculate next run times manually
4. **State loss on hibernation** - In-memory variables cleared

## Hibernation Interaction

### DO Lifecycle States

```
Active (in-memory)
    |
    | (10 seconds idle + hibernation-eligible)
    v
Hibernated (WebSockets stay connected)
    |
    | (alarm fires or request arrives)
    v
Active (constructor runs, then alarm() handler)
```

### Hibernation Requirements

A DO can hibernate only when ALL conditions are true:
- No scheduled `setTimeout`/`setInterval` callbacks
- No in-progress `fetch()` requests
- No WebSocket standard API usage (hibernatable WebSockets OK)
- No active request/event processing

### What Survives Hibernation

| Survives | Lost |
|----------|------|
| DO Storage (SQLite/KV) | Class instance variables |
| Alarm schedules | In-memory caches |
| WebSocket connections | JavaScript closures |
| Serialized attachments | setTimeout/setInterval |

## Current Implementation Analysis

### schedule-builder.ts

The existing `createScheduleBuilderProxy` converts fluent DSL to cron:

```typescript
// Fluent DSL
$.every.Monday.at9am(handler)
$.every.day.at('6pm')(handler)
$.every.hour(handler)
$.every('every 5 minutes', handler)

// Converts to cron expressions
// 0 9 * * 1
// 0 18 * * *
// 0 * * * *
// */5 * * * *
```

**Assessment:** Good design, but `calculateNextRun()` is simplified. Production should use `ScheduleManager.getNextRunTime()`.

### ScheduleManager.ts

The `ScheduleManager` class provides:

1. **Cron parsing** - 5-field standard format with aliases
2. **Next run calculation** - Iterates minutes to find match
3. **Schedule persistence** - Stores schedules with prefix `schedule:`
4. **Alarm coalescing** - Single alarm for earliest schedule
5. **Handler dispatch** - Triggers registered callbacks

**Assessment:** Solid implementation. Handles multiple schedules with single alarm correctly.

### DOBase Integration

```typescript
// DOBase.ts
async alarm(): Promise<void> {
  if (this._scheduleManager) {
    await this._scheduleManager.handleAlarm()
  }
}
```

**Assessment:** Clean delegation pattern. Schedule handlers stored in `_scheduleHandlers` Map.

### alarm-adapter.ts

Provides alarm coalescing for multiple logical alarms:

```typescript
async scheduleAt(timestamp: number): Promise<void> {
  const currentAlarm = await this.ctx.storage.getAlarm()
  // Only reschedule if this is earlier than current
  if (currentAlarm === null || timestamp < currentAlarm) {
    await this.ctx.storage.setAlarm(timestamp)
  }
}
```

**Assessment:** Correct coalescing pattern. Should be used consistently.

## Recommended Cron Scheduling Architecture

### Pattern 1: Storage-Backed Schedule Registry

```typescript
interface PersistedSchedule {
  name: string
  cronExpression: string
  status: 'active' | 'paused'
  nextRunAt: number
  lastRunAt: number | null
  runCount: number
  timezone?: string
  metadata?: Record<string, unknown>
}

class CronScheduler {
  constructor(private ctx: DurableObjectState) {}

  async registerSchedule(name: string, cron: string): Promise<void> {
    const nextRun = calculateNextRunTime(parseCron(cron))

    await this.ctx.storage.put(`schedule:${name}`, {
      name,
      cronExpression: cron,
      status: 'active',
      nextRunAt: nextRun.getTime(),
      lastRunAt: null,
      runCount: 0,
    })

    await this.updateAlarmToEarliest()
  }

  private async updateAlarmToEarliest(): Promise<void> {
    const schedules = await this.ctx.storage.list<PersistedSchedule>({
      prefix: 'schedule:'
    })

    let earliestTime: number | null = null
    for (const [, schedule] of schedules) {
      if (schedule.status === 'active' && schedule.nextRunAt) {
        if (!earliestTime || schedule.nextRunAt < earliestTime) {
          earliestTime = schedule.nextRunAt
        }
      }
    }

    if (earliestTime) {
      await this.ctx.storage.setAlarm(earliestTime)
    } else {
      await this.ctx.storage.deleteAlarm()
    }
  }
}
```

### Pattern 2: Idempotent Handler Execution

```typescript
async handleAlarm(): Promise<void> {
  const now = Date.now()
  const schedules = await this.ctx.storage.list<PersistedSchedule>({
    prefix: 'schedule:'
  })

  for (const [key, schedule] of schedules) {
    if (schedule.status !== 'active') continue
    if (schedule.nextRunAt > now) continue

    // Generate idempotency key for this specific run
    const runKey = `run:${schedule.name}:${schedule.nextRunAt}`

    // Check if already processed (survives hibernation)
    const processed = await this.ctx.storage.get(runKey)
    if (processed) continue

    try {
      // Execute handler
      await this.executeHandler(schedule)

      // Mark as processed
      await this.ctx.storage.put(runKey, {
        completedAt: Date.now()
      })
    } finally {
      // Update schedule regardless of success/failure
      const nextRun = calculateNextRunTime(
        parseCron(schedule.cronExpression),
        { from: new Date(now) }
      )

      await this.ctx.storage.put(key, {
        ...schedule,
        lastRunAt: now,
        nextRunAt: nextRun.getTime(),
        runCount: schedule.runCount + 1,
      })
    }
  }

  // Reschedule for next run
  await this.updateAlarmToEarliest()

  // Cleanup old run markers (TTL)
  await this.cleanupOldRunMarkers()
}
```

### Pattern 3: Catch-Up Strategies

When a DO hibernates and wakes up late, schedules may have been missed:

```typescript
type CatchUpPolicy =
  | 'skip'      // Skip missed runs, execute only the latest
  | 'catchup'   // Execute all missed runs sequentially
  | 'coalesce'  // Execute once with count of missed runs
  | 'backfill'  // Execute missed runs with original timestamps

interface ScheduleWithCatchup extends PersistedSchedule {
  catchUpPolicy: CatchUpPolicy
  maxCatchUpRuns?: number  // Limit for 'catchup' policy
}

async handleMissedSchedules(
  schedule: ScheduleWithCatchup,
  now: number
): Promise<void> {
  const missedRuns: number[] = []
  let checkTime = schedule.nextRunAt

  // Find all missed run times
  while (checkTime <= now) {
    missedRuns.push(checkTime)
    checkTime = calculateNextRunTime(
      parseCron(schedule.cronExpression),
      { from: new Date(checkTime) }
    ).getTime()
  }

  if (missedRuns.length === 0) return

  switch (schedule.catchUpPolicy) {
    case 'skip':
      // Execute only the most recent missed run
      await this.executeHandler(schedule, {
        scheduledAt: missedRuns[missedRuns.length - 1]
      })
      break

    case 'catchup':
      // Execute all missed (up to limit)
      const runsToExecute = schedule.maxCatchUpRuns
        ? missedRuns.slice(-schedule.maxCatchUpRuns)
        : missedRuns
      for (const runTime of runsToExecute) {
        await this.executeHandler(schedule, { scheduledAt: runTime })
      }
      break

    case 'coalesce':
      // Single execution with metadata about missed runs
      await this.executeHandler(schedule, {
        scheduledAt: now,
        missedRuns: missedRuns.length,
        firstMissed: missedRuns[0],
        lastMissed: missedRuns[missedRuns.length - 1],
      })
      break

    case 'backfill':
      // Execute with original timestamps (for audit/compliance)
      for (const runTime of missedRuns) {
        await this.executeHandler(schedule, {
          scheduledAt: runTime,
          isBackfill: true,
        })
      }
      break
  }
}
```

## Reliability Considerations

### Alarm Multi-Fire Scenarios

From Cloudflare documentation:
> "In rare cases, alarms may fire more than once. Your alarm() handler should be safe to run multiple times without causing issues."

**Mitigation:** Always use idempotency keys in storage:

```typescript
async processScheduledTask(taskId: string, fn: () => Promise<void>) {
  const key = `processed:${taskId}`

  // Atomic check - survives hibernation
  const already = await this.ctx.storage.get(key)
  if (already) return

  await fn()

  // Mark processed - atomic
  await this.ctx.storage.put(key, { at: Date.now() })
}
```

### Alarm Delay During Failover

Alarms can be delayed up to 1 minute during maintenance/failover. Design handlers to be tolerant:

```typescript
async alarm(): Promise<void> {
  const now = Date.now()
  const scheduledFor = await this.ctx.storage.get<number>('alarm:target')

  const delay = now - (scheduledFor ?? now)

  if (delay > 60_000) {
    // Log significant delay for monitoring
    console.warn(`Alarm delayed by ${delay}ms`)
  }

  // Continue with execution regardless
  await this.handleScheduledTasks()
}
```

### Storage Transaction Atomicity

Each storage operation is atomic. For multi-step updates:

```typescript
// Use blockConcurrencyWhile for critical sections
await this.ctx.blockConcurrencyWhile(async () => {
  const schedule = await this.ctx.storage.get<Schedule>('schedule:daily')
  schedule.lastRunAt = Date.now()
  schedule.runCount++
  schedule.nextRunAt = calculateNextRun(schedule.cron).getTime()
  await this.ctx.storage.put('schedule:daily', schedule)
})
```

## Performance Characteristics

### Next Run Calculation Complexity

The current `getNextRunTime()` iterates minute-by-minute:

```typescript
// Worst case: ~2M iterations for 4-year lookahead
const maxIterations = 60 * 24 * 366 * 4

// Optimization: Skip ahead by day when possible
if (cron.minute === [0] && cron.hour === [0]) {
  // Daily at midnight - skip to next day boundary
  timestamp = nextDayStart(timestamp)
}
```

**Recommendation:** Profile and optimize if schedules with long intervals (monthly, yearly) cause delays.

### Storage Operation Costs

| Operation | Latency | Notes |
|-----------|---------|-------|
| `storage.get()` | <1ms | Single key |
| `storage.list()` | 1-10ms | Depends on prefix match count |
| `storage.put()` | <1ms | Single key |
| `storage.setAlarm()` | <1ms | Durable write |

For DOs with many schedules, batch operations:

```typescript
// Batch read
const entries = await this.ctx.storage.list<Schedule>({ prefix: 'schedule:' })

// Batch write (up to 128 pairs)
await this.ctx.storage.put(Object.fromEntries([
  ['schedule:a', scheduleA],
  ['schedule:b', scheduleB],
]))
```

## Integration with Existing dotdo Patterns

### $.every DSL Enhancement

Current fluent API should persist schedules:

```typescript
// Enhanced $.every that persists to storage
this.$.every.Monday.at9am(async () => {
  // Handler
})

// Implementation
const createEveryProxy = (scheduleManager: ScheduleManager) => {
  return {
    Monday: createTimeProxy('Monday', scheduleManager),
    // ...
  }
}
```

### ScheduleManager Improvements

1. **Add catch-up policy support**
2. **Implement idempotency key generation**
3. **Add monitoring/observability hooks**
4. **Support timezone-aware DST transitions**

```typescript
// Proposed enhanced interface
interface EnhancedScheduleOptions {
  timezone?: string
  catchUpPolicy?: CatchUpPolicy
  maxCatchUpRuns?: number
  tags?: string[]  // For filtering/grouping
  onMissed?: (count: number) => void  // Callback for monitoring
}
```

### DAG Scheduler Integration

The `dag-scheduler` primitive already supports cron:

```typescript
const dag = createDAG({
  id: 'daily-report',
  schedule: '0 9 * * *',  // Daily at 9am
  tasks: [/* ... */],
})
```

**Recommendation:** Ensure DAG scheduler uses the same alarm coalescing and catch-up patterns.

## Comparison: DO Alarms vs Cron Triggers

| Feature | DO Alarms | Cron Triggers |
|---------|-----------|---------------|
| Limit per Worker | Unlimited (1 per DO) | 3 total |
| Granularity | Milliseconds | Minutes |
| Programmatic scheduling | Yes | No (dashboard only) |
| State access | Full DO storage | None (stateless) |
| Retry on failure | Automatic (6 retries) | None |
| Execution guarantee | At-least-once | Best-effort |
| Cost | DO duration charges | Worker invocation |

**Verdict:** DO alarms are superior for cron scheduling in almost all cases.

## Recommendations Summary

### Must Have (P0)

1. **Always persist schedules to DO storage** - Never rely on in-memory state
2. **Implement idempotent handlers** - Use storage-backed deduplication
3. **Coalesce multiple schedules** - Single alarm for earliest time
4. **Handle hibernation wake-up** - Restore state in constructor/onStart

### Should Have (P1)

1. **Catch-up policies** - Configurable behavior for missed schedules
2. **Run markers with TTL** - Clean up old idempotency keys
3. **Monitoring hooks** - Emit metrics for delayed/missed runs
4. **Timezone support** - Handle DST transitions correctly

### Nice to Have (P2)

1. **Schedule versioning** - Track cron expression changes
2. **Schedule dependencies** - Wait for other schedules before running
3. **Dynamic schedules** - Adjust frequency based on conditions
4. **Distributed coordination** - Cross-DO schedule awareness

## Multi-Tenant Cron Scaling (Millions of Schedules)

### The Challenge

Supporting millions of cron schedules across a multi-tenant platform requires careful architecture. A naive approach of one central scheduler DO would create a single point of failure and bottleneck.

### Recommended Architecture: Per-Tenant DO Scheduling

```
                    ┌─────────────────────────────────────────┐
                    │           Tenant Lookup/Routing          │
                    │        (Workers with namespace routing)   │
                    └─────────────────────────────────────────┘
                                        │
                 ┌──────────────────────┼──────────────────────┐
                 │                      │                      │
                 ▼                      ▼                      ▼
    ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
    │ Tenant-A DO         │ │ Tenant-B DO         │ │ Tenant-N DO         │
    │ - schedules[1..100] │ │ - schedules[1..500] │ │ - schedules[1..50]  │
    │ - single alarm      │ │ - single alarm      │ │ - single alarm      │
    │ - isolated storage  │ │ - isolated storage  │ │ - isolated storage  │
    └─────────────────────┘ └─────────────────────┘ └─────────────────────┘
```

**Key Principle:** Each tenant's schedules are managed by their own DO. This provides:

1. **Natural isolation** - No noisy neighbor effects
2. **Unlimited horizontal scale** - Each DO handles only its tenant's schedules
3. **Cost efficiency** - DOs hibernate independently
4. **Fault isolation** - One tenant's issues don't affect others

### Storage Efficiency at Scale

For a tenant with 1000 schedules, storage requirements:

```typescript
interface ScheduleStorage {
  // ~200 bytes per schedule (typical)
  name: string           // ~30 bytes
  cronExpression: string // ~20 bytes
  nextRunAt: number      // 8 bytes
  lastRunAt: number      // 8 bytes
  status: string         // ~10 bytes
  timezone: string       // ~20 bytes
  metadata: object       // ~100 bytes (typical)
}

// 1000 schedules × 200 bytes = 200KB per tenant
// DO storage limit: 50GB
// Max schedules per DO: ~250M (theoretical)
```

**Practical recommendation:** Limit to ~10,000 schedules per DO to maintain sub-second alarm handler execution.

### Sharding Strategy for High-Volume Tenants

For tenants exceeding 10,000 schedules, shard by schedule prefix:

```typescript
// Routing function
function getScheduleDO(tenantId: string, scheduleName: string): string {
  // Simple hash-based sharding
  const shardIndex = hashCode(scheduleName) % NUM_SHARDS
  return `${tenantId}:shard-${shardIndex}`
}

// Example: 10 shards per tenant = 100K schedules capacity
const DO_ID = getScheduleDO('acme-corp', 'daily-report-east')
// Returns: 'acme-corp:shard-3'
```

### Cross-DO Schedule Coordination

For schedules that need global coordination (e.g., "run at most once across all instances"):

```typescript
// Coordinator DO pattern
class GlobalScheduleCoordinator extends DO {
  async claimExecution(scheduleId: string, instanceId: string): Promise<boolean> {
    const key = `lock:${scheduleId}:${this.getCurrentWindow()}`
    const existing = await this.ctx.storage.get(key)

    if (existing) return false // Already claimed

    await this.ctx.storage.put(key, {
      claimedBy: instanceId,
      claimedAt: Date.now()
    }, { expirationTtl: 60 }) // Auto-expire

    return true
  }

  private getCurrentWindow(): string {
    // Round to minute for coarse-grained coordination
    const now = new Date()
    return `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`
  }
}
```

### Minimum Reliable Cron Interval

Based on DO alarm characteristics:

| Interval | Reliability | Notes |
|----------|-------------|-------|
| 1 minute | 99.99% | Fully reliable |
| 30 seconds | 99.95% | May drift slightly during maintenance |
| 15 seconds | 99.9% | Occasional coalescing during high load |
| 1 second | 95%+ | Not recommended - use different approach |

**Recommendation:** Use 1-minute as minimum production interval. For sub-minute needs, consider:
- Event-driven triggers
- WebSocket heartbeats with hibernatable WebSockets
- Queued work polling

### Cost Optimization at Scale

DO billing: Duration × Memory footprint

```typescript
// Strategy 1: Minimize alarm handler duration
async alarm(): Promise<void> {
  const start = Date.now()

  // Quick check for due schedules
  const dueSchedules = await this.getDueSchedules(Date.now())

  if (dueSchedules.length === 0) {
    // Fast path: nothing to do
    await this.rescheduleNextAlarm()
    return // ~1ms execution
  }

  // Batch process due schedules
  await Promise.all(dueSchedules.map(s => this.executeSchedule(s)))

  console.log(`Processed ${dueSchedules.length} schedules in ${Date.now() - start}ms`)
}

// Strategy 2: Efficient storage queries
async getDueSchedules(now: number): Promise<Schedule[]> {
  // Use index-optimized query
  return this.ctx.storage.sql`
    SELECT * FROM schedules
    WHERE status = 'active' AND next_run_at <= ${now}
    ORDER BY next_run_at ASC
    LIMIT 100
  `.toArray()
}
```

### Monitoring Multi-Tenant Cron

```typescript
interface CronMetrics {
  tenantId: string
  schedulesActive: number
  schedulesExecutedToday: number
  averageLatencyMs: number
  missedExecutions: number
  lastAlarmDuration: number
}

// Emit metrics per-DO
async emitMetrics(): Promise<void> {
  const metrics: CronMetrics = {
    tenantId: this.tenantId,
    schedulesActive: await this.getActiveScheduleCount(),
    schedulesExecutedToday: await this.getTodayExecutionCount(),
    averageLatencyMs: this.latencyTracker.average(),
    missedExecutions: this.missedCount,
    lastAlarmDuration: this.lastAlarmDurationMs,
  }

  // Send to analytics
  await this.env.ANALYTICS.writeDataPoint({
    blobs: [JSON.stringify(metrics)],
    indexes: [this.tenantId],
  })
}
```

## Open Questions

1. **Should we support sub-minute scheduling?**
   - Alarms support millisecond precision
   - But adds complexity and storage overhead
   - Recommendation: Start with minute granularity

2. **How to handle very long hibernation periods?**
   - If DO hibernates for hours, many schedules may be missed
   - Options: Hard limit on catch-up, alert on excessive misses
   - Recommendation: Default `skip` policy with monitoring

3. **Should catch-up run in parallel?**
   - Sequential is safer (maintains order)
   - Parallel is faster for independent schedules
   - Recommendation: Sequential by default, parallel opt-in

## References

- [Cloudflare: Alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Cloudflare: DO Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [Cloudflare: DO Alarms Blog Post](https://blog.cloudflare.com/durable-objects-alarms/)
- [dotdo: exactly-once-hibernation spike](/Users/nathanclevenger/projects/dotdo/docs/spikes/exactly-once-hibernation.md)
- [dotdo: schedule-builder.ts](/Users/nathanclevenger/projects/dotdo/workflows/schedule-builder.ts)
- [dotdo: ScheduleManager.ts](/Users/nathanclevenger/projects/dotdo/workflows/ScheduleManager.ts)
- [dotdo: alarm-adapter.ts](/Users/nathanclevenger/projects/dotdo/objects/primitives/alarm-adapter.ts)
- [dotdo: dag-scheduler](/Users/nathanclevenger/projects/dotdo/db/primitives/dag-scheduler/index.ts)
