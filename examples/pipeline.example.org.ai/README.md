# pipeline.example.com.ai

Data pipeline orchestration with dotdo v2.

## The Problem

You need ETL pipelines. Traditional tools require:

- Airflow: Python DAGs, executors, schedulers, metadata DBs
- Dagster: Asset definitions, ops, resources, YAML configs

All of them need servers. All of them separate scheduling from execution.

## The Solution

dotdo pipelines are TypeScript functions with `this.every` scheduling. No YAML. No orchestrators.

```typescript
import { DO } from 'dotdo'

export default DO.extend({
  init() {
    this.every.day.at('2am')(async () => {
      const raw = await extract('s3://data-lake/events/')
      const clean = transform(raw)
      await load(clean, iceberg)
    })
  }
})
```

## Extract-Transform-Load

```typescript
// Extract: pull from any source
async function extract(source: string): Promise<RawEvent[]> {
  return fetch(source).then(r => r.json())
}

// Transform: pure functions
function transform(events: RawEvent[]): CleanEvent[] {
  return events
    .filter(e => e.ts && e.user)
    .map(e => ({
      timestamp: new Date(e.ts),
      userId: e.user.toLowerCase(),
      action: e.action,
      metadata: e.meta ?? {}
    }))
}

// Load: write to Iceberg
async function load(events: CleanEvent[], iceberg: IcebergWriter) {
  await iceberg.write(events.map(e => ({
    type: e.action,
    entityId: e.userId,
    payload: e.metadata,
    ts: e.timestamp.getTime()
  })))
}
```

## Scheduling with this.every

```typescript
this.every.day.at('2am')(runETL)        // Daily at 2am
this.every.Monday.at('9am')(generateReport) // Weekly on Monday
this.every.hour(syncInventory)          // Every hour
this.every(15).minutes(checkAlerts)     // Every 15 minutes
```

## Fanout for Parallel Processing

```typescript
import { QueryCoordinator } from 'dotdo'

const coordinator = new QueryCoordinator(scanners)

// Parallel aggregation across shards
const results = await coordinator.query(
  'SELECT user_id, COUNT(*) FROM events GROUP BY user_id'
)

// Stream results as they complete
for await (const batch of coordinator.queryStream(sql)) {
  await processBatch(batch)
}
```

## Pipeline DAG with Dependencies

```typescript
async dailyPipeline() {
  // Stage 1: Parallel extract
  const [users, events, products] = await Promise.all([
    this.do(() => extract('users'), { stepId: 'extract-users' }),
    this.do(() => extract('events'), { stepId: 'extract-events' }),
    this.do(() => extract('products'), { stepId: 'extract-products' })
  ])

  // Stage 2: Transform (depends on Stage 1)
  const enriched = await this.do(
    () => enrichEvents(events, users, products),
    { stepId: 'enrich-events' }
  )

  // Stage 3: Load to Iceberg
  await this.do(() => load(enriched, iceberg), { stepId: 'load' })

  // Stage 4: Notify (fire-and-forget)
  this.send('Pipeline.completed', { records: enriched.length })
}
```

## Promise Pipelining (Cap'n Web)

True Cap'n Proto-style pipelining: method calls on stubs batch until `await`, then resolve in a single round-trip.

```typescript
// ❌ Sequential - N round-trips
for (const stage of stages) {
  await this.Stage(stage.id).execute(data)
}

// ✅ Pipelined - fire and forget (side effects don't need await)
stages.forEach(s => this.Stage(s.id).execute(data))

// ✅ Pipelined - single round-trip for chained access
const result = await this.Pipeline(id).getStage(0).run(batch)
```

`this.Noun(id)` returns a pipelined stub. Property access and method calls are recorded, then executed server-side on `await`. Fire-and-forget is valid for side effects like notifications or metrics.

## Complete Example

```typescript
import { DO, IcebergWriter } from 'dotdo'

export default DO.extend({
  iceberg: null as IcebergWriter | null,

  init() {
    this.iceberg = new IcebergWriter({
      bucket: this.env.R2_BUCKET,
      namespace: 'analytics',
      tableName: 'events'
    })

    this.every.day.at('2am')(async () => {
      // Extract
      const sources = ['events', 'users', 'products']
      const data = await Promise.all(
        sources.map(s => this.do(
          () => fetch(`https://api.example.com/${s}`).then(r => r.json()),
          { stepId: `extract-${s}` }
        ))
      )

      // Transform
      const [events, users, products] = data
      const enriched = events.map(e => ({
        ...e,
        userName: users.find(u => u.id === e.userId)?.name
      }))

      // Load
      await this.do(() => this.iceberg!.write(enriched.map(e => ({
        type: 'event',
        entityId: e.id,
        payload: e,
        ts: Date.now()
      }))), { stepId: 'load' })

      this.send('Pipeline.completed', { count: enriched.length })
    })
  }
})
```

## Why dotdo?

| Traditional | dotdo |
|------------|-------|
| YAML DAG definitions | TypeScript functions |
| Separate scheduler | `this.every` built-in |
| Task queues + workers | Durable Objects |
| S3 + Spark | Fanout + Iceberg |
| Servers to manage | Edge runtime |

```bash
npm create dotdo@latest my-pipeline
```
