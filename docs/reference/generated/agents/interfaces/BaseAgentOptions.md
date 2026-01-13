[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / BaseAgentOptions

# Interface: BaseAgentOptions

Defined in: [agents/Agent.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Agent.ts#L53)

## Properties

### config

> **config**: [`AgentConfig`](AgentConfig.md)

Defined in: [agents/Agent.ts:54](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Agent.ts#L54)

***

### generate()

> **generate**: (`messages`, `config`) => `Promise`\<[`StepResult`](StepResult.md)\>

Defined in: [agents/Agent.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Agent.ts#L58)

Provider-specific generate function

#### Parameters

##### messages

[`Message`](../type-aliases/Message.md)[]

##### config

[`AgentConfig`](AgentConfig.md)

#### Returns

`Promise`\<[`StepResult`](StepResult.md)\>

***

### generateStream()?

> `optional` **generateStream**: (`messages`, `config`) => `AsyncIterable`\<[`StreamEvent`](StreamEvent.md)\>

Defined in: [agents/Agent.ts:60](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Agent.ts#L60)

Provider-specific stream function

#### Parameters

##### messages

[`Message`](../type-aliases/Message.md)[]

##### config

[`AgentConfig`](AgentConfig.md)

#### Returns

`AsyncIterable`\<[`StreamEvent`](StreamEvent.md)\>

***

### hooks?

> `optional` **hooks**: [`AgentHooks`](AgentHooks.md)

Defined in: [agents/Agent.ts:56](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Agent.ts#L56)

***

### provider

> **provider**: [`AgentProvider`](AgentProvider.md)

Defined in: [agents/Agent.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Agent.ts#L55)
