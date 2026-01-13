[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / StepResult

# Interface: StepResult

Defined in: [agents/types.ts:180](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L180)

## Properties

### finishReason

> **finishReason**: `"error"` \| `"stop"` \| `"tool_calls"` \| `"max_steps"`

Defined in: [agents/types.ts:184](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L184)

***

### text?

> `optional` **text**: `string`

Defined in: [agents/types.ts:181](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L181)

***

### toolCalls?

> `optional` **toolCalls**: [`ToolCall`](ToolCall.md)[]

Defined in: [agents/types.ts:182](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L182)

***

### toolResults?

> `optional` **toolResults**: [`ToolResult`](ToolResult.md)[]

Defined in: [agents/types.ts:183](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L183)

***

### usage?

> `optional` **usage**: [`TokenUsage`](TokenUsage.md)

Defined in: [agents/types.ts:185](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L185)
