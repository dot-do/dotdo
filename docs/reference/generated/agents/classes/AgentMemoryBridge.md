[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentMemoryBridge

# Class: AgentMemoryBridge

Defined in: [agents/unified-memory.ts:664](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L664)

Adapter that provides Agent.ts-compatible memory interface
backed by unified AgentMemory.

This allows migrating from ctx.storage-based memory to graph-backed memory
while preserving the existing API.

## Constructors

### Constructor

> **new AgentMemoryBridge**(`memory`): `AgentMemoryBridge`

Defined in: [agents/unified-memory.ts:667](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L667)

#### Parameters

##### memory

[`AgentMemory`](../interfaces/AgentMemory.md)

#### Returns

`AgentMemoryBridge`

## Methods

### getRecentMemories()

> **getRecentMemories**(`limit`): `Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)[]\>

Defined in: [agents/unified-memory.ts:681](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L681)

Get recent memories (Agent.ts API)

#### Parameters

##### limit

`number` = `10`

#### Returns

`Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)[]\>

***

### remember()

> **remember**(`content`, `type`): `Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)\>

Defined in: [agents/unified-memory.ts:674](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L674)

Store a memory (Agent.ts API)

#### Parameters

##### content

`string`

##### type

[`MemoryType`](../type-aliases/MemoryType.md) = `'short-term'`

#### Returns

`Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)\>

***

### searchMemories()

> **searchMemories**(`query`): `Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)[]\>

Defined in: [agents/unified-memory.ts:688](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L688)

Search memories by content (Agent.ts API)

#### Parameters

##### query

`string`

#### Returns

`Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)[]\>
