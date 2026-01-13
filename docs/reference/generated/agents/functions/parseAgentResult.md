[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / parseAgentResult

# Function: parseAgentResult()

> **parseAgentResult**\<`T`\>(`text`, `schema`, `options`): [`TypedAgentResult`](../interfaces/TypedAgentResult.md)\<`T`\>

Defined in: [agents/typed-result.ts:320](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L320)

Parse agent output into a typed result

## Type Parameters

### T

`T`

## Parameters

### text

`string`

Raw text output from agent

### schema

`ZodType`\<`T`\>

Zod schema for validation

### options

Parsing options

#### agent?

`string`

#### allowPartial?

`boolean`

#### coerce?

`boolean`

## Returns

[`TypedAgentResult`](../interfaces/TypedAgentResult.md)\<`T`\>

Typed AgentResult<T>
