[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / FoundingHypothesis

# Interface: FoundingHypothesis

Defined in: [workflows/context/foundation.ts:92](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L92)

Complete Founding Hypothesis

## Properties

### confidence

> **confidence**: `number`

Defined in: [workflows/context/foundation.ts:106](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L106)

Confidence score (0-100)

***

### createdAt

> **createdAt**: `Date`

Defined in: [workflows/context/foundation.ts:108](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L108)

Creation timestamp

***

### customers

> **customers**: [`CustomerPersona`](CustomerPersona.md)[]

Defined in: [workflows/context/foundation.ts:98](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L98)

Customer persona(s)

***

### differentiation

> **differentiation**: [`Differentiation`](Differentiation.md)

Defined in: [workflows/context/foundation.ts:102](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L102)

Differentiation

***

### id

> **id**: `string`

Defined in: [workflows/context/foundation.ts:94](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L94)

Unique identifier

***

### name

> **name**: `string`

Defined in: [workflows/context/foundation.ts:96](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L96)

Startup/product name

***

### problem

> **problem**: [`ProblemStatement`](ProblemStatement.md)

Defined in: [workflows/context/foundation.ts:100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L100)

Problem statement

***

### status

> **status**: `"draft"` \| `"validating"` \| `"validated"` \| `"pivoted"` \| `"abandoned"`

Defined in: [workflows/context/foundation.ts:104](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L104)

Hypothesis status

***

### updatedAt

> **updatedAt**: `Date`

Defined in: [workflows/context/foundation.ts:110](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L110)

Last update timestamp

***

### version

> **version**: `number`

Defined in: [workflows/context/foundation.ts:112](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L112)

Version for tracking iterations
