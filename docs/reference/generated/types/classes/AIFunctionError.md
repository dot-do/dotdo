[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / AIFunctionError

# Class: AIFunctionError

Defined in: [types/AIFunction.ts:437](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L437)

Base error class for AI function errors

## Extends

- `Error`

## Extended by

- [`ValidationError`](ValidationError.md)
- [`TimeoutError`](TimeoutError.md)
- [`RateLimitError`](RateLimitError.md)
- [`ModelError`](ModelError.md)
- [`ToolError`](ToolError.md)
- [`ContentFilterError`](ContentFilterError.md)
- [`HumanRejectedError`](HumanRejectedError.md)

## Constructors

### Constructor

> **new AIFunctionError**(`code`, `message`, `details?`, `cause?`): `AIFunctionError`

Defined in: [types/AIFunction.ts:438](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L438)

#### Parameters

##### code

[`AIFunctionErrorCode`](../type-aliases/AIFunctionErrorCode.md)

##### message

`string`

##### details?

`Record`\<`string`, `unknown`\>

##### cause?

`Error`

#### Returns

`AIFunctionError`

#### Overrides

`Error.constructor`

## Methods

### toJSON()

> **toJSON**(): [`AIFunctionErrorData`](../interfaces/AIFunctionErrorData.md)

Defined in: [types/AIFunction.ts:449](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L449)

Convert to plain object for serialization

#### Returns

[`AIFunctionErrorData`](../interfaces/AIFunctionErrorData.md)

## Properties

### cause?

> `optional` **cause**: `Error`

Defined in: [types/AIFunction.ts:442](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L442)

#### Inherited from

`Error.cause`

***

### code

> **code**: [`AIFunctionErrorCode`](../type-aliases/AIFunctionErrorCode.md)

Defined in: [types/AIFunction.ts:439](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L439)

***

### details?

> `optional` **details**: `Record`\<`string`, `unknown`\>

Defined in: [types/AIFunction.ts:441](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L441)
