[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ToolOptions

# Interface: ToolOptions\<TInput, TOutput\>

Defined in: [agents/Tool.ts:87](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Tool.ts#L87)

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Properties

### description

> **description**: `string`

Defined in: [agents/Tool.ts:89](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Tool.ts#L89)

***

### execute()

> **execute**: (`input`, `context`) => `Promise`\<`TOutput`\>

Defined in: [agents/Tool.ts:92](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Tool.ts#L92)

#### Parameters

##### input

`TInput`

##### context

[`ToolContext`](ToolContext.md)

#### Returns

`Promise`\<`TOutput`\>

***

### inputSchema

> **inputSchema**: [`JsonSchema`](JsonSchema.md) \| `ZodType`\<`TInput`, `unknown`, `$ZodTypeInternals`\<`TInput`, `unknown`\>\>

Defined in: [agents/Tool.ts:90](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Tool.ts#L90)

***

### interruptible?

> `optional` **interruptible**: `boolean`

Defined in: [agents/Tool.ts:93](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Tool.ts#L93)

***

### name

> **name**: `string`

Defined in: [agents/Tool.ts:88](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Tool.ts#L88)

***

### outputSchema?

> `optional` **outputSchema**: [`JsonSchema`](JsonSchema.md) \| `ZodType`\<`TOutput`, `unknown`, `$ZodTypeInternals`\<`TOutput`, `unknown`\>\>

Defined in: [agents/Tool.ts:91](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Tool.ts#L91)

***

### permission?

> `optional` **permission**: `"auto"` \| `"confirm"` \| `"deny"`

Defined in: [agents/Tool.ts:94](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/Tool.ts#L94)
