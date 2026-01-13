[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / OutputModifierFunction

# Type Alias: OutputModifierFunction()\<TResult, TIn, TOut\>

> **OutputModifierFunction**\<`TResult`, `TIn`, `TOut`\> = (`result`, `input?`, `context?`) => `TOut` \| `Promise`\<`TOut`\>

Defined in: [lib/Modifier.ts:63](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L63)

Function type for output transformation

## Type Parameters

### TResult

`TResult` = `unknown`

### TIn

`TIn` = `unknown`

### TOut

`TOut` = `unknown`

## Parameters

### result

`TResult`

### input?

`TIn`

### context?

[`ModifierContext`](../interfaces/ModifierContext.md)

## Returns

`TOut` \| `Promise`\<`TOut`\>
