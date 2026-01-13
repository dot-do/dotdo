[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / AgenticMetrics

# Interface: AgenticMetrics

Defined in: [types/AIFunction.ts:367](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L367)

Metrics specific to agentic execution

## Extends

- [`GenerativeMetrics`](GenerativeMetrics.md)

## Properties

### cached

> **cached**: `boolean`

Defined in: [types/AIFunction.ts:343](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L343)

Whether result was from cache

#### Inherited from

[`GenerativeMetrics`](GenerativeMetrics.md).[`cached`](GenerativeMetrics.md#cached)

***

### completedAt

> **completedAt**: `Date`

Defined in: [types/AIFunction.ts:339](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L339)

End time

#### Inherited from

[`GenerativeMetrics`](GenerativeMetrics.md).[`completedAt`](GenerativeMetrics.md#completedat)

***

### completionTokens

> **completionTokens**: `number`

Defined in: [types/AIFunction.ts:353](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L353)

Tokens generated in completion

#### Inherited from

[`GenerativeMetrics`](GenerativeMetrics.md).[`completionTokens`](GenerativeMetrics.md#completiontokens)

***

### durationMs

> **durationMs**: `number`

Defined in: [types/AIFunction.ts:335](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L335)

Total duration in milliseconds

#### Inherited from

[`GenerativeMetrics`](GenerativeMetrics.md).[`durationMs`](GenerativeMetrics.md#durationms)

***

### finishReason

> **finishReason**: `"error"` \| `"stop"` \| `"length"` \| `"content_filter"` \| `"tool_calls"`

Defined in: [types/AIFunction.ts:361](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L361)

Finish reason

#### Inherited from

[`GenerativeMetrics`](GenerativeMetrics.md).[`finishReason`](GenerativeMetrics.md#finishreason)

***

### iterations

> **iterations**: `number`

Defined in: [types/AIFunction.ts:369](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L369)

Number of iterations

***

### model

> **model**: `string`

Defined in: [types/AIFunction.ts:357](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L357)

Model that was used

#### Inherited from

[`GenerativeMetrics`](GenerativeMetrics.md).[`model`](GenerativeMetrics.md#model)

***

### planningSteps?

> `optional` **planningSteps**: `string`[]

Defined in: [types/AIFunction.ts:375](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L375)

Planning steps if applicable

***

### promptTokens

> **promptTokens**: `number`

Defined in: [types/AIFunction.ts:351](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L351)

Tokens used in the prompt

#### Inherited from

[`GenerativeMetrics`](GenerativeMetrics.md).[`promptTokens`](GenerativeMetrics.md#prompttokens)

***

### provider

> **provider**: `AIProvider`

Defined in: [types/AIFunction.ts:359](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L359)

Provider that was used

#### Inherited from

[`GenerativeMetrics`](GenerativeMetrics.md).[`provider`](GenerativeMetrics.md#provider)

***

### retryCount

> **retryCount**: `number`

Defined in: [types/AIFunction.ts:341](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L341)

Number of retry attempts

#### Inherited from

[`GenerativeMetrics`](GenerativeMetrics.md).[`retryCount`](GenerativeMetrics.md#retrycount)

***

### startedAt

> **startedAt**: `Date`

Defined in: [types/AIFunction.ts:337](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L337)

Start time

#### Inherited from

[`GenerativeMetrics`](GenerativeMetrics.md).[`startedAt`](GenerativeMetrics.md#startedat)

***

### toolDurationMs

> **toolDurationMs**: `number`

Defined in: [types/AIFunction.ts:373](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L373)

Total tool execution time

***

### toolInvocations

> **toolInvocations**: [`ToolInvocation`](ToolInvocation.md)\<`unknown`\>[]

Defined in: [types/AIFunction.ts:371](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L371)

Tool invocations

***

### totalTokens

> **totalTokens**: `number`

Defined in: [types/AIFunction.ts:355](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L355)

Total tokens used

#### Inherited from

[`GenerativeMetrics`](GenerativeMetrics.md).[`totalTokens`](GenerativeMetrics.md#totaltokens)
