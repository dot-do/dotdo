[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / BaseSQLiteDb

# Type Alias: BaseSQLiteDb\<TSchema\>

> **BaseSQLiteDb**\<`TSchema`\> = `BaseSQLiteDatabase`\<`"sync"` \| `"async"`, `unknown`, `TSchema`\>

Defined in: [types/drizzle.ts:46](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/drizzle.ts#L46)

Base SQLite database type for maximum compatibility
This is the common interface that both DO and D1 databases implement

## Type Parameters

### TSchema

`TSchema` *extends* `Record`\<`string`, `unknown`\> = [`AppSchema`](AppSchema.md)
