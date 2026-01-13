[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / inputModifier

# Function: inputModifier()

> **inputModifier**\<`TIn`, `TOut`\>(`fn`): [`Modifier`](../interfaces/Modifier.md)\<`TIn`, `TOut`\>

Defined in: [lib/Modifier.ts:269](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L269)

Create an input-only modifier (convenience helper)

## Type Parameters

### TIn

`TIn` = `unknown`

### TOut

`TOut` = `unknown`

## Parameters

### fn

[`InputModifierFunction`](../type-aliases/InputModifierFunction.md)\<`TIn`, `TOut`\>

## Returns

[`Modifier`](../interfaces/Modifier.md)\<`TIn`, `TOut`\>

## Example

```typescript
const validateOrder = inputModifier((input) => {
  if (!input.items) throw new Error('Missing items')
  return input
})
```
