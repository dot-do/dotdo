[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / zodToPromptSchema

# Function: zodToPromptSchema()

> **zodToPromptSchema**\<`T`\>(`schema`): [`JsonSchema`](../interfaces/JsonSchema.md)

Defined in: [agents/typed-result.ts:468](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L468)

Convert a Zod schema to JSON schema for prompt injection

This generates a JSON schema that can be included in prompts to guide
the AI model to produce correctly structured output.

## Type Parameters

### T

`T`

## Parameters

### schema

`ZodType`\<`T`\>

## Returns

[`JsonSchema`](../interfaces/JsonSchema.md)
