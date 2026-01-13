[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / on

# Variable: on

> `const` **on**: `OnProxy`

Defined in: [workflows/on.ts:373](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/on.ts#L373)

Event subscription proxy for declarative event handling.

Supports infinite `Noun.verb` combinations via JavaScript Proxy, enabling
natural domain event subscription without pre-defining event types.

## Examples

```typescript
// Subscribe to customer signup events
on.Customer.signup((customer) => {
  console.log('Welcome', customer.name)
  sendWelcomeEmail(customer.email)
})

// Subscribe to payment events
on.Payment.failed((payment) => {
  notifyBilling(payment.customerId)
})
```

```typescript
// Register with context for grouped cleanup
on.Order.created((order) => {
  processOrder(order)
}, { context: 'order-processor' })

// Later, clean up all handlers for this context
clearHandlersByContext('order-processor')
```

```typescript
const unsubscribe = on.User.updated((user) => {
  syncToExternalSystem(user)
})

// Stop listening when no longer needed
unsubscribe()
```

## Returns

Unsubscribe function to remove the handler
