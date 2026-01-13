[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / DODatabase

# Type Alias: DODatabase\<TSchema\>

> **DODatabase**\<`TSchema`\> = `DrizzleSqliteDODatabase`\<`TSchema`\>

Defined in: [types/drizzle.ts:26](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/drizzle.ts#L26)

Drizzle database type for Durable Object SQLite storage
Use this in DO classes that use ctx.storage for persistence

## Type Parameters

### TSchema

`TSchema` *extends* `Record`\<`string`, `unknown`\> = [`AppSchema`](AppSchema.md)
