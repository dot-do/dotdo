[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createPreservedState

# Function: createPreservedState()

> **createPreservedState**(`options`): [`PreservedState`](../interfaces/PreservedState.md)

Defined in: [agents/handoff.ts:1132](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L1132)

Create a preserved state snapshot

## Parameters

### options

#### agentState?

`Record`\<`string`, `unknown`\>

#### pendingOperations?

`object`[]

#### sessionId?

`string`

#### userContext?

\{ `preferences?`: `Record`\<`string`, `unknown`\>; `userId?`: `string`; `userProfile?`: `Record`\<`string`, `unknown`\>; \}

#### userContext.preferences?

`Record`\<`string`, `unknown`\>

#### userContext.userId?

`string`

#### userContext.userProfile?

`Record`\<`string`, `unknown`\>

#### workflowState?

\{ `currentStep?`: `string`; `stepHistory?`: `string`[]; `variables?`: `Record`\<`string`, `unknown`\>; `workflowId?`: `string`; \}

#### workflowState.currentStep?

`string`

#### workflowState.stepHistory?

`string`[]

#### workflowState.variables?

`Record`\<`string`, `unknown`\>

#### workflowState.workflowId?

`string`

## Returns

[`PreservedState`](../interfaces/PreservedState.md)
