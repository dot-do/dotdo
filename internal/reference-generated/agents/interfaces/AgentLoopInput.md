[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentLoopInput

# Interface: AgentLoopInput

Defined in: [agents/loop.ts:92](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L92)

Input for running the agent loop

## Properties

### messages?

> `optional` **messages**: [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/loop.ts:96](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L96)

Initial messages

***

### prompt?

> `optional` **prompt**: `string`

Defined in: [agents/loop.ts:94](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L94)

Initial prompt

***

### signal?

> `optional` **signal**: `AbortSignal`

Defined in: [agents/loop.ts:102](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L102)

Abort signal

***

### stopWhen?

> `optional` **stopWhen**: [`StopCondition`](../type-aliases/StopCondition.md) \| [`StopCondition`](../type-aliases/StopCondition.md)[]

Defined in: [agents/loop.ts:100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L100)

Override stop conditions

***

### tools?

> `optional` **tools**: [`ToolDefinition`](ToolDefinition.md)\<`unknown`, `unknown`\>[]

Defined in: [agents/loop.ts:98](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L98)

Override tools for this run
