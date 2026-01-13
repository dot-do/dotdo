[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / CostTrackerConfig

# Interface: CostTrackerConfig

Defined in: [agents/cost-tracker.ts:85](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L85)

Configuration for the cost tracker

## Properties

### budget?

> `optional` **budget**: [`CostBudget`](CostBudget.md)

Defined in: [agents/cost-tracker.ts:87](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L87)

Budget constraints

***

### defaultModel?

> `optional` **defaultModel**: `string`

Defined in: [agents/cost-tracker.ts:91](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L91)

Default model to use when model is not specified

***

### id?

> `optional` **id**: `string`

Defined in: [agents/cost-tracker.ts:93](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L93)

ID for this tracker (useful for per-agent tracking)

***

### pricing?

> `optional` **pricing**: [`PricingTable`](../type-aliases/PricingTable.md)

Defined in: [agents/cost-tracker.ts:89](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L89)

Pricing table for models
