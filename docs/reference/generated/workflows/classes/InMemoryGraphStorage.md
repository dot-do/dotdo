[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / InMemoryGraphStorage

# Class: InMemoryGraphStorage

Defined in: [workflows/core/graph-runtime-state.ts:167](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L167)

In-memory implementation of GraphRuntimeStorage
Useful for testing or when DO storage is not available

## Implements

- [`GraphRuntimeStorage`](../interfaces/GraphRuntimeStorage.md)

## Constructors

### Constructor

> **new InMemoryGraphStorage**(): `InMemoryGraphStorage`

#### Returns

`InMemoryGraphStorage`

## Methods

### clear()

> **clear**(): `void`

Defined in: [workflows/core/graph-runtime-state.ts:248](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L248)

Clear all data (for testing)

#### Returns

`void`

***

### createRelationship()

> **createRelationship**(`rel`): `Promise`\<[`WorkflowRelationship`](../interfaces/WorkflowRelationship.md)\>

Defined in: [workflows/core/graph-runtime-state.ts:202](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L202)

#### Parameters

##### rel

`Omit`\<[`WorkflowRelationship`](../interfaces/WorkflowRelationship.md), `"id"` \| `"createdAt"`\>

#### Returns

`Promise`\<[`WorkflowRelationship`](../interfaces/WorkflowRelationship.md)\>

#### Implementation of

[`GraphRuntimeStorage`](../interfaces/GraphRuntimeStorage.md).[`createRelationship`](../interfaces/GraphRuntimeStorage.md#createrelationship)

***

### createThing()

> **createThing**(`thing`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:172](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L172)

#### Parameters

##### thing

[`WorkflowRunThing`](../interfaces/WorkflowRunThing.md) | [`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`GraphRuntimeStorage`](../interfaces/GraphRuntimeStorage.md).[`createThing`](../interfaces/GraphRuntimeStorage.md#creatething)

***

### deleteRelationship()

> **deleteRelationship**(`id`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:241](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L241)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`GraphRuntimeStorage`](../interfaces/GraphRuntimeStorage.md).[`deleteRelationship`](../interfaces/GraphRuntimeStorage.md#deleterelationship)

***

### getRelationshipsFrom()

> **getRelationshipsFrom**(`fromId`, `verb?`): `Promise`\<[`WorkflowRelationship`](../interfaces/WorkflowRelationship.md)[]\>

Defined in: [workflows/core/graph-runtime-state.ts:215](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L215)

#### Parameters

##### fromId

`string`

##### verb?

`string`

#### Returns

`Promise`\<[`WorkflowRelationship`](../interfaces/WorkflowRelationship.md)[]\>

#### Implementation of

[`GraphRuntimeStorage`](../interfaces/GraphRuntimeStorage.md).[`getRelationshipsFrom`](../interfaces/GraphRuntimeStorage.md#getrelationshipsfrom)

***

### getRelationshipsTo()

> **getRelationshipsTo**(`toId`, `verb?`): `Promise`\<[`WorkflowRelationship`](../interfaces/WorkflowRelationship.md)[]\>

Defined in: [workflows/core/graph-runtime-state.ts:228](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L228)

#### Parameters

##### toId

`string`

##### verb?

`string`

#### Returns

`Promise`\<[`WorkflowRelationship`](../interfaces/WorkflowRelationship.md)[]\>

#### Implementation of

[`GraphRuntimeStorage`](../interfaces/GraphRuntimeStorage.md).[`getRelationshipsTo`](../interfaces/GraphRuntimeStorage.md#getrelationshipsto)

***

### getThing()

> **getThing**\<`T`\>(`id`): `Promise`\<`T` \| `null`\>

Defined in: [workflows/core/graph-runtime-state.ts:176](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L176)

#### Type Parameters

##### T

`T` *extends* [`WorkflowRunThing`](../interfaces/WorkflowRunThing.md) \| [`WorkflowStepThing`](../interfaces/WorkflowStepThing.md)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`T` \| `null`\>

#### Implementation of

[`GraphRuntimeStorage`](../interfaces/GraphRuntimeStorage.md).[`getThing`](../interfaces/GraphRuntimeStorage.md#getthing)

***

### listThings()

> **listThings**(`options`): `Promise`\<([`WorkflowRunThing`](../interfaces/WorkflowRunThing.md) \| [`WorkflowStepThing`](../interfaces/WorkflowStepThing.md))[]\>

Defined in: [workflows/core/graph-runtime-state.ts:191](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L191)

#### Parameters

##### options

###### prefix?

`string`

###### type?

`string`

#### Returns

`Promise`\<([`WorkflowRunThing`](../interfaces/WorkflowRunThing.md) \| [`WorkflowStepThing`](../interfaces/WorkflowStepThing.md))[]\>

#### Implementation of

[`GraphRuntimeStorage`](../interfaces/GraphRuntimeStorage.md).[`listThings`](../interfaces/GraphRuntimeStorage.md#listthings)

***

### updateThing()

> **updateThing**(`id`, `updates`): `Promise`\<`void`\>

Defined in: [workflows/core/graph-runtime-state.ts:180](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/graph-runtime-state.ts#L180)

#### Parameters

##### id

`string`

##### updates

`Partial`\<\{ `completedAt?`: `string`; `currentStepIndex`: `number`; `description?`: `string`; `error?`: \{ `message`: `string`; `name`: `string`; `stack?`: `string`; \}; `input?`: `unknown`; `instanceId`: `string`; `name`: `string`; `output?`: `unknown`; `pendingEvents`: `string`[]; `startedAt?`: `string`; `status`: [`WorkflowRuntimeStatus`](../type-aliases/WorkflowRuntimeStatus.md); `version?`: `string`; \} \| \{ `completedAt?`: `string`; `duration?`: `number`; `error?`: \{ `message`: `string`; `name`: `string`; `stack?`: `string`; \}; `index`: `number`; `isParallel?`: `boolean`; `name`: `string`; `output?`: `unknown`; `parallelResults?`: `Record`\<`string`, \{ `completedAt?`: `string`; `duration?`: `number`; `error?`: \{ `message`: `string`; `name`: `string`; `stack?`: `string`; \}; `name`: `string`; `output?`: `unknown`; `startedAt?`: `string`; `status`: [`StepExecutionStatus`](../type-aliases/StepExecutionStatus.md); \}\>; `retryCount?`: `number`; `startedAt?`: `string`; `status`: [`StepExecutionStatus`](../type-aliases/StepExecutionStatus.md); \}\>

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`GraphRuntimeStorage`](../interfaces/GraphRuntimeStorage.md).[`updateThing`](../interfaces/GraphRuntimeStorage.md#updatething)
