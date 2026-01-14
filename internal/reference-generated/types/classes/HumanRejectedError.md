[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / HumanRejectedError

# Class: HumanRejectedError

Defined in: [types/AIFunction.ts:601](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L601)

Human task rejected error

## Extends

- [`AIFunctionError`](AIFunctionError.md)

## Constructors

### Constructor

> **new HumanRejectedError**(`respondent`, `reason?`, `message?`): `HumanRejectedError`

Defined in: [types/AIFunction.ts:602](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L602)

#### Parameters

##### respondent

`string`

##### reason?

`string`

##### message?

`string`

#### Returns

`HumanRejectedError`

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

### reason?

> `optional` **reason**: `string`

Defined in: [types/AIFunction.ts:604](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L604)

***

### respondent

> **respondent**: `string`

Defined in: [types/AIFunction.ts:603](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L603)
