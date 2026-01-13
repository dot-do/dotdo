[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / DeepPartial

# Type Alias: DeepPartial\<T\>

> **DeepPartial**\<`T`\> = `{ [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }`

Defined in: [types/AIFunction.ts:991](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L991)

Make all properties deeply partial

## Type Parameters

### T

`T`
