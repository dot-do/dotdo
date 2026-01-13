[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / CostTracker

# Class: CostTracker

Defined in: [agents/cost-tracker.ts:246](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L246)

Cost Tracker - Tracks token usage and costs across agent runs

Features:
- Per-model and per-provider usage tracking
- Configurable pricing tables
- Budget enforcement with soft (alert) and hard (error) limits
- Detailed usage history and statistics

## Constructors

### Constructor

> **new CostTracker**(`config`): `CostTracker`

Defined in: [agents/cost-tracker.ts:256](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L256)

#### Parameters

##### config

[`CostTrackerConfig`](../interfaces/CostTrackerConfig.md) = `{}`

#### Returns

`CostTracker`

## Methods

### exportState()

> **exportState**(): `object`

Defined in: [agents/cost-tracker.ts:516](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L516)

Export state for persistence

#### Returns

`object`

##### config

> **config**: [`CostTrackerConfig`](../interfaces/CostTrackerConfig.md)

##### id?

> `optional` **id**: `string`

##### records

> **records**: [`UsageRecord`](../interfaces/UsageRecord.md)[]

***

### getConfig()

> **getConfig**(): [`CostTrackerConfig`](../interfaces/CostTrackerConfig.md)

Defined in: [agents/cost-tracker.ts:269](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L269)

Get current configuration

#### Returns

[`CostTrackerConfig`](../interfaces/CostTrackerConfig.md)

***

### getModelPricing()

> **getModelPricing**(`model`): [`ModelPricing`](../interfaces/ModelPricing.md) \| `undefined`

Defined in: [agents/cost-tracker.ts:283](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L283)

Get pricing for a model

#### Parameters

##### model

`string`

#### Returns

[`ModelPricing`](../interfaces/ModelPricing.md) \| `undefined`

***

### getRecords()

> **getRecords**(): [`UsageRecord`](../interfaces/UsageRecord.md)[]

Defined in: [agents/cost-tracker.ts:489](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L489)

Get all usage records

#### Returns

[`UsageRecord`](../interfaces/UsageRecord.md)[]

***

### getRecordsBetween()

> **getRecordsBetween**(`start`, `end`): [`UsageRecord`](../interfaces/UsageRecord.md)[]

Defined in: [agents/cost-tracker.ts:496](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L496)

Get records within a time range

#### Parameters

##### start

`Date`

##### end

`Date`

#### Returns

[`UsageRecord`](../interfaces/UsageRecord.md)[]

***

### getRemainingBudget()

> **getRemainingBudget**(): `number`

Defined in: [agents/cost-tracker.ts:384](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L384)

Get remaining budget (returns Infinity if no budget set)

#### Returns

`number`

***

### getStats()

> **getStats**(): [`UsageStats`](../interfaces/UsageStats.md)

Defined in: [agents/cost-tracker.ts:411](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L411)

Get full usage statistics

#### Returns

[`UsageStats`](../interfaces/UsageStats.md)

***

### getTotalCost()

> **getTotalCost**(): `number`

Defined in: [agents/cost-tracker.ts:397](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L397)

Get total cost across all recorded usage

#### Returns

`number`

***

### getTotalTokens()

> **getTotalTokens**(): `number`

Defined in: [agents/cost-tracker.ts:404](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L404)

Get total tokens across all recorded usage

#### Returns

`number`

***

### getUsageByModel()

> **getUsageByModel**(): `Record`\<`string`, [`ModelUsage`](../interfaces/ModelUsage.md)\>

Defined in: [agents/cost-tracker.ts:475](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L475)

Get usage breakdown by model

#### Returns

`Record`\<`string`, [`ModelUsage`](../interfaces/ModelUsage.md)\>

***

### getUsageByProvider()

> **getUsageByProvider**(): `Record`\<`string`, [`ProviderUsage`](../interfaces/ProviderUsage.md)\>

Defined in: [agents/cost-tracker.ts:482](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L482)

Get usage breakdown by provider

#### Returns

`Record`\<`string`, [`ProviderUsage`](../interfaces/ProviderUsage.md)\>

***

### importState()

> **importState**(`state`): `void`

Defined in: [agents/cost-tracker.ts:531](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L531)

Import state from persistence

#### Parameters

##### state

###### config?

[`CostTrackerConfig`](../interfaces/CostTrackerConfig.md)

###### records

[`UsageRecord`](../interfaces/UsageRecord.md)[]

#### Returns

`void`

***

### recordTokenUsage()

> **recordTokenUsage**(`usage`, `model`, `provider?`): [`UsageRecord`](../interfaces/UsageRecord.md)

Defined in: [agents/cost-tracker.ts:362](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L362)

Record usage from a TokenUsage object (common return from agent runs)

#### Parameters

##### usage

[`TokenUsage`](../interfaces/TokenUsage.md)

##### model

`string`

##### provider?

`string`

#### Returns

[`UsageRecord`](../interfaces/UsageRecord.md)

***

### recordUsage()

> **recordUsage**(`input`): [`UsageRecord`](../interfaces/UsageRecord.md)

Defined in: [agents/cost-tracker.ts:307](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L307)

Record token usage and calculate cost

#### Parameters

##### input

[`RecordUsageInput`](../interfaces/RecordUsageInput.md)

#### Returns

[`UsageRecord`](../interfaces/UsageRecord.md)

#### Throws

BudgetExceededError if hardLimit is enabled and budget exceeded

***

### reset()

> **reset**(): `void`

Defined in: [agents/cost-tracker.ts:507](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L507)

Reset all tracked usage

#### Returns

`void`

***

### setBudget()

> **setBudget**(`budget`): `void`

Defined in: [agents/cost-tracker.ts:290](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L290)

Update budget configuration

#### Parameters

##### budget

[`CostBudget`](../interfaces/CostBudget.md)

#### Returns

`void`

***

### setModelPricing()

> **setModelPricing**(`model`, `pricing`): `void`

Defined in: [agents/cost-tracker.ts:276](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L276)

Update pricing for a model

#### Parameters

##### model

`string`

##### pricing

[`ModelPricing`](../interfaces/ModelPricing.md)

#### Returns

`void`

***

### wouldExceedBudget()

> **wouldExceedBudget**(`additionalCost`): `boolean`

Defined in: [agents/cost-tracker.ts:375](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L375)

Check if budget would be exceeded by additional cost
Useful for pre-flight checks before expensive operations

#### Parameters

##### additionalCost

`number`

#### Returns

`boolean`

## Properties

### id?

> `readonly` `optional` **id**: `string`

Defined in: [agents/cost-tracker.ts:247](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/cost-tracker.ts#L247)
