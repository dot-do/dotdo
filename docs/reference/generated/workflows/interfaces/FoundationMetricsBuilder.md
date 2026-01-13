[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / FoundationMetricsBuilder

# Interface: FoundationMetricsBuilder

Defined in: [workflows/context/foundation.ts:367](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L367)

Metrics builder - for HUNCH metrics

## Methods

### baseline()

> **baseline**(`metrics`): `Promise`\<[`HUNCHMetrics`](HUNCHMetrics.md)\>

Defined in: [workflows/context/foundation.ts:371](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L371)

Set baseline metrics

#### Parameters

##### metrics

`Partial`\<[`HUNCHMetrics`](HUNCHMetrics.md)\>

#### Returns

`Promise`\<[`HUNCHMetrics`](HUNCHMetrics.md)\>

***

### compare()

> **compare**(`target`): `Promise`\<`object`[]\>

Defined in: [workflows/context/foundation.ts:377](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L377)

Compare to target

#### Parameters

##### target

`Partial`\<[`HUNCHMetrics`](HUNCHMetrics.md)\>

#### Returns

`Promise`\<`object`[]\>

***

### current()

> **current**(): `Promise`\<[`HUNCHMetrics`](HUNCHMetrics.md) \| `null`\>

Defined in: [workflows/context/foundation.ts:369](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L369)

Get current metrics

#### Returns

`Promise`\<[`HUNCHMetrics`](HUNCHMetrics.md) \| `null`\>

***

### track()

> **track**(`metric`): `Promise`\<\{ `activelySearching`: `boolean`; `painLevel`: `number`; `urgencyScore`: `number`; \} \| \{ `avgSessionDuration`: `number`; `dauMau`: `number`; `featureAdoption`: `Record`\<`string`, `number`\>; `sessionsPerWeek`: `number`; \} \| \{ `detractors`: `number`; `passives`: `number`; `promoters`: `number`; `responseCount`: `number`; `score`: `number`; \} \| \{ `annualRate`: `number`; `avgLifetimeMonths`: `number`; `cohortRetention`: `Record`\<`string`, `number`\>; `monthlyRate`: `number`; \} \| \{ `cac`: `number`; `ltv`: `number`; `paybackMonths`: `number`; `ratio`: `number`; \}\>

Defined in: [workflows/context/foundation.ts:373](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L373)

Track specific metric

#### Parameters

##### metric

keyof [`HUNCHMetrics`](HUNCHMetrics.md)

#### Returns

`Promise`\<\{ `activelySearching`: `boolean`; `painLevel`: `number`; `urgencyScore`: `number`; \} \| \{ `avgSessionDuration`: `number`; `dauMau`: `number`; `featureAdoption`: `Record`\<`string`, `number`\>; `sessionsPerWeek`: `number`; \} \| \{ `detractors`: `number`; `passives`: `number`; `promoters`: `number`; `responseCount`: `number`; `score`: `number`; \} \| \{ `annualRate`: `number`; `avgLifetimeMonths`: `number`; `cohortRetention`: `Record`\<`string`, `number`\>; `monthlyRate`: `number`; \} \| \{ `cac`: `number`; `ltv`: `number`; `paybackMonths`: `number`; `ratio`: `number`; \}\>

***

### trend()

> **trend**(`metric`, `period`): `Promise`\<`object`[]\>

Defined in: [workflows/context/foundation.ts:375](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L375)

Get metrics trend

#### Parameters

##### metric

keyof [`HUNCHMetrics`](HUNCHMetrics.md)

##### period

`"day"` | `"week"` | `"month"`

#### Returns

`Promise`\<`object`[]\>
