[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createCompleteHandoffContext

# Function: createCompleteHandoffContext()

> **createCompleteHandoffContext**(`result`, `options`): [`HandoffContext`](../interfaces/HandoffContext.md)

Defined in: [agents/handoff.ts:1214](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L1214)

Create a complete handoff context from an agent result with state preservation

## Parameters

### result

[`AgentResult`](../interfaces/AgentResult.md)

### options

#### attachments?

`object`[]

#### conversationId?

`string`

#### instructions?

`string`

#### metadata?

`Record`\<`string`, `unknown`\>

#### preservedState?

[`PreservedState`](../interfaces/PreservedState.md)

#### summary?

`string`

#### variables?

`Record`\<`string`, `unknown`\>

## Returns

[`HandoffContext`](../interfaces/HandoffContext.md)
