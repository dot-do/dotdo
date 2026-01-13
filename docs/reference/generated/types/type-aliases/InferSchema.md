[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / InferSchema

# Type Alias: InferSchema\<S\>

> **InferSchema**\<`S`\> = `S` *extends* `object` ? `C` : `S` *extends* `object` ? `E` : `S` *extends* `object` ? `string` : `S` *extends* `object` ? `number` : `S` *extends* `object` ? `number` : `S` *extends* `object` ? `boolean` : `S` *extends* `object` ? `null` : `S` *extends* `object` ? `InferSchema`\<`I`\>[] : `S` *extends* `object` ? `{ [K in (...) as (...)]: (...) }` & `{ [K in (...) as (...)]?: (...) }` : `S` *extends* `object` ? `{ [K in (...)]?: (...) }` : ... *extends* ... ? ... : ...

Defined in: [types/AIFunction.ts:81](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L81)

Infer TypeScript type from JSON Schema definition
Provides deep type inference for complex schemas

## Type Parameters

### S

`S` *extends* [`JSONSchema`](../interfaces/JSONSchema-1.md)
