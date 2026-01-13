[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / CostBudget

# Interface: CostBudget

Defined in: [agents/cost-tracker.ts:69](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L69)

Budget configuration for cost tracking

## Properties

### alertThreshold?

> `optional` **alertThreshold**: `number`

Defined in: [agents/cost-tracker.ts:73](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L73)

Cost threshold that triggers an alert (in dollars)

***

### hardLimit?

> `optional` **hardLimit**: `boolean`

Defined in: [agents/cost-tracker.ts:75](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L75)

Whether to throw an error when budget is exceeded (hard limit)

***

### maxCost?

> `optional` **maxCost**: `number`

Defined in: [agents/cost-tracker.ts:71](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L71)

Maximum total cost allowed (in dollars)

***

### onAlert()?

> `optional` **onAlert**: (`currentCost`, `threshold`) => `void`

Defined in: [agents/cost-tracker.ts:77](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L77)

Callback when alert threshold is reached

#### Parameters

##### currentCost

`number`

##### threshold

`number`

#### Returns

`void`

***

### onExceeded()?

> `optional` **onExceeded**: (`currentCost`, `maxCost`) => `void`

Defined in: [agents/cost-tracker.ts:79](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L79)

Callback when budget is exceeded

#### Parameters

##### currentCost

`number`

##### maxCost

`number`

#### Returns

`void`
