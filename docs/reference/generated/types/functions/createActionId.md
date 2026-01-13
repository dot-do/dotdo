[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / createActionId

# Function: createActionId()

> **createActionId**(`value`): [`ActionId`](../type-aliases/ActionId.md)

Defined in: [types/ids.ts:104](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L104)

Creates a branded ActionId from a string.

## Parameters

### value

`string`

The string value to brand as ActionId

## Returns

[`ActionId`](../type-aliases/ActionId.md)

A branded ActionId

## Example

```ts
const actionId = createActionId('550e8400-e29b-41d4-a716-446655440000')
```
