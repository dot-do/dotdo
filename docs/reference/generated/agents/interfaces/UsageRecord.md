[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / UsageRecord

# Interface: UsageRecord

Defined in: [agents/cost-tracker.ts:99](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L99)

Record of a single usage event

## Properties

### cachedInputTokens?

> `optional` **cachedInputTokens**: `number`

Defined in: [agents/cost-tracker.ts:109](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L109)

Cached input tokens (optional)

***

### completionTokens

> **completionTokens**: `number`

Defined in: [agents/cost-tracker.ts:107](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L107)

Completion/output tokens

***

### cost

> **cost**: `number`

Defined in: [agents/cost-tracker.ts:113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L113)

Calculated cost for this usage

***

### metadata?

> `optional` **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [agents/cost-tracker.ts:115](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L115)

Optional metadata

***

### model

> **model**: `string`

Defined in: [agents/cost-tracker.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L101)

Model used

***

### promptTokens

> **promptTokens**: `number`

Defined in: [agents/cost-tracker.ts:105](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L105)

Prompt/input tokens

***

### provider?

> `optional` **provider**: `string`

Defined in: [agents/cost-tracker.ts:103](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L103)

Provider name (optional)

***

### timestamp

> **timestamp**: `Date`

Defined in: [agents/cost-tracker.ts:111](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L111)

When this usage occurred
