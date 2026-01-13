[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / InferEventPayload

# Type Alias: InferEventPayload\<T\>

> **InferEventPayload**\<`T`\> = `T` *extends* [`TypedEventHandler`](TypedEventHandler.md)\<infer P\> ? `P` : `T` *extends* (`event`) => `Promise`\<`void`\> ? `P` : `T` *extends* [`EventHandler`](EventHandler.md) ? `unknown` : `never`

Defined in: [types/EventHandler.ts:180](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L180)

Infer the payload type from an event handler function.

Useful for extracting the expected payload type from an existing handler.

## Type Parameters

### T

`T`

The event handler function type

## Example

```typescript
const myHandler: TypedEventHandler<CustomerCreatedPayload> = async (e) => {}
type Payload = InferEventPayload<typeof myHandler> // CustomerCreatedPayload
```
