[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ExtractFunction

# Type Alias: ExtractFunction()

> **ExtractFunction** = \<`T`\>(`strings`, ...`values`) => [`AIPipelinePromise`](../interfaces/AIPipelinePromise.md)\<[`ExtractResult`](../interfaces/ExtractResult.md)\<`T`\>\>

Defined in: [types/DO.ts:33](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/DO.ts#L33)

Data extraction with typed entities

## Type Parameters

### T

`T` = `Record`\<`string`, `unknown`\>

## Parameters

### strings

`TemplateStringsArray`

### values

...`unknown`[]

## Returns

[`AIPipelinePromise`](../interfaces/AIPipelinePromise.md)\<[`ExtractResult`](../interfaces/ExtractResult.md)\<`T`\>\>
