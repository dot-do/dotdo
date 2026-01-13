[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / simpleHash

# Function: simpleHash()

> **simpleHash**(`key`, `count`): `number`

Defined in: [db/core/shard.ts:212](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/shard.ts#L212)

Simple modulo hash for uniform distribution
Full redistribution when shard count changes

## Parameters

### key

`string`

The key to hash

### count

`number`

Number of shards

## Returns

`number`

Shard index [0, count)
