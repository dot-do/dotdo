[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / VectorTierConfig

# Interface: VectorTierConfig

Defined in: [db/core/types.ts:485](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L485)

Configuration for a single vector tier

## Properties

### dimensions

> **dimensions**: `number`

Defined in: [db/core/types.ts:489](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L489)

Vector dimensions

***

### engine

> **engine**: [`VectorEngineType`](../type-aliases/VectorEngineType.md)

Defined in: [db/core/types.ts:487](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L487)

Engine to use

***

### index?

> `optional` **index**: `ClickHouseIndex`

Defined in: [db/core/types.ts:491](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L491)

ClickHouse-specific index type

***

### metric?

> `optional` **metric**: `"cosine"` \| `"euclidean"` \| `"dot"`

Defined in: [db/core/types.ts:493](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L493)

Metric type (default: cosine)
