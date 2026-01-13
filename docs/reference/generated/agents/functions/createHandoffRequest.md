[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createHandoffRequest

# Function: createHandoffRequest()

> **createHandoffRequest**(`sourceAgentId`, `targetAgentId`, `context`, `reason`, `reasonDescription?`): `Omit`\<`HandoffRequest`, `"id"` \| `"initiatedAt"`\>

Defined in: [agents/handoff.ts:792](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L792)

Create a simple handoff request

## Parameters

### sourceAgentId

`string`

### targetAgentId

`string`

### context

[`HandoffContext`](../interfaces/HandoffContext.md)

### reason

[`HandoffReason`](../type-aliases/HandoffReason.md) = `'delegation'`

### reasonDescription?

`string`

## Returns

`Omit`\<`HandoffRequest`, `"id"` \| `"initiatedAt"`\>
