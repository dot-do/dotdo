[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createEscalationTool

# Function: createEscalationTool()

> **createEscalationTool**(`escalateFn`): [`ToolDefinition`](../interfaces/ToolDefinition.md)\<\{ `context?`: `Record`\<`string`, `unknown`\>; `question`: `string`; \}, \{ `answer`: `string`; \}\>

Defined in: [agents/Tool.ts:198](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Tool.ts#L198)

Create a human escalation tool (HumanFunction pattern)

## Parameters

### escalateFn

(`question`, `context`) => `Promise`\<`string`\>

## Returns

[`ToolDefinition`](../interfaces/ToolDefinition.md)\<\{ `context?`: `Record`\<`string`, `unknown`\>; `question`: `string`; \}, \{ `answer`: `string`; \}\>
