[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / ShardAlgorithm

# Type Alias: ShardAlgorithm

> **ShardAlgorithm** = `"consistent"` \| `"range"` \| `"hash"`

Defined in: [db/core/types.ts:204](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/core/types.ts#L204)

Sharding algorithm
- consistent: Consistent hashing (good for dynamic scaling)
- range: Range-based partitioning (good for ordered queries)
- hash: Simple hash modulo (good for uniform distribution)
