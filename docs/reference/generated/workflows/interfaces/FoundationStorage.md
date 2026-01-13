[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / FoundationStorage

# Interface: FoundationStorage

Defined in: [workflows/context/foundation.ts:393](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L393)

Mock storage interface for foundation context

## Properties

### currentHypothesisId

> **currentHypothesisId**: `string` \| `null`

Defined in: [workflows/context/foundation.ts:398](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L398)

***

### hypotheses

> **hypotheses**: `Map`\<`string`, [`FoundingHypothesis`](FoundingHypothesis.md)\>

Defined in: [workflows/context/foundation.ts:394](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L394)

***

### interviews

> **interviews**: `Map`\<`string`, [`CustomerInterview`](CustomerInterview.md)\>

Defined in: [workflows/context/foundation.ts:395](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L395)

***

### metrics

> **metrics**: [`HUNCHMetrics`](HUNCHMetrics.md) \| `null`

Defined in: [workflows/context/foundation.ts:396](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L396)

***

### metricsHistory

> **metricsHistory**: `object`[]

Defined in: [workflows/context/foundation.ts:397](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L397)

#### date

> **date**: `Date`

#### metrics

> **metrics**: [`HUNCHMetrics`](HUNCHMetrics.md)
