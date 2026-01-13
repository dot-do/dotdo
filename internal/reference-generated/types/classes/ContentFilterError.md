[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ContentFilterError

# Class: ContentFilterError

Defined in: [types/AIFunction.ts:583](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L583)

Content filter/moderation error

## Extends

- [`AIFunctionError`](AIFunctionError.md)

## Constructors

### Constructor

> **new ContentFilterError**(`category`, `severity`, `message?`): `ContentFilterError`

Defined in: [types/AIFunction.ts:584](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L584)

#### Parameters

##### category

`string`

##### severity

`"low"` | `"medium"` | `"high"`

##### message?

`string`

#### Returns

`ContentFilterError`

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

### category

> **category**: `string`

Defined in: [types/AIFunction.ts:585](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L585)

***

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

### severity

> **severity**: `"low"` \| `"medium"` \| `"high"`

Defined in: [types/AIFunction.ts:586](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L586)
