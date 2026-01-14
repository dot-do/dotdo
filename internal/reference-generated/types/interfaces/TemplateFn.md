[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / TemplateFn

# Interface: TemplateFn()\<Output, Params\>

Defined in: [types/AIFunction.ts:844](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L844)

Create a type-safe template function

## Type Parameters

### Output

`Output`

### Params

`Params` *extends* `Record`\<`string`, `unknown`\> = `Record`\<`string`, `unknown`\>

> **TemplateFn**(`params`): `Promise`\<`Output`\>

Defined in: [types/AIFunction.ts:846](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L846)

Call with params object

## Parameters

### params

`Params`

## Returns

`Promise`\<`Output`\>

## Properties

### params

> `readonly` **params**: keyof `Params`[]

Defined in: [types/AIFunction.ts:850](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L850)

Get the parameter names

***

### template

> `readonly` **template**: `string`

Defined in: [types/AIFunction.ts:848](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L848)

Get the raw template
