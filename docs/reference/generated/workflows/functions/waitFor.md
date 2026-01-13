[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / waitFor

# Function: waitFor()

> **waitFor**(`eventName`, `options`): [`PipelinePromise`](../interfaces/PipelinePromise.md)\<`unknown`\>

Defined in: [workflows/on.ts:802](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/on.ts#L802)

Human-in-the-loop wait for external events or approvals.

Suspends workflow execution until the specified event is received,
enabling human approval workflows, external system callbacks, and
long-running asynchronous operations.

## Parameters

### eventName

`string`

Name of the event to wait for

### options

Optional timeout and event type configuration

#### timeout?

`string`

#### type?

`string`

## Returns

[`PipelinePromise`](../interfaces/PipelinePromise.md)\<`unknown`\>

PipelinePromise that resolves when the event is received

## Examples

```typescript
const approval = await waitFor('manager.approval', {
  timeout: '24 hours',
  type: 'approval'
})

if (approval.approved) {
  processRefund(order)
}
```

```typescript
// Workflow pauses until payment provider sends webhook
const paymentResult = await waitFor('payment.completed', {
  timeout: '30 minutes'
})

if (paymentResult.success) {
  send.Order.paid({ orderId: order.id })
}
```

```typescript
async function processLargeRefund(refund: Refund) {
  // Escalate to manager for approval
  send.Approval.requested({
    type: 'refund',
    amount: refund.amount,
    customerId: refund.customerId
  })

  // Workflow hibernates until approval
  const decision = await waitFor('refund.decision')

  return decision.approved
    ? executeRefund(refund)
    : rejectRefund(refund, decision.reason)
}
```
