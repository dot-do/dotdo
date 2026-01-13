[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / CascadeExecutor

# Class: CascadeExecutor

Defined in: [lib/executors/CascadeExecutor.ts:401](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L401)

## Constructors

### Constructor

> **new CascadeExecutor**(`options`): `CascadeExecutor`

Defined in: [lib/executors/CascadeExecutor.ts:406](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L406)

#### Parameters

##### options

[`CascadeExecutorOptions`](../interfaces/CascadeExecutorOptions.md)

#### Returns

`CascadeExecutor`

## Methods

### execute()

> **execute**\<`TInput`, `TOutput`\>(`options`): `Promise`\<[`CascadeResult`](../interfaces/CascadeResult.md)\<`TOutput`\>\>

Defined in: [lib/executors/CascadeExecutor.ts:415](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L415)

Execute a cascade, trying handlers in order of cost/complexity

#### Type Parameters

##### TInput

`TInput` = `unknown`

##### TOutput

`TOutput` = `unknown`

#### Parameters

##### options

[`CascadeOptions`](../interfaces/CascadeOptions.md)\<`TInput`\>

#### Returns

`Promise`\<[`CascadeResult`](../interfaces/CascadeResult.md)\<`TOutput`\>\>
