[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / InMemoryAgentMemory

# Class: InMemoryAgentMemory

Defined in: [agents/unified-memory.ts:726](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L726)

Simple in-memory implementation of AgentMemory for testing
and contexts where graph storage is not available.

## Implements

- [`AgentMemory`](../interfaces/AgentMemory.md)

## Constructors

### Constructor

> **new InMemoryAgentMemory**(`maxMessages`): `InMemoryAgentMemory`

Defined in: [agents/unified-memory.ts:733](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L733)

#### Parameters

##### maxMessages

`number` = `100`

#### Returns

`InMemoryAgentMemory`

## Methods

### addMessage()

> **addMessage**(`message`): `Promise`\<`void`\>

Defined in: [agents/unified-memory.ts:737](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L737)

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

Defined in: [agents/unified-memory.ts:758](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L758)

Clear all messages

#### Returns

`void`

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`clearMessages`](../interfaces/AgentMemory.md#clearmessages)

***

### deleteMemory()

> **deleteMemory**(`id`): `Promise`\<`boolean`\>

Defined in: [agents/unified-memory.ts:844](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L844)

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

Defined in: [agents/unified-memory.ts:870](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L870)

Persist current state (for adapters that batch writes)

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`flush`](../interfaces/AgentMemory.md#flush)

***

### getContextMessages()

> **getContextMessages**(): [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/unified-memory.ts:754](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L754)

Get messages optimized for LLM context window
Includes summary as system message if available

#### Returns

[`Message`](../type-aliases/Message.md)[]

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`getContextMessages`](../interfaces/AgentMemory.md#getcontextmessages)

***

### getMemory()

> **getMemory**(`id`): `Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md) \| `null`\>

Defined in: [agents/unified-memory.ts:820](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L820)

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

Defined in: [agents/unified-memory.ts:750](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L750)

Get all messages in current context

#### Returns

[`Message`](../type-aliases/Message.md)[]

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`getMessages`](../interfaces/AgentMemory.md#getmessages)

***

### getRecentMemories()

> **getRecentMemories**(`limit`, `type?`): `Promise`\<[`MemoryThing`](../interfaces/MemoryThing.md)[]\>

Defined in: [agents/unified-memory.ts:789](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L789)

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

Defined in: [agents/unified-memory.ts:855](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L855)

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

Defined in: [agents/unified-memory.ts:874](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L874)

Get memory statistics

#### Returns

`Promise`\<[`MemoryStats`](../interfaces/MemoryStats.md)\>

#### Implementation of

[`AgentMemory`](../interfaces/AgentMemory.md).[`getStats`](../interfaces/AgentMemory.md#getstats)

***

### linkMemories()

> **linkMemories**(`fromId`, `toId`, `verb`): `Promise`\<`void`\>

Defined in: [agents/unified-memory.ts:848](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L848)

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

Defined in: [agents/unified-memory.ts:762](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L762)

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

Defined in: [agents/unified-memory.ts:804](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L804)

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

Defined in: [agents/unified-memory.ts:827](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L827)

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
