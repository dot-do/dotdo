[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ExtractVerb

# Type Alias: ExtractVerb\<T\>

> **ExtractVerb**\<`T`\> = `T` *extends* `` `${string}.${infer V}` `` ? `V` : `never`

Defined in: [types/EventHandler.ts:276](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L276)

Extract the verb from an event key string (e.g., 'Customer.created' -> 'created')

## Type Parameters

### T

`T` *extends* `string`
