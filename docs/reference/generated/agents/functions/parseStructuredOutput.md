[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / parseStructuredOutput

# Function: parseStructuredOutput()

> **parseStructuredOutput**\<`T`\>(`schema`, `output`, `options`): `T`

Defined in: [agents/structured-output.ts:393](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/structured-output.ts#L393)

Parse structured output from AI response

Extracts JSON from the response, validates against schema,
and optionally coerces types.

## Type Parameters

### T

`T`

## Parameters

### schema

`ZodType`\<`T`\>

Zod schema to validate against

### output

`unknown`

Raw AI output (string or already parsed object)

### options

Parsing options

#### coerce?

`boolean`

## Returns

`T`

Validated and typed data

## Throws

StructuredOutputError on parse or validation failure
