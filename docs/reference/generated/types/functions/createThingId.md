[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / createThingId

# Function: createThingId()

> **createThingId**(`value`): [`ThingId`](../type-aliases/ThingId.md)

Defined in: [types/ids.ts:91](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L91)

Creates a branded ThingId from a string.

## Parameters

### value

`string`

The string value to brand as ThingId

## Returns

[`ThingId`](../type-aliases/ThingId.md)

A branded ThingId

## Example

```ts
const thingId = createThingId('acme')
// thingId has type ThingId, not string
```
