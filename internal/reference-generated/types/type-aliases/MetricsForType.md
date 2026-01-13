[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / MetricsForType

# Type Alias: MetricsForType\<T\>

> **MetricsForType**\<`T`\> = `T` *extends* `"code"` ? [`ExecutionMetrics`](../interfaces/ExecutionMetrics.md) : `T` *extends* `"generative"` ? [`GenerativeMetrics`](../interfaces/GenerativeMetrics.md) : `T` *extends* `"agentic"` ? [`AgenticMetrics`](../interfaces/AgenticMetrics.md) : `T` *extends* `"human"` ? [`HumanMetrics`](../interfaces/HumanMetrics.md) : [`ExecutionMetrics`](../interfaces/ExecutionMetrics.md)

Defined in: [types/AIFunction.ts:974](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L974)

Get the metrics type for a function type

## Type Parameters

### T

`T` *extends* [`FunctionType`](FunctionType.md)
