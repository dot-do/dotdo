[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ActionId

# Type Alias: ActionId

> **ActionId** = `Brand`\<`string`, `"ActionId"`\>

Defined in: [types/ids.ts:56](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L56)

Branded type for Action IDs.
Actions are the source of truth for all mutations (append-only command log).

## Example

```ts
const id: ActionId = createActionId('550e8400-e29b-41d4-a716-446655440000')
```
