[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / ProductAnalytics

# Interface: ProductAnalytics

Defined in: [workflows/context/analytics.ts:311](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L311)

Product analytics API

## Methods

### activationRate()

> **activationRate**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:317](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L317)

#### Returns

`Promise`\<`number`\>

***

### all()

> **all**(): `Promise`\<[`ProductMetrics`](ProductMetrics.md)\>

Defined in: [workflows/context/analytics.ts:318](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L318)

#### Returns

`Promise`\<[`ProductMetrics`](ProductMetrics.md)\>

***

### dau()

> **dau**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:312](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L312)

#### Returns

`Promise`\<`number`\>

***

### dauTrend()

> **dauTrend**(`period`): `Promise`\<[`MetricTrend`](MetricTrend.md)[]\>

Defined in: [workflows/context/analytics.ts:321](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L321)

#### Parameters

##### period

[`TrendPeriod`](../type-aliases/TrendPeriod.md)

#### Returns

`Promise`\<[`MetricTrend`](MetricTrend.md)[]\>

***

### featureUsage()

> **featureUsage**(): `Promise`\<`Record`\<`string`, `number`\>\>

Defined in: [workflows/context/analytics.ts:315](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L315)

#### Returns

`Promise`\<`Record`\<`string`, `number`\>\>

***

### lowAdoptionFeatures()

> **lowAdoptionFeatures**(`threshold`): `Promise`\<`string`[]\>

Defined in: [workflows/context/analytics.ts:323](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L323)

#### Parameters

##### threshold

`number`

#### Returns

`Promise`\<`string`[]\>

***

### mau()

> **mau**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:313](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L313)

#### Returns

`Promise`\<`number`\>

***

### retentionRate()

> **retentionRate**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:316](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L316)

#### Returns

`Promise`\<`number`\>

***

### retentionTrend()

> **retentionTrend**(`period`): `Promise`\<[`MetricTrend`](MetricTrend.md)[]\>

Defined in: [workflows/context/analytics.ts:322](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L322)

#### Parameters

##### period

[`TrendPeriod`](../type-aliases/TrendPeriod.md)

#### Returns

`Promise`\<[`MetricTrend`](MetricTrend.md)[]\>

***

### stickiness()

> **stickiness**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:314](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L314)

#### Returns

`Promise`\<`number`\>

***

### trackActivity()

> **trackActivity**(`data`): `Promise`\<`void`\>

Defined in: [workflows/context/analytics.ts:319](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L319)

#### Parameters

##### data

[`ActivityData`](ActivityData.md)

#### Returns

`Promise`\<`void`\>

***

### trackFeature()

> **trackFeature**(`data`): `Promise`\<`void`\>

Defined in: [workflows/context/analytics.ts:320](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L320)

#### Parameters

##### data

[`FeatureData`](FeatureData.md)

#### Returns

`Promise`\<`void`\>
