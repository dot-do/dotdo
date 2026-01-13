[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / WorkflowCoreOptions

# Interface: WorkflowCoreOptions

Defined in: [workflows/core/workflow-core.ts:83](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L83)

Options for creating a WorkflowCore

## Properties

### historyRetention?

> `optional` **historyRetention**: [`RetentionPolicy`](RetentionPolicy.md)

Defined in: [workflows/core/workflow-core.ts:93](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L93)

Default retention policy for workflow history

***

### metrics?

> `optional` **metrics**: `MetricsCollector`

Defined in: [workflows/core/workflow-core.ts:89](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L89)

Optional metrics collector

***

### runId?

> `optional` **runId**: `string`

Defined in: [workflows/core/workflow-core.ts:87](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L87)

Optional run ID for this execution

***

### stepIdTtl?

> `optional` **stepIdTtl**: `number`

Defined in: [workflows/core/workflow-core.ts:91](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L91)

TTL for step deduplication (ms)

***

### workflowId

> **workflowId**: `string`

Defined in: [workflows/core/workflow-core.ts:85](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core.ts#L85)

Unique workflow instance ID
