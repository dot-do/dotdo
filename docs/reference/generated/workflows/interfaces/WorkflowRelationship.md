[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / WorkflowRelationship

# Interface: WorkflowRelationship

Defined in: [workflows/core/graph-runtime-state.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L119)

Relationship edge between workflow entities

## Properties

### createdAt

> **createdAt**: `number`

Defined in: [workflows/core/graph-runtime-state.ts:125](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L125)

***

### data?

> `optional` **data**: `Record`\<`string`, `unknown`\>

Defined in: [workflows/core/graph-runtime-state.ts:124](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L124)

***

### from

> **from**: `string`

Defined in: [workflows/core/graph-runtime-state.ts:122](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L122)

***

### id

> **id**: `string`

Defined in: [workflows/core/graph-runtime-state.ts:120](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L120)

***

### to

> **to**: `string`

Defined in: [workflows/core/graph-runtime-state.ts:123](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L123)

***

### verb

> **verb**: `"contains"` \| `"executes"` \| `"follows"` \| `"waitingFor"`

Defined in: [workflows/core/graph-runtime-state.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L121)
