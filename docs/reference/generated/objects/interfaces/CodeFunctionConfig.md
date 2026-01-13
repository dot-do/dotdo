[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / CodeFunctionConfig

# Interface: CodeFunctionConfig

Defined in: [lib/executors/BaseFunctionExecutor.ts:143](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L143)

## Extends

- [`BaseFunctionConfig`](BaseFunctionConfig.md)

## Properties

### description?

> `optional` **description**: `string`

Defined in: [lib/executors/BaseFunctionExecutor.ts:138](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L138)

#### Inherited from

[`BaseFunctionConfig`](BaseFunctionConfig.md).[`description`](BaseFunctionConfig.md#description)

***

### handler()

> **handler**: (`input`, `ctx`) => `unknown`

Defined in: [lib/executors/BaseFunctionExecutor.ts:145](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L145)

#### Parameters

##### input

`unknown`

##### ctx

`unknown`

#### Returns

`unknown`

***

### name

> **name**: `string`

Defined in: [lib/executors/BaseFunctionExecutor.ts:137](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L137)

#### Inherited from

[`BaseFunctionConfig`](BaseFunctionConfig.md).[`name`](BaseFunctionConfig.md#name)

***

### retries?

> `optional` **retries**: [`RetryConfig`](RetryConfig.md)

Defined in: [lib/executors/BaseFunctionExecutor.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L140)

#### Inherited from

[`BaseFunctionConfig`](BaseFunctionConfig.md).[`retries`](BaseFunctionConfig.md#retries)

***

### sandboxed?

> `optional` **sandboxed**: `boolean`

Defined in: [lib/executors/BaseFunctionExecutor.ts:146](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L146)

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [lib/executors/BaseFunctionExecutor.ts:139](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L139)

#### Inherited from

[`BaseFunctionConfig`](BaseFunctionConfig.md).[`timeout`](BaseFunctionConfig.md#timeout)

***

### type

> **type**: `"code"`

Defined in: [lib/executors/BaseFunctionExecutor.ts:144](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L144)
