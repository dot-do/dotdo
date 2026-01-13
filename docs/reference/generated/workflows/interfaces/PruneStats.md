[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / PruneStats

# Interface: PruneStats

Defined in: [db/primitives/temporal-store.ts:216](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/primitives/temporal-store.ts#L216)

Statistics returned from prune/compact operations.

## Properties

### keysAffected

> **keysAffected**: `number`

Defined in: [db/primitives/temporal-store.ts:220](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/primitives/temporal-store.ts#L220)

Number of keys that had at least one version removed

***

### keysRemoved

> **keysRemoved**: `number`

Defined in: [db/primitives/temporal-store.ts:222](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/primitives/temporal-store.ts#L222)

Number of keys completely removed (all versions pruned)

***

### versionsRemoved

> **versionsRemoved**: `number`

Defined in: [db/primitives/temporal-store.ts:218](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/primitives/temporal-store.ts#L218)

Total number of versions removed across all keys
