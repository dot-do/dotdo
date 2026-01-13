[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / ValidationOptions

# Interface: ValidationOptions

Defined in: [lib/functions/FunctionMiddleware.ts:359](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L359)

## Properties

### inputValidator()?

> `optional` **inputValidator**: (`input`) => `string` \| `boolean` \| `Promise`\<`string` \| `boolean`\>

Defined in: [lib/functions/FunctionMiddleware.ts:360](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L360)

#### Parameters

##### input

`unknown`

#### Returns

`string` \| `boolean` \| `Promise`\<`string` \| `boolean`\>

***

### outputValidator()?

> `optional` **outputValidator**: (`output`) => `string` \| `boolean` \| `Promise`\<`string` \| `boolean`\>

Defined in: [lib/functions/FunctionMiddleware.ts:361](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionMiddleware.ts#L361)

#### Parameters

##### output

`unknown`

#### Returns

`string` \| `boolean` \| `Promise`\<`string` \| `boolean`\>
