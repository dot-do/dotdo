[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / CascadeExhaustedError

# Class: CascadeExhaustedError

Defined in: [lib/executors/CascadeExecutor.ts:197](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L197)

## Extends

- `Error`

## Constructors

### Constructor

> **new CascadeExhaustedError**(`message`, `cascade`, `errors`): `CascadeExhaustedError`

Defined in: [lib/executors/CascadeExecutor.ts:202](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L202)

#### Parameters

##### message

`string`

##### cascade

[`CascadePath`](../interfaces/CascadePath.md)

##### errors

`Error`[]

#### Returns

`CascadeExhaustedError`

#### Overrides

`Error.constructor`

## Properties

### cascade

> **cascade**: [`CascadePath`](../interfaces/CascadePath.md)

Defined in: [lib/executors/CascadeExecutor.ts:199](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L199)

***

### errors

> **errors**: `Error`[]

Defined in: [lib/executors/CascadeExecutor.ts:200](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L200)

***

### name

> **name**: `string` = `'CascadeExhaustedError'`

Defined in: [lib/executors/CascadeExecutor.ts:198](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L198)

#### Overrides

`Error.name`
