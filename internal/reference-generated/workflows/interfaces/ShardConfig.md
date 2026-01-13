[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / ShardConfig

# Interface: ShardConfig

Defined in: [db/core/types.ts:209](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L209)

Configuration for DO sharding (10GB per DO limit)

## Properties

### algorithm

> **algorithm**: [`ShardAlgorithm`](../type-aliases/ShardAlgorithm.md)

Defined in: [db/core/types.ts:215](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L215)

Sharding algorithm

***

### count

> **count**: `number`

Defined in: [db/core/types.ts:213](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L213)

Number of shards

***

### key

> **key**: `string`

Defined in: [db/core/types.ts:211](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L211)

Field to shard on (e.g., 'tenant_id', 'user_id')
