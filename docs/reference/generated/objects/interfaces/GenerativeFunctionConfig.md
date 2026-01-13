[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / GenerativeFunctionConfig

# Interface: GenerativeFunctionConfig

Defined in: [lib/executors/BaseFunctionExecutor.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L149)

## Extends

- [`BaseFunctionConfig`](BaseFunctionConfig.md)

## Properties

### description?

> `optional` **description**: `string`

Defined in: [lib/executors/BaseFunctionExecutor.ts:138](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L138)

#### Inherited from

[`BaseFunctionConfig`](BaseFunctionConfig.md).[`description`](BaseFunctionConfig.md#description)

***

### maxTokens?

> `optional` **maxTokens**: `number`

Defined in: [lib/executors/BaseFunctionExecutor.ts:154](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L154)

***

### model

> **model**: `string`

Defined in: [lib/executors/BaseFunctionExecutor.ts:151](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L151)

***

### name

> **name**: `string`

Defined in: [lib/executors/BaseFunctionExecutor.ts:137](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L137)

#### Inherited from

[`BaseFunctionConfig`](BaseFunctionConfig.md).[`name`](BaseFunctionConfig.md#name)

***

### prompt

> **prompt**: `string` \| (`input`) => `string`

Defined in: [lib/executors/BaseFunctionExecutor.ts:152](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L152)

***

### retries?

> `optional` **retries**: [`RetryConfig`](RetryConfig.md)

Defined in: [lib/executors/BaseFunctionExecutor.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L140)

#### Inherited from

[`BaseFunctionConfig`](BaseFunctionConfig.md).[`retries`](BaseFunctionConfig.md#retries)

***

### schema?

> `optional` **schema**: `Record`\<`string`, `unknown`\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:155](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L155)

***

### temperature?

> `optional` **temperature**: `number`

Defined in: [lib/executors/BaseFunctionExecutor.ts:153](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L153)

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [lib/executors/BaseFunctionExecutor.ts:139](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L139)

#### Inherited from

[`BaseFunctionConfig`](BaseFunctionConfig.md).[`timeout`](BaseFunctionConfig.md#timeout)

***

### type

> **type**: `"generative"`

Defined in: [lib/executors/BaseFunctionExecutor.ts:150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L150)
