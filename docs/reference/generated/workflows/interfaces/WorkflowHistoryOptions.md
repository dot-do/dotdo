[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / WorkflowHistoryOptions

# Interface: WorkflowHistoryOptions

Defined in: [workflows/core/workflow-history.ts:73](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L73)

Options for creating a WorkflowHistory

## Properties

### cacheSize?

> `optional` **cacheSize**: `number`

Defined in: [workflows/core/workflow-history.ts:83](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L83)

LRU cache size for time-travel queries

***

### metrics?

> `optional` **metrics**: `MetricsCollector`

Defined in: [workflows/core/workflow-history.ts:79](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L79)

Optional metrics collector

***

### retention?

> `optional` **retention**: [`RetentionPolicy`](RetentionPolicy.md)

Defined in: [workflows/core/workflow-history.ts:81](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L81)

Default retention policy

***

### runId?

> `optional` **runId**: `string`

Defined in: [workflows/core/workflow-history.ts:77](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L77)

Optional run ID for this execution

***

### workflowId

> **workflowId**: `string`

Defined in: [workflows/core/workflow-history.ts:75](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L75)

Unique workflow instance ID
