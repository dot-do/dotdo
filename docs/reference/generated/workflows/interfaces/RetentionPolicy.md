[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / RetentionPolicy

# Interface: RetentionPolicy

Defined in: [db/primitives/temporal-store.ts:161](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/primitives/temporal-store.ts#L161)

Retention policy for controlling memory usage through version pruning.

Both constraints can be combined - entries must satisfy both to be retained.

## Example

```ts
// Keep last 10 versions, but no older than 7 days
{ maxVersions: 10, maxAge: '7d' }
```

## Properties

### maxAge?

> `optional` **maxAge**: `Duration`

Defined in: [db/primitives/temporal-store.ts:171](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/primitives/temporal-store.ts#L171)

Keep versions newer than this duration.
Accepts milliseconds (number) or duration string ('7d', '24h', '30m').

***

### maxVersions?

> `optional` **maxVersions**: `number`

Defined in: [db/primitives/temporal-store.ts:166](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/primitives/temporal-store.ts#L166)

Keep only the last N versions per key.
Older versions are removed on prune().
