[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / runSingleCycle

# Function: runSingleCycle()

> **runSingleCycle**(`messages`, `generate`, `tools`, `hooks?`): `Promise`\<\{ `newMessages`: [`Message`](../type-aliases/Message.md)[]; `result`: [`StepResult`](../interfaces/StepResult.md); `toolResults`: [`ToolResult`](../interfaces/ToolResult.md)[]; \}\>

Defined in: [agents/loop.ts:657](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L657)

Run a single think-act-observe cycle

Useful for custom loop implementations that need fine-grained control.

## Parameters

### messages

[`Message`](../type-aliases/Message.md)[]

Current messages

### generate

(`messages`, `tools?`) => `Promise`\<[`StepResult`](../interfaces/StepResult.md)\>

LLM generate function

### tools

[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`unknown`, `unknown`\>[] = `[]`

Available tools

### hooks?

[`AgentHooks`](../interfaces/AgentHooks.md)

Optional hooks

## Returns

`Promise`\<\{ `newMessages`: [`Message`](../type-aliases/Message.md)[]; `result`: [`StepResult`](../interfaces/StepResult.md); `toolResults`: [`ToolResult`](../interfaces/ToolResult.md)[]; \}\>

Step result with tool results
