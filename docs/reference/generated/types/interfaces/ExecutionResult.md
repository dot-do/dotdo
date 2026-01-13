[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ExecutionResult

# Interface: ExecutionResult\<T, M\>

Defined in: [types/AIFunction.ts:397](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L397)

Base execution result type

## Type Parameters

### T

`T`

### M

`M` *extends* [`ExecutionMetrics`](ExecutionMetrics.md) = [`ExecutionMetrics`](ExecutionMetrics.md)

## Properties

### error?

> `optional` **error**: [`AIFunctionError`](../classes/AIFunctionError.md)

Defined in: [types/AIFunction.ts:403](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L403)

The error (present if success=false)

***

### metrics

> **metrics**: `M`

Defined in: [types/AIFunction.ts:405](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L405)

Execution metrics

***

### success

> **success**: `boolean`

Defined in: [types/AIFunction.ts:399](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L399)

Whether execution succeeded

***

### traceId

> **traceId**: `string`

Defined in: [types/AIFunction.ts:407](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L407)

Trace ID for debugging

***

### value?

> `optional` **value**: `T`

Defined in: [types/AIFunction.ts:401](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L401)

The result value (present if success=true)
