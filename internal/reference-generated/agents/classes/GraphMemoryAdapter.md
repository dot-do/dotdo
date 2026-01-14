[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / GraphMemoryAdapter

# Class: GraphMemoryAdapter

Defined in: [agents/unified-memory.ts:230](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L230)

Graph-backed implementation of AgentMemory

Stores memories as Things in the graph with relationships for linking.
Messages are stored as a separate Thing type with sequence relationships.

## Implements

- [`AgentMemory`](../interfaces/AgentMemory.md)

## Constructors

### Constructor

> **new GraphMemoryAdapter**(`config`): `GraphMemoryAdapter`

Defined in: [agents/unified-memory.ts:240](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L240)

#### Parameters

##### config

[`GraphMemoryAdapterConfig`](../interfaces/GraphMemoryAdapterConfig.md)

#### Returns

`GraphMemoryAdapter`

## Methods

### addMessage()

> **addMessage**(`message`): `Promise`\<`void`\>

Defined in: [agents/unified-memory.ts:252](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L252)

Add a message to conversation history

#### Parameters

##### message

[`Message`](../type-aliases/Message.md)

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`addMessage`](../interfaces/AgentMemory.md#addmessage)

***

### clearMessages()

> **clearMessages**(): `void`

Defined in: [agents/unified-memory.ts:305](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L305)

Clear all messages

#### Returns

`void`

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`clearMessages`](../interfaces/AgentMemory.md#clearmessages)

***

### deleteMemory()

> **deleteMemory**(`id`): `Promise`\<`boolean`\>

Defined in: [agents/unified-memory.ts:440](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L440)

Delete a memory

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`boolean`\>

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`deleteMemory`](../interfaces/AgentMemory.md#deletememory)

***

### flush()

> **flush**(): `Promise`\<`void`\>

Defined in: [agents/unified-memory.ts:479](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L479)

Persist current state (for adapters that batch writes)

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`flush`](../interfaces/AgentMemory.md#flush)

***

### getContextMessages()

> **getContextMessages**(): [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/unified-memory.ts:300](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L300)

Get messages optimized for LLM context window
Includes summary as system message if available

#### Returns

[`Message`](../type-aliases/Message.md)[]

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`getContextMessages`](../interfaces/AgentMemory.md#getcontextmessages)

***

### getMemory()

> **getMemory**(`id`): `Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md) \| `null`\>

Defined in: [agents/unified-memory.ts:415](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L415)

Get a specific memory by ID

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md) \| `null`\>

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`getMemory`](../interfaces/AgentMemory.md#getmemory)

***

### getMessages()

> **getMessages**(): [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/unified-memory.ts:296](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L296)

Get all messages in current context

#### Returns

[`Message`](../type-aliases/Message.md)[]

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`getMessages`](../interfaces/AgentMemory.md#getmessages)

***

### getRecentMemories()

> **getRecentMemories**(`limit`, `type?`): `Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)[]\>

Defined in: [agents/unified-memory.ts:354](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L354)

Get recent memories, optionally filtered by type

#### Parameters

##### limit

`number` = `10`

##### type?

[`MemoryType`](../type-aliases/MemoryType.md)

#### Returns

`Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)[]\>

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`getRecentMemories`](../interfaces/AgentMemory.md#getrecentmemories)

***

### getRelatedMemories()

> **getRelatedMemories**(`id`, `verb?`): `Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)[]\>

Defined in: [agents/unified-memory.ts:454](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L454)

Get memories related to a specific memory

#### Parameters

##### id

`string`

##### verb?

`string`

#### Returns

`Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)[]\>

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`getRelatedMemories`](../interfaces/AgentMemory.md#getrelatedmemories)

***

### getStats()

> **getStats**(): `Promise`\<[`MemoryStats`](../interfaces/MemoryStats.md)\>

Defined in: [agents/unified-memory.ts:483](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L483)

Get memory statistics

#### Returns

`Promise`\<[`MemoryStats`](../interfaces/MemoryStats.md)\>

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`getStats`](../interfaces/AgentMemory.md#getstats)

***

### linkMemories()

> **linkMemories**(`fromId`, `toId`, `verb`): `Promise`\<`void`\>

Defined in: [agents/unified-memory.ts:445](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L445)

Link two memories with a relationship

#### Parameters

##### fromId

`string`

##### toId

`string`

##### verb

`string`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`linkMemories`](../interfaces/AgentMemory.md#linkmemories)

***

### remember()

> **remember**(`content`, `options?`): `Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)\>

Defined in: [agents/unified-memory.ts:313](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L313)

Store a memory with optional type and metadata
Returns the created memory Thing

#### Parameters

##### content

`string`

##### options?

[`StoreMemoryOptions`](../interfaces/StoreMemoryOptions.md)

#### Returns

`Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)\>

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`remember`](../interfaces/AgentMemory.md#remember)

***

### searchMemories()

> **searchMemories**(`query`, `options?`): `Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)[]\>

Defined in: [agents/unified-memory.ts:378](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L378)

Search memories by content (text match or semantic)

#### Parameters

##### query

`string`

##### options?

[`MemorySearchOptions`](../interfaces/MemorySearchOptions.md)

#### Returns

`Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)[]\>

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`searchMemories`](../interfaces/AgentMemory.md#searchmemories)

***

### updateMemory()

> **updateMemory**(`id`, `updates`): `Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md) \| `null`\>

Defined in: [agents/unified-memory.ts:421](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L421)

Update an existing memory

#### Parameters

##### id

`string`

##### updates

`Partial`\<`Pick`\<[`MemoryThing`](../interfaces/MemoryThing.md), `"content"` \| `"type"` \| `"metadata"`\>\>

#### Returns

`Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md) \| `null`\>

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`updateMemory`](../interfaces/AgentMemory.md#updatememory)
