[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / extractJson

# Function: extractJson()

> **extractJson**(`input`): `unknown`[]

Defined in: [agents/structured-output.ts:133](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L133)

Extract JSON objects/arrays from a string

Handles:
- Markdown code blocks (```json ... ```)
- Bare JSON objects/arrays in text
- Multiple JSON blocks (returns all)

## Parameters

### input

`string`

String that may contain JSON

## Returns

`unknown`[]

Array of extracted JSON values (parsed)
