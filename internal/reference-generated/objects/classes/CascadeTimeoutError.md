[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / CascadeTimeoutError

# Class: CascadeTimeoutError

Defined in: [lib/executors/CascadeExecutor.ts:209](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L209)

## Extends

- `Error`

## Constructors

### Constructor

> **new CascadeTimeoutError**(`message`, `cascade`): `CascadeTimeoutError`

Defined in: [lib/executors/CascadeExecutor.ts:213](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L213)

#### Parameters

##### message

`string`

##### cascade

[`CascadePath`](../interfaces/CascadePath.md)

#### Returns

`CascadeTimeoutError`

#### Overrides

`Error.constructor`

## Properties

### cascade

> **cascade**: [`CascadePath`](../interfaces/CascadePath.md)

Defined in: [lib/executors/CascadeExecutor.ts:211](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L211)

***

### name

> **name**: `string` = `'CascadeTimeoutError'`

Defined in: [lib/executors/CascadeExecutor.ts:210](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L210)

#### Overrides

`Error.name`
