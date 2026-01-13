[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / WorkflowCoreStorageOptions

# Interface: WorkflowCoreStorageOptions

Defined in: [workflows/core/workflow-core-storage.ts:88](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L88)

Options for creating a WorkflowCoreStorageStrategy

## Properties

### enableHistory?

> `optional` **enableHistory**: `boolean`

Defined in: [workflows/core/workflow-core-storage.ts:98](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L98)

Enable history tracking (default: true)

***

### historyRetention?

> `optional` **historyRetention**: `object`

Defined in: [workflows/core/workflow-core-storage.ts:100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L100)

Retention policy for history

#### maxAge?

> `optional` **maxAge**: `string` \| `number`

#### maxVersions?

> `optional` **maxVersions**: `number`

***

### metrics?

> `optional` **metrics**: `MetricsCollector`

Defined in: [workflows/core/workflow-core-storage.ts:94](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L94)

Optional metrics collector

***

### runId?

> `optional` **runId**: `string`

Defined in: [workflows/core/workflow-core-storage.ts:92](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L92)

Optional run ID for this execution

***

### stepIdTtl?

> `optional` **stepIdTtl**: `number`

Defined in: [workflows/core/workflow-core-storage.ts:96](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L96)

TTL for step deduplication (ms)

***

### workflowId

> **workflowId**: `string`

Defined in: [workflows/core/workflow-core-storage.ts:90](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L90)

Unique workflow instance ID
