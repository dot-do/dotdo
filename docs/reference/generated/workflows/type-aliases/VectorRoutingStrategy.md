[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / VectorRoutingStrategy

# Type Alias: VectorRoutingStrategy

> **VectorRoutingStrategy** = `"cascade"` \| `"parallel"` \| `"smart"`

Defined in: [db/core/types.ts:480](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L480)

Vector routing strategy
- cascade: Try hot first, fall back to colder tiers
- parallel: Query all tiers simultaneously, merge results
- smart: Use query characteristics to pick best tier
