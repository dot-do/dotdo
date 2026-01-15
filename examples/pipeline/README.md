# pipeline.example.com.ai

Data pipeline orchestration with dotdo v2.

## The Problem

You need ETL pipelines. Traditional tools require:

- Airflow: Python DAGs, executors, schedulers, metadata DBs
- Dagster: Asset definitions, ops, resources, YAML configs

All of them need servers. All of them separate scheduling from execution.

## The Solution

dotdo pipelines are TypeScript functions with `$.every` scheduling. No YAML. No orchestrators.

```typescript
import { $ } from 'dotdo'

$.every.day.at('2am')(async () => {
  const raw = await extract('s3://data-lake/events/')
  const clean = transform(raw)
  await load(clean, iceberg)
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

## Scheduling with $.every

```typescript
$.every.day.at('2am')(runETL)        // Daily at 2am
$.every.Monday.at9am(generateReport) // Weekly on Monday
$.every.hour(syncInventory)          // Every hour
$.every(15).minutes(checkAlerts)     // Every 15 minutes
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
async function dailyPipeline() {
  // Stage 1: Parallel extract
  const [users, events, products] = await Promise.all([
    $.do(() => extract('users'), { stepId: 'extract-users' }),
    $.do(() => extract('events'), { stepId: 'extract-events' }),
    $.do(() => extract('products'), { stepId: 'extract-products' })
  ])

  // Stage 2: Transform (depends on Stage 1)
  const enriched = await $.do(
    () => enrichEvents(events, users, products),
    { stepId: 'enrich-events' }
  )

  // Stage 3: Load to Iceberg
  await $.do(() => load(enriched, iceberg), { stepId: 'load' })

  // Stage 4: Notify (fire-and-forget)
  $.send('Pipeline.completed', { records: enriched.length })
}
```

## Complete Example

```typescript
import { $, IcebergWriter } from 'dotdo'

const iceberg = new IcebergWriter({
  bucket: env.R2_BUCKET,
  namespace: 'analytics',
  tableName: 'events'
})

$.every.day.at('2am')(async () => {
  // Extract
  const sources = ['events', 'users', 'products']
  const data = await Promise.all(
    sources.map(s => $.do(
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
  await $.do(() => iceberg.write(enriched.map(e => ({
    type: 'event',
    entityId: e.id,
    payload: e,
    ts: Date.now()
  }))), { stepId: 'load' })

  $.send('Pipeline.completed', { count: enriched.length })
})
```

## Why dotdo?

| Traditional | dotdo |
|------------|-------|
| YAML DAG definitions | TypeScript functions |
| Separate scheduler | `$.every` built-in |
| Task queues + workers | Durable Objects |
| S3 + Spark | Fanout + Iceberg |
| Servers to manage | Edge runtime |

```bash
npm create dotdo@latest my-pipeline
```
