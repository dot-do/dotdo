[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / RateLimitError

# Class: RateLimitError

Defined in: [types/AIFunction.ts:527](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L527)

Rate limit error with retry information

## Extends

- [`AIFunctionError`](AIFunctionError.md)

## Constructors

### Constructor

> **new RateLimitError**(`retryAfterMs`, `limit?`, `remaining?`, `message?`): `RateLimitError`

Defined in: [types/AIFunction.ts:528](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L528)

#### Parameters

##### retryAfterMs

`number`

##### limit?

`number`

##### remaining?

`number`

##### message?

`string`

#### Returns

`RateLimitError`

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

### limit?

> `optional` **limit**: `number`

Defined in: [types/AIFunction.ts:530](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L530)

***

### remaining?

> `optional` **remaining**: `number`

Defined in: [types/AIFunction.ts:531](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L531)

***

### retryAfterMs

> **retryAfterMs**: `number`

Defined in: [types/AIFunction.ts:529](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L529)
