[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / RateLimitError

# Class: RateLimitError

Defined in: [lib/functions/FunctionMiddleware.ts:410](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L410)

## Extends

- `Error`

## Constructors

### Constructor

> **new RateLimitError**(`message`, `remaining`, `resetAt`): `RateLimitError`

Defined in: [lib/functions/FunctionMiddleware.ts:414](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L414)

#### Parameters

##### message

`string`

##### remaining

`number`

##### resetAt

`Date`

#### Returns

`RateLimitError`

#### Overrides

`Error.constructor`

## Properties

### remaining

> **remaining**: `number`

Defined in: [lib/functions/FunctionMiddleware.ts:411](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L411)

***

### resetAt

> **resetAt**: `Date`

Defined in: [lib/functions/FunctionMiddleware.ts:412](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L412)
