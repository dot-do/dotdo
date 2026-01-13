[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / assertEventPayload

# Function: assertEventPayload()

> **assertEventPayload**\<`TPayload`\>(`event`): [`TypedDomainEvent`](../interfaces/TypedDomainEvent.md)\<`TPayload`\>

Defined in: [types/EventHandler.ts:258](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L258)

Assert that an event has a specific payload type.

## Type Parameters

### TPayload

`TPayload`

## Parameters

### event

The domain event to assert

[`DomainEvent`](../interfaces/DomainEvent.md)\<`unknown`\> | [`TypedDomainEvent`](../interfaces/TypedDomainEvent.md)\<`unknown`\>

## Returns

[`TypedDomainEvent`](../interfaces/TypedDomainEvent.md)\<`TPayload`\>

The event with typed payload

## Throws

If called at runtime (this is primarily for type narrowing)

## Example

```typescript
const typedEvent = assertEventPayload<CustomerCreatedPayload>(event)
console.log(typedEvent.data.customerId) // Type-safe access
```
