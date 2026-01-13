[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / isNounId

# Function: isNounId()

> **isNounId**(`value`): `value is NounId`

Defined in: [types/ids.ts:234](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L234)

Type guard that narrows unknown to NounId.
Validates that the value is a string in PascalCase format.

## Parameters

### value

`unknown`

The value to check

## Returns

`value is NounId`

true if the value is a valid NounId format, narrowing the type
