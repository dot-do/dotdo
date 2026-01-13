[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / generateSchemaPrompt

# Function: generateSchemaPrompt()

> **generateSchemaPrompt**\<`T`\>(`schema`): `string`

Defined in: [agents/typed-result.ts:553](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L553)

Generate a prompt suffix that instructs the AI to output valid JSON

## Type Parameters

### T

`T`

## Parameters

### schema

`ZodType`\<`T`\>

Zod schema defining expected output

## Returns

`string`

Prompt suffix string
