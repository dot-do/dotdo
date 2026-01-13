[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / DOCallError

# Class: DOCallError

Defined in: [workflows/StepDOBridge.ts:59](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepDOBridge.ts#L59)

Error thrown when DO call fails

## Extends

- `Error`

## Constructors

### Constructor

> **new DOCallError**(`noun`, `id`, `method`, `message`, `originalError?`): `DOCallError`

Defined in: [workflows/StepDOBridge.ts:65](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepDOBridge.ts#L65)

#### Parameters

##### noun

`string`

##### id

`string`

##### method

`string`

##### message

`string`

##### originalError?

###### message

`string`

###### name

`string`

#### Returns

`DOCallError`

#### Overrides

`Error.constructor`

## Properties

### id

> `readonly` **id**: `string`

Defined in: [workflows/StepDOBridge.ts:61](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepDOBridge.ts#L61)

***

### method

> `readonly` **method**: `string`

Defined in: [workflows/StepDOBridge.ts:62](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepDOBridge.ts#L62)

***

### noun

> `readonly` **noun**: `string`

Defined in: [workflows/StepDOBridge.ts:60](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepDOBridge.ts#L60)

***

### originalError?

> `readonly` `optional` **originalError**: `object`

Defined in: [workflows/StepDOBridge.ts:63](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/StepDOBridge.ts#L63)

#### message

> **message**: `string`

#### name

> **name**: `string`
