[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / estimateCost

# Function: estimateCost()

> **estimateCost**(`prompt`, `model`, `estimatedOutputRatio`, `pricing`): `number`

Defined in: [agents/cost-tracker.ts:704](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L704)

Estimate cost for a prompt before running

Uses approximate token counting (4 chars per token)

## Parameters

### prompt

`string`

### model

`string`

### estimatedOutputRatio

`number` = `1.0`

### pricing

[`PricingTable`](../type-aliases/PricingTable.md) = `MODEL_PRICING`

## Returns

`number`
