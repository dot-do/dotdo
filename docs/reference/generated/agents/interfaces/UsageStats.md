[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / UsageStats

# Interface: UsageStats

Defined in: [agents/cost-tracker.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L121)

Aggregated usage statistics

## Properties

### byModel

> **byModel**: `Record`\<`string`, [`ModelUsage`](ModelUsage.md)\>

Defined in: [agents/cost-tracker.ts:133](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L133)

Usage breakdown by model

***

### byProvider

> **byProvider**: `Record`\<`string`, [`ProviderUsage`](ProviderUsage.md)\>

Defined in: [agents/cost-tracker.ts:135](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L135)

Usage breakdown by provider

***

### requestCount

> **requestCount**: `number`

Defined in: [agents/cost-tracker.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L131)

Number of requests

***

### totalCompletionTokens

> **totalCompletionTokens**: `number`

Defined in: [agents/cost-tracker.ts:125](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L125)

Total completion tokens

***

### totalCost

> **totalCost**: `number`

Defined in: [agents/cost-tracker.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L129)

Total cost

***

### totalPromptTokens

> **totalPromptTokens**: `number`

Defined in: [agents/cost-tracker.ts:123](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L123)

Total prompt tokens

***

### totalTokens

> **totalTokens**: `number`

Defined in: [agents/cost-tracker.ts:127](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L127)

Total tokens (prompt + completion)
