[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / TypedEventHandler

# Type Alias: TypedEventHandler()\<TPayload\>

> **TypedEventHandler**\<`TPayload`\> = (`event`) => `Promise`\<`void`\>

Defined in: [types/EventHandler.ts:100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L100)

An event handler function that receives events with typed payloads.

This is the typed version of EventHandler that provides compile-time
type checking for the event payload.

## Type Parameters

### TPayload

`TPayload`

The type of the event payload data

## Parameters

### event

[`TypedDomainEvent`](../interfaces/TypedDomainEvent.md)\<`TPayload`\>

## Returns

`Promise`\<`void`\>

## Example

```typescript
interface OrderShippedPayload {
  orderId: string
  trackingNumber: string
  carrier: string
}

const handleOrderShipped: TypedEventHandler<OrderShippedPayload> = async (event) => {
  // Full type safety on event.data
  const { orderId, trackingNumber, carrier } = event.data
  await sendShippingNotification(orderId, trackingNumber, carrier)
}
```
