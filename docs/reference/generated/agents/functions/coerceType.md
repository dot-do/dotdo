[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / coerceType

# Function: coerceType()

> **coerceType**(`value`, `target`): `unknown`

Defined in: [agents/structured-output.ts:222](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L222)

Coerce a value to a target type

Handles common AI output quirks:
- "123" -> 123 (string to number)
- "true"/"false" -> true/false (string to boolean)
- "yes"/"no" -> true/false
- "1"/"0" -> true/false
- 123 -> "123" (number to string)
- "null" -> null

## Parameters

### value

`unknown`

Value to coerce

### target

[`CoercionTarget`](../type-aliases/CoercionTarget.md)

Target type

## Returns

`unknown`

Coerced value or undefined if coercion not possible
