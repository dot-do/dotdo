[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / isEventId

# Function: isEventId()

> **isEventId**(`value`): `value is EventId`

Defined in: [types/ids.ts:222](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L222)

Type guard that narrows unknown to EventId.
Validates that the value is a string with the 'evt-' prefix followed by alphanumeric id.

## Parameters

### value

`unknown`

The value to check

## Returns

`value is EventId`

true if the value is a valid EventId format, narrowing the type
