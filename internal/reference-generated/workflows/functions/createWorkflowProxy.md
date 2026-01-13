[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / createWorkflowProxy

# Function: createWorkflowProxy()

> **createWorkflowProxy**(`options`): `any`

Defined in: [workflows/pipeline-promise.ts:547](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/pipeline-promise.ts#L547)

Creates the $ workflow proxy for capturing domain method calls.

The workflow proxy is the primary interface for writing workflow logic.
It captures all operations as expressions for deferred execution and
provides special methods for control flow and external events.

## Parameters

### options

[`WorkflowProxyOptions`](../interfaces/WorkflowProxyOptions.md) = `{}`

Configuration for the workflow proxy

## Returns

`any`

A proxy object that captures domain calls

## Examples

```typescript
const $ = createWorkflowProxy({
  execute: async (expr) => {
    // In production, send to server
    return await rpc.execute(expr)
  }
})

// Domain method calls
const user = $.User(userId).get()
const orders = $.Order(user).list({ status: 'pending' })

// Result is awaited, triggering execution
const result = await orders
```

```typescript
const $ = createWorkflowProxy(options)

const result = $.when(stock.available, {
  then: () => $.Order(order).fulfill(),
  else: () => $.Order(order).backorder()
})
```

```typescript
const result = $.branch(order.status, {
  pending: () => $.Order(order).process(),
  shipped: () => $.Order(order).track(),
  delivered: () => $.Order(order).complete(),
  default: () => $.Order(order).review()
})
```

```typescript
const result = $.match(payment, [
  [p => p.amount > 10000, () => $.Approval(payment).escalate()],
  [p => p.type === 'refund', () => $.Refund(payment).process()],
  [() => true, () => $.Payment(payment).complete()]
])
```

```typescript
// Workflow pauses until external event
const approval = await $.waitFor('manager.approval', {
  timeout: '24 hours',
  type: 'approval'
})

if (approval.approved) {
  await $.Refund(refund).process()
}
```
