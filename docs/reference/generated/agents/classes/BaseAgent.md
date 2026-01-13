[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / BaseAgent

# Class: BaseAgent

Defined in: [agents/Agent.ts:63](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Agent.ts#L63)

## Implements

- [`Agent`](../interfaces/Agent.md)

## Constructors

### Constructor

> **new BaseAgent**(`options`): `BaseAgent`

Defined in: [agents/Agent.ts:70](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Agent.ts#L70)

#### Parameters

##### options

[`BaseAgentOptions`](../interfaces/BaseAgentOptions.md)

#### Returns

`BaseAgent`

## Methods

### handoff()?

> `optional` **handoff**(`request`): `Promise`\<[`AgentResult`](../interfaces/AgentResult.md)\>

Defined in: [agents/Agent.ts:409](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Agent.ts#L409)

Hand off to another agent (OpenAI pattern)

#### Parameters

##### request

[`HandoffRequest`](../interfaces/HandoffRequest.md)

#### Returns

`Promise`\<[`AgentResult`](../interfaces/AgentResult.md)\>

#### Implementation of

[`Agent`](../interfaces/Agent.md).[`handoff`](../interfaces/Agent.md#handoff)

***

### run()

> **run**(`input`): `Promise`\<[`AgentResult`](../interfaces/AgentResult.md)\>

Defined in: [agents/Agent.ts:81](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Agent.ts#L81)

Run agent to completion

#### Parameters

##### input

[`AgentInput`](../interfaces/AgentInput.md)

#### Returns

`Promise`\<[`AgentResult`](../interfaces/AgentResult.md)\>

#### Implementation of

[`Agent`](../interfaces/Agent.md).[`run`](../interfaces/Agent.md#run)

***

### spawnSubagent()?

> `optional` **spawnSubagent**(`task`): `Promise`\<[`SubagentResult`](../interfaces/SubagentResult.md)\>

Defined in: [agents/Agent.ts:359](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Agent.ts#L359)

Spawn a subagent (Claude pattern)

#### Parameters

##### task

[`SubagentTask`](../interfaces/SubagentTask.md)

#### Returns

`Promise`\<[`SubagentResult`](../interfaces/SubagentResult.md)\>

#### Implementation of

[`Agent`](../interfaces/Agent.md).[`spawnSubagent`](../interfaces/Agent.md#spawnsubagent)

***

### stream()

> **stream**(`input`): [`AgentStreamResult`](../interfaces/AgentStreamResult.md)

Defined in: [agents/Agent.ts:284](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Agent.ts#L284)

Stream agent execution

#### Parameters

##### input

[`AgentInput`](../interfaces/AgentInput.md)

#### Returns

[`AgentStreamResult`](../interfaces/AgentStreamResult.md)

#### Implementation of

[`Agent`](../interfaces/Agent.md).[`stream`](../interfaces/Agent.md#stream)

## Properties

### config

> `readonly` **config**: [`AgentConfig`](../interfaces/AgentConfig.md)

Defined in: [agents/Agent.ts:64](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Agent.ts#L64)

#### Implementation of

[`Agent`](../interfaces/Agent.md).[`config`](../interfaces/Agent.md#config)

***

### provider

> `readonly` **provider**: [`AgentProvider`](../interfaces/AgentProvider.md)

Defined in: [agents/Agent.ts:65](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Agent.ts#L65)

#### Implementation of

[`Agent`](../interfaces/Agent.md).[`provider`](../interfaces/Agent.md#provider)
