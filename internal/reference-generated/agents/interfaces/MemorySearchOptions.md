[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / MemorySearchOptions

# Interface: MemorySearchOptions

Defined in: [agents/unified-memory.ts:51](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L51)

Options for memory search/retrieval

## Properties

### before?

> `optional` **before**: `Date`

Defined in: [agents/unified-memory.ts:60](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L60)

***

### limit?

> `optional` **limit**: `number`

Defined in: [agents/unified-memory.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L55)

Maximum results to return

***

### minSimilarity?

> `optional` **minSimilarity**: `number`

Defined in: [agents/unified-memory.ts:57](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L57)

Minimum similarity score (0-1) for semantic search

***

### since?

> `optional` **since**: `Date`

Defined in: [agents/unified-memory.ts:59](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L59)

Time range filter

***

### type?

> `optional` **type**: [`MemoryType`](../type-aliases/MemoryType.md)

Defined in: [agents/unified-memory.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L53)

Filter by memory type
