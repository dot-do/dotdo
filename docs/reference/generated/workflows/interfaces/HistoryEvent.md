[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / HistoryEvent

# Interface: HistoryEvent

Defined in: [workflows/core/workflow-history.ts:41](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L41)

A workflow history event.
Must include type and timestamp, can include arbitrary additional data.

## Indexable

\[`key`: `string`\]: `unknown`

Additional event data

## Properties

### timestamp

> **timestamp**: `number`

Defined in: [workflows/core/workflow-history.ts:45](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L45)

Timestamp when the event occurred

***

### type

> **type**: `string`

Defined in: [workflows/core/workflow-history.ts:43](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L43)

Event type (e.g., 'STEP_STARTED', 'STEP_COMPLETED', 'WORKFLOW_STARTED')
