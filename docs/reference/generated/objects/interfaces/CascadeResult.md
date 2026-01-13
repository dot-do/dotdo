[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / CascadeResult

# Interface: CascadeResult\<T\>

Defined in: [lib/executors/CascadeExecutor.ts:330](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L330)

## Type Parameters

### T

`T` = `unknown`

## Properties

### cascade

> **cascade**: [`CascadePath`](CascadePath.md)

Defined in: [lib/executors/CascadeExecutor.ts:339](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L339)

***

### duration

> **duration**: `number`

Defined in: [lib/executors/CascadeExecutor.ts:340](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L340)

***

### error?

> `optional` **error**: `object`

Defined in: [lib/executors/CascadeExecutor.ts:333](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L333)

#### message

> **message**: `string`

#### name

> **name**: `string`

#### stack?

> `optional` **stack**: `string`

***

### event

> **event**: [`Event5WH`](Event5WH.md)

Defined in: [lib/executors/CascadeExecutor.ts:341](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L341)

***

### method

> **method**: [`CascadeFunctionType`](../type-aliases/CascadeFunctionType.md)

Defined in: [lib/executors/CascadeExecutor.ts:338](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L338)

***

### result?

> `optional` **result**: `T`

Defined in: [lib/executors/CascadeExecutor.ts:332](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L332)

***

### success

> **success**: `boolean`

Defined in: [lib/executors/CascadeExecutor.ts:331](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L331)
