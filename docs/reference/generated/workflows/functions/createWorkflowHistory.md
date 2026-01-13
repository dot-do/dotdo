[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / createWorkflowHistory

# Function: createWorkflowHistory()

> **createWorkflowHistory**(`options`): [`WorkflowHistory`](../classes/WorkflowHistory.md)

Defined in: [workflows/core/workflow-history.ts:485](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L485)

Create a new WorkflowHistory instance.

## Parameters

### options

[`WorkflowHistoryOptions`](../interfaces/WorkflowHistoryOptions.md)

Configuration options

## Returns

[`WorkflowHistory`](../classes/WorkflowHistory.md)

New WorkflowHistory instance

## Example

```typescript
const history = createWorkflowHistory({
  workflowId: 'order-processing-123',
  retention: { maxVersions: 100, maxAge: '7d' }
})
```
