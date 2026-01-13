[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / isTypedEvent

# Function: isTypedEvent()

> **isTypedEvent**\<`TPayload`\>(`event`, `validator`): `event is TypedDomainEvent<TPayload>`

Defined in: [types/EventHandler.ts:238](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L238)

Type guard to check if an event has a specific payload shape.

## Type Parameters

### TPayload

`TPayload`

## Parameters

### event

The domain event to check

[`DomainEvent`](../interfaces/DomainEvent.md)\<`unknown`\> | [`TypedDomainEvent`](../interfaces/TypedDomainEvent.md)\<`unknown`\>

### validator

(`data`) => `data is TPayload`

A function that validates the payload

## Returns

`event is TypedDomainEvent<TPayload>`

True if the event payload matches the expected type

## Example

```typescript
if (isTypedEvent<CustomerCreatedPayload>(event, (d) => 'customerId' in d)) {
  // event.data is typed as CustomerCreatedPayload
}
```
