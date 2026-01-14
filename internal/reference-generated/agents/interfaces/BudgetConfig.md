[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / BudgetConfig

# Interface: BudgetConfig

Defined in: [agents/router/router.ts:113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L113)

Budget configuration

## Properties

### alertThreshold?

> `optional` **alertThreshold**: `number`

Defined in: [agents/router/router.ts:117](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L117)

Cost threshold to trigger alert

***

### hardLimit?

> `optional` **hardLimit**: `boolean`

Defined in: [agents/router/router.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L119)

Whether to hard stop when budget exceeded

***

### maxTotalCost?

> `optional` **maxTotalCost**: `number`

Defined in: [agents/router/router.ts:115](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L115)

Maximum total cost allowed

***

### onAlert()?

> `optional` **onAlert**: (`currentCost`, `threshold`) => `void`

Defined in: [agents/router/router.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L121)

Callback when alert threshold is reached

#### Parameters

##### currentCost

`number`

##### threshold

`number`

#### Returns

`void`
