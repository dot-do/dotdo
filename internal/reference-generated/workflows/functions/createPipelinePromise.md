[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / createPipelinePromise

# Function: createPipelinePromise()

> **createPipelinePromise**\<`T`\>(`expr`, `options`): [`PipelinePromise`](../interfaces/PipelinePromise.md)\<`T`\>

Defined in: [workflows/pipeline-promise.ts:223](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L223)

Creates a PipelinePromise that captures an expression without executing it.

The returned promise is both a Thenable (can be awaited) and a Proxy
(property access creates new expressions). This dual nature enables
the promise pipelining pattern where operations are recorded for
later batch execution.

## Type Parameters

### T

`T` = `unknown`

The expected type when the promise resolves

## Parameters

### expr

[`PipelineExpression`](../type-aliases/PipelineExpression.md)

The pipeline expression to capture

### options

[`WorkflowProxyOptions`](../interfaces/WorkflowProxyOptions.md)

Configuration including the execute function

## Returns

[`PipelinePromise`](../interfaces/PipelinePromise.md)\<`T`\>

A PipelinePromise that can be awaited or have properties accessed

## Examples

```typescript
const expr: PipelineExpression = {
  type: 'call',
  domain: 'User',
  method: ['get'],
  context: userId,
  args: []
}

const promise = createPipelinePromise(expr, {
  execute: async (e) => await rpc.execute(e)
})

// Property access creates new expression
const name = promise.name  // type: 'property', base: expr, property: 'name'

// Awaiting triggers execution
const result = await promise
```

```typescript
const ordersExpr = createPipelinePromise(ordersCallExpr, options)

// Map creates a map expression with recorded callback
const totals = ordersExpr.map(order => $.Pricing(order).calculate())
```
