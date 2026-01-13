[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ConversationMemoryAdapter

# Class: ConversationMemoryAdapter

Defined in: [agents/unified-memory.ts:556](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L556)

Adapter that wraps AgentMemory to provide ConversationMemory interface
for backwards compatibility with existing code.

## Constructors

### Constructor

> **new ConversationMemoryAdapter**(`memory`, `conversationId?`): `ConversationMemoryAdapter`

Defined in: [agents/unified-memory.ts:560](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L560)

#### Parameters

##### memory

[`AgentMemory`](../interfaces/AgentMemory.md)

##### conversationId?

`string`

#### Returns

`ConversationMemoryAdapter`

## Methods

### addMessage()

> **addMessage**(`message`): `void`

Defined in: [agents/unified-memory.ts:569](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L569)

#### Parameters

##### message

[`Message`](../type-aliases/Message.md)

#### Returns

`void`

***

### addMessages()

> **addMessages**(`messages`): `void`

Defined in: [agents/unified-memory.ts:574](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L574)

#### Parameters

##### messages

[`Message`](../type-aliases/Message.md)[]

#### Returns

`void`

***

### clear()

> **clear**(): `void`

Defined in: [agents/unified-memory.ts:588](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L588)

#### Returns

`void`

***

### exportState()

> **exportState**(): `object`

Defined in: [agents/unified-memory.ts:635](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L635)

#### Returns

`object`

##### createdAt

> **createdAt**: `Date`

##### id

> **id**: `string`

##### messages

> **messages**: [`Message`](../type-aliases/Message.md)[]

##### updatedAt

> **updatedAt**: `Date`

***

### getContextMessages()

> **getContextMessages**(): [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/unified-memory.ts:584](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L584)

#### Returns

[`Message`](../type-aliases/Message.md)[]

***

### getConversationId()

> **getConversationId**(): `string`

Defined in: [agents/unified-memory.ts:565](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L565)

#### Returns

`string`

***

### getLastMessage()

> **getLastMessage**(): [`Message`](../type-aliases/Message.md) \| `undefined`

Defined in: [agents/unified-memory.ts:592](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L592)

#### Returns

[`Message`](../type-aliases/Message.md) \| `undefined`

***

### getMessageById()

> **getMessageById**(`id`): [`Message`](../type-aliases/Message.md) \| `undefined`

Defined in: [agents/unified-memory.ts:597](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L597)

#### Parameters

##### id

`string`

#### Returns

[`Message`](../type-aliases/Message.md) \| `undefined`

***

### getMessages()

> **getMessages**(): [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/unified-memory.ts:580](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L580)

#### Returns

[`Message`](../type-aliases/Message.md)[]

***

### getSummary()

> **getSummary**(): `undefined`

Defined in: [agents/unified-memory.ts:602](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L602)

#### Returns

`undefined`

***

### getTokenCount()

> **getTokenCount**(): `Promise`\<`number`\>

Defined in: [agents/unified-memory.ts:614](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L614)

#### Returns

`Promise`\<`number`\>

***

### importState()

> **importState**(`state`): `void`

Defined in: [agents/unified-memory.ts:644](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L644)

#### Parameters

##### state

###### id

`string`

###### messages

[`Message`](../type-aliases/Message.md)[]

#### Returns

`void`

***

### setSummarizer()

> **setSummarizer**(): `void`

Defined in: [agents/unified-memory.ts:631](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L631)

#### Returns

`void`

***

### setSummary()

> **setSummary**(): `void`

Defined in: [agents/unified-memory.ts:606](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L606)

#### Returns

`void`

***

### setTokenCounter()

> **setTokenCounter**(): `void`

Defined in: [agents/unified-memory.ts:627](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L627)

#### Returns

`void`

***

### truncate()

> **truncate**(): `Promise`\<`void`\>

Defined in: [agents/unified-memory.ts:610](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/unified-memory.ts#L610)

#### Returns

`Promise`\<`void`\>
