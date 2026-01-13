[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / VectorConfig

# Interface: VectorConfig

Defined in: [db/core/types.ts:511](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L511)

Configuration for pluggable vector search

## Properties

### routing

> **routing**: `VectorRoutingConfig`

Defined in: [db/core/types.ts:519](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L519)

Routing configuration

***

### tiers

> **tiers**: `object`

Defined in: [db/core/types.ts:513](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L513)

Tiered vector engines

#### cold?

> `optional` **cold**: [`VectorTierConfig`](VectorTierConfig.md)

#### hot?

> `optional` **hot**: [`VectorTierConfig`](VectorTierConfig.md)

#### warm?

> `optional` **warm**: [`VectorTierConfig`](VectorTierConfig.md)
