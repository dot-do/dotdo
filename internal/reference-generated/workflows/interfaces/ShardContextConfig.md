[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / ShardContextConfig

# Interface: ShardContextConfig

Defined in: workflows/context/shard.ts:40

Configuration options for shard context

## Extends

- `Partial`\<[`ShardConfig`](ShardConfig.md)\>

## Properties

### algorithm?

> `optional` **algorithm**: [`ShardAlgorithm`](../type-aliases/ShardAlgorithm.md)

Defined in: [db/core/types.ts:215](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L215)

Sharding algorithm

#### Inherited from

[`ShardConfig`](ShardConfig.md).[`algorithm`](ShardConfig.md#algorithm)

***

### count?

> `optional` **count**: `number`

Defined in: [db/core/types.ts:213](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L213)

Number of shards

#### Inherited from

[`ShardConfig`](ShardConfig.md).[`count`](ShardConfig.md#count)

***

### key?

> `optional` **key**: `string`

Defined in: [db/core/types.ts:211](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L211)

Field to shard on (e.g., 'tenant_id', 'user_id')

#### Inherited from

[`ShardConfig`](ShardConfig.md).[`key`](ShardConfig.md#key)

***

### namespace?

> `optional` **namespace**: `DurableObjectNamespace`\<`undefined`\>

Defined in: workflows/context/shard.ts:42

Optional namespace binding (for testing with mocks)
