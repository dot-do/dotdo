[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / conditionalModifier

# Function: conditionalModifier()

> **conditionalModifier**\<`TIn`\>(`condition`, `mod`): [`Modifier`](../interfaces/Modifier.md)\<`TIn`\>

Defined in: [lib/Modifier.ts:303](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L303)

Create a conditional modifier that only applies when condition is met

## Type Parameters

### TIn

`TIn` = `unknown`

## Parameters

### condition

[`ConditionFunction`](../type-aliases/ConditionFunction.md)\<`TIn`\>

### mod

[`Modifier`](../interfaces/Modifier.md)

## Returns

[`Modifier`](../interfaces/Modifier.md)\<`TIn`\>

## Example

```typescript
const mod = conditionalModifier(
  (input) => input.shouldModify === true,
  modifier().input((i) => ({ ...i, modified: true }))
)
```
