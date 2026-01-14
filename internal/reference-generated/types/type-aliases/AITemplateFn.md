[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / AITemplateFn

# Type Alias: AITemplateFn()\<Output\>

> **AITemplateFn**\<`Output`\> = \<`S`\>(`strings`, ...`values`) => [`TemplateFn`](../interfaces/TemplateFn.md)\<`Output`, `Record`\<[`ExtractTemplateParams`](ExtractTemplateParams.md)\<`S`\>, `unknown`\>\>

Defined in: [types/AIFunction.ts:856](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L856)

AI template literal function type

## Type Parameters

### Output

`Output`

## Type Parameters

### S

`S` *extends* `string`

## Parameters

### strings

`TemplateStringsArray` & `object`

### values

...`unknown`[]

## Returns

[`TemplateFn`](../interfaces/TemplateFn.md)\<`Output`, `Record`\<[`ExtractTemplateParams`](ExtractTemplateParams.md)\<`S`\>, `unknown`\>\>
