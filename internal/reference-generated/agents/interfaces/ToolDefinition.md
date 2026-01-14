[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ToolDefinition

# Interface: ToolDefinition\<TInput, TOutput\>

Defined in: [agents/types.ts:100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L100)

## Extended by

- [`CacheableToolDefinition`](CacheableToolDefinition.md)

## Type Parameters

### TInput

`TInput` = `unknown`

### TOutput

`TOutput` = `unknown`

## Properties

### description

> **description**: `string`

Defined in: [agents/types.ts:102](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L102)

***

### execute()

> **execute**: (`input`, `context`) => `Promise`\<`TOutput`\>

Defined in: [agents/types.ts:105](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L105)

#### Parameters

##### input

`TInput`

##### context

[`ToolContext`](ToolContext.md)

#### Returns

`Promise`\<`TOutput`\>

***

### inputSchema

> **inputSchema**: [`Schema`](../type-aliases/Schema.md)\<`TInput`\>

Defined in: [agents/types.ts:103](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L103)

***

### interruptible?

> `optional` **interruptible**: `boolean`

Defined in: [agents/types.ts:108](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L108)

For voice agents: can this tool be called while speaking?

***

### name

> **name**: `string`

Defined in: [agents/types.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L101)

***

### outputSchema?

> `optional` **outputSchema**: [`Schema`](../type-aliases/Schema.md)\<`TOutput`\>

Defined in: [agents/types.ts:104](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L104)

***

### permission?

> `optional` **permission**: `"auto"` \| `"confirm"` \| `"deny"`

Defined in: [agents/types.ts:110](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/types.ts#L110)

Permission level required
