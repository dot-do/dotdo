[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / MessageSubscription

# Interface: MessageSubscription

Defined in: [agents/communication.ts:107](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L107)

Message subscription handle

## Properties

### agentId

> **agentId**: `string`

Defined in: [agents/communication.ts:111](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L111)

The agent ID being subscribed to

***

### id

> **id**: `string`

Defined in: [agents/communication.ts:109](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L109)

Unique subscription ID

***

### unsubscribe()

> **unsubscribe**: () => `void`

Defined in: [agents/communication.ts:113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L113)

Unsubscribe from messages

#### Returns

`void`
