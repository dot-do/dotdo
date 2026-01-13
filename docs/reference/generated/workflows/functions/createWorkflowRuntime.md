[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / createWorkflowRuntime

# Function: createWorkflowRuntime()

> **createWorkflowRuntime**(`options`): [`DurableWorkflowRuntime`](../classes/DurableWorkflowRuntime.md)

Defined in: [workflows/runtime.ts:593](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L593)

Create a new workflow runtime with the specified options.

This is the primary factory function for creating workflow runtimes.
It provides sensible defaults while allowing full customization.

## Parameters

### options

[`RuntimeOptions`](../interfaces/RuntimeOptions.md) = `{}`

Runtime configuration options

## Returns

[`DurableWorkflowRuntime`](../classes/DurableWorkflowRuntime.md)

A configured DurableWorkflowRuntime instance

## Examples

```typescript
const runtime = createWorkflowRuntime()
// Uses in-memory storage and default retry policy
```

```typescript
const runtime = createWorkflowRuntime({
  storage: new SqliteStepStorage(db)
})
```

```typescript
const runtime = createWorkflowRuntime({
  storage,
  onStepStart: (stepId) => span.start(stepId),
  onStepComplete: (stepId, result) => span.end(stepId),
  onStepError: (stepId, error, attempt) => {
    span.recordError(stepId, error)
    if (attempt === 3) alertOps(stepId, error)
  }
})
```
