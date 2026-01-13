[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / PersistentToolOptions

# Interface: PersistentToolOptions\<TInput, TOutput\>

Defined in: [agents/tool-thing.ts:261](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L261)

Options for creating a persistent tool.

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Properties

### description

> **description**: `string`

Defined in: [agents/tool-thing.ts:265](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L265)

Human-readable description

***

### execute()

> **execute**: (`input`, `context`) => `Promise`\<`TOutput`\>

Defined in: [agents/tool-thing.ts:271](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L271)

Execute function

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

Defined in: [agents/tool-thing.ts:267](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L267)

Input schema (Zod or JSON Schema)

***

### interruptible?

> `optional` **interruptible**: `boolean`

Defined in: [agents/tool-thing.ts:273](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L273)

Whether this tool can be interrupted

***

### name

> **name**: `string`

Defined in: [agents/tool-thing.ts:263](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L263)

Tool name (unique identifier)

***

### outputSchema?

> `optional` **outputSchema**: [`JsonSchema`](JsonSchema.md) \| `ZodType`\<`TOutput`, `unknown`, `$ZodTypeInternals`\<`TOutput`, `unknown`\>\>

Defined in: [agents/tool-thing.ts:269](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L269)

Output schema (optional)

***

### permission?

> `optional` **permission**: `"auto"` \| `"confirm"` \| `"deny"`

Defined in: [agents/tool-thing.ts:275](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L275)

Permission level

***

### store?

> `optional` **store**: `GraphStore`

Defined in: [agents/tool-thing.ts:277](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L277)

Graph store for persistence (optional)
