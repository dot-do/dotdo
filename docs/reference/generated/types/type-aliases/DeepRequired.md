[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / DeepRequired

# Type Alias: DeepRequired\<T\>

> **DeepRequired**\<`T`\> = `{ [K in keyof T]-?: T[K] extends object ? DeepRequired<T[K]> : T[K] }`

Defined in: [types/AIFunction.ts:984](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L984)

Make all properties deeply required

## Type Parameters

### T

`T`
