[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentLoopStep

# Interface: AgentLoopStep

Defined in: [agents/loop.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L52)

Step in the agent loop with explicit phase information

## Properties

### actResults?

> `optional` **actResults**: [`ToolResult`](ToolResult.md)[]

Defined in: [agents/loop.ts:62](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L62)

Tool executions from act phase

***

### messages

> **messages**: [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/loop.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L58)

Messages at this point

***

### observation?

> `optional` **observation**: `string`

Defined in: [agents/loop.ts:64](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L64)

Observation/analysis from observe phase

***

### phase

> **phase**: `"think"` \| `"act"` \| `"observe"`

Defined in: [agents/loop.ts:56](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L56)

Phase: think (LLM call), act (tool execution), observe (process results)

***

### stepNumber

> **stepNumber**: `number`

Defined in: [agents/loop.ts:54](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L54)

Step number (1-indexed)

***

### thinkResult?

> `optional` **thinkResult**: [`StepResult`](StepResult.md)

Defined in: [agents/loop.ts:60](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L60)

Result from think phase

***

### usage?

> `optional` **usage**: [`TokenUsage`](TokenUsage.md)

Defined in: [agents/loop.ts:66](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L66)

Token usage for this step
