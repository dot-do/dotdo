# cron.example.com.ai

Scheduled jobs for Durable Objects using dotdo's `$.every` DSL.

## The Problem

Cron syntax is write-only:

```
0 9 * * 1
```

What does that mean? Monday at 9am? Or the 9th minute of every hour on the 1st?

Adding scheduled jobs means another service, another dependency, another thing to monitor.

## The Solution

Write schedules in plain English. They run inside your Durable Object.

```typescript
$.every.Monday.at9am(generateWeeklyReport)
$.every.day.at('6pm')(sendDailyDigest)
$.every.hour(checkHealth)
```

No external dependencies. No cron syntax. Schedules that explain themselves.

## Quick Start

```typescript
import { $ } from 'dotdo'

// Weekly report every Monday at 9am
$.every.Monday.at9am(async () => {
  const report = await generateReport()
  await sendToSlack(report)
})

// Health check every hour
$.every.hour(async () => {
  const status = await checkAllServices()
  if (!status.healthy) await alertOnCall(status)
})
```

## Schedule Patterns

### Days of the Week

```typescript
$.every.Monday.at9am(handler)
$.every.Tuesday.at('10:30am')(handler)
$.every.Friday.at6am(handler)
$.every.Sunday.at('midnight')(handler)
```

### Daily Schedules

```typescript
$.every.day.at9am(handler)
$.every.day.at('6pm')(handler)
$.every.day.at('14:30')(handler)      // 24-hour format
$.every.day.at('noon')(handler)       // Named times
```

### Intervals

```typescript
$.every.hour(handler)
$.every.minute(handler)
$.every(5).minutes(handler)
$.every(2).hours(handler)
$.every(30).seconds(handler)
```

## Cron Conversion

The DSL converts to standard 5-field cron:

| DSL Pattern | Cron |
|-------------|------|
| `$.every.Monday.at9am` | `0 9 * * 1` |
| `$.every.day.at('6pm')` | `0 18 * * *` |
| `$.every.hour` | `0 * * * *` |
| `$.every.minute` | `* * * * *` |
| `$.every(5).minutes` | `*/5 * * * *` |
| `$.every(2).hours` | `0 */2 * * *` |
| `$.every.day.at('9:30am')` | `30 9 * * *` |

## One-Time Scheduling

Schedule a handler for a specific date/time:

```typescript
$.at('2024-12-25T09:00:00Z')(async () => {
  await sendHolidayGreeting()
})

const launchDate = new Date('2024-06-01T00:00:00Z')
$.at(launchDate)(async () => {
  await triggerProductLaunch()
})
```

## Handler Patterns

### Unsubscribe

Every schedule returns an unsubscribe function:

```typescript
const unsubscribe = $.every.Monday.at9am(handler)
unsubscribe()  // Stop the schedule
```

### Combine with Events

```typescript
$.every.Monday.at9am(async () => {
  const report = await generateReport()
  $.send('Report.generated', { report })
})

$.on.Report.generated(async (event) => {
  await sendToStakeholders(event.data.report)
})
```

## Time Formats

```typescript
$.every.day.at('9am')(handler)       // 12-hour
$.every.day.at('5:30pm')(handler)
$.every.day.at('17:30')(handler)     // 24-hour
$.every.day.at('noon')(handler)      // Named
$.every.day.at9am(handler)           // Shortcuts
```

## Full Example

```typescript
import { $ } from 'dotdo'

// Morning prep
$.every.day.at6am(async () => {
  await warmCaches()
  await precomputeReports()
})

// Health monitoring
$.every(15).minutes(async () => {
  const health = await checkServices()
  if (health.degraded) $.send('System.degraded', health)
})

// Nightly cleanup
$.every.day.at('11pm')(async () => {
  await archiveLogs()
  await pruneOldData()
})

// Weekly reports
$.every.Monday.at9am(async () => {
  const metrics = await collectWeeklyMetrics()
  await sendWeeklyReport(metrics)
})

// Monthly billing (1st of month)
$.every.day.at('midnight')(async () => {
  if (new Date().getDate() === 1) {
    await processMonthlyBilling()
  }
})

// Alert handler
$.on.System.degraded(async (event) => {
  await notifyOnCall(event.data)
})
```

## How It Works

1. `$.every` builds schedule expressions via proxy
2. Patterns convert to cron expressions
3. Cron registers with DO alarm API
4. Alarms fire, handlers execute, reschedule

Runs inside your Durable Object. No external scheduler.

## Promise Pipelining

Promises are stubs. Chain freely, await only when needed.

```typescript
// Batch notifications - fire and forget
$.every.Monday.at9am(async () => {
  const report = await generateReport()

  // ❌ Sequential - N round-trips
  for (const userId of subscribers) {
    await $.User(userId).sendDigest(report)
  }

  // ✅ Pipelined - fire and forget
  subscribers.forEach(id => $.User(id).sendDigest(report))
})

// Chain without awaiting intermediate results
$.every.hour(async () => {
  // ✅ Single round-trip - only await the final value
  const status = await $.Monitor('health').check().status
  if (status !== 'ok') $.Alert('oncall').notify(status)
})
```

Only `await` at exit points when you need the value. Side effects don't require awaiting.

## See Also

- [dotdo docs](https://dotdo.dev/docs) - Full documentation
- [$.on handlers](https://dotdo.dev/docs/events) - Event patterns
- [$.do execution](https://dotdo.dev/docs/durable) - Durable tasks
