[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / QueryFilter

# Type Alias: QueryFilter\<T\>

> **QueryFilter**\<`T`\> = \{ \[K in keyof T\]?: T\[K\] \| QueryFilterOperators\<T\[K\]\> \}

Defined in: workflows/data/index.ts:121

Query filter - can be exact match or operator object

## Type Parameters

### T

`T` *extends* `Record`\<`string`, `unknown`\> = `Record`\<`string`, `unknown`\>
