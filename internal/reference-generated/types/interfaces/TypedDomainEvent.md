[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / TypedDomainEvent

# Interface: TypedDomainEvent\<TPayload\>

Defined in: [types/EventHandler.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L53)

A domain event with a typed payload.

Extends the base DomainEvent structure but replaces `data: unknown`
with a specific payload type for type-safe access.

## Example

```typescript
interface CustomerCreatedPayload {
  customerId: string
  name: string
  email: string
}

const event: TypedDomainEvent<CustomerCreatedPayload> = {
  id: 'evt-123',
  verb: 'created',
  source: 'https://api.example.com.ai/customers',
  data: { customerId: 'cust-1', name: 'John', email: 'john@example.com.ai' },
  timestamp: new Date()
}
```

## Type Parameters

### TPayload

`TPayload`

The type of the event payload data

## Properties

### actionId?

> `optional` **actionId**: `string`

Defined in: [types/EventHandler.ts:67](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L67)

Optional action ID that triggered this event

***

### data

> **data**: `TPayload`

Defined in: [types/EventHandler.ts:64](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L64)

The typed event payload data

***

### id

> **id**: `string`

Defined in: [types/EventHandler.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L55)

Unique event identifier

***

### source

> **source**: `string`

Defined in: [types/EventHandler.ts:61](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L61)

URL of the source entity that emitted the event

***

### timestamp

> **timestamp**: `Date`

Defined in: [types/EventHandler.ts:70](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L70)

When the event occurred

***

### verb

> **verb**: `string`

Defined in: [types/EventHandler.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L58)

The action/verb that occurred (e.g., 'created', 'updated', 'shipped')
