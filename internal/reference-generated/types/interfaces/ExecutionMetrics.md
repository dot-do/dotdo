[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ExecutionMetrics

# Interface: ExecutionMetrics

Defined in: [types/AIFunction.ts:333](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L333)

Base execution metrics shared by all function types

## Extended by

- [`GenerativeMetrics`](GenerativeMetrics.md)
- [`HumanMetrics`](HumanMetrics.md)

## Properties

### cached

> **cached**: `boolean`

Defined in: [types/AIFunction.ts:343](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L343)

Whether result was from cache

***

### completedAt

> **completedAt**: `Date`

Defined in: [types/AIFunction.ts:339](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L339)

End time

***

### durationMs

> **durationMs**: `number`

Defined in: [types/AIFunction.ts:335](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L335)

Total duration in milliseconds

***

### retryCount

> **retryCount**: `number`

Defined in: [types/AIFunction.ts:341](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L341)

Number of retry attempts

***

### startedAt

> **startedAt**: `Date`

Defined in: [types/AIFunction.ts:337](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L337)

Start time
