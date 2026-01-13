[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / isActionId

# Function: isActionId()

> **isActionId**(`value`): `value is ActionId`

Defined in: [types/ids.ts:210](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L210)

Type guard that narrows unknown to ActionId.
Validates that the value is a string matching UUID v4 format.

## Parameters

### value

`unknown`

The value to check

## Returns

`value is ActionId`

true if the value is a valid ActionId format, narrowing the type
