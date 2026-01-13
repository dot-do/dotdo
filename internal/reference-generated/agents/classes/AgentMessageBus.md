[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentMessageBus

# Class: AgentMessageBus

Defined in: [agents/communication.ts:198](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L198)

In-memory message bus for agent-to-agent communication

## Extended by

- [`GraphMessageBus`](GraphMessageBus.md)

## Constructors

### Constructor

> **new AgentMessageBus**(`config`): `AgentMessageBus`

Defined in: [agents/communication.ts:206](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L206)

#### Parameters

##### config

[`BusConfig`](../interfaces/BusConfig.md) = `{}`

#### Returns

`AgentMessageBus`

## Methods

### broadcast()

> **broadcast**\<`T`\>(`broadcast`): `Promise`\<[`MessageEnvelope`](../interfaces/MessageEnvelope.md)\<`T`\>[]\>

Defined in: [agents/communication.ts:309](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L309)

Broadcast a message to multiple recipients

#### Type Parameters

##### T

`T`

#### Parameters

##### broadcast

[`BroadcastRequest`](../interfaces/BroadcastRequest.md)\<`T`\>

#### Returns

`Promise`\<[`MessageEnvelope`](../interfaces/MessageEnvelope.md)\<`T`\>[]\>

***

### getHistory()

> **getHistory**(`agentId`, `filter?`): `Promise`\<[`AgentMessage`](../interfaces/AgentMessage.md)\<`unknown`\>[]\>

Defined in: [agents/communication.ts:331](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L331)

Get message history for an agent

#### Parameters

##### agentId

`string`

##### filter?

[`MessageFilter`](../interfaces/MessageFilter.md)

#### Returns

`Promise`\<[`AgentMessage`](../interfaces/AgentMessage.md)\<`unknown`\>[]\>

***

### request()

> **request**\<`TReq`, `TRes`\>(`request`, `options`): `Promise`\<[`AgentMessage`](../interfaces/AgentMessage.md)\<`TRes`\>\>

Defined in: [agents/communication.ts:272](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L272)

Send a request and wait for response

#### Type Parameters

##### TReq

`TReq`

##### TRes

`TRes`

#### Parameters

##### request

[`SimpleRequest`](../interfaces/SimpleRequest.md)\<`TReq`\>

##### options

[`RequestOptions`](../interfaces/RequestOptions.md)

#### Returns

`Promise`\<[`AgentMessage`](../interfaces/AgentMessage.md)\<`TRes`\>\>

***

### send()

> **send**\<`T`\>(`message`): `Promise`\<[`MessageEnvelope`](../interfaces/MessageEnvelope.md)\<`T`\>\>

Defined in: [agents/communication.ts:217](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L217)

Send a message to an agent

#### Type Parameters

##### T

`T`

#### Parameters

##### message

[`AgentMessage`](../interfaces/AgentMessage.md)\<`T`\>

#### Returns

`Promise`\<[`MessageEnvelope`](../interfaces/MessageEnvelope.md)\<`T`\>\>

***

### subscribe()

> **subscribe**\<`T`\>(`agentId`, `handler`, `filter?`): [`MessageSubscription`](../interfaces/MessageSubscription.md)

Defined in: [agents/communication.ts:246](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L246)

Subscribe to messages for a specific agent

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### agentId

`string`

##### handler

[`MessageHandler`](../type-aliases/MessageHandler.md)\<`T`\>

##### filter?

`Omit`\<[`MessageFilter`](../interfaces/MessageFilter.md), `"recipient"`\>

#### Returns

[`MessageSubscription`](../interfaces/MessageSubscription.md)
