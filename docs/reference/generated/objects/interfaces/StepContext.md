[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / StepContext

# Interface: StepContext

Defined in: [objects/WorkflowRuntime.ts:172](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L172)

## Properties

### $

> **$**: `Record`\<`string`, `unknown`\>

Defined in: [objects/WorkflowRuntime.ts:186](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L186)

Domain proxy for cross-DO calls

***

### emit()

> **emit**: (`event`, `data`) => `void`

Defined in: [objects/WorkflowRuntime.ts:188](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L188)

Emit an event

#### Parameters

##### event

`string`

##### data

`unknown`

#### Returns

`void`

***

### input

> **input**: `unknown`

Defined in: [objects/WorkflowRuntime.ts:174](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L174)

Workflow input

***

### previousStepOutput?

> `optional` **previousStepOutput**: `unknown`

Defined in: [objects/WorkflowRuntime.ts:176](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L176)

Output from previous step

***

### stepIndex

> **stepIndex**: `number`

Defined in: [objects/WorkflowRuntime.ts:180](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L180)

Current step index (0-based)

***

### stepName

> **stepName**: `string`

Defined in: [objects/WorkflowRuntime.ts:178](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L178)

Current step name

***

### waitForEvent()

> **waitForEvent**: \<`T`\>(`eventName`, `options?`) => `Promise`\<`T`\>

Defined in: [objects/WorkflowRuntime.ts:184](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L184)

Wait for an external event

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### eventName

`string`

##### options?

`WaitForEventOptions`

#### Returns

`Promise`\<`T`\>

***

### workflowInstanceId

> **workflowInstanceId**: `string`

Defined in: [objects/WorkflowRuntime.ts:182](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L182)

Workflow instance ID
