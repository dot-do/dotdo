[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / IsBrandedId

# Type Alias: IsBrandedId\<T\>

> **IsBrandedId**\<`T`\> = `T` *extends* `Brand`\<`string`, `string`\> ? `true` : `false`

Defined in: [types/ids.ts:270](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L270)

Type to check if a type is a branded ID.

## Type Parameters

### T

`T`

## Example

```ts
type IsThingIdBranded = IsBrandedId<ThingId> // true
type IsStringBranded = IsBrandedId<string> // false
```
