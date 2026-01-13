[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / GenerativeFunctionDefinition

# Interface: GenerativeFunctionDefinition\<Input, Output\>

Defined in: [types/AIFunction.ts:663](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L663)

Generative function definition

## Extends

- [`AIFunctionDefinition`](AIFunctionDefinition.md)\<`Input`, `Output`, [`GenerativeOptions`](GenerativeOptions.md)\>

## Type Parameters

### Input

`Input` = `unknown`

### Output

`Output` = `unknown`

## Properties

### defaultOptions?

> `optional` **defaultOptions**: `Partial`\<[`GenerativeOptions`](GenerativeOptions.md)\>

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

### prompt?

> `optional` **prompt**: `string` \| (`input`) => `string`

Defined in: [types/AIFunction.ts:667](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L667)

Prompt template (tagged template literal)

***

### systemPrompt?

> `optional` **systemPrompt**: `string`

Defined in: [types/AIFunction.ts:669](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L669)

System prompt override

***

### tags?

> `optional` **tags**: `string`[]

Defined in: [types/AIFunction.ts:643](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L643)

Tags for categorization

#### Inherited from

[`AIFunctionDefinition`](AIFunctionDefinition.md).[`tags`](AIFunctionDefinition.md#tags)

***

### type

> **type**: `"generative"`

Defined in: [types/AIFunction.ts:665](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L665)

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
