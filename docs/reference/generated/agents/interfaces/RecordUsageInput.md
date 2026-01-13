[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / RecordUsageInput

# Interface: RecordUsageInput

Defined in: [agents/cost-tracker.ts:163](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L163)

Input for recording usage

## Properties

### cachedInputTokens?

> `optional` **cachedInputTokens**: `number`

Defined in: [agents/cost-tracker.ts:173](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L173)

Cached input tokens (optional)

***

### completionTokens

> **completionTokens**: `number`

Defined in: [agents/cost-tracker.ts:171](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L171)

Completion/output tokens

***

### metadata?

> `optional` **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [agents/cost-tracker.ts:175](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L175)

Optional metadata

***

### model

> **model**: `string`

Defined in: [agents/cost-tracker.ts:165](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L165)

Model used

***

### promptTokens

> **promptTokens**: `number`

Defined in: [agents/cost-tracker.ts:169](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L169)

Prompt/input tokens

***

### provider?

> `optional` **provider**: `string`

Defined in: [agents/cost-tracker.ts:167](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L167)

Provider name (optional)
