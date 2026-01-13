[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventId

# Type Alias: EventId

> **EventId** = `Brand`\<`string`, `"EventId"`\>

Defined in: [types/ids.ts:65](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L65)

Branded type for Event IDs.
Events are domain events emitted after actions complete.

## Example

```ts
const id: EventId = createEventId('evt-123')
```
