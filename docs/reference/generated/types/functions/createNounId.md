[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / createNounId

# Function: createNounId()

> **createNounId**(`value`): [`NounId`](../type-aliases/NounId.md)

Defined in: [types/ids.ts:130](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L130)

Creates a branded NounId from a string.

## Parameters

### value

`string`

The string value to brand as NounId

## Returns

[`NounId`](../type-aliases/NounId.md)

A branded NounId

## Example

```ts
const nounId = createNounId('Startup')
```
