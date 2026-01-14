[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / collectExpressions

# Function: collectExpressions()

> **collectExpressions**(`value`): [`PipelinePromise`](../interfaces/PipelinePromise.md)\<`unknown`\>[]

Defined in: [workflows/pipeline-promise.ts:715](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L715)

Collects all PipelinePromises from a value tree.

Traverses objects and arrays recursively to find all embedded
PipelinePromises, useful for analyzing workflow expressions
before execution.

## Parameters

### value

`unknown`

The value tree to traverse

## Returns

[`PipelinePromise`](../interfaces/PipelinePromise.md)\<`unknown`\>[]

Array of all PipelinePromises found

## Example

```typescript
const user = $.User(id).get()
const orders = $.Order(user).list()

const result = {
  user,
  orders,
  metadata: { timestamp: Date.now() }
}

const expressions = collectExpressions(result)
// Returns [user, orders] (the two PipelinePromises)
```
