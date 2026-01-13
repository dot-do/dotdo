[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / AIFunctionDefinition

# Interface: AIFunctionDefinition\<Input, Output, Options\>

Defined in: [types/AIFunction.ts:623](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L623)

Base AI function definition

## Extended by

- [`CodeFunctionDefinition`](CodeFunctionDefinition.md)
- [`GenerativeFunctionDefinition`](GenerativeFunctionDefinition.md)
- [`AgenticFunctionDefinition`](AgenticFunctionDefinition.md)
- [`HumanFunctionDefinition`](HumanFunctionDefinition.md)

## Type Parameters

### Input

`Input` = `unknown`

### Output

`Output` = `unknown`

### Options

`Options` *extends* [`BaseExecutorOptions`](BaseExecutorOptions.md) = [`BaseExecutorOptions`](BaseExecutorOptions.md)

## Properties

### defaultOptions?

> `optional` **defaultOptions**: `Partial`\<`Options`\>

Defined in: [types/AIFunction.ts:639](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L639)

Default options

***

### deprecated?

> `optional` **deprecated**: `boolean`

Defined in: [types/AIFunction.ts:645](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L645)

Whether this function is deprecated

***

### deprecationMessage?

> `optional` **deprecationMessage**: `string`

Defined in: [types/AIFunction.ts:647](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L647)

Deprecation message if deprecated

***

### description?

> `optional` **description**: `string`

Defined in: [types/AIFunction.ts:631](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L631)

Human-readable description

***

### inputSchema?

> `optional` **inputSchema**: [`JSONSchema`](JSONSchema-1.md)

Defined in: [types/AIFunction.ts:635](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L635)

Input schema for validation and inference

***

### name

> **name**: `string`

Defined in: [types/AIFunction.ts:629](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L629)

Unique function name

***

### outputSchema?

> `optional` **outputSchema**: [`JSONSchema`](JSONSchema-1.md)

Defined in: [types/AIFunction.ts:637](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L637)

Output schema for validation and inference

***

### tags?

> `optional` **tags**: `string`[]

Defined in: [types/AIFunction.ts:643](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L643)

Tags for categorization

***

### type

> **type**: [`FunctionType`](../type-aliases/FunctionType.md)

Defined in: [types/AIFunction.ts:633](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L633)

Function type (code, generative, agentic, human)

***

### version?

> `optional` **version**: `string`

Defined in: [types/AIFunction.ts:641](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L641)

Version for tracking changes
