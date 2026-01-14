[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventPayloadRegistry

# Interface: EventPayloadRegistry

Defined in: [types/EventHandler.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L131)

Event payload registry for type-level lookup.

This interface can be extended via declaration merging to register
payload types for specific Noun/Verb combinations.

## Example

```typescript
// Extend the registry in your application:
declare module 'dotdo/types/EventHandler' {
  interface EventPayloadRegistry {
    Customer: {
      created: CustomerCreatedPayload
      updated: CustomerUpdatedPayload
    }
    Order: {
      shipped: OrderShippedPayload
      failed: OrderFailedPayload
    }
  }
}
```

## Indexable

\[`Noun`: `string`\]: `object`
