[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / RmOptions

# Interface: RmOptions

Defined in: [types/capabilities.ts:73](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L73)

Options for file/directory removal operations.

## Properties

### force?

> `optional` **force**: `boolean`

Defined in: [types/capabilities.ts:84](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L84)

If true, ignores errors if path doesn't exist.

#### Default

```ts
false
```

***

### recursive?

> `optional` **recursive**: `boolean`

Defined in: [types/capabilities.ts:78](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L78)

If true, removes directories and their contents recursively.

#### Default

```ts
false
```
