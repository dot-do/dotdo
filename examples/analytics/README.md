# analytics.example.com.ai

**Product analytics at the cost of a side project.**

```typescript
await this.track('PageView', { userId: 'alice', page: '/pricing' })

const activeNow = await this.counters.get('active_users_1m')  // real-time
const retention = await this.iceberg.query({ sql: '...' })    // historical
```

**10M events/day. $5/month. No vendor lock-in.**

---

## The Problem

| Solution | Monthly Cost | Latency |
|----------|-------------|---------|
| Amplitude/Mixpanel | $2,000+ | Seconds |
| Self-hosted | $500+ | Minutes |
| **dotdo Analytics** | **$5** | **Milliseconds** |

---

## The Solution

dotdo's 4-layer storage turns a Durable Object into a complete analytics backend:

```
L0: InMemory    Real-time counters     (active now)
L1: Pipeline    High-volume ingestion  (10K events/sec)
L2: SQLite      Hourly/daily rollups   (7-day window)
L3: Iceberg     Historical archive     (time travel)
```

---

## Storage Layer Progression

### L0: InMemory - Real-Time Counters

```typescript
this.counters.incr('pageviews_1m', 1, { ttl: 60 })
this.counters.incr(`active:${userId}`, 1, { ttl: 60 })

// Read instantly (no query)
const active = this.counters.count('active:*')
```

### L1: Pipeline - High-Volume Ingestion

```typescript
async track(event: string, props: Record<string, unknown>) {
  // Emit to Pipeline (durable immediately, ACK before SQLite)
  this.pipeline.emit('event', 'analytics', {
    event, props, timestamp: Date.now(),
  })

  // Update real-time counters (L0)
  this.counters.incr(`event:${event}`, 1)
}
```

### L2: SQLite - Scheduled Rollups

```typescript
this.every.hour(async () => {
  await this.sql`
    INSERT INTO hourly_events (hour, event, count)
    SELECT strftime('%Y-%m-%d %H:00', timestamp/1000, 'unixepoch'),
           event, COUNT(*)
    FROM raw_events
    WHERE timestamp > ${Date.now() - 3600000}
    GROUP BY 1, 2
    ON CONFLICT DO UPDATE SET count = excluded.count
  `
})

this.every.day.at('3am')(async () => {
  await this.sql`
    INSERT INTO daily_metrics (date, dau, events)
    SELECT date(timestamp/1000, 'unixepoch'),
           COUNT(DISTINCT user_id), COUNT(*)
    FROM raw_events WHERE timestamp > ${Date.now() - 86400000}
    GROUP BY 1
  `
})
```

### L3: Iceberg - Historical Archive

```typescript
this.every.Sunday.at('4am')(async () => {
  const weekAgo = Date.now() - 7 * 86400000
  const old = await this.sql`SELECT * FROM raw_events WHERE timestamp < ${weekAgo}`
  await this.iceberg.write(old)
  await this.sql`DELETE FROM raw_events WHERE timestamp < ${weekAgo}`
})

// Time travel query
const dau = await this.iceberg.query({
  asOf: new Date('2024-01-15'),
  sql: `SELECT date, COUNT(DISTINCT user_id) FROM events GROUP BY 1`
})
```

---

## Real-Time vs Historical

```typescript
// Real-time: L0 counters (instant)
async getActiveUsers() {
  return this.counters.count('active:*')
}

// Recent: L2 SQLite (milliseconds)
async getDAU(days: number) {
  return this.sql`SELECT date, dau FROM daily_metrics LIMIT ${days}`
}

// Historical: L3 Iceberg (seconds)
async getRetention() {
  return this.iceberg.query({ sql: `SELECT cohort, week, retained FROM retention` })
}
```

---

## Promise Pipelining (Cap'n Web)

True Cap'n Proto-style pipelining: method calls on stubs batch until `await`, then resolve in a single round-trip.

```typescript
// ❌ Sequential - N round-trips
for (const event of batch) {
  await this.Analytics(tenantId).track(event)
}

// ✅ Pipelined - fire and forget
batch.forEach(e => this.Analytics(tenantId).track(e))

// ✅ Pipelined - single round-trip for chained access
const dau = await this.Analytics(tenantId).getDAU(7).then(r => r[0].dau)
```

`this.Noun(id)` returns a pipelined stub. Analytics events are fire-and-forget by nature. No need to `await` each `track()` call - just emit and move on. The Pipeline (L1) handles durability.

---

## Quick Start

```bash
# Track event
curl -X POST https://analytics.example.com.ai/track \
  -d '{"event":"PageView","properties":{"userId":"123","page":"/pricing"}}'

# Real-time stats
curl https://analytics.example.com.ai/stats

# Historical query
curl -X POST https://analytics.example.com.ai/query \
  -d '{"sql":"SELECT date, dau FROM daily_metrics ORDER BY date DESC LIMIT 7"}'
```

---

## API

| Endpoint | Description |
|----------|-------------|
| `POST /track` | Ingest event |
| `POST /track/batch` | Batch ingest |
| `GET /stats` | Real-time counters |
| `GET /dau` | Daily active users |
| `POST /query` | SQL query |

---

## Cost Breakdown (10M events/day)

| Layer | Cost |
|-------|------|
| L1: Pipeline | ~$1 |
| L2: SQLite | ~$0.01 |
| L3: R2 | ~$0.10 |
| **Total** | **~$5/month** |

---

## Architecture

```
track() ──▶ Pipeline (L1) ──▶ ACK
                │
                ▼
          InMemory (L0) counters
                │
          this.every.hour ──▶ SQLite (L2) rollups
                               │
                         this.every.week ──▶ Iceberg (L3) archive

Query:  Real-time → L0    Recent → L2    Historical → L3
```

---

Built with [dotdo](https://dotdo.dev)
