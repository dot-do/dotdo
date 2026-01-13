[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / WorkflowDefinition

# Interface: WorkflowDefinition\<TInput, TOutput\>

Defined in: [workflows/workflow.ts:15](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/workflow.ts#L15)

Workflow definition result

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Properties

### execute()

> **execute**: (`context`, `input`) => `TOutput`

Defined in: [workflows/workflow.ts:17](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/workflow.ts#L17)

#### Parameters

##### context

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md)

##### input

`TInput`

#### Returns

`TOutput`

***

### name

> **name**: `string`

Defined in: [workflows/workflow.ts:16](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/workflow.ts#L16)
