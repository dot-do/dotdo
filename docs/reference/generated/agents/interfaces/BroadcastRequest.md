[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / BroadcastRequest

# Interface: BroadcastRequest\<T\>

Defined in: [agents/communication.ts:144](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L144)

Broadcast request (one-to-many)

## Type Parameters

### T

`T` = `unknown`

## Properties

### metadata?

> `optional` **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [agents/communication.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L149)

***

### payload

> **payload**: `T`

Defined in: [agents/communication.ts:148](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L148)

***

### recipients

> **recipients**: `string`[]

Defined in: [agents/communication.ts:146](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L146)

***

### sender

> **sender**: `string`

Defined in: [agents/communication.ts:145](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L145)

***

### type

> **type**: [`MessageType`](../type-aliases/MessageType.md)

Defined in: [agents/communication.ts:147](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L147)
