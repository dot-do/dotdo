[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / WorkflowRuntimeOptions

# Interface: WorkflowRuntimeOptions

Defined in: [objects/WorkflowRuntime.ts:123](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L123)

## Properties

### domainProxy?

> `optional` **domainProxy**: `Record`\<`string`, `unknown`\>

Defined in: [objects/WorkflowRuntime.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L131)

Domain proxy for $.Noun(id).method() calls

***

### onError?

> `optional` **onError**: `"pause"` \| `"fail"`

Defined in: [objects/WorkflowRuntime.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L129)

Behavior on error: 'fail' (default) or 'pause'

***

### retries?

> `optional` **retries**: `number`

Defined in: [objects/WorkflowRuntime.ts:127](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L127)

Number of retries for failed steps (default: 0)

***

### timeout?

> `optional` **timeout**: `string` \| `number`

Defined in: [objects/WorkflowRuntime.ts:125](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L125)

Global timeout for the entire workflow
