[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / parseCronExpression

# Function: parseCronExpression()

> **parseCronExpression**(`expression`): [`CronExpression`](../interfaces/CronExpression.md)

Defined in: [workflows/ScheduleManager.ts:410](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/ScheduleManager.ts#L410)

Parse a cron expression string into a structured CronExpression object.

Supports standard 5-field cron format with extensions for readability.

## Fields

| Position | Field | Range | Example |
|----------|-------|-------|---------|
| 1 | minute | 0-59 | `0`, `30`, `*​/5` |
| 2 | hour | 0-23 | `9`, `0-12`, `*` |
| 3 | day of month | 1-31 | `1`, `15`, `1,15` |
| 4 | month | 1-12 | `1`, `JAN`, `*` |
| 5 | day of week | 0-6 | `0`, `MON`, `1-5` |

## Supported Syntax

- **Wildcards**: `*` matches all values
- **Ranges**: `1-5` matches 1, 2, 3, 4, 5
- **Lists**: `1,3,5` matches 1, 3, or 5
- **Steps**: `*​/15` (every 15), `0-30/10` (0, 10, 20, 30)
- **Month names**: `JAN`, `FEB`, ..., `DEC`
- **Day names**: `SUN`, `MON`, ..., `SAT`

## Parameters

### expression

`string`

The cron expression string to parse

## Returns

[`CronExpression`](../interfaces/CronExpression.md)

Parsed CronExpression object

## Throws

InvalidCronExpressionError if the expression is malformed

## Example

```typescript
// Every Monday at 9am
const cron = parseCronExpression('0 9 * * 1')
// { minute: [0], hour: [9], dayOfMonth: '*', month: '*', dayOfWeek: [1] }

// Every 5 minutes
const cron2 = parseCronExpression('*​/5 * * * *')
// { minute: [0,5,10,15,20,25,30,35,40,45,50,55], ... }

// Weekdays at 8:30am
const cron3 = parseCronExpression('30 8 * * MON-FRI')
// { minute: [30], hour: [8], ..., dayOfWeek: [1,2,3,4,5] }
```
