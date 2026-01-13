[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / RetryExhaustedError

# Class: RetryExhaustedError

Defined in: [lib/functions/FunctionComposition.ts:97](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L97)

## Extends

- `Error`

## Constructors

### Constructor

> **new RetryExhaustedError**(`attempts`, `lastError`): `RetryExhaustedError`

Defined in: [lib/functions/FunctionComposition.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L101)

#### Parameters

##### attempts

`number`

##### lastError

`Error`

#### Returns

`RetryExhaustedError`

#### Overrides

`Error.constructor`

## Properties

### attempts

> **attempts**: `number`

Defined in: [lib/functions/FunctionComposition.ts:98](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L98)

***

### lastError

> **lastError**: `Error`

Defined in: [lib/functions/FunctionComposition.ts:99](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L99)
