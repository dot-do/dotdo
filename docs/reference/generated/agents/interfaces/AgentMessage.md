[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentMessage

# Interface: AgentMessage\<T\>

Defined in: [agents/communication.ts:30](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L30)

Message sent between agents

## Type Parameters

### T

`T` = `unknown`

## Properties

### id

> **id**: `string`

Defined in: [agents/communication.ts:32](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L32)

Unique message identifier

***

### metadata?

> `optional` **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [agents/communication.ts:48](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L48)

Optional: Additional metadata

***

### payload

> **payload**: `T`

Defined in: [agents/communication.ts:40](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L40)

Message payload

***

### recipient

> **recipient**: `string`

Defined in: [agents/communication.ts:36](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L36)

Receiving agent ID

***

### replyTo?

> `optional` **replyTo**: `string`

Defined in: [agents/communication.ts:44](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L44)

Optional: ID of message this is responding to

***

### sender

> **sender**: `string`

Defined in: [agents/communication.ts:34](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L34)

Sending agent ID

***

### timestamp

> **timestamp**: `Date`

Defined in: [agents/communication.ts:42](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L42)

When the message was created

***

### ttlMs?

> `optional` **ttlMs**: `number`

Defined in: [agents/communication.ts:46](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L46)

Optional: Time-to-live in milliseconds

***

### type

> **type**: [`MessageType`](../type-aliases/MessageType.md)

Defined in: [agents/communication.ts:38](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L38)

Message type
