[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventPayloadMap

# Interface: EventPayloadMap

Defined in: [types/WorkflowContext.ts:491](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L491)

Event payload map for typed event handling

This interface defines the mapping from Noun.verb to payload type.
Extend this interface in your domain code to add typed event payloads.

## Example

```typescript
// In your domain types:
declare module '../types/WorkflowContext' {
  interface EventPayloadMap {
    'Customer.created': { id: string; email: string; name: string }
    'Order.paid': { orderId: string; amount: number; currency: string }
    'Invoice.sent': { invoiceId: string; recipientEmail: string }
  }
}
```

## Indexable

\[`event`: `string`\]: `unknown`
