[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / FlagsCollection

# Interface: FlagsCollection

Defined in: [workflows/context/flag.ts:62](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/flag.ts#L62)

Flags collection API at $.flags

## Methods

### evaluate()

> **evaluate**(`flagId`, `userId`, `flags`): [`FlagEvaluation`](FlagEvaluation.md)

Defined in: [workflows/context/flag.ts:64](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/flag.ts#L64)

#### Parameters

##### flagId

`string`

##### userId

`string`

##### flags

`Record`\<`string`, [`FlagWithBranches`](FlagWithBranches.md)\>

#### Returns

[`FlagEvaluation`](FlagEvaluation.md)

***

### fetch()

> **fetch**(): `Promise`\<`Record`\<`string`, [`FlagWithBranches`](FlagWithBranches.md)\>\>

Defined in: [workflows/context/flag.ts:63](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/flag.ts#L63)

#### Returns

`Promise`\<`Record`\<`string`, [`FlagWithBranches`](FlagWithBranches.md)\>\>
