[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ValidationError

# Class: ValidationError

Defined in: [types/AIFunction.ts:493](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L493)

Validation error with field-level details

## Extends

- [`AIFunctionError`](AIFunctionError.md)

## Constructors

### Constructor

> **new ValidationError**(`fieldErrors`, `message?`): `ValidationError`

Defined in: [types/AIFunction.ts:494](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L494)

#### Parameters

##### fieldErrors

`object`[]

##### message?

`string`

#### Returns

`ValidationError`

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

### fieldErrors

> **fieldErrors**: `object`[]

Defined in: [types/AIFunction.ts:495](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L495)

#### field

> **field**: `string`

#### message

> **message**: `string`
