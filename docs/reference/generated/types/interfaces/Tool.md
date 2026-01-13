[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / Tool

# Interface: Tool\<Input, Output\>

Defined in: [types/AIFunction.ts:107](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L107)

Tool definition for agentic functions

## Type Parameters

### Input

`Input` = `unknown`

### Output

`Output` = `unknown`

## Properties

### description

> **description**: `string`

Defined in: [types/AIFunction.ts:111](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L111)

Human-readable description for the AI

***

### execute()

> **execute**: (`input`) => `Promise`\<`Output`\>

Defined in: [types/AIFunction.ts:117](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L117)

The tool execution function

#### Parameters

##### input

`Input`

#### Returns

`Promise`\<`Output`\>

***

### inputSchema?

> `optional` **inputSchema**: [`JSONSchema`](JSONSchema-1.md)

Defined in: [types/AIFunction.ts:113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L113)

Input schema for validation and type inference

***

### name

> **name**: `string`

Defined in: [types/AIFunction.ts:109](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L109)

Unique tool name

***

### outputSchema?

> `optional` **outputSchema**: [`JSONSchema`](JSONSchema-1.md)

Defined in: [types/AIFunction.ts:115](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L115)

Output schema for validation
