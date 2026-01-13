[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / PreservedState

# Interface: PreservedState

Defined in: [agents/handoff.ts:239](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L239)

Preserved state during handoff
Ensures no data loss during agent transitions

## Properties

### agentState?

> `optional` **agentState**: `Record`\<`string`, `unknown`\>

Defined in: [agents/handoff.ts:241](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L241)

Snapshot of agent's internal state

***

### checksum?

> `optional` **checksum**: `string`

Defined in: [agents/handoff.ts:264](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L264)

Checksum for state validation

***

### pendingOperations?

> `optional` **pendingOperations**: `object`[]

Defined in: [agents/handoff.ts:258](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L258)

Any pending operations

#### createdAt

> **createdAt**: `Date`

#### data

> **data**: `unknown`

#### type

> **type**: `string`

***

### sessionId?

> `optional` **sessionId**: `string`

Defined in: [agents/handoff.ts:243](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L243)

Active conversation/session ID

***

### userContext?

> `optional` **userContext**: `object`

Defined in: [agents/handoff.ts:245](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L245)

User/customer context

#### preferences?

> `optional` **preferences**: `Record`\<`string`, `unknown`\>

#### userId?

> `optional` **userId**: `string`

#### userProfile?

> `optional` **userProfile**: `Record`\<`string`, `unknown`\>

***

### workflowState?

> `optional` **workflowState**: `object`

Defined in: [agents/handoff.ts:251](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L251)

Workflow state if part of a workflow

#### currentStep?

> `optional` **currentStep**: `string`

#### stepHistory?

> `optional` **stepHistory**: `string`[]

#### variables?

> `optional` **variables**: `Record`\<`string`, `unknown`\>

#### workflowId?

> `optional` **workflowId**: `string`
