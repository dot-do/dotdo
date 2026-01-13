[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / withMemory

# ~~Function: withMemory()~~

> **withMemory**(`agent`, `memory`): [`AgentWithMemory`](../interfaces/AgentWithMemory.md)

Defined in: [agents/memory.ts:543](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L543)

Wrap an agent with conversation memory

## Parameters

### agent

[`Agent`](../interfaces/Agent.md)

### memory

[`ConversationMemory`](../interfaces/ConversationMemory.md)

## Returns

[`AgentWithMemory`](../interfaces/AgentWithMemory.md)

## Deprecated

Consider using the unified AgentMemory system instead.
The unified system provides better integration with graph-backed storage
and consistent APIs across conversation and long-term memory.

## Example

```ts
const memory = createConversationMemory({ windowStrategy: 'summarize' })
const agentWithMemory = withMemory(agent, memory)

// First interaction
await agentWithMemory.runWithMemory({ prompt: 'Hello!' })

// Subsequent interactions include previous context
await agentWithMemory.runWithMemory({ prompt: 'What did I just say?' })
```
