[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / HumanFunctionDefinition

# Interface: HumanFunctionDefinition\<Input, Output\>

Defined in: [types/AIFunction.ts:691](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L691)

Human function definition

## Extends

- [`AIFunctionDefinition`](AIFunctionDefinition.md)\<`Input`, `Output`, [`HumanOptions`](HumanOptions.md)\>

## Type Parameters

### Input

`Input` = `unknown`

### Output

`Output` = `unknown`

## Properties

### channel?

> `optional` **channel**: `"webhook"` \| `"web"` \| `"email"` \| `"sms"` \| `"slack"`

Defined in: [types/AIFunction.ts:699](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L699)

Default channel

***

### defaultOptions?

> `optional` **defaultOptions**: `Partial`\<[`HumanOptions`](HumanOptions.md)\>

Defined in: [types/AIFunction.ts:639](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L639)

Default options

#### Inherited from

[`AIFunctionDefinition`](AIFunctionDefinition.md).[`defaultOptions`](AIFunctionDefinition.md#defaultoptions)

***

### deprecated?

> `optional` **deprecated**: `boolean`

Defined in: [types/AIFunction.ts:645](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L645)

Whether this function is deprecated

#### Inherited from

[`AIFunctionDefinition`](AIFunctionDefinition.md).[`deprecated`](AIFunctionDefinition.md#deprecated)

***

### deprecationMessage?

> `optional` **deprecationMessage**: `string`

Defined in: [types/AIFunction.ts:647](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L647)

Deprecation message if deprecated

#### Inherited from

[`AIFunctionDefinition`](AIFunctionDefinition.md).[`deprecationMessage`](AIFunctionDefinition.md#deprecationmessage)

***

### description?

> `optional` **description**: `string`

Defined in: [types/AIFunction.ts:631](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L631)

Human-readable description

#### Inherited from

[`AIFunctionDefinition`](AIFunctionDefinition.md).[`description`](AIFunctionDefinition.md#description)

***

### formSchema?

> `optional` **formSchema**: [`JSONSchema`](JSONSchema-1.md)

Defined in: [types/AIFunction.ts:697](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L697)

Form schema for structured input

***

### inputSchema?

> `optional` **inputSchema**: [`JSONSchema`](JSONSchema-1.md)

Defined in: [types/AIFunction.ts:635](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L635)

Input schema for validation and inference

#### Inherited from

[`AIFunctionDefinition`](AIFunctionDefinition.md).[`inputSchema`](AIFunctionDefinition.md#inputschema)

***

### name

> **name**: `string`

Defined in: [types/AIFunction.ts:629](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L629)

Unique function name

#### Inherited from

[`AIFunctionDefinition`](AIFunctionDefinition.md).[`name`](AIFunctionDefinition.md#name)

***

### outputSchema?

> `optional` **outputSchema**: [`JSONSchema`](JSONSchema-1.md)

Defined in: [types/AIFunction.ts:637](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L637)

Output schema for validation and inference

#### Inherited from

[`AIFunctionDefinition`](AIFunctionDefinition.md).[`outputSchema`](AIFunctionDefinition.md#outputschema)

***

### tags?

> `optional` **tags**: `string`[]

Defined in: [types/AIFunction.ts:643](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L643)

Tags for categorization

#### Inherited from

[`AIFunctionDefinition`](AIFunctionDefinition.md).[`tags`](AIFunctionDefinition.md#tags)

***

### taskDescription?

> `optional` **taskDescription**: `string` \| (`input`) => `string`

Defined in: [types/AIFunction.ts:695](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L695)

Task description template

***

### type

> **type**: `"human"`

Defined in: [types/AIFunction.ts:693](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L693)

Function type (code, generative, agentic, human)

#### Overrides

[`AIFunctionDefinition`](AIFunctionDefinition.md).[`type`](AIFunctionDefinition.md#type)

***

### version?

> `optional` **version**: `string`

Defined in: [types/AIFunction.ts:641](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L641)

Version for tracking changes

#### Inherited from

[`AIFunctionDefinition`](AIFunctionDefinition.md).[`version`](AIFunctionDefinition.md#version)
