[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / GenerativeMetrics

# Interface: GenerativeMetrics

Defined in: [types/AIFunction.ts:349](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L349)

Metrics specific to generative execution

## Extends

- [`ExecutionMetrics`](ExecutionMetrics.md)

## Extended by

- [`AgenticMetrics`](AgenticMetrics.md)

## Properties

### cached

> **cached**: `boolean`

Defined in: [types/AIFunction.ts:343](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L343)

Whether result was from cache

#### Inherited from

[`ExecutionMetrics`](ExecutionMetrics.md).[`cached`](ExecutionMetrics.md#cached)

***

### completedAt

> **completedAt**: `Date`

Defined in: [types/AIFunction.ts:339](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L339)

End time

#### Inherited from

[`ExecutionMetrics`](ExecutionMetrics.md).[`completedAt`](ExecutionMetrics.md#completedat)

***

### completionTokens

> **completionTokens**: `number`

Defined in: [types/AIFunction.ts:353](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L353)

Tokens generated in completion

***

### durationMs

> **durationMs**: `number`

Defined in: [types/AIFunction.ts:335](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L335)

Total duration in milliseconds

#### Inherited from

[`ExecutionMetrics`](ExecutionMetrics.md).[`durationMs`](ExecutionMetrics.md#durationms)

***

### finishReason

> **finishReason**: `"error"` \| `"stop"` \| `"length"` \| `"content_filter"` \| `"tool_calls"`

Defined in: [types/AIFunction.ts:361](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L361)

Finish reason

***

### model

> **model**: `string`

Defined in: [types/AIFunction.ts:357](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L357)

Model that was used

***

### promptTokens

> **promptTokens**: `number`

Defined in: [types/AIFunction.ts:351](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L351)

Tokens used in the prompt

***

### provider

> **provider**: `AIProvider`

Defined in: [types/AIFunction.ts:359](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L359)

Provider that was used

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

### totalTokens

> **totalTokens**: `number`

Defined in: [types/AIFunction.ts:355](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L355)

Total tokens used
