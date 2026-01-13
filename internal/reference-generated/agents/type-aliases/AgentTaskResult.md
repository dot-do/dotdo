[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentTaskResult

# Type Alias: AgentTaskResult\<Agent, Task\>

> **AgentTaskResult**\<`Agent`, `Task`\> = `` `${Agent}.${Task}` `` *extends* keyof [`AgentSchemaRegistry`](../interfaces/AgentSchemaRegistry.md) ? [`AgentSchemaRegistry`](../interfaces/AgentSchemaRegistry.md)\[`` `${Agent}.${Task}` ``\] : `unknown`

Defined in: [agents/typed-result.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L131)

Extract the content type for a given agent.task combination

## Type Parameters

### Agent

`Agent` *extends* `string`

### Task

`Task` *extends* `string`
