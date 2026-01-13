[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / GraphRuntimeState

# Class: GraphRuntimeState

Defined in: [workflows/core/graph-runtime-state.ts:366](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L366)

GraphRuntimeState manages workflow execution state as a graph of Things
and Relationships, enabling rich querying and history preservation.

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Defined in: [workflows/core/graph-runtime-state.ts:383](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L383)

##### Returns

`string`

***

### instance

#### Get Signature

> **get** **instance**(): `string`

Defined in: [workflows/core/graph-runtime-state.ts:387](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L387)

##### Returns

`string`

## Constructors

### Constructor

> **new GraphRuntimeState**(`storage`, `config`): `GraphRuntimeState`

Defined in: [workflows/core/graph-runtime-state.ts:372](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L372)

#### Parameters

##### storage

[`GraphRuntimeStorage`](../interfaces/GraphRuntimeStorage.md)

##### config

[`GraphRuntimeStateConfig`](../interfaces/GraphRuntimeStateConfig.md)

#### Returns

`GraphRuntimeState`

## Methods

### complete()

> **complete**(`output`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:452](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L452)

Mark workflow as completed

#### Parameters

##### output

`unknown`

#### Returns

`Promise`\<`void`\>

***

### createStep()

> **createStep**(`stepIndex`, `stepName`, `isParallel`): `Promise`\<[`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)\>

Defined in: [workflows/core/graph-runtime-state.ts:514](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L514)

Create a step Thing and establish relationship to workflow

#### Parameters

##### stepIndex

`number`

##### stepName

`string`

##### isParallel

`boolean` = `false`

#### Returns

`Promise`\<[`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)\>

***

### exportState()

> **exportState**(): `Promise`\<\{ `steps`: [`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)[]; `workflow`: [`WorkflowRunThing`](../interfaces/WorkflowRunThing.md) \| `null`; \}\>

Defined in: [workflows/core/graph-runtime-state.ts:738](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L738)

Export state for persistence across hibernation

#### Returns

`Promise`\<\{ `steps`: [`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)[]; `workflow`: [`WorkflowRunThing`](../interfaces/WorkflowRunThing.md) \| `null`; \}\>

***

### fail()

> **fail**(`error`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:463](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L463)

Mark workflow as failed

#### Parameters

##### error

`Error`

#### Returns

`Promise`\<`void`\>

***

### getCompletedStepsCount()

> **getCompletedStepsCount**(): `Promise`\<`number`\>

Defined in: [workflows/core/graph-runtime-state.ts:699](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L699)

Get completed steps count

#### Returns

`Promise`\<`number`\>

***

### getExecutionChain()

> **getExecutionChain**(): `Promise`\<[`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)[]\>

Defined in: [workflows/core/graph-runtime-state.ts:665](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L665)

Get the execution chain (sequence of steps) for this workflow

#### Returns

`Promise`\<[`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)[]\>

***

### getExecutionHistory()

> **getExecutionHistory**(): `Promise`\<\{ `relationships`: [`WorkflowRelationship`](../interfaces/WorkflowRelationship.md)[]; `steps`: [`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)[]; `workflow`: [`WorkflowRunThing`](../interfaces/WorkflowRunThing.md) \| `null`; \}\>

Defined in: [workflows/core/graph-runtime-state.ts:719](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L719)

Get full execution history including all steps and their relationships

#### Returns

`Promise`\<\{ `relationships`: [`WorkflowRelationship`](../interfaces/WorkflowRelationship.md)[]; `steps`: [`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)[]; `workflow`: [`WorkflowRunThing`](../interfaces/WorkflowRunThing.md) \| `null`; \}\>

***

### getFailedStepsCount()

> **getFailedStepsCount**(): `Promise`\<`number`\>

Defined in: [workflows/core/graph-runtime-state.ts:707](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L707)

Get failed steps count

#### Returns

`Promise`\<`number`\>

***

### getFollowingSteps()

> **getFollowingSteps**(`stepId`): `Promise`\<[`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)[]\>

Defined in: [workflows/core/graph-runtime-state.ts:672](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L672)

Get steps that follow a given step

#### Parameters

##### stepId

`string`

#### Returns

`Promise`\<[`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)[]\>

***

### getPrecedingStep()

> **getPrecedingStep**(`stepId`): `Promise`\<[`WorkflowStepThing`](../interfaces/WorkflowStepThing.md) \| `null`\>

Defined in: [workflows/core/graph-runtime-state.ts:689](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L689)

Get the step that precedes a given step

#### Parameters

##### stepId

`string`

#### Returns

`Promise`\<[`WorkflowStepThing`](../interfaces/WorkflowStepThing.md) \| `null`\>

***

### getStep()

> **getStep**(`stepIndex`): `Promise`\<[`WorkflowStepThing`](../interfaces/WorkflowStepThing.md) \| `null`\>

Defined in: [workflows/core/graph-runtime-state.ts:564](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L564)

Get a step by index

#### Parameters

##### stepIndex

`number`

#### Returns

`Promise`\<[`WorkflowStepThing`](../interfaces/WorkflowStepThing.md) \| `null`\>

***

### getSteps()

> **getSteps**(): `Promise`\<[`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)[]\>

Defined in: [workflows/core/graph-runtime-state.ts:572](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L572)

Get all steps for this workflow

#### Returns

`Promise`\<[`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)[]\>

***

### getWorkflowRun()

> **getWorkflowRun**(): `Promise`\<[`WorkflowRunThing`](../interfaces/WorkflowRunThing.md) \| `null`\>

Defined in: [workflows/core/graph-runtime-state.ts:424](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L424)

Get the current workflow run Thing

#### Returns

`Promise`\<[`WorkflowRunThing`](../interfaces/WorkflowRunThing.md) \| `null`\>

***

### importState()

> **importState**(`state`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:750](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L750)

Import state from persistence (for recovery after hibernation)

#### Parameters

##### state

###### steps

[`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)[]

###### workflow

[`WorkflowRunThing`](../interfaces/WorkflowRunThing.md)

#### Returns

`Promise`\<`void`\>

***

### initialize()

> **initialize**(`input?`): `Promise`\<[`WorkflowRunThing`](../interfaces/WorkflowRunThing.md)\>

Defined in: [workflows/core/graph-runtime-state.ts:398](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L398)

Initialize the workflow run as a Thing

#### Parameters

##### input?

`unknown`

#### Returns

`Promise`\<[`WorkflowRunThing`](../interfaces/WorkflowRunThing.md)\>

***

### pause()

> **pause**(`pendingEvents?`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:478](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L478)

Mark workflow as paused

#### Parameters

##### pendingEvents?

`string`[]

#### Returns

`Promise`\<`void`\>

***

### resume()

> **resume**(): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:491](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L491)

Resume workflow from paused state

#### Returns

`Promise`\<`void`\>

***

### setCurrentStepIndex()

> **setCurrentStepIndex**(`index`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:501](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L501)

Update current step index

#### Parameters

##### index

`number`

#### Returns

`Promise`\<`void`\>

***

### start()

> **start**(`input`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:441](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L441)

Mark workflow as started

#### Parameters

##### input

`unknown`

#### Returns

`Promise`\<`void`\>

***

### stepCompleted()

> **stepCompleted**(`stepIndex`, `output`, `duration?`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:613](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L613)

Mark step as completed

#### Parameters

##### stepIndex

`number`

##### output

`unknown`

##### duration?

`number`

#### Returns

`Promise`\<`void`\>

***

### stepFailed()

> **stepFailed**(`stepIndex`, `error`, `retryCount?`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:629](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L629)

Mark step as failed

#### Parameters

##### stepIndex

`number`

##### error

`Error`

##### retryCount?

`number`

#### Returns

`Promise`\<`void`\>

***

### stepStarted()

> **stepStarted**(`stepIndex`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:603](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L603)

Mark step as started

#### Parameters

##### stepIndex

`number`

#### Returns

`Promise`\<`void`\>

***

### updateParallelResults()

> **updateParallelResults**(`stepIndex`, `parallelResults`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:649](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L649)

Update parallel step results

#### Parameters

##### stepIndex

`number`

##### parallelResults

`Record`\<`string`, \{ `completedAt?`: `string`; `duration?`: `number`; `error?`: \{ `message`: `string`; `name`: `string`; `stack?`: `string`; \}; `name`: `string`; `output?`: `unknown`; `startedAt?`: `string`; `status`: [`StepExecutionStatus`](../type-aliases/StepExecutionStatus.md); \}\> | `undefined`

#### Returns

`Promise`\<`void`\>

***

### updateStatus()

> **updateStatus**(`status`, `updates?`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:431](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L431)

Update workflow run status

#### Parameters

##### status

[`WorkflowRuntimeStatus`](../type-aliases/WorkflowRuntimeStatus.md)

##### updates?

`Partial`\<\{ `completedAt?`: `string`; `currentStepIndex`: `number`; `description?`: `string`; `error?`: \{ `message`: `string`; `name`: `string`; `stack?`: `string`; \}; `input?`: `unknown`; `instanceId`: `string`; `name`: `string`; `output?`: `unknown`; `pendingEvents`: `string`[]; `startedAt?`: `string`; `status`: [`WorkflowRuntimeStatus`](../type-aliases/WorkflowRuntimeStatus.md); `version?`: `string`; \}\>

#### Returns

`Promise`\<`void`\>

***

### updateStep()

> **updateStep**(`stepIndex`, `updates`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:590](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L590)

Update step status and data

#### Parameters

##### stepIndex

`number`

##### updates

`Partial`\<[`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)\[`"data"`\]\>

#### Returns

`Promise`\<`void`\>
