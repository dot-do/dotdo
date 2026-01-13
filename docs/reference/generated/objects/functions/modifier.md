[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / modifier

# Function: modifier()

> **modifier**(`config?`): [`Modifier`](../interfaces/Modifier.md)

Defined in: [lib/Modifier.ts:247](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L247)

Create a new modifier

## Parameters

### config?

[`ModifierConfig`](../interfaces/ModifierConfig.md)

## Returns

[`Modifier`](../interfaces/Modifier.md)

## Example

```typescript
const addTimestamp = modifier()
  .output((result) => ({ ...result, timestamp: Date.now() }))

const validateInput = modifier({ name: 'input-validator' })
  .input((input) => {
    if (!input.orderId) throw new Error('Missing orderId')
    return input
  })
```
