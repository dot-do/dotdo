[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createDelegationTool

# Function: createDelegationTool()

> **createDelegationTool**(`spawnFn`): [`ToolDefinition`](../interfaces/ToolDefinition.md)\<\{ `agentId?`: `string`; `task`: `string`; \}, \{ `result`: `string`; \}\>

Defined in: [agents/Tool.ts:137](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Tool.ts#L137)

Create a delegation tool for spawning subagents (Claude pattern)

## Parameters

### spawnFn

(`prompt`, `agentId?`) => `Promise`\<`string`\>

## Returns

[`ToolDefinition`](../interfaces/ToolDefinition.md)\<\{ `agentId?`: `string`; `task`: `string`; \}, \{ `result`: `string`; \}\>
