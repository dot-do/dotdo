[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / consistentHash

# Function: consistentHash()

> **consistentHash**(`key`, `count`, `virtualNodes`): `number`

Defined in: [db/core/shard.ts:135](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/shard.ts#L135)

Consistent hash using virtual nodes for better distribution
Minimizes key redistribution when shard count changes

Uses cached ring for O(log n) lookup after first call.
Ring is built once per (count, virtualNodes) configuration.

## Parameters

### key

`string`

The key to hash

### count

`number`

Number of shards

### virtualNodes

`number` = `150`

Virtual nodes per shard (more = better distribution)

## Returns

`number`

Shard index [0, count)
