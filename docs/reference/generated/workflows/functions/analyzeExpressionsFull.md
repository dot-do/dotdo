[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / analyzeExpressionsFull

# Function: analyzeExpressionsFull()

> **analyzeExpressionsFull**(`expressions`): [`AnalysisResult`](../interfaces/AnalysisResult.md)

Defined in: [workflows/analyzer.ts:66](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/analyzer.ts#L66)

Performs full dependency analysis on a set of PipelinePromises.

Returns a complete dependency graph and optimal execution order.

## Parameters

### expressions

[`PipelinePromise`](../interfaces/PipelinePromise.md)\<`unknown`\>[]

## Returns

[`AnalysisResult`](../interfaces/AnalysisResult.md)

## Example

```typescript
const crm = $.CRM(customer).createAccount()
const billing = $.Billing(customer).setupSubscription()
// These are INDEPENDENT - can run in parallel

const order = $.Orders({}).create({ items: [] })
const payment = $.Payment({ orderId: order.id }).process()
// payment DEPENDS on order (uses order.id)

const result = analyzeExpressionsFull([crm, billing, order, payment])
// result.executionOrder = [
//   [crm.__expr, billing.__expr, order.__expr],  // Parallel group 1
//   [payment.__expr]                              // Parallel group 2 (waits for order)
// ]
```
