[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / InferSchemaType

# Type Alias: InferSchemaType\<T\>

> **InferSchemaType**\<`T`\> = `T` *extends* `"string"` ? `string` : `T` *extends* `"number"` ? `number` : `T` *extends* `"integer"` ? `number` : `T` *extends* `"boolean"` ? `boolean` : `T` *extends* `"null"` ? `null` : `T` *extends* `"object"` ? `Record`\<`string`, `unknown`\> : `T` *extends* `"array"` ? `unknown`[] : `unknown`

Defined in: [types/AIFunction.ts:67](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L67)

Infer TypeScript type from JSON Schema type string

## Type Parameters

### T

`T` *extends* [`JSONSchemaType`](JSONSchemaType.md)
