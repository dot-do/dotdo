[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / ShardQueryResult

# Interface: ShardQueryResult\<T\>

Defined in: [db/core/shard.ts:340](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/shard.ts#L340)

Result from a sharded query

## Type Parameters

### T

`T` = `unknown`

## Properties

### data?

> `optional` **data**: `T`

Defined in: [db/core/shard.ts:342](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/shard.ts#L342)

***

### error?

> `optional` **error**: `Error`

Defined in: [db/core/shard.ts:343](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/shard.ts#L343)

***

### shard

> **shard**: `number`

Defined in: [db/core/shard.ts:341](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/shard.ts#L341)
