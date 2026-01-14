[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / GitLogOptions

# Interface: GitLogOptions

Defined in: [types/capabilities.ts:391](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L391)

Options for git log operations.

## Properties

### from?

> `optional` **from**: `string`

Defined in: [types/capabilities.ts:401](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L401)

Starting reference (branch, tag, or commit hash).

***

### limit?

> `optional` **limit**: `number`

Defined in: [types/capabilities.ts:396](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L396)

Maximum number of commits to return.

#### Default

```ts
10
```

***

### path?

> `optional` **path**: `string`

Defined in: [types/capabilities.ts:411](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L411)

Only include commits that modified this path.

***

### to?

> `optional` **to**: `string`

Defined in: [types/capabilities.ts:406](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L406)

Ending reference for range queries.
