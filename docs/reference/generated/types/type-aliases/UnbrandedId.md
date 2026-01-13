[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / UnbrandedId

# Type Alias: UnbrandedId\<T\>

> **UnbrandedId**\<`T`\> = `T` *extends* `Brand`\<infer U, `string`\> ? `U` : `never`

Defined in: [types/ids.ts:250](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L250)

Extracts the base string type from any branded ID type.
Useful when you need to work with the underlying string.

## Type Parameters

### T

`T` *extends* `Brand`\<`string`, `string`\>

## Example

```ts
type BaseType = UnbrandedId<ThingId> // string
```
