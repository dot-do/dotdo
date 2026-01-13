[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / FinancialAnalytics

# Interface: FinancialAnalytics

Defined in: [workflows/context/analytics.ts:329](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L329)

Financial analytics API

## Methods

### all()

> **all**(): `Promise`\<[`FinancialMetrics`](FinancialMetrics.md)\>

Defined in: [workflows/context/analytics.ts:341](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L341)

#### Returns

`Promise`\<[`FinancialMetrics`](FinancialMetrics.md)\>

***

### arr()

> **arr**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:331](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L331)

#### Returns

`Promise`\<`number`\>

***

### burnRate()

> **burnRate**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:340](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L340)

#### Returns

`Promise`\<`number`\>

***

### cac()

> **cac**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:337](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L337)

#### Returns

`Promise`\<`number`\>

***

### compareToTarget()

> **compareToTarget**(`target`): `Promise`\<`FinancialTargetComparison`\>

Defined in: [workflows/context/analytics.ts:347](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L347)

#### Parameters

##### target

`Partial`\<[`FinancialMetrics`](FinancialMetrics.md)\>

#### Returns

`Promise`\<`FinancialTargetComparison`\>

***

### costs()

> **costs**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:333](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L333)

#### Returns

`Promise`\<`number`\>

***

### grossMargin()

> **grossMargin**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:334](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L334)

#### Returns

`Promise`\<`number`\>

***

### ltv()

> **ltv**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:336](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L336)

#### Returns

`Promise`\<`number`\>

***

### ltvCacRatio()

> **ltvCacRatio**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:338](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L338)

#### Returns

`Promise`\<`number`\>

***

### mrr()

> **mrr**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:330](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L330)

#### Returns

`Promise`\<`number`\>

***

### mrrTrend()

> **mrrTrend**(`period`): `Promise`\<[`MetricTrend`](MetricTrend.md)[]\>

Defined in: [workflows/context/analytics.ts:345](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L345)

#### Parameters

##### period

[`TrendPeriod`](../type-aliases/TrendPeriod.md)

#### Returns

`Promise`\<[`MetricTrend`](MetricTrend.md)[]\>

***

### netMargin()

> **netMargin**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:335](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L335)

#### Returns

`Promise`\<`number`\>

***

### recordCost()

> **recordCost**(`data`): `Promise`\<`void`\>

Defined in: [workflows/context/analytics.ts:343](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L343)

#### Parameters

##### data

[`CostData`](CostData.md)

#### Returns

`Promise`\<`void`\>

***

### recordRevenue()

> **recordRevenue**(`data`): `Promise`\<`void`\>

Defined in: [workflows/context/analytics.ts:342](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L342)

#### Parameters

##### data

[`RevenueData`](RevenueData.md)

#### Returns

`Promise`\<`void`\>

***

### recordSubscription()

> **recordSubscription**(`data`): `Promise`\<`void`\>

Defined in: [workflows/context/analytics.ts:344](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L344)

#### Parameters

##### data

[`SubscriptionData`](SubscriptionData.md)

#### Returns

`Promise`\<`void`\>

***

### revenue()

> **revenue**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:332](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L332)

#### Returns

`Promise`\<`number`\>

***

### revenueTrend()

> **revenueTrend**(`period`): `Promise`\<[`MetricTrend`](MetricTrend.md)[]\>

Defined in: [workflows/context/analytics.ts:346](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L346)

#### Parameters

##### period

[`TrendPeriod`](../type-aliases/TrendPeriod.md)

#### Returns

`Promise`\<[`MetricTrend`](MetricTrend.md)[]\>

***

### runway()

> **runway**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:339](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L339)

#### Returns

`Promise`\<`number`\>
