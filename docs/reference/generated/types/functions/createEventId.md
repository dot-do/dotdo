[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / createEventId

# Function: createEventId()

> **createEventId**(`value`): [`EventId`](../type-aliases/EventId.md)

Defined in: [types/ids.ts:117](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L117)

Creates a branded EventId from a string.

## Parameters

### value

`string`

The string value to brand as EventId

## Returns

[`EventId`](../type-aliases/EventId.md)

A branded EventId

## Example

```ts
const eventId = createEventId('evt-123')
```
