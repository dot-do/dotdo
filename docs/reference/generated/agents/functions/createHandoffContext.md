[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createHandoffContext

# Function: createHandoffContext()

> **createHandoffContext**(`result`, `options`): [`HandoffContext`](../interfaces/HandoffContext.md)

Defined in: [agents/handoff.ts:811](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L811)

Create handoff context from an agent result

## Parameters

### result

[`AgentResult`](../interfaces/AgentResult.md)

### options

#### instructions?

`string`

#### metadata?

`Record`\<`string`, `unknown`\>

#### summary?

`string`

#### variables?

`Record`\<`string`, `unknown`\>

## Returns

[`HandoffContext`](../interfaces/HandoffContext.md)
