[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / WebAnalytics

# Interface: WebAnalytics

Defined in: [workflows/context/analytics.ts:294](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L294)

Web analytics API

## Methods

### all()

> **all**(): `Promise`\<[`WebMetrics`](WebMetrics.md)\>

Defined in: [workflows/context/analytics.ts:301](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L301)

#### Returns

`Promise`\<[`WebMetrics`](WebMetrics.md)\>

***

### avgSessionDuration()

> **avgSessionDuration**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:299](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L299)

#### Returns

`Promise`\<`number`\>

***

### bounceRate()

> **bounceRate**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:297](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L297)

#### Returns

`Promise`\<`number`\>

***

### compare()

> **compare**(`period`): `Promise`\<`WebMetricsComparison`\>

Defined in: [workflows/context/analytics.ts:305](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L305)

#### Parameters

##### period

`string`

#### Returns

`Promise`\<`WebMetricsComparison`\>

***

### pagesPerSession()

> **pagesPerSession**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:300](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L300)

#### Returns

`Promise`\<`number`\>

***

### pageviews()

> **pageviews**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:296](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L296)

#### Returns

`Promise`\<`number`\>

***

### recordPageview()

> **recordPageview**(`data`): `Promise`\<`void`\>

Defined in: [workflows/context/analytics.ts:303](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L303)

#### Parameters

##### data

[`PageviewData`](PageviewData.md)

#### Returns

`Promise`\<`void`\>

***

### recordSession()

> **recordSession**(`data`): `Promise`\<`void`\>

Defined in: [workflows/context/analytics.ts:302](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L302)

#### Parameters

##### data

[`SessionData`](SessionData.md)

#### Returns

`Promise`\<`void`\>

***

### sessions()

> **sessions**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:295](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L295)

#### Returns

`Promise`\<`number`\>

***

### sessionsTrend()

> **sessionsTrend**(`period`): `Promise`\<[`MetricTrend`](MetricTrend.md)[]\>

Defined in: [workflows/context/analytics.ts:304](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L304)

#### Parameters

##### period

[`TrendPeriod`](../type-aliases/TrendPeriod.md)

#### Returns

`Promise`\<[`MetricTrend`](MetricTrend.md)[]\>

***

### uniqueVisitors()

> **uniqueVisitors**(): `Promise`\<`number`\>

Defined in: [workflows/context/analytics.ts:298](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/analytics.ts#L298)

#### Returns

`Promise`\<`number`\>
