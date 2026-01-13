[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ConversationMemory

# Interface: ConversationMemory

Defined in: [agents/memory.ts:106](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L106)

## Methods

### addMessage()

> **addMessage**(`message`): `void`

Defined in: [agents/memory.ts:114](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L114)

Add a single message to history

#### Parameters

##### message

[`Message`](../type-aliases/Message.md)

#### Returns

`void`

***

### addMessages()

> **addMessages**(`messages`): `void`

Defined in: [agents/memory.ts:117](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L117)

Add multiple messages to history

#### Parameters

##### messages

[`Message`](../type-aliases/Message.md)[]

#### Returns

`void`

***

### clear()

> **clear**(): `void`

Defined in: [agents/memory.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L129)

Clear all messages and summary

#### Returns

`void`

***

### exportState()

> **exportState**(): [`ConversationState`](ConversationState.md)

Defined in: [agents/memory.ts:159](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L159)

Export state for persistence

#### Returns

[`ConversationState`](ConversationState.md)

***

### getConfig()

> **getConfig**(): [`ConversationMemoryConfig`](ConversationMemoryConfig.md)

Defined in: [agents/memory.ts:111](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L111)

Get memory configuration

#### Returns

[`ConversationMemoryConfig`](ConversationMemoryConfig.md)

***

### getContextMessages()

> **getContextMessages**(): [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/memory.ts:141](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L141)

Get messages suitable for LLM context
If a summary exists, it's prepended as a system message

#### Returns

[`Message`](../type-aliases/Message.md)[]

***

### getConversationId()

> **getConversationId**(): `string`

Defined in: [agents/memory.ts:108](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L108)

Get conversation ID

#### Returns

`string`

***

### getLastMessage()

> **getLastMessage**(): [`Message`](../type-aliases/Message.md) \| `undefined`

Defined in: [agents/memory.ts:123](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L123)

Get the last message

#### Returns

[`Message`](../type-aliases/Message.md) \| `undefined`

***

### getMessageById()

> **getMessageById**(`id`): [`Message`](../type-aliases/Message.md) \| `undefined`

Defined in: [agents/memory.ts:126](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L126)

Get a message by ID

#### Parameters

##### id

`string`

#### Returns

[`Message`](../type-aliases/Message.md) \| `undefined`

***

### getMessages()

> **getMessages**(): [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/memory.ts:120](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L120)

Get all messages in current context

#### Returns

[`Message`](../type-aliases/Message.md)[]

***

### getSummary()

> **getSummary**(): [`MemorySummary`](MemorySummary.md) \| `undefined`

Defined in: [agents/memory.ts:132](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L132)

Get current summary if one exists

#### Returns

[`MemorySummary`](MemorySummary.md) \| `undefined`

***

### getTokenCount()

> **getTokenCount**(): `Promise`\<`number`\>

Defined in: [agents/memory.ts:150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L150)

Get estimated current token count

#### Returns

`Promise`\<`number`\>

***

### importState()

> **importState**(`state`): `void`

Defined in: [agents/memory.ts:162](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L162)

Import state from persistence

#### Parameters

##### state

[`ConversationState`](ConversationState.md)

#### Returns

`void`

***

### setSummarizer()

> **setSummarizer**(`summarizer`): `void`

Defined in: [agents/memory.ts:156](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L156)

Set custom summarization function

#### Parameters

##### summarizer

[`Summarizer`](../type-aliases/Summarizer.md)

#### Returns

`void`

***

### setSummary()

> **setSummary**(`summary`): `void`

Defined in: [agents/memory.ts:135](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L135)

Set summary manually

#### Parameters

##### summary

[`MemorySummary`](MemorySummary.md)

#### Returns

`void`

***

### setTokenCounter()

> **setTokenCounter**(`counter`): `void`

Defined in: [agents/memory.ts:153](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L153)

Set custom token counting function

#### Parameters

##### counter

[`TokenCounter`](../type-aliases/TokenCounter.md)

#### Returns

`void`

***

### truncate()

> **truncate**(): `Promise`\<`void`\>

Defined in: [agents/memory.ts:147](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L147)

Truncate messages based on config (FIFO or summarize)
Call this periodically or before generating to stay within limits

#### Returns

`Promise`\<`void`\>
