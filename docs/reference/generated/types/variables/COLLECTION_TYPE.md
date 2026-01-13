[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / COLLECTION\_TYPE

# Variable: COLLECTION\_TYPE

> `const` **COLLECTION\_TYPE**: `"https://schema.org.ai/Collection"` = `'https://schema.org.ai/Collection'`

Defined in: [types/Collection.ts:14](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Collection.ts#L14)

Collection - Homogeneous typed container interface

A Collection is a typed container where:
- All items are of the same type (itemType)
- IDs are constructed as `ns/id` (no type in path)
- CRUD operations don't require type parameter
