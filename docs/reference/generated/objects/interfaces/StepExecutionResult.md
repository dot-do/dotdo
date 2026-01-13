[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / StepExecutionResult

# Interface: StepExecutionResult

Defined in: [objects/WorkflowRuntime.ts:145](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L145)

## Properties

### completedAt?

> `optional` **completedAt**: `Date`

Defined in: [objects/WorkflowRuntime.ts:152](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L152)

***

### duration?

> `optional` **duration**: `number`

Defined in: [objects/WorkflowRuntime.ts:150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L150)

***

### error?

> `optional` **error**: `Error`

Defined in: [objects/WorkflowRuntime.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L149)

***

### name

> **name**: `string`

Defined in: [objects/WorkflowRuntime.ts:146](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L146)

***

### output?

> `optional` **output**: `unknown`

Defined in: [objects/WorkflowRuntime.ts:148](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L148)

***

### parallelResults?

> `optional` **parallelResults**: `Record`\<`string`, `ParallelStepResult`\>

Defined in: [objects/WorkflowRuntime.ts:155](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L155)

For parallel steps: individual results keyed by step name

***

### retryCount?

> `optional` **retryCount**: `number`

Defined in: [objects/WorkflowRuntime.ts:153](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L153)

***

### startedAt?

> `optional` **startedAt**: `Date`

Defined in: [objects/WorkflowRuntime.ts:151](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L151)

***

### status

> **status**: `"pending"` \| `"running"` \| `"completed"` \| `"failed"` \| `"skipped"`

Defined in: [objects/WorkflowRuntime.ts:147](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L147)
