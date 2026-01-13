[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / AnyId

# Type Alias: AnyId

> **AnyId** = [`ThingId`](ThingId.md) \| [`ActionId`](ActionId.md) \| [`EventId`](EventId.md) \| [`NounId`](NounId.md)

Defined in: [types/ids.ts:261](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L261)

Union type of all branded ID types.
Useful for functions that can accept any kind of ID.

## Example

```ts
function logId(id: AnyId): void {
  console.log(`ID: ${id}`)
}
```
