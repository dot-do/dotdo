[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / PrepareStepResult

# Interface: PrepareStepResult

Defined in: [agents/types.ts:196](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L196)

## Properties

### instructions?

> `optional` **instructions**: `string`

Defined in: [agents/types.ts:204](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L204)

Override instructions

***

### messages?

> `optional` **messages**: [`Message`](../type-aliases/Message.md)[]

Defined in: [agents/types.ts:202](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L202)

Modify messages (e.g., for context compression)

***

### model?

> `optional` **model**: `string`

Defined in: [agents/types.ts:198](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L198)

Override model for this step

***

### providerOptions?

> `optional` **providerOptions**: `Record`\<`string`, `unknown`\>

Defined in: [agents/types.ts:206](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L206)

Provider-specific options

***

### tools?

> `optional` **tools**: [`ToolDefinition`](ToolDefinition.md)\<`unknown`, `unknown`\>[]

Defined in: [agents/types.ts:200](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L200)

Override tools for this step
