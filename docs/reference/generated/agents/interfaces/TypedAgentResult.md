[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / TypedAgentResult

# Interface: TypedAgentResult\<T\>

Defined in: [agents/typed-result.ts:47](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L47)

AgentResult<T> - Typed result from an agent invocation

Contains both the raw text output and the parsed/validated structured data.

## Type Parameters

### T

`T` = `unknown`

The type of the structured content

## Properties

### content

> **content**: `T`

Defined in: [agents/typed-result.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L52)

Parsed and validated structured content

***

### meta?

> `optional` **meta**: [`AgentResultMeta`](AgentResultMeta.md)

Defined in: [agents/typed-result.ts:61](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L61)

Metadata about the invocation

***

### parsed

> **parsed**: `boolean`

Defined in: [agents/typed-result.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L55)

Whether structured parsing was successful

***

### text

> **text**: `string`

Defined in: [agents/typed-result.ts:49](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L49)

Raw text output from the agent

***

### toolCalls?

> `optional` **toolCalls**: [`TypedToolCallRecord`](TypedToolCallRecord.md)[]

Defined in: [agents/typed-result.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L58)

Tool calls made during execution (if any)
