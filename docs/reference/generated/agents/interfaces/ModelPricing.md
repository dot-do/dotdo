[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ModelPricing

# Interface: ModelPricing

Defined in: [agents/cost-tracker.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L52)

Pricing per 1K tokens for a model

## Properties

### cachedInput?

> `optional` **cachedInput**: `number`

Defined in: [agents/cost-tracker.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L58)

Optional: cost per 1K cached input tokens (for providers that support it)

***

### input

> **input**: `number`

Defined in: [agents/cost-tracker.ts:54](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L54)

Cost per 1K input/prompt tokens

***

### output

> **output**: `number`

Defined in: [agents/cost-tracker.ts:56](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L56)

Cost per 1K output/completion tokens
