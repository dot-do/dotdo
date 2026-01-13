[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / HistoryCheckpoint

# Interface: HistoryCheckpoint

Defined in: [workflows/core/workflow-history.ts:61](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L61)

Checkpoint state for WorkflowCore integration

## Properties

### events

> **events**: [`HistoryEvent`](HistoryEvent.md)[]

Defined in: [workflows/core/workflow-history.ts:65](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L65)

All history events

***

### historyTimestamp

> **historyTimestamp**: `number`

Defined in: [workflows/core/workflow-history.ts:67](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L67)

Timestamp of latest event

***

### workflowId

> **workflowId**: `string`

Defined in: [workflows/core/workflow-history.ts:63](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L63)

Workflow instance ID
