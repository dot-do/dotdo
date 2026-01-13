[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / GraphRuntimeStorage

# Interface: GraphRuntimeStorage

Defined in: [workflows/core/graph-runtime-state.ts:131](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L131)

Storage interface for graph-based workflow state

## Methods

### createRelationship()

> **createRelationship**(`rel`): `Promise`\<[`WorkflowRelationship`](WorkflowRelationship.md)\>

Defined in: [workflows/core/graph-runtime-state.ts:139](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L139)

#### Parameters

##### rel

`Omit`\<[`WorkflowRelationship`](WorkflowRelationship.md), `"id"` \| `"createdAt"`\>

#### Returns

`Promise`\<[`WorkflowRelationship`](WorkflowRelationship.md)\>

***

### createThing()

> **createThing**(`thing`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:133](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L133)

#### Parameters

##### thing

[`WorkflowRunThing`](WorkflowRunThing.md) | [`WorkflowStepThing`](WorkflowStepThing.md)

#### Returns

`Promise`\<`void`\>

***

### deleteRelationship()

> **deleteRelationship**(`id`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:142](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L142)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

***

### getRelationshipsFrom()

> **getRelationshipsFrom**(`fromId`, `verb?`): `Promise`\<[`WorkflowRelationship`](WorkflowRelationship.md)[]\>

Defined in: [workflows/core/graph-runtime-state.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L140)

#### Parameters

##### fromId

`string`

##### verb?

`string`

#### Returns

`Promise`\<[`WorkflowRelationship`](WorkflowRelationship.md)[]\>

***

### getRelationshipsTo()

> **getRelationshipsTo**(`toId`, `verb?`): `Promise`\<[`WorkflowRelationship`](WorkflowRelationship.md)[]\>

Defined in: [workflows/core/graph-runtime-state.ts:141](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L141)

#### Parameters

##### toId

`string`

##### verb?

`string`

#### Returns

`Promise`\<[`WorkflowRelationship`](WorkflowRelationship.md)[]\>

***

### getThing()

> **getThing**\<`T`\>(`id`): `Promise`\<`T` \| `null`\>

Defined in: [workflows/core/graph-runtime-state.ts:134](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L134)

#### Type Parameters

##### T

`T` *extends* [`WorkflowRunThing`](WorkflowRunThing.md) \| [`WorkflowStepThing`](WorkflowStepThing.md)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`T` \| `null`\>

***

### listThings()

> **listThings**(`options`): `Promise`\<([`WorkflowRunThing`](WorkflowRunThing.md) \| [`WorkflowStepThing`](WorkflowStepThing.md))[]\>

Defined in: [workflows/core/graph-runtime-state.ts:136](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L136)

#### Parameters

##### options

###### prefix?

`string`

###### type?

`string`

#### Returns

`Promise`\<([`WorkflowRunThing`](WorkflowRunThing.md) \| [`WorkflowStepThing`](WorkflowStepThing.md))[]\>

***

### updateThing()

> **updateThing**(`id`, `updates`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:135](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L135)

#### Parameters

##### id

`string`

##### updates

`Partial`\<\{ `completedAt?`: `string`; `currentStepIndex`: `number`; `description?`: `string`; `error?`: \{ `message`: `string`; `name`: `string`; `stack?`: `string`; \}; `input?`: `unknown`; `instanceId`: `string`; `name`: `string`; `output?`: `unknown`; `pendingEvents`: `string`[]; `startedAt?`: `string`; `status`: [`WorkflowRuntimeStatus`](../type-aliases/WorkflowRuntimeStatus.md); `version?`: `string`; \} \| \{ `completedAt?`: `string`; `duration?`: `number`; `error?`: \{ `message`: `string`; `name`: `string`; `stack?`: `string`; \}; `index`: `number`; `isParallel?`: `boolean`; `name`: `string`; `output?`: `unknown`; `parallelResults?`: `Record`\<`string`, \{ `completedAt?`: `string`; `duration?`: `number`; `error?`: \{ `message`: `string`; `name`: `string`; `stack?`: `string`; \}; `name`: `string`; `output?`: `unknown`; `startedAt?`: `string`; `status`: [`StepExecutionStatus`](../type-aliases/StepExecutionStatus.md); \}\>; `retryCount?`: `number`; `startedAt?`: `string`; `status`: [`StepExecutionStatus`](../type-aliases/StepExecutionStatus.md); \}\>

#### Returns

`Promise`\<`void`\>
