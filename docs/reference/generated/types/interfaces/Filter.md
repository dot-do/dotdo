[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / Filter

# Interface: Filter

Defined in: [types/Flag.ts:20](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L20)

Filter for targeting users based on properties or cohort membership

## Properties

### cohortId?

> `optional` **cohortId**: `string`

Defined in: [types/Flag.ts:25](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L25)

***

### operator?

> `optional` **operator**: `"eq"` \| `"gt"` \| `"lt"` \| `"contains"` \| `"in"`

Defined in: [types/Flag.ts:23](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L23)

***

### property?

> `optional` **property**: `string`

Defined in: [types/Flag.ts:22](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L22)

***

### type

> **type**: `"property"` \| `"cohort"`

Defined in: [types/Flag.ts:21](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L21)

***

### value?

> `optional` **value**: `any`

Defined in: [types/Flag.ts:24](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L24)
