[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / ScheduleManager

# Class: ScheduleManager

Defined in: [workflows/ScheduleManager.ts:651](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/ScheduleManager.ts#L651)

Schedule Manager for Durable Objects.

Manages cron-based schedules with full CRUD operations, timezone support,
and integration with the Durable Object alarm API for reliable execution.

## Examples

```typescript
class MyWorkflow extends DurableObject {
  private scheduleManager: ScheduleManager

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.scheduleManager = new ScheduleManager(ctx.state)

    this.scheduleManager.onScheduleTrigger(async (schedule) => {
      await this.runTask(schedule.name)
    })
  }

  async registerSchedules() {
    await this.scheduleManager.schedule('0 9 * * 1', 'weekly-sync')
    await this.scheduleManager.schedule('0 0 1 * *', 'monthly-report')
  }

  async alarm() {
    await this.scheduleManager.handleAlarm()
  }
}
```

```typescript
await scheduleManager.schedule('0 9 * * *', 'daily-sync', {
  timezone: 'America/New_York',
  metadata: {
    target: 'salesforce',
    priority: 'high'
  }
})
```

## Constructors

### Constructor

> **new ScheduleManager**(`state`): `ScheduleManager`

Defined in: [workflows/ScheduleManager.ts:662](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/ScheduleManager.ts#L662)

Create a new ScheduleManager.

#### Parameters

##### state

`DurableObjectState`

The Durable Object state, providing storage access

#### Returns

`ScheduleManager`

## Methods

### deleteSchedule()

> **deleteSchedule**(`name`): `Promise`\<`void`\>

Defined in: [workflows/ScheduleManager.ts:800](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/ScheduleManager.ts#L800)

Delete a schedule

#### Parameters

##### name

`string`

#### Returns

`Promise`\<`void`\>

***

### getSchedule()

> **getSchedule**(`name`): `Promise`\<[`Schedule`](../interfaces/Schedule.md) \| `null`\>

Defined in: [workflows/ScheduleManager.ts:778](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/ScheduleManager.ts#L778)

Get a schedule by name

#### Parameters

##### name

`string`

#### Returns

`Promise`\<[`Schedule`](../interfaces/Schedule.md) \| `null`\>

***

### handleAlarm()

> **handleAlarm**(): `Promise`\<`void`\>

Defined in: [workflows/ScheduleManager.ts:909](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/ScheduleManager.ts#L909)

Handle a DO alarm - triggers any schedules due to run.

This method should be called from the Durable Object's `alarm()` method.
It finds all active schedules that are due, triggers them, and sets
the next alarm.

For each due schedule:
1. Calls the registered trigger handler
2. Records the trigger event for auditing
3. Updates lastRunAt and increments runCount
4. Calculates and stores the next run time

After processing, sets the DO alarm for the next scheduled run.

#### Returns

`Promise`\<`void`\>

#### Example

```typescript
class MyWorkflow extends DurableObject {
  private scheduleManager: ScheduleManager

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.scheduleManager = new ScheduleManager(ctx.state)

    this.scheduleManager.onScheduleTrigger(async (schedule) => {
      await this.executeScheduledTask(schedule)
    })
  }

  // Called by Cloudflare when alarm fires
  async alarm() {
    await this.scheduleManager.handleAlarm()
  }
}
```

***

### listSchedules()

> **listSchedules**(`options`): `Promise`\<[`Schedule`](../interfaces/Schedule.md)[]\>

Defined in: [workflows/ScheduleManager.ts:789](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/ScheduleManager.ts#L789)

List all registered schedules

#### Parameters

##### options

[`ScheduleListOptions`](../interfaces/ScheduleListOptions.md) = `{}`

#### Returns

`Promise`\<[`Schedule`](../interfaces/Schedule.md)[]\>

***

### onScheduleTrigger()

> **onScheduleTrigger**(`handler`): `void`

Defined in: [workflows/ScheduleManager.ts:689](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/ScheduleManager.ts#L689)

Register a handler to be called when a schedule triggers.

The handler is invoked during `handleAlarm()` for each schedule
that is due to run. Only one handler can be registered at a time.

#### Parameters

##### handler

`ScheduleTriggerHandler`

Async function called with the triggering schedule

#### Returns

`void`

#### Example

```typescript
scheduleManager.onScheduleTrigger(async (schedule) => {
  console.log(`Running: ${schedule.name}`)
  console.log(`Cron: ${schedule.cronExpression}`)
  console.log(`Run count: ${schedule.runCount}`)

  if (schedule.metadata?.target === 'salesforce') {
    await syncSalesforce()
  }
})
```

***

### schedule()

> **schedule**(`cronExpression`, `name`, `options`): `Promise`\<[`Schedule`](../interfaces/Schedule.md)\>

Defined in: [workflows/ScheduleManager.ts:735](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/ScheduleManager.ts#L735)

Register a new cron schedule.

Creates a schedule that will trigger at times matching the cron expression.
The schedule is persisted and survives DO hibernation.

#### Parameters

##### cronExpression

`string`

Standard 5-field cron expression

##### name

`string`

Unique name for the schedule

##### options

[`ScheduleOptions`](../interfaces/ScheduleOptions.md) = `{}`

Optional configuration

#### Returns

`Promise`\<[`Schedule`](../interfaces/Schedule.md)\>

The created schedule object

#### Throws

ScheduleValidationError if name already exists

#### Throws

InvalidCronExpressionError if cron is malformed

#### Examples

```typescript
const schedule = await manager.schedule('0 9 * * 1', 'weekly-report')
console.log(schedule.nextRunAt)  // Next Monday 9am
```

```typescript
const schedule = await manager.schedule('0 18 * * *', 'daily-sync', {
  timezone: 'Asia/Tokyo',
  metadata: { region: 'apac', priority: 1 },
  enabled: true
})
```

```typescript
// Create but don't run until explicitly enabled
const schedule = await manager.schedule('0 0 * * *', 'migration', {
  enabled: false
})

// Later, enable it
await manager.updateSchedule('migration', { enabled: true })
```

***

### updateSchedule()

> **updateSchedule**(`name`, `options`): `Promise`\<[`Schedule`](../interfaces/Schedule.md)\>

Defined in: [workflows/ScheduleManager.ts:813](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/ScheduleManager.ts#L813)

Update a schedule

#### Parameters

##### name

`string`

##### options

[`ScheduleUpdateOptions`](../interfaces/ScheduleUpdateOptions.md)

#### Returns

`Promise`\<[`Schedule`](../interfaces/Schedule.md)\>
