[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / TaggedResult

# Type Alias: TaggedResult()\<Out, S, Opts\>

> **TaggedResult**\<`Out`, `S`, `Opts`\> = (`params`, `opts?`) => `Out`

Defined in: [types/fn.ts:37](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L37)

Result type for tagged templates with named parameters.
When using fn`hello ${'name'}`, returns a function that accepts params.

## Type Parameters

### Out

`Out`

The output type

### S

`S` *extends* `string`

The template string type (for param extraction)

### Opts

`Opts` *extends* `Record`\<`string`, `unknown`\> = \{ \}

Optional configuration

## Parameters

### params

`Record`\<`string`, `unknown`\>

### opts?

`Opts`

## Returns

`Out`
