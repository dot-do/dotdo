[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ExtractTemplateParams

# Type Alias: ExtractTemplateParams\<S\>

> **ExtractTemplateParams**\<`S`\> = `S` *extends* `` `${infer _}${"${"}${infer Param}${"}"}${infer Rest}` `` ? `Param` \| `ExtractTemplateParams`\<`Rest`\> : `never`

Defined in: [types/AIFunction.ts:836](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L836)

Extract parameter names from a template string type

## Type Parameters

### S

`S` *extends* `string`
