[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / createWorkflowCoreStorageStrategy

# Function: createWorkflowCoreStorageStrategy()

> **createWorkflowCoreStorageStrategy**(`options`): [`WorkflowCoreStorageStrategy`](../classes/WorkflowCoreStorageStrategy.md)

Defined in: [workflows/core/workflow-core-storage.ts:455](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-core-storage.ts#L455)

Create a new WorkflowCoreStorageStrategy instance.

## Parameters

### options

[`WorkflowCoreStorageOptions`](../interfaces/WorkflowCoreStorageOptions.md)

Configuration options

## Returns

[`WorkflowCoreStorageStrategy`](../classes/WorkflowCoreStorageStrategy.md)

New strategy instance

## Example

```typescript
const strategy = createWorkflowCoreStorageStrategy({
  workflowId: 'order-123',
  enableHistory: true,
  historyRetention: { maxVersions: 100, maxAge: '7d' }
})
```
