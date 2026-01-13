[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / QueryOptions

# Interface: QueryOptions\<T\>

Defined in: workflows/data/index.ts:145

Query options combining filter, sort, and pagination

## Type Parameters

### T

`T` *extends* `Record`\<`string`, `unknown`\> = `Record`\<`string`, `unknown`\>

## Properties

### cursor?

> `optional` **cursor**: `string`

Defined in: workflows/data/index.ts:150

***

### limit?

> `optional` **limit**: `number`

Defined in: workflows/data/index.ts:148

***

### offset?

> `optional` **offset**: `number`

Defined in: workflows/data/index.ts:149

***

### sort?

> `optional` **sort**: [`SortOption`](SortOption.md) \| [`SortOption`](SortOption.md)[]

Defined in: workflows/data/index.ts:147

***

### where?

> `optional` **where**: [`QueryFilter`](../type-aliases/QueryFilter.md)\<`T`\>

Defined in: workflows/data/index.ts:146
