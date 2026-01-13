[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / isValidNoun

# Function: isValidNoun()

> **isValidNoun**\<`K`\>(`noun`): `noun is K`

Defined in: [types/WorkflowContext.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L149)

Type guard to check if a string is a valid registered noun

## Type Parameters

### K

`K` *extends* keyof [`NounRegistry`](../interfaces/NounRegistry.md)

## Parameters

### noun

`string`

## Returns

`noun is K`

## Example

```typescript
const maybeNoun: string = 'Customer'
if (isValidNoun(maybeNoun)) {
  // maybeNoun is now typed as keyof NounRegistry
  $[maybeNoun](id) // type-safe access
}
```
