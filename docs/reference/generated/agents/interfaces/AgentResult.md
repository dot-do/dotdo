[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentResult

# Interface: AgentResult

Defined in: [agents/types.ts:406](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L406)

## Properties

### finishReason

> **finishReason**: `"error"` \| `"stop"` \| `"tool_calls"` \| `"cancelled"` \| `"max_steps"`

Defined in: [agents/types.ts:418](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L418)

Why the agent stopped

***

### messages

> **messages**: [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/types.ts:414](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L414)

All messages in conversation

***

### steps

> **steps**: `number`

Defined in: [agents/types.ts:416](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L416)

Number of steps taken

***

### text

> **text**: `string`

Defined in: [agents/types.ts:408](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L408)

Final text output

***

### toolCalls

> **toolCalls**: [`ToolCall`](ToolCall.md)[]

Defined in: [agents/types.ts:410](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L410)

All tool calls made

***

### toolResults

> **toolResults**: [`ToolResult`](ToolResult.md)[]

Defined in: [agents/types.ts:412](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L412)

All tool results

***

### usage

> **usage**: [`TokenUsage`](TokenUsage.md)

Defined in: [agents/types.ts:420](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L420)

Token usage
