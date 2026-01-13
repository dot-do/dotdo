[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentMemory

# Interface: AgentMemory

Defined in: [agents/unified-memory.ts:87](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L87)

Unified AgentMemory interface that consolidates:
- ConversationMemory (messages, truncation, summarization)
- Agent.ts memory (remember, getRecentMemories, searchMemories)
- Graph-backed persistence

## Methods

### addMessage()

> **addMessage**(`message`): `Promise`\<`void`\>

Defined in: [agents/unified-memory.ts:95](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L95)

Add a message to conversation history

#### Parameters

##### message

[`Message`](../type-aliases/Message.md)

#### Returns

`Promise`\<`void`\>

***

### clearMessages()

> **clearMessages**(): `void`

Defined in: [agents/unified-memory.ts:111](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L111)

Clear all messages

#### Returns

`void`

***

### deleteMemory()

> **deleteMemory**(`id`): `Promise`\<`boolean`\>

Defined in: [agents/unified-memory.ts:150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L150)

Delete a memory

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`boolean`\>

***

### flush()

> **flush**(): `Promise`\<`void`\>

Defined in: [agents/unified-memory.ts:169](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L169)

Persist current state (for adapters that batch writes)

#### Returns

`Promise`\<`void`\>

***

### getContextMessages()

> **getContextMessages**(): [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/unified-memory.ts:106](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L106)

Get messages optimized for LLM context window
Includes summary as system message if available

#### Returns

[`Message`](../type-aliases/Message.md)[]

***

### getMemory()

> **getMemory**(`id`): `Promise`\<[`MemoryThing`](MemoryThing.md) \| `null`\>

Defined in: [agents/unified-memory.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L140)

Get a specific memory by ID

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`MemoryThing`](MemoryThing.md) \| `null`\>

***

### getMessages()

> **getMessages**(): [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/unified-memory.ts:100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L100)

Get all messages in current context

#### Returns

[`Message`](../type-aliases/Message.md)[]

***

### getRecentMemories()

> **getRecentMemories**(`limit?`, `type?`): `Promise`\<[`MemoryThing`](MemoryThing.md)[]\>

Defined in: [agents/unified-memory.ts:126](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L126)

Get recent memories, optionally filtered by type

#### Parameters

##### limit?

`number`

##### type?

[`MemoryType`](../type-aliases/MemoryType.md)

#### Returns

`Promise`\<[`MemoryThing`](MemoryThing.md)[]\>

***

### getRelatedMemories()

> **getRelatedMemories**(`id`, `verb?`): `Promise`\<[`MemoryThing`](MemoryThing.md)[]\>

Defined in: [agents/unified-memory.ts:160](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L160)

Get memories related to a specific memory

#### Parameters

##### id

`string`

##### verb?

`string`

#### Returns

`Promise`\<[`MemoryThing`](MemoryThing.md)[]\>

***

### getStats()

> **getStats**(): `Promise`\<[`MemoryStats`](MemoryStats.md)\>

Defined in: [agents/unified-memory.ts:174](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L174)

Get memory statistics

#### Returns

`Promise`\<[`MemoryStats`](MemoryStats.md)\>

***

### linkMemories()

> **linkMemories**(`fromId`, `toId`, `verb`): `Promise`\<`void`\>

Defined in: [agents/unified-memory.ts:155](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L155)

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

***

### remember()

> **remember**(`content`, `options?`): `Promise`\<[`MemoryThing`](MemoryThing.md)\>

Defined in: [agents/unified-memory.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L121)

Store a memory with optional type and metadata
Returns the created memory Thing

#### Parameters

##### content

`string`

##### options?

[`StoreMemoryOptions`](StoreMemoryOptions.md)

#### Returns

`Promise`\<[`MemoryThing`](MemoryThing.md)\>

***

### searchMemories()

> **searchMemories**(`query`, `options?`): `Promise`\<[`MemoryThing`](MemoryThing.md)[]\>

Defined in: [agents/unified-memory.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L131)

Search memories by content (text match or semantic)

#### Parameters

##### query

`string`

##### options?

[`MemorySearchOptions`](MemorySearchOptions.md)

#### Returns

`Promise`\<[`MemoryThing`](MemoryThing.md)[]\>

***

### updateMemory()

> **updateMemory**(`id`, `updates`): `Promise`\<[`MemoryThing`](MemoryThing.md) \| `null`\>

Defined in: [agents/unified-memory.ts:145](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L145)

Update an existing memory

#### Parameters

##### id

`string`

##### updates

`Partial`\<`Pick`\<[`MemoryThing`](MemoryThing.md), `"content"` \| `"type"` \| `"metadata"`\>\>

#### Returns

`Promise`\<[`MemoryThing`](MemoryThing.md) \| `null`\>
