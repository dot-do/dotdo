[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / AnyDatabase

# Type Alias: AnyDatabase\<TSchema\>

> **AnyDatabase**\<`TSchema`\> = [`DODatabase`](DODatabase.md)\<`TSchema`\> \| [`D1Database`](D1Database.md)\<`TSchema`\>

Defined in: [types/drizzle.ts:38](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/drizzle.ts#L38)

Union type for any SQLite database (DO or D1)
Use this when code needs to work with either database type

## Type Parameters

### TSchema

`TSchema` *extends* `Record`\<`string`, `unknown`\> = [`AppSchema`](AppSchema.md)
