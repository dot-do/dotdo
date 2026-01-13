[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / HumanMetrics

# Interface: HumanMetrics

Defined in: [types/AIFunction.ts:381](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L381)

Metrics specific to human execution

## Extends

- [`ExecutionMetrics`](ExecutionMetrics.md)

## Properties

### cached

> **cached**: `boolean`

Defined in: [types/AIFunction.ts:343](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L343)

Whether result was from cache

#### Inherited from

[`ExecutionMetrics`](ExecutionMetrics.md).[`cached`](ExecutionMetrics.md#cached)

***

### channel

> **channel**: `"webhook"` \| `"web"` \| `"email"` \| `"sms"` \| `"slack"` \| `undefined`

Defined in: [types/AIFunction.ts:383](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L383)

Channel used for communication

***

### completedAt

> **completedAt**: `Date`

Defined in: [types/AIFunction.ts:339](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L339)

End time

#### Inherited from

[`ExecutionMetrics`](ExecutionMetrics.md).[`completedAt`](ExecutionMetrics.md#completedat)

***

### durationMs

> **durationMs**: `number`

Defined in: [types/AIFunction.ts:335](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L335)

Total duration in milliseconds

#### Inherited from

[`ExecutionMetrics`](ExecutionMetrics.md).[`durationMs`](ExecutionMetrics.md#durationms)

***

### escalated

> **escalated**: `boolean`

Defined in: [types/AIFunction.ts:391](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L391)

Whether escalation occurred

***

### remindersSent

> **remindersSent**: `number`

Defined in: [types/AIFunction.ts:389](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L389)

Number of reminders sent

***

### respondent

> **respondent**: `string`

Defined in: [types/AIFunction.ts:385](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L385)

User who responded

***

### retryCount

> **retryCount**: `number`

Defined in: [types/AIFunction.ts:341](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L341)

Number of retry attempts

#### Inherited from

[`ExecutionMetrics`](ExecutionMetrics.md).[`retryCount`](ExecutionMetrics.md#retrycount)

***

### startedAt

> **startedAt**: `Date`

Defined in: [types/AIFunction.ts:337](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L337)

Start time

#### Inherited from

[`ExecutionMetrics`](ExecutionMetrics.md).[`startedAt`](ExecutionMetrics.md#startedat)

***

### timeToFirstResponseMs?

> `optional` **timeToFirstResponseMs**: `number`

Defined in: [types/AIFunction.ts:387](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L387)

Time until first response
