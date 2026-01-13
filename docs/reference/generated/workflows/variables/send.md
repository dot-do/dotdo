[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / send

# Variable: send

> `const` **send**: `SendProxy`

Defined in: [workflows/on.ts:655](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/on.ts#L655)

Event emission proxy for fire-and-forget event dispatch.

Creates pipeline expressions for deferred event emission, enabling
event-driven workflows with Cap'n Web RPC promise pipelining.

## Examples

```typescript
// Emit order shipped event
send.Order.shipped({
  orderId: '12345',
  carrier: 'UPS',
  trackingNumber: '1Z999AA10123456784'
})

// Emit customer created event
send.Customer.created({
  id: 'cust_123',
  email: 'user@example.com',
  name: 'John Doe'
})
```

```typescript
async function processOrder(order: Order) {
  await validateOrder(order)

  // Fire-and-forget notification
  send.Order.validated({ orderId: order.id })

  await chargePayment(order)
  send.Payment.captured({ orderId: order.id, amount: order.total })

  return order
}
```

## Returns

PipelinePromise representing the deferred event emission
