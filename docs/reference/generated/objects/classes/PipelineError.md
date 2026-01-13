[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / PipelineError

# Class: PipelineError

Defined in: [lib/functions/FunctionComposition.ts:66](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L66)

## Extends

- `Error`

## Constructors

### Constructor

> **new PipelineError**(`message`, `stageIndex`, `stageName`, `cause`): `PipelineError`

Defined in: [lib/functions/FunctionComposition.ts:71](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L71)

#### Parameters

##### message

`string`

##### stageIndex

`number`

##### stageName

`string`

##### cause

`Error`

#### Returns

`PipelineError`

#### Overrides

`Error.constructor`

## Properties

### cause

> **cause**: `Error`

Defined in: [lib/functions/FunctionComposition.ts:69](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L69)

#### Overrides

`Error.cause`

***

### stageIndex

> **stageIndex**: `number`

Defined in: [lib/functions/FunctionComposition.ts:67](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L67)

***

### stageName

> **stageName**: `string`

Defined in: [lib/functions/FunctionComposition.ts:68](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L68)
