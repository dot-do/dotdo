[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / StoreMemoryOptions

# Interface: StoreMemoryOptions

Defined in: [agents/unified-memory.ts:66](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L66)

Options for storing a memory

## Properties

### embedding?

> `optional` **embedding**: `number`[]

Defined in: [agents/unified-memory.ts:72](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L72)

Pre-computed embedding vector

***

### metadata?

> `optional` **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [agents/unified-memory.ts:70](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L70)

Additional metadata

***

### relatedTo?

> `optional` **relatedTo**: `string`[]

Defined in: [agents/unified-memory.ts:74](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L74)

Related entity IDs to link

***

### type?

> `optional` **type**: [`MemoryType`](../type-aliases/MemoryType.md)

Defined in: [agents/unified-memory.ts:68](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L68)

Memory type classification
