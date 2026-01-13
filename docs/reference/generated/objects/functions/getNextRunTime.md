[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / getNextRunTime

# Function: getNextRunTime()

> **getNextRunTime**(`cron`, `options`): `Date`

Defined in: [workflows/ScheduleManager.ts:567](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/ScheduleManager.ts#L567)

Calculate the next run time for a cron expression.

Iterates through future times to find the next moment that matches
all fields in the cron expression. Supports timezone-aware calculation.

## Parameters

### cron

[`CronExpression`](../interfaces/CronExpression.md)

Parsed cron expression object

### options

[`NextRunTimeOptions`](../interfaces/NextRunTimeOptions.md) = `{}`

Optional configuration

## Returns

`Date`

The next Date when the schedule should run (in UTC)

## Examples

```typescript
const cron = parseCronExpression('0 9 * * 1')  // Monday 9am
const nextRun = getNextRunTime(cron)
console.log(nextRun)  // Next Monday at 9am UTC
```

```typescript
const cron = parseCronExpression('0 9 * * *')  // Daily 9am
const nextRun = getNextRunTime(cron, {
  timezone: 'America/New_York'
})
// Returns UTC time that corresponds to 9am in New York
```

```typescript
const cron = parseCronExpression('0 9 * * *')
const nextRun = getNextRunTime(cron, {
  from: new Date('2024-01-15T08:00:00Z')
})
// Returns 2024-01-15T09:00:00Z
```
