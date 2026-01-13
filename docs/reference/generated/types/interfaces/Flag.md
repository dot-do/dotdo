[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / Flag

# Interface: Flag

Defined in: [types/Flag.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L52)

Feature Flag for A/B testing and gradual rollouts

Features:
- Branch-based variants with weighted traffic distribution
- Traffic control (0-1) for gradual rollouts
- Sticky assignment for consistent user experience
- Targeting filters for property or cohort-based targeting

## Properties

### branches

> **branches**: [`Branch`](Branch.md)[]

Defined in: [types/Flag.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L55)

***

### filters?

> `optional` **filters**: [`Filter`](Filter.md)[]

Defined in: [types/Flag.ts:59](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L59)

***

### id

> **id**: `string`

Defined in: [types/Flag.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L53)

***

### key

> **key**: `string`

Defined in: [types/Flag.ts:54](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L54)

***

### status

> **status**: [`FlagStatus`](../type-aliases/FlagStatus.md)

Defined in: [types/Flag.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L58)

***

### stickiness

> **stickiness**: [`Stickiness`](../type-aliases/Stickiness.md)

Defined in: [types/Flag.ts:57](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L57)

***

### traffic

> **traffic**: `number`

Defined in: [types/Flag.ts:56](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L56)
