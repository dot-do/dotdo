[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / Branch

# Interface: Branch

Defined in: [types/Flag.ts:11](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L11)

Branch represents a variant in the feature flag
Each branch has a weight for traffic distribution and optional payload

## Properties

### key

> **key**: `string`

Defined in: [types/Flag.ts:12](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L12)

***

### payload?

> `optional` **payload**: `Record`\<`string`, `any`\>

Defined in: [types/Flag.ts:14](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L14)

***

### weight

> **weight**: `number`

Defined in: [types/Flag.ts:13](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Flag.ts#L13)
