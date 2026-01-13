[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createHandoffTool

# Function: createHandoffTool()

> **createHandoffTool**(`agents`, `handoffFn`): [`ToolDefinition`](../interfaces/ToolDefinition.md)\<\{ `agentId`: `string`; `reason`: `string`; \}, \{ `success`: `boolean`; \}\>

Defined in: [agents/Tool.ts:157](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Tool.ts#L157)

Create a handoff tool for transferring to another agent (OpenAI pattern)

## Parameters

### agents

`object`[]

### handoffFn

(`agentId`, `reason`) => `Promise`\<`void`\>

## Returns

[`ToolDefinition`](../interfaces/ToolDefinition.md)\<\{ `agentId`: `string`; `reason`: `string`; \}, \{ `success`: `boolean`; \}\>
