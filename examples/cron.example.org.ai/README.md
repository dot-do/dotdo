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
this.every.Monday.at('9am')(generateWeeklyReport)
this.every.day.at('6pm')(sendDailyDigest)
this.every.hour(checkHealth)
```

No external dependencies. No cron syntax. Schedules that explain themselves.

## Quick Start

```typescript
import { DO } from 'dotdo'

export default DO.extend({
  init() {
    // Weekly report every Monday at 9am
    this.every.Monday.at('9am')(async () => {
      const report = await generateReport()
      await sendToSlack(report)
    })

    // Health check every hour
    this.every.hour(async () => {
      const status = await checkAllServices()
      if (!status.healthy) await alertOnCall(status)
    })
  }
})
```

## Schedule Patterns

### Days of the Week

```typescript
this.every.Monday.at('9am')(handler)
this.every.Tuesday.at('10:30am')(handler)
this.every.Friday.at('6am')(handler)
this.every.Sunday.at('midnight')(handler)
```

### Daily Schedules

```typescript
this.every.day.at('9am')(handler)
this.every.day.at('6pm')(handler)
this.every.day.at('14:30')(handler)      // 24-hour format
this.every.day.at('noon')(handler)       // Named times
```

### Intervals

```typescript
this.every.hour(handler)
this.every.minute(handler)
this.every(5).minutes(handler)
this.every(2).hours(handler)
this.every(30).seconds(handler)
```

## Cron Conversion

The DSL converts to standard 5-field cron:

| DSL Pattern | Cron |
|-------------|------|
| `this.every.Monday.at('9am')` | `0 9 * * 1` |
| `this.every.day.at('6pm')` | `0 18 * * *` |
| `this.every.hour` | `0 * * * *` |
| `this.every.minute` | `* * * * *` |
| `this.every(5).minutes` | `*/5 * * * *` |
| `this.every(2).hours` | `0 */2 * * *` |
| `this.every.day.at('9:30am')` | `30 9 * * *` |

## One-Time Scheduling

Schedule a handler for a specific date/time:

```typescript
this.at('2024-12-25T09:00:00Z')(async () => {
  await sendHolidayGreeting()
})

const launchDate = new Date('2024-06-01T00:00:00Z')
this.at(launchDate)(async () => {
  await triggerProductLaunch()
})
```

## Handler Patterns

### Unsubscribe

Every schedule returns an unsubscribe function:

```typescript
const unsubscribe = this.every.Monday.at('9am')(handler)
unsubscribe()  // Stop the schedule
```

### Combine with Events

```typescript
this.every.Monday.at('9am')(async () => {
  const report = await generateReport()
  this.send('Report.generated', { report })
})

this.on.Report.generated(async (event) => {
  await sendToStakeholders(event.data.report)
})
```

## Time Formats

```typescript
this.every.day.at('9am')(handler)       // 12-hour
this.every.day.at('5:30pm')(handler)
this.every.day.at('17:30')(handler)     // 24-hour
this.every.day.at('noon')(handler)      // Named
```

## Full Example

```typescript
import { DO } from 'dotdo'

export default DO.extend({
  init() {
    // Morning prep
    this.every.day.at('6am')(async () => {
      await warmCaches()
      await precomputeReports()
    })

    // Health monitoring
    this.every(15).minutes(async () => {
      const health = await checkServices()
      if (health.degraded) this.send('System.degraded', health)
    })

    // Nightly cleanup
    this.every.day.at('11pm')(async () => {
      await archiveLogs()
      await pruneOldData()
    })

    // Weekly reports
    this.every.Monday.at('9am')(async () => {
      const metrics = await collectWeeklyMetrics()
      await sendWeeklyReport(metrics)
    })

    // Monthly billing (1st of month)
    this.every.day.at('midnight')(async () => {
      if (new Date().getDate() === 1) {
        await processMonthlyBilling()
      }
    })

    // Alert handler
    this.on.System.degraded(async (event) => {
      await notifyOnCall(event.data)
    })
  }
})
```

## How It Works

1. `this.every` builds schedule expressions via proxy
2. Patterns convert to cron expressions
3. Cron registers with DO alarm API
4. Alarms fire, handlers execute, reschedule

Runs inside your Durable Object. No external scheduler.

## Promise Pipelining (Cap'n Web)

True Cap'n Proto-style pipelining: method calls on stubs batch until `await`, then resolve in a single round-trip.

```typescript
// Batch notifications - fire and forget
this.every.Monday.at('9am')(async () => {
  const report = await generateReport()

  // ❌ Sequential - N round-trips
  for (const userId of subscribers) {
    await this.User(userId).sendDigest(report)
  }

  // ✅ Pipelined - fire and forget
  subscribers.forEach(id => this.User(id).sendDigest(report))
})

// Chain without awaiting intermediate results
this.every.hour(async () => {
  // ✅ Single round-trip - only await the final value
  const status = await this.Monitor('health').check().status
  if (status !== 'ok') this.Alert('oncall').notify(status)
})
```

`this.Noun(id)` returns a pipelined stub. Property access and method calls are recorded, then executed server-side on `await`.

## See Also

- [dotdo docs](https://dotdo.dev/docs) - Full documentation
- [this.on handlers](https://dotdo.dev/docs/events) - Event patterns
- [this.do execution](https://dotdo.dev/docs/durable) - Durable tasks
