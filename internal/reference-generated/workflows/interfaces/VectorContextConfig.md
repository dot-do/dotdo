[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / VectorContextConfig

# Interface: VectorContextConfig

Defined in: workflows/context/vector.ts:56

Configuration options for vector context

## Extends

- `Partial`\<[`VectorConfig`](VectorConfig.md)\>

## Properties

### bindings?

> `optional` **bindings**: `unknown`

Defined in: workflows/context/vector.ts:58

Optional bindings (for testing with mocks)

***

### routing?

> `optional` **routing**: `VectorRoutingConfig`

Defined in: [db/core/types.ts:519](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L519)

Routing configuration

#### Inherited from

[`VectorConfig`](VectorConfig.md).[`routing`](VectorConfig.md#routing)

***

### tiers?

> `optional` **tiers**: `object`

Defined in: [db/core/types.ts:513](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L513)

Tiered vector engines

#### cold?

> `optional` **cold**: [`VectorTierConfig`](VectorTierConfig.md)

#### hot?

> `optional` **hot**: [`VectorTierConfig`](VectorTierConfig.md)

#### warm?

> `optional` **warm**: [`VectorTierConfig`](VectorTierConfig.md)

#### Inherited from

[`VectorConfig`](VectorConfig.md).[`tiers`](VectorConfig.md#tiers)
