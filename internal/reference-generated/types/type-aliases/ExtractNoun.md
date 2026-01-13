[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ExtractNoun

# Type Alias: ExtractNoun\<T\>

> **ExtractNoun**\<`T`\> = `T` *extends* `` `${infer N}.${string}` `` ? `N` : `never`

Defined in: [types/EventHandler.ts:271](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L271)

Extract the noun from an event key string (e.g., 'Customer.created' -> 'Customer')

## Type Parameters

### T

`T` *extends* `string`
