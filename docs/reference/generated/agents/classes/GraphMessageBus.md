[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / GraphMessageBus

# Class: GraphMessageBus

Defined in: [agents/communication.ts:433](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L433)

Message bus with graph storage integration

Stores all messages as graph relationships:
- Regular messages: (sender)-[:sentTo]->(recipient)
- Handoffs: (sender)-[:handedOffTo]->(recipient)

This enables:
- Queryable message history
- Handoff chain traversal
- Communication pattern analysis

## Extends

- [`AgentMessageBus`](AgentMessageBus.md)

## Constructors

### Constructor

> **new GraphMessageBus**(`config`): `GraphMessageBus`

Defined in: [agents/communication.ts:436](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L436)

#### Parameters

##### config

[`GraphMessageBusConfig`](../interfaces/GraphMessageBusConfig.md)

#### Returns

`GraphMessageBus`

#### Overrides

[`AgentMessageBus`](AgentMessageBus.md).[`constructor`](AgentMessageBus.md#constructor)

## Methods

### broadcast()

> **broadcast**\<`T`\>(`broadcast`): `Promise`\<[`MessageEnvelope`](../interfaces/MessageEnvelope.md)\<`T`\>[]\>

Defined in: [agents/communication.ts:470](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L470)

Broadcast with graph persistence

#### Type Parameters

##### T

`T`

#### Parameters

##### broadcast

[`BroadcastRequest`](../interfaces/BroadcastRequest.md)\<`T`\>

#### Returns

`Promise`\<[`MessageEnvelope`](../interfaces/MessageEnvelope.md)\<`T`\>[]\>

#### Overrides

[`AgentMessageBus`](AgentMessageBus.md).[`broadcast`](AgentMessageBus.md#broadcast)

***

### getAgentCommunications()

> **getAgentCommunications**(`agentId`): `Promise`\<[`AgentMessage`](../interfaces/AgentMessage.md)\<`unknown`\>[]\>

Defined in: [agents/communication.ts:529](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L529)

Get all communications for an agent (sent and received)

#### Parameters

##### agentId

`string`

#### Returns

`Promise`\<[`AgentMessage`](../interfaces/AgentMessage.md)\<`unknown`\>[]\>

***

### getConversation()

> **getConversation**(`agent1`, `agent2`): `Promise`\<[`AgentMessage`](../interfaces/AgentMessage.md)\<`unknown`\>[]\>

Defined in: [agents/communication.ts:514](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L514)

Get conversation between two agents

#### Parameters

##### agent1

`string`

##### agent2

`string`

#### Returns

`Promise`\<[`AgentMessage`](../interfaces/AgentMessage.md)\<`unknown`\>[]\>

***

### getHandoffChain()

> **getHandoffChain**(`conversationId`): `Promise`\<[`HandoffRecord`](../interfaces/HandoffRecord.md)[]\>

Defined in: [agents/communication.ts:492](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L492)

Get handoff chain for a conversation

#### Parameters

##### conversationId

`string`

#### Returns

`Promise`\<[`HandoffRecord`](../interfaces/HandoffRecord.md)[]\>

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

#### Inherited from

[`AgentMessageBus`](AgentMessageBus.md).[`getHistory`](AgentMessageBus.md#gethistory)

***

### getMostActiveAgents()

> **getMostActiveAgents**(`limit`): `Promise`\<[`AgentActivity`](../interfaces/AgentActivity.md)[]\>

Defined in: [agents/communication.ts:610](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L610)

Get most active agents by message count

#### Parameters

##### limit

`number`

#### Returns

`Promise`\<[`AgentActivity`](../interfaces/AgentActivity.md)[]\>

***

### getStats()

> **getStats**(): `Promise`\<[`CommunicationStats`](../interfaces/CommunicationStats.md)\>

Defined in: [agents/communication.ts:586](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L586)

Get communication statistics

#### Returns

`Promise`\<[`CommunicationStats`](../interfaces/CommunicationStats.md)\>

***

### queryMessages()

> **queryMessages**(`filter`): `Promise`\<[`AgentMessage`](../interfaces/AgentMessage.md)\<`unknown`\>[]\>

Defined in: [agents/communication.ts:545](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L545)

Query messages by filter

#### Parameters

##### filter

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

#### Inherited from

[`AgentMessageBus`](AgentMessageBus.md).[`request`](AgentMessageBus.md#request)

***

### send()

> **send**\<`T`\>(`message`): `Promise`\<[`MessageEnvelope`](../interfaces/MessageEnvelope.md)\<`T`\>\>

Defined in: [agents/communication.ts:444](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/communication.ts#L444)

Send a message with graph persistence

#### Type Parameters

##### T

`T`

#### Parameters

##### message

[`AgentMessage`](../interfaces/AgentMessage.md)\<`T`\>

#### Returns

`Promise`\<[`MessageEnvelope`](../interfaces/MessageEnvelope.md)\<`T`\>\>

#### Overrides

[`AgentMessageBus`](AgentMessageBus.md).[`send`](AgentMessageBus.md#send)

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

#### Inherited from

[`AgentMessageBus`](AgentMessageBus.md).[`subscribe`](AgentMessageBus.md#subscribe)
