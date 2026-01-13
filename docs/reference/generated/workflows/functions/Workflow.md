[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / Workflow

# Function: Workflow()

> **Workflow**\<`TInput`, `TOutput`\>(`name`, `definition`): [`WorkflowDefinition`](../interfaces/WorkflowDefinition.md)\<`TInput`, `TOutput`\>

Defined in: [workflows/workflow.ts:51](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/workflow.ts#L51)

Define a workflow

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Parameters

### name

`string`

### definition

(`$`, `input`) => `TOutput`

## Returns

[`WorkflowDefinition`](../interfaces/WorkflowDefinition.md)\<`TInput`, `TOutput`\>

## Example

```typescript
const MyWorkflow = Workflow('my-workflow', ($, input: MyInput) => {
  const result = $.Service(input.id).doSomething()
  $.when(result.success, {
    then: () => $.Notification.send({ message: 'Success!' }),
    else: () => $.Alert.trigger({ error: result.error })
  })
  return { processed: true }
})
```
