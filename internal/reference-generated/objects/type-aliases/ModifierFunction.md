[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / ModifierFunction

# Type Alias: ModifierFunction()\<TIn, TOut\>

> **ModifierFunction**\<`TIn`, `TOut`\> = (`value`, `context?`) => `TOut` \| `Promise`\<`TOut`\>

Defined in: [lib/Modifier.ts:77](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L77)

Generic modifier function type (for internal use)

## Type Parameters

### TIn

`TIn` = `unknown`

### TOut

`TOut` = `unknown`

## Parameters

### value

`TIn`

### context?

[`ModifierContext`](../interfaces/ModifierContext.md)

## Returns

`TOut` \| `Promise`\<`TOut`\>
