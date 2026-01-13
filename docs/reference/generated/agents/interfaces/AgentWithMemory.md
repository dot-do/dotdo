[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentWithMemory

# Interface: AgentWithMemory

Defined in: [agents/memory.ts:516](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L516)

Wrapper that adds memory capabilities to an agent

## Extends

- [`Agent`](Agent.md)

## Methods

### getMemory()

> **getMemory**(): [`ConversationMemory`](ConversationMemory.md)

Defined in: [agents/memory.ts:518](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L518)

Get the memory instance

#### Returns

[`ConversationMemory`](ConversationMemory.md)

***

### handoff()?

> `optional` **handoff**(`request`): `Promise`\<[`AgentResult`](AgentResult.md)\>

Defined in: [agents/types.ts:535](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L535)

Hand off to another agent (OpenAI pattern)

#### Parameters

##### request

[`HandoffRequest`](HandoffRequest.md)

#### Returns

`Promise`\<[`AgentResult`](AgentResult.md)\>

#### Inherited from

[`Agent`](Agent.md).[`handoff`](Agent.md#handoff)

***

### run()

> **run**(`input`): `Promise`\<[`AgentResult`](AgentResult.md)\>

Defined in: [agents/types.ts:526](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L526)

Run agent to completion

#### Parameters

##### input

[`AgentInput`](AgentInput.md)

#### Returns

`Promise`\<[`AgentResult`](AgentResult.md)\>

#### Inherited from

[`Agent`](Agent.md).[`run`](Agent.md#run)

***

### runWithMemory()

> **runWithMemory**(`input`): `Promise`\<[`AgentResult`](AgentResult.md)\>

Defined in: [agents/memory.ts:521](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/memory.ts#L521)

Run with automatic memory management

#### Parameters

##### input

[`AgentInput`](AgentInput.md)

#### Returns

`Promise`\<[`AgentResult`](AgentResult.md)\>

***

### spawnSubagent()?

> `optional` **spawnSubagent**(`task`): `Promise`\<[`SubagentResult`](SubagentResult.md)\>

Defined in: [agents/types.ts:532](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L532)

Spawn a subagent (Claude pattern)

#### Parameters

##### task

[`SubagentTask`](SubagentTask.md)

#### Returns

`Promise`\<[`SubagentResult`](SubagentResult.md)\>

#### Inherited from

[`Agent`](Agent.md).[`spawnSubagent`](Agent.md#spawnsubagent)

***

### stream()

> **stream**(`input`): [`AgentStreamResult`](AgentStreamResult.md)

Defined in: [agents/types.ts:529](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L529)

Stream agent execution

#### Parameters

##### input

[`AgentInput`](AgentInput.md)

#### Returns

[`AgentStreamResult`](AgentStreamResult.md)

#### Inherited from

[`Agent`](Agent.md).[`stream`](Agent.md#stream)

## Properties

### config

> `readonly` **config**: [`AgentConfig`](AgentConfig.md)

Defined in: [agents/types.ts:522](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L522)

#### Inherited from

[`Agent`](Agent.md).[`config`](Agent.md#config)

***

### provider

> `readonly` **provider**: [`AgentProvider`](AgentProvider.md)

Defined in: [agents/types.ts:523](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L523)

#### Inherited from

[`Agent`](Agent.md).[`provider`](Agent.md#provider)
