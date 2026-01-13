[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ToolError

# Class: ToolError

Defined in: [types/AIFunction.ts:564](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L564)

Tool execution error

## Extends

- [`AIFunctionError`](AIFunctionError.md)

## Constructors

### Constructor

> **new ToolError**(`toolName`, `toolError`, `message?`): `ToolError`

Defined in: [types/AIFunction.ts:565](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L565)

#### Parameters

##### toolName

`string`

##### toolError

`Error`

##### message?

`string`

#### Returns

`ToolError`

#### Overrides

[`AIFunctionError`](AIFunctionError.md).[`constructor`](AIFunctionError.md#constructor)

## Methods

### toJSON()

> **toJSON**(): [`AIFunctionErrorData`](../interfaces/AIFunctionErrorData.md)

Defined in: [types/AIFunction.ts:449](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L449)

Convert to plain object for serialization

#### Returns

[`AIFunctionErrorData`](../interfaces/AIFunctionErrorData.md)

#### Inherited from

[`AIFunctionError`](AIFunctionError.md).[`toJSON`](AIFunctionError.md#tojson)

## Properties

### cause?

> `optional` **cause**: `Error`

Defined in: [types/AIFunction.ts:442](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L442)

#### Inherited from

[`AIFunctionError`](AIFunctionError.md).[`cause`](AIFunctionError.md#cause)

***

### code

> **code**: [`AIFunctionErrorCode`](../type-aliases/AIFunctionErrorCode.md)

Defined in: [types/AIFunction.ts:439](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L439)

#### Inherited from

[`AIFunctionError`](AIFunctionError.md).[`code`](AIFunctionError.md#code)

***

### details?

> `optional` **details**: `Record`\<`string`, `unknown`\>

Defined in: [types/AIFunction.ts:441](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L441)

#### Inherited from

[`AIFunctionError`](AIFunctionError.md).[`details`](AIFunctionError.md#details)

***

### toolError

> **toolError**: `Error`

Defined in: [types/AIFunction.ts:567](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L567)

***

### toolName

> **toolName**: `string`

Defined in: [types/AIFunction.ts:566](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L566)
