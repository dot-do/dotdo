[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / createPipelineProxy

# Function: createPipelineProxy()

> **createPipelineProxy**(`runtime`): [`WorkflowAPI`](../type-aliases/WorkflowAPI.md)

Defined in: [workflows/proxy.ts:85](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/proxy.ts#L85)

Creates the main workflow proxy ($).

Usage:
  const $ = createWorkflowProxy(runtime)
  const result = await $.Inventory(product).check()

The proxy intercepts property access to create domain factories.
Each domain factory captures context and returns a pipeline proxy.

## Parameters

### runtime

[`PipelineRuntime`](../interfaces/PipelineRuntime.md)

## Returns

[`WorkflowAPI`](../type-aliases/WorkflowAPI.md)
