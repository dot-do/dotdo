[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / PipelineAIFunction

# Interface: PipelineAIFunction()\<Output, Input, Options\>

Defined in: [types/AIFunction.ts:718](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L718)

AI Function that returns a PipelinePromise for lazy evaluation

## Type Parameters

### Output

`Output`

### Input

`Input` = `unknown`

### Options

`Options` *extends* [`BaseExecutorOptions`](BaseExecutorOptions.md) = [`BaseExecutorOptions`](BaseExecutorOptions.md)

## Call Signature

> **PipelineAIFunction**(`input`, `options?`): [`PipelinePromise`](../../workflows/interfaces/PipelinePromise.md)\<[`ExecutionResult`](ExecutionResult.md)\<`Output`, [`ExecutionMetrics`](ExecutionMetrics.md)\>\>

Defined in: [types/AIFunction.ts:720](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L720)

Direct call with input and options

### Parameters

#### input

`Input`

#### options?

`Options`

### Returns

[`PipelinePromise`](../../workflows/interfaces/PipelinePromise.md)\<[`ExecutionResult`](ExecutionResult.md)\<`Output`, [`ExecutionMetrics`](ExecutionMetrics.md)\>\>

## Call Signature

> **PipelineAIFunction**(`strings`, ...`values`): [`PipelinePromise`](../../workflows/interfaces/PipelinePromise.md)\<[`ExecutionResult`](ExecutionResult.md)\<`Output`, [`ExecutionMetrics`](ExecutionMetrics.md)\>\>

Defined in: [types/AIFunction.ts:723](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L723)

Tagged template call with interpolation

### Parameters

#### strings

`TemplateStringsArray`

#### values

...`unknown`[]

### Returns

[`PipelinePromise`](../../workflows/interfaces/PipelinePromise.md)\<[`ExecutionResult`](ExecutionResult.md)\<`Output`, [`ExecutionMetrics`](ExecutionMetrics.md)\>\>

## Call Signature

> **PipelineAIFunction**\<`S`\>(`strings`): (`params`, `options?`) => [`PipelinePromise`](../../workflows/interfaces/PipelinePromise.md)\<[`ExecutionResult`](ExecutionResult.md)\<`Output`, [`ExecutionMetrics`](ExecutionMetrics.md)\>\>

Defined in: [types/AIFunction.ts:726](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L726)

Tagged template call with named params - returns partially applied function

### Type Parameters

#### S

`S` *extends* `string`

### Parameters

#### strings

`TemplateStringsArray` & `object`

### Returns

> (`params`, `options?`): [`PipelinePromise`](../../workflows/interfaces/PipelinePromise.md)\<[`ExecutionResult`](ExecutionResult.md)\<`Output`, [`ExecutionMetrics`](ExecutionMetrics.md)\>\>

#### Parameters

##### params

`Record`\<`string`, `unknown`\>

##### options?

`Options`

#### Returns

[`PipelinePromise`](../../workflows/interfaces/PipelinePromise.md)\<[`ExecutionResult`](ExecutionResult.md)\<`Output`, [`ExecutionMetrics`](ExecutionMetrics.md)\>\>
