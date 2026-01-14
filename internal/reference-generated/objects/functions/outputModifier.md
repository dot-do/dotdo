[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / outputModifier

# Function: outputModifier()

> **outputModifier**\<`TResult`, `TOut`\>(`fn`): [`Modifier`](../interfaces/Modifier.md)\<`unknown`, `TOut`\>

Defined in: [lib/Modifier.ts:286](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L286)

Create an output-only modifier (convenience helper)

## Type Parameters

### TResult

`TResult` = `unknown`

### TOut

`TOut` = `unknown`

## Parameters

### fn

[`OutputModifierFunction`](../type-aliases/OutputModifierFunction.md)\<`TResult`, `unknown`, `TOut`\>

## Returns

[`Modifier`](../interfaces/Modifier.md)\<`unknown`, `TOut`\>

## Example

```typescript
const addMetadata = outputModifier((result) => ({
  ...result,
  processedAt: new Date().toISOString()
}))
```
