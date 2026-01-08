# Cloudflare Streams & Pipelines

> Event streaming from DOs to R2 SQL for cross-DO queries and analytics

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DURABLE OBJECTS                                 │
│                                                                              │
│   DO 1 ─────┐                                                               │
│   DO 2 ─────┼──▶  PIPELINE BINDING  ──▶  STREAM (buffered queue)           │
│   DO 3 ─────┘         │                         │                           │
│                       │                         │                           │
└───────────────────────┼─────────────────────────┼───────────────────────────┘
                        │                         │
                        │                         ▼
                        │              ┌─────────────────────┐
                        │              │   SQL TRANSFORM     │
                        │              │                     │
                        │              │   • Prepend ns      │
                        │              │   • Filter          │
                        │              │   • Enrich          │
                        │              │   • Reshape         │
                        │              └─────────────────────┘
                        │                         │
                        │                         ▼
                        │              ┌─────────────────────┐
                        │              │      SINK           │
                        │              │                     │
                        │              │   • R2 Iceberg      │
                        │              │   • R2 Parquet      │
                        │              │   • R2 JSON         │
                        │              └─────────────────────┘
                        │                         │
                        │                         ▼
                        │              ┌─────────────────────┐
                        │              │      R2 SQL         │
                        │              │                     │
                        │              │   Cross-DO queries  │
                        │              │   Analytics         │
                        │              │   Audit/SOC2        │
                        │              └─────────────────────┘
```

## Pipelines

We define three main pipelines:

| Pipeline | Purpose | SQL File |
|----------|---------|----------|
| `events` | Domain events for analytics | `events.sql` |
| `things` | Thing versions for cross-DO queries | `things.sql` |
| `actions` | Audit log for SOC2 compliance | `actions.sql` |

## Creating Pipelines

```bash
# Create events pipeline
npx wrangler pipelines create do-events --sql-file streams/events.sql

# Create things pipeline
npx wrangler pipelines create do-things --sql-file streams/things.sql

# Create actions pipeline (audit log)
npx wrangler pipelines create do-actions --sql-file streams/actions.sql
```

Or use interactive setup:

```bash
npx wrangler pipelines setup
```

## Key Constraint

**Pipeline SQL cannot be modified after creation.** To change the SQL transformation, you must delete and recreate the pipeline.

## Local → Global Transform

The SQL transforms convert local DO identifiers to fully qualified URLs:

| Local (in DO) | Global (in R2 SQL) |
|---------------|-------------------|
| `type: 1` (rowid) | `type: 'https://startups.studio/Startup'` |
| `id: 'acme'` | `id: 'https://startups.studio/acme'` |
| `actor: 'Human/nathan'` | `actor: 'https://startups.studio/Human/nathan'` |

This is done by including the `ns` (namespace) in the event payload from the DO, then concatenating in the SQL transform.

## Event Payload Format

DOs emit events in this format:

```json
{
  "ns": "https://startups.studio",
  "verb": "created",
  "source": "Startup/acme",
  "sourceType": "Startup",
  "data": { ... },
  "actionId": "uuid",
  "timestamp": "2024-01-08T12:00:00Z"
}
```

The SQL transform expands to:

```json
{
  "verb": "created",
  "source": "https://startups.studio/Startup/acme",
  "sourceType": "https://startups.studio/Startup",
  "data": { ... },
  "actionId": "uuid",
  "timestamp": "2024-01-08T12:00:00Z"
}
```

## Wrangler Configuration

```toml
# wrangler.toml

[[pipelines]]
name = "do-events"
binding = "EVENTS_PIPELINE"

[[pipelines]]
name = "do-things"
binding = "THINGS_PIPELINE"

[[pipelines]]
name = "do-actions"
binding = "ACTIONS_PIPELINE"
```

## Usage in DO

```typescript
// In the DO base class
protected async emitEvent(verb: string, data: unknown): Promise<void> {
  // Insert to local events table
  await this.db.insert(schema.events).values({...})

  // Stream to Pipeline (prepend ns for global identity)
  if (this.env.EVENTS_PIPELINE) {
    await this.env.EVENTS_PIPELINE.send({
      ns: this.ns,
      verb,
      source: data.source,
      sourceType: data.type,
      data,
      timestamp: new Date().toISOString(),
    })
  }
}
```

## R2 SQL Queries

Once data flows to R2 Iceberg, query with R2 SQL:

```sql
-- Cross-DO query: All startups that raised in Q4
SELECT * FROM do_things
WHERE type = 'https://startups.studio/Startup'
  AND JSON_EXTRACT(data, '$.raisedAt') >= '2024-10-01'

-- Analytics: Events by type
SELECT verb, COUNT(*) as count
FROM do_events
GROUP BY verb
ORDER BY count DESC

-- Audit: All actions by a specific actor
SELECT * FROM do_actions
WHERE actor = 'https://startups.studio/Human/nathan'
ORDER BY timestamp DESC
```
