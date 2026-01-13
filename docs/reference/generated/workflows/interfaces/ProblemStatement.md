[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / ProblemStatement

# Interface: ProblemStatement

Defined in: [workflows/context/foundation.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L52)

Problem statement definition

## Properties

### currentSolutions

> **currentSolutions**: `string`[]

Defined in: [workflows/context/foundation.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L58)

Current workarounds customers use

***

### description

> **description**: `string`

Defined in: [workflows/context/foundation.ts:56](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L56)

Detailed description

***

### frequency

> **frequency**: `"monthly"` \| `"daily"` \| `"weekly"` \| `"quarterly"` \| `"rarely"`

Defined in: [workflows/context/foundation.ts:64](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L64)

How frequently does this problem occur

***

### gaps

> **gaps**: `string`[]

Defined in: [workflows/context/foundation.ts:60](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L60)

Why current solutions are inadequate

***

### hairOnFire

> **hairOnFire**: `boolean`

Defined in: [workflows/context/foundation.ts:66](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L66)

Is this a "hair on fire" problem?

***

### painLevel

> **painLevel**: `number`

Defined in: [workflows/context/foundation.ts:62](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L62)

How painful is this problem (1-10)

***

### summary

> **summary**: `string`

Defined in: [workflows/context/foundation.ts:54](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L54)

One-line summary of the problem
