[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / StreamingAIFunction

# Interface: StreamingAIFunction()\<Output, Input, Options\>

Defined in: [types/AIFunction.ts:734](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L734)

Streaming AI Function that returns an AsyncIterable wrapped in PipelinePromise

## Type Parameters

### Output

`Output`

### Input

`Input` = `unknown`

### Options

`Options` *extends* [`BaseExecutorOptions`](BaseExecutorOptions.md) = [`BaseExecutorOptions`](BaseExecutorOptions.md)

## Call Signature

> **StreamingAIFunction**(`input`, `options?`): [`PipelinePromise`](../../workflows/interfaces/PipelinePromise.md)\<`AsyncIterable`\<`Output`, `any`, `any`\>\>

Defined in: [types/AIFunction.ts:736](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L736)

Direct call with input and options

### Parameters

#### input

`Input`

#### options?

`Options`

### Returns

[`PipelinePromise`](../../workflows/interfaces/PipelinePromise.md)\<`AsyncIterable`\<`Output`, `any`, `any`\>\>

## Call Signature

> **StreamingAIFunction**(`strings`, ...`values`): [`PipelinePromise`](../../workflows/interfaces/PipelinePromise.md)\<`AsyncIterable`\<`Output`, `any`, `any`\>\>

Defined in: [types/AIFunction.ts:739](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L739)

Tagged template call with interpolation

### Parameters

#### strings

`TemplateStringsArray`

#### values

...`unknown`[]

### Returns

[`PipelinePromise`](../../workflows/interfaces/PipelinePromise.md)\<`AsyncIterable`\<`Output`, `any`, `any`\>\>

## Call Signature

> **StreamingAIFunction**\<`S`\>(`strings`): (`params`, `options?`) => [`PipelinePromise`](../../workflows/interfaces/PipelinePromise.md)\<`AsyncIterable`\<`Output`, `any`, `any`\>\>

Defined in: [types/AIFunction.ts:742](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L742)

Tagged template call with named params

### Type Parameters

#### S

`S` *extends* `string`

### Parameters

#### strings

`TemplateStringsArray` & `object`

### Returns

> (`params`, `options?`): [`PipelinePromise`](../../workflows/interfaces/PipelinePromise.md)\<`AsyncIterable`\<`Output`, `any`, `any`\>\>

#### Parameters

##### params

`Record`\<`string`, `unknown`\>

##### options?

`Options`

#### Returns

[`PipelinePromise`](../../workflows/interfaces/PipelinePromise.md)\<`AsyncIterable`\<`Output`, `any`, `any`\>\>
