[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / calculateCost

# Function: calculateCost()

> **calculateCost**(`input`, `pricing`): `number`

Defined in: [agents/cost-tracker.ts:683](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L683)

Calculate cost for a given usage and model

## Parameters

### input

#### cachedInputTokens?

`number`

#### completionTokens

`number`

#### model

`string`

#### promptTokens

`number`

### pricing

[`PricingTable`](../type-aliases/PricingTable.md) = `MODEL_PRICING`

## Returns

`number`

## Example

```ts
const cost = calculateCost({
  model: 'gpt-4o',
  promptTokens: 1000,
  completionTokens: 500,
})
```
