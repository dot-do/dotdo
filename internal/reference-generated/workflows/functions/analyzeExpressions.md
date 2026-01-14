[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / analyzeExpressions

# Function: analyzeExpressions()

> **analyzeExpressions**(`expressions`): `object`

Defined in: [workflows/pipeline-promise.ts:824](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L824)

Analyzes expressions to determine which can run in parallel.

Examines the dependencies between expressions to identify which
can be executed concurrently (independent) and which must wait
for other expressions (dependent).

## Parameters

### expressions

[`PipelinePromise`](../interfaces/PipelinePromise.md)\<`unknown`\>[]

Array of PipelinePromises to analyze

## Returns

`object`

Object with `independent` and `dependent` arrays

### dependent

> **dependent**: [`PipelinePromise`](../interfaces/PipelinePromise.md)\<`unknown`\>[]

### independent

> **independent**: [`PipelinePromise`](../interfaces/PipelinePromise.md)\<`unknown`\>[]

## Examples

```typescript
// These are independent (no shared dependencies)
const userA = $.User('a').get()
const userB = $.User('b').get()

// This depends on userA
const orders = $.Order(userA).list()

const { independent, dependent } = analyzeExpressions([userA, userB, orders])
// independent: [userA, userB] - can run in parallel
// dependent: [orders] - must wait for userA
```

```typescript
const allExprs = collectExpressions(workflowResult)
const { independent, dependent } = analyzeExpressions(allExprs)

// Execute independent expressions in parallel
await Promise.all(independent.map(exec))

// Then execute dependent expressions
for (const expr of dependent) {
  await exec(expr)
}
```
