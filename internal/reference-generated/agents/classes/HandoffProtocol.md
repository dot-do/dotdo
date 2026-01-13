[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / HandoffProtocol

# Class: HandoffProtocol

Defined in: [agents/handoff.ts:473](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L473)

HandoffProtocol - Manages agent-to-agent handoffs

Provides a structured way to:
- Transfer context between agents
- Track handoff chains
- Hook into handoff lifecycle
- Prevent circular handoffs

## Example

```ts
const protocol = new HandoffProtocol({
  provider: createOpenAIProvider(),
  agents: [supportAgent, salesAgent, techAgent],
  hooks: {
    onHandoffComplete: async (result) => {
      console.log(`Handoff to ${result.request.targetAgentId} completed`)
    },
  },
})

const result = await protocol.handoff({
  sourceAgentId: 'router',
  targetAgentId: 'support',
  reason: 'routing',
  context: {
    messages: conversationHistory,
    summary: 'Customer asking about billing',
  },
})
```

## Constructors

### Constructor

> **new HandoffProtocol**(`config`): `HandoffProtocol`

Defined in: [agents/handoff.ts:479](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L479)

#### Parameters

##### config

[`HandoffProtocolConfig`](../interfaces/HandoffProtocolConfig.md)

#### Returns

`HandoffProtocol`

## Methods

### addAgent()

> **addAgent**(`config`): `void`

Defined in: [agents/handoff.ts:669](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L669)

Add an agent to the available pool

#### Parameters

##### config

[`AgentConfig`](../interfaces/AgentConfig.md)

#### Returns

`void`

***

### clearChain()

> **clearChain**(`conversationId`): `void`

Defined in: [agents/handoff.ts:648](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L648)

Clear handoff chain for a conversation

#### Parameters

##### conversationId

`string`

#### Returns

`void`

***

### getAvailableAgents()

> **getAvailableAgents**(): [`AgentConfig`](../interfaces/AgentConfig.md)[]

Defined in: [agents/handoff.ts:655](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L655)

Get available agents for handoff

#### Returns

[`AgentConfig`](../interfaces/AgentConfig.md)[]

***

### getChain()

> **getChain**(`conversationId`): [`HandoffChainEntry`](../interfaces/HandoffChainEntry.md)[]

Defined in: [agents/handoff.ts:641](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L641)

Get the current handoff chain for a conversation

#### Parameters

##### conversationId

`string`

#### Returns

[`HandoffChainEntry`](../interfaces/HandoffChainEntry.md)[]

***

### handoff()

> **handoff**(`request`): `Promise`\<[`HandoffResult`](../interfaces/HandoffResult.md)\>

Defined in: [agents/handoff.ts:494](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L494)

Initiate a handoff to another agent

#### Parameters

##### request

`Omit`\<`HandoffRequest`, `"id"` \| `"initiatedAt"`\>

#### Returns

`Promise`\<[`HandoffResult`](../interfaces/HandoffResult.md)\>

***

### isAgentAvailable()

> **isAgentAvailable**(`agentId`): `boolean`

Defined in: [agents/handoff.ts:662](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L662)

Check if an agent is available for handoff

#### Parameters

##### agentId

`string`

#### Returns

`boolean`

***

### removeAgent()

> **removeAgent**(`agentId`): `void`

Defined in: [agents/handoff.ts:676](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L676)

Remove an agent from the available pool

#### Parameters

##### agentId

`string`

#### Returns

`void`
