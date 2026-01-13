[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / rangeHash

# Function: rangeHash()

> **rangeHash**(`key`, `count`, `min`, `max`): `number`

Defined in: [db/core/shard.ts:172](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/shard.ts#L172)

Range-based hash for ordered data
Good for time-series data or alphabetical partitioning

## Parameters

### key

The key (number or string)

`string` | `number`

### count

`number`

Number of shards

### min

`number` = `0`

Minimum value in range (for numeric keys)

### max

`number` = `1000`

Maximum value in range (for numeric keys)

## Returns

`number`

Shard index [0, count)
