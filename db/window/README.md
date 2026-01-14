# Window Primitives

> Flink-inspired windowing with tumbling, sliding, and session windows

## Overview

Window primitives provide Flink-compatible windowing semantics for stream processing. They enable time-based aggregations, event-time processing with watermarks, and exactly-once window computations.

## Features

- **Tumbling windows** - Fixed-size, non-overlapping time buckets
- **Sliding windows** - Overlapping windows with configurable slide
- **Session windows** - Gap-based windows per key
- **Watermarks** - Event-time progress tracking
- **Late data** - Handling out-of-order events
- **Triggers** - Custom window firing policies
- **Three-tier storage** - Hot/warm/cold automatic tiering

## Three-Tier Storage

```
┌─────────────────────────────────────────────────────────────────┐
│ HOT: DO SQLite                                                  │
│ • Active windows (current + recent)                             │
│ • Watermark state                                               │
│ • Late data buffer                                              │
│ Access: <1ms                                                    │
├─────────────────────────────────────────────────────────────────┤
│ WARM: R2 Parquet                                                │
│ • Closed window results                                         │
│ • Aggregated metrics by window                                  │
│ • Pre-computed rollups                                          │
│ Access: ~50ms                                                   │
├─────────────────────────────────────────────────────────────────┤
│ COLD: R2 Iceberg Archive                                        │
│ • Full window history                                           │
│ • Cross-DO window joins                                         │
│ • Analytics on historical windows                               │
│ Access: ~100ms                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Window Types

### Tumbling Windows

Fixed-size, non-overlapping windows:

```typescript
import { TumblingWindow } from 'dotdo/db/window'

// 1-hour tumbling window
const hourlyMetrics = new TumblingWindow<Metric>({
  size: '1h',
  aggregate: (events) => ({
    count: events.length,
    sum: events.reduce((s, e) => s + e.value, 0),
    avg: events.reduce((s, e) => s + e.value, 0) / events.length,
  }),
})

// Add events
await hourlyMetrics.add({ timestamp: Date.now(), value: 100 })

// Get current window state
const current = await hourlyMetrics.getCurrent()

// Get closed windows
const closed = await hourlyMetrics.getClosed({ limit: 24 })
```

```
Time:    |-------|-------|-------|-------|
Window:  [  W1   ][  W2   ][  W3   ][  W4   ]
         0       1h       2h       3h       4h
```

### Sliding Windows

Overlapping windows with configurable slide:

```typescript
import { SlidingWindow } from 'dotdo/db/window'

// 1-hour window, sliding every 15 minutes
const rollingMetrics = new SlidingWindow<Metric>({
  size: '1h',
  slide: '15m',
  aggregate: (events) => ({
    p50: percentile(events, 50),
    p99: percentile(events, 99),
  }),
})
```

```
Time:    |-------|-------|-------|-------|
Window1: [       W1       ]
Window2:     [       W2       ]
Window3:         [       W3       ]
Window4:             [       W4       ]
         0      15m     30m     45m     1h
```

### Session Windows

Gap-based windows per key:

```typescript
import { SessionWindow } from 'dotdo/db/window'

// Session window with 30-minute gap
const userSessions = new SessionWindow<UserEvent>({
  gap: '30m',
  keyBy: (event) => event.userId,
  aggregate: (events) => ({
    duration: events[events.length - 1].timestamp - events[0].timestamp,
    pageViews: events.filter(e => e.type === 'pageView').length,
    actions: events.length,
  }),
})

// Events create/extend sessions per user
await userSessions.add({ userId: 'alice', type: 'pageView', timestamp: t1 })
await userSessions.add({ userId: 'alice', type: 'click', timestamp: t1 + 1000 })
// 30+ minutes later...
await userSessions.add({ userId: 'alice', type: 'pageView', timestamp: t1 + 2000000 })
// New session created for alice
```

```
User Alice:
Events:  x     x  x              x    x
         |     |  |              |    |
Session: [  Session 1  ]         [ Session 2 ]
         <----- gap ----->
```

## Watermarks

Watermarks track event-time progress for handling out-of-order events:

```typescript
import { WindowManager, Watermark } from 'dotdo/db/window'

const manager = new WindowManager({
  watermarkStrategy: 'bounded',  // or 'punctuated'
  maxOutOfOrder: '5m',           // Allow 5 minutes late
  allowedLateness: '1h',         // Accept up to 1 hour late
})

// Watermark advances as events arrive
await manager.add({ timestamp: '2024-01-14T12:00:00Z', value: 100 })
// Watermark: 2024-01-14T11:55:00Z (event time - maxOutOfOrder)

// Late event handling
manager.on('lateData', (event, window) => {
  console.log(`Late event for window ${window.id}:`, event)
})
```

## Triggers

Custom window firing policies:

```typescript
import { Trigger, EventTimeTrigger, ProcessingTimeTrigger } from 'dotdo/db/window'

// Fire on watermark passing window end
const eventTimeTrigger = new EventTimeTrigger()

// Fire every N events
const countTrigger = new Trigger.Count(100)

// Fire after processing time duration
const processingTimeTrigger = new ProcessingTimeTrigger('1m')

// Combine triggers
const combinedTrigger = Trigger.any([
  eventTimeTrigger,
  countTrigger,
  Trigger.timeout('5m'),  // Fire if no events for 5m
])

const window = new TumblingWindow({
  size: '1h',
  trigger: combinedTrigger,
})
```

## API

```typescript
import {
  WindowManager,
  TumblingWindow,
  SlidingWindow,
  SessionWindow,
  Watermark,
} from 'dotdo/db/window'

// Create window manager
const manager = new WindowManager(db, {
  maxOutOfOrder: '5m',
  allowedLateness: '1h',
})

// Register windows
manager.register('hourly_metrics', new TumblingWindow({ size: '1h' }))
manager.register('rolling_p99', new SlidingWindow({ size: '1h', slide: '5m' }))
manager.register('user_sessions', new SessionWindow({ gap: '30m', keyBy: 'userId' }))

// Add events (routed to all relevant windows)
await manager.add({
  timestamp: Date.now(),
  userId: 'alice',
  metric: 'latency',
  value: 150,
})

// Query window state
const hourly = await manager.get('hourly_metrics').getCurrent()
const sessions = await manager.get('user_sessions').getByKey('alice')

// Handle window close
manager.on('windowClose', async (windowId, result) => {
  await pipeline.send({
    type: 'window.closed',
    window: windowId,
    result,
  })
})
```

## Schema

```sql
-- Window state
CREATE TABLE windows (
  window_id TEXT PRIMARY KEY,
  window_type TEXT NOT NULL,  -- 'tumbling', 'sliding', 'session'
  config JSON NOT NULL,
  status TEXT NOT NULL,       -- 'active', 'closed', 'archived'
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  key TEXT,                   -- For keyed windows
  state JSON                  -- Aggregation state
);

-- Events in active windows
CREATE TABLE window_events (
  event_id TEXT PRIMARY KEY,
  window_id TEXT NOT NULL,
  event_time INTEGER NOT NULL,
  data JSON NOT NULL,
  FOREIGN KEY (window_id) REFERENCES windows(window_id)
);

-- Watermark state
CREATE TABLE watermarks (
  source TEXT PRIMARY KEY,
  watermark INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Late data buffer
CREATE TABLE late_data (
  event_id TEXT PRIMARY KEY,
  event_time INTEGER NOT NULL,
  data JSON NOT NULL,
  target_window TEXT,
  received_at INTEGER NOT NULL
);

CREATE INDEX idx_windows_status ON windows(status, end_time);
CREATE INDEX idx_events_window ON window_events(window_id, event_time);
CREATE INDEX idx_late_received ON late_data(received_at);
```

## CDC Events

```typescript
// On window close
{
  type: 'window.closed',
  windowId: 'hourly_metrics_2024-01-14T12:00:00Z',
  windowType: 'tumbling',
  startTime: '2024-01-14T12:00:00Z',
  endTime: '2024-01-14T13:00:00Z',
  result: { count: 1000, sum: 50000, avg: 50 }
}

// On late data
{
  type: 'window.late_data',
  windowId: 'hourly_metrics_2024-01-14T11:00:00Z',
  eventTime: '2024-01-14T11:30:00Z',
  lateness: '45m'
}
```

## When to Use

| Use Window | Use Stream |
|------------|------------|
| Time-based aggregations | Simple event processing |
| Metrics and analytics | Message passing |
| Session analysis | Event sourcing |
| Real-time dashboards | Queue processing |

## Dependencies

None. Uses only native SQLite.

## Related

- [`do/primitives/window-manager.ts`](../../do/primitives/window-manager.ts) - Core window manager
- [`do/primitives/watermark-service.ts`](../../do/primitives/watermark-service.ts) - Watermark tracking
- Flink documentation for compatibility details

## Implementation Status

| Feature | Status |
|---------|--------|
| Tumbling windows | See `do/primitives/window-manager.ts` |
| Sliding windows | TBD |
| Session windows | TBD |
| Watermarks | See `do/primitives/watermark-service.ts` |
| Triggers | TBD |
| Late data handling | TBD |
| Hot → Warm tiering | TBD |
| CDC integration | TBD |
