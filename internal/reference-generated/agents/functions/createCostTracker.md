[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createCostTracker

# Function: createCostTracker()

> **createCostTracker**(`config?`): [`CostTracker`](../classes/CostTracker.md)

Defined in: [agents/cost-tracker.ts:574](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L574)

Create a cost tracker instance

## Parameters

### config?

[`CostTrackerConfig`](../interfaces/CostTrackerConfig.md)

## Returns

[`CostTracker`](../classes/CostTracker.md)

## Example

```ts
// Simple tracker
const tracker = createCostTracker()

// With budget
const tracker = createCostTracker({
  budget: {
    maxCost: 10.0,
    alertThreshold: 8.0,
    hardLimit: true,
    onAlert: (cost, threshold) => console.warn('Budget alert!'),
  },
})

// With custom pricing
const tracker = createCostTracker({
  pricing: {
    'my-custom-model': { input: 0.001, output: 0.002 },
  },
})
```
