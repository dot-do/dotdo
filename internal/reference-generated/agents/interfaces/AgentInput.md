[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentInput

# Interface: AgentInput

Defined in: [agents/types.ts:392](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L392)

## Properties

### messages?

> `optional` **messages**: [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/types.ts:395](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L395)

***

### prompt?

> `optional` **prompt**: `string`

Defined in: [agents/types.ts:394](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L394)

The prompt or messages to send

***

### providerOptions?

> `optional` **providerOptions**: `Record`\<`string`, `unknown`\>

Defined in: [agents/types.ts:403](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L403)

Provider-specific options

***

### signal?

> `optional` **signal**: `AbortSignal`

Defined in: [agents/types.ts:401](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L401)

Abort signal

***

### stopWhen?

> `optional` **stopWhen**: [`StopCondition`](../type-aliases/StopCondition.md) \| [`StopCondition`](../type-aliases/StopCondition.md)[]

Defined in: [agents/types.ts:399](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L399)

Override stop conditions

***

### tools?

> `optional` **tools**: [`ToolDefinition`](ToolDefinition.md)\<`unknown`, `unknown`\>[]

Defined in: [agents/types.ts:397](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L397)

Override tools for this run
