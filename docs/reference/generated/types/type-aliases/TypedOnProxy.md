[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / TypedOnProxy

# Type Alias: TypedOnProxy

> **TypedOnProxy** = `{ [Noun in string]: TypedOnNounProxy<Noun> }`

Defined in: [types/EventHandler.ts:216](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L216)

Typed version of OnProxy for event subscriptions.

## Example

```typescript
// Usage with the $ context
$.on.Customer.created((event) => {
  // If CustomerCreatedPayload is registered, event.data is typed
  console.log(event.data)
})
```
