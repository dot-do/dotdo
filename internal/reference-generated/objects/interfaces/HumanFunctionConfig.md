[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / HumanFunctionConfig

# Interface: HumanFunctionConfig

Defined in: [lib/executors/BaseFunctionExecutor.ts:167](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L167)

## Extends

- [`BaseFunctionConfig`](BaseFunctionConfig.md)

## Properties

### actions?

> `optional` **actions**: `string`[]

Defined in: [lib/executors/BaseFunctionExecutor.ts:171](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L171)

***

### channel

> **channel**: `string`

Defined in: [lib/executors/BaseFunctionExecutor.ts:169](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L169)

***

### description?

> `optional` **description**: `string`

Defined in: [lib/executors/BaseFunctionExecutor.ts:138](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L138)

#### Inherited from

[`BaseFunctionConfig`](BaseFunctionConfig.md).[`description`](BaseFunctionConfig.md#description)

***

### form?

> `optional` **form**: `Record`\<`string`, `unknown`\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:172](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L172)

***

### name

> **name**: `string`

Defined in: [lib/executors/BaseFunctionExecutor.ts:137](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L137)

#### Inherited from

[`BaseFunctionConfig`](BaseFunctionConfig.md).[`name`](BaseFunctionConfig.md#name)

***

### prompt

> **prompt**: `string` \| (`input`) => `string`

Defined in: [lib/executors/BaseFunctionExecutor.ts:170](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L170)

***

### retries?

> `optional` **retries**: [`RetryConfig`](RetryConfig.md)

Defined in: [lib/executors/BaseFunctionExecutor.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L140)

#### Inherited from

[`BaseFunctionConfig`](BaseFunctionConfig.md).[`retries`](BaseFunctionConfig.md#retries)

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [lib/executors/BaseFunctionExecutor.ts:139](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L139)

#### Inherited from

[`BaseFunctionConfig`](BaseFunctionConfig.md).[`timeout`](BaseFunctionConfig.md#timeout)

***

### type

> **type**: `"human"`

Defined in: [lib/executors/BaseFunctionExecutor.ts:168](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L168)
