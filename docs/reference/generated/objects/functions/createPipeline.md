[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / createPipeline

# Function: createPipeline()

> **createPipeline**\<`TInput`, `TOutput`\>(`stages`, `options?`): (`input`, `context?`) => `Promise`\<[`PipelineResult`](../interfaces/PipelineResult.md)\<`TOutput`\>\>

Defined in: [lib/functions/FunctionComposition.ts:208](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L208)

Create a named pipeline with detailed results

## Type Parameters

### TInput

`TInput` = `unknown`

### TOutput

`TOutput` = `unknown`

## Parameters

### stages

`object`[]

### options?

[`PipeOptions`](../interfaces/PipeOptions.md)

## Returns

> (`input`, `context?`): `Promise`\<[`PipelineResult`](../interfaces/PipelineResult.md)\<`TOutput`\>\>

### Parameters

#### input

`TInput`

#### context?

[`CompositionExecutionContext`](../interfaces/CompositionExecutionContext.md)

### Returns

`Promise`\<[`PipelineResult`](../interfaces/PipelineResult.md)\<`TOutput`\>\>
