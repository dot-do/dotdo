[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / WorkflowRuntime

# Class: WorkflowRuntime

Defined in: [objects/WorkflowRuntime.ts:317](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L317)

## Accessors

### completedAt

#### Get Signature

> **get** **completedAt**(): `Date` \| `undefined`

Defined in: [objects/WorkflowRuntime.ts:437](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L437)

##### Returns

`Date` \| `undefined`

***

### currentStepIndex

#### Get Signature

> **get** **currentStepIndex**(): `number`

Defined in: [objects/WorkflowRuntime.ts:417](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L417)

##### Returns

`number`

***

### duration

#### Get Signature

> **get** **duration**(): `number` \| `undefined`

Defined in: [objects/WorkflowRuntime.ts:445](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L445)

##### Returns

`number` \| `undefined`

***

### error

#### Get Signature

> **get** **error**(): `Error` \| `undefined`

Defined in: [objects/WorkflowRuntime.ts:429](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L429)

##### Returns

`Error` \| `undefined`

***

### input

#### Get Signature

> **get** **input**(): `unknown`

Defined in: [objects/WorkflowRuntime.ts:421](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L421)

##### Returns

`unknown`

***

### instanceId

#### Get Signature

> **get** **instanceId**(): `string`

Defined in: [objects/WorkflowRuntime.ts:385](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L385)

##### Returns

`string`

***

### name

#### Get Signature

> **get** **name**(): `string`

Defined in: [objects/WorkflowRuntime.ts:377](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L377)

##### Returns

`string`

***

### options

#### Get Signature

> **get** **options**(): [`WorkflowRuntimeOptions`](../interfaces/WorkflowRuntimeOptions.md)

Defined in: [objects/WorkflowRuntime.ts:405](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L405)

##### Returns

[`WorkflowRuntimeOptions`](../interfaces/WorkflowRuntimeOptions.md)

***

### output

#### Get Signature

> **get** **output**(): `unknown`

Defined in: [objects/WorkflowRuntime.ts:425](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L425)

##### Returns

`unknown`

***

### pendingEvents

#### Get Signature

> **get** **pendingEvents**(): readonly `string`[]

Defined in: [objects/WorkflowRuntime.ts:441](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L441)

##### Returns

readonly `string`[]

***

### startedAt

#### Get Signature

> **get** **startedAt**(): `Date` \| `undefined`

Defined in: [objects/WorkflowRuntime.ts:433](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L433)

##### Returns

`Date` \| `undefined`

***

### state

#### Get Signature

> **get** **state**(): [`WorkflowRuntimeState`](../type-aliases/WorkflowRuntimeState.md)

Defined in: [objects/WorkflowRuntime.ts:389](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L389)

##### Returns

[`WorkflowRuntimeState`](../type-aliases/WorkflowRuntimeState.md)

***

### stateRelationship

#### Get Signature

> **get** **stateRelationship**(): `Readonly`\<`WorkflowStateRelationship`\> \| `null`

Defined in: [objects/WorkflowRuntime.ts:401](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L401)

Gets the current state relationship edge for graph-based state queries.
Returns null if workflow hasn't been started.

##### Returns

`Readonly`\<`WorkflowStateRelationship`\> \| `null`

***

### stepResults

#### Get Signature

> **get** **stepResults**(): readonly [`StepExecutionResult`](../interfaces/StepExecutionResult.md)[]

Defined in: [objects/WorkflowRuntime.ts:413](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L413)

##### Returns

readonly [`StepExecutionResult`](../interfaces/StepExecutionResult.md)[]

***

### steps

#### Get Signature

> **get** **steps**(): readonly `RegisteredStep`[]

Defined in: [objects/WorkflowRuntime.ts:409](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L409)

##### Returns

readonly `RegisteredStep`[]

***

### version

#### Get Signature

> **get** **version**(): `string` \| `undefined`

Defined in: [objects/WorkflowRuntime.ts:381](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L381)

##### Returns

`string` \| `undefined`

## Constructors

### Constructor

> **new WorkflowRuntime**(`state`, `config`, `options`): `WorkflowRuntime`

Defined in: [objects/WorkflowRuntime.ts:361](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L361)

#### Parameters

##### state

`DurableObjectState`

##### config

[`WorkflowRuntimeConfig`](../interfaces/WorkflowRuntimeConfig.md)

##### options

[`WorkflowRuntimeOptions`](../interfaces/WorkflowRuntimeOptions.md) = `{}`

#### Returns

`WorkflowRuntime`

## Methods

### deliverEvent()

> **deliverEvent**(`eventName`, `payload`): `Promise`\<`void`\>

Defined in: [objects/WorkflowRuntime.ts:1247](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L1247)

#### Parameters

##### eventName

`string`

##### payload

`unknown`

#### Returns

`Promise`\<`void`\>

***

### getMetrics()

> **getMetrics**(): [`WorkflowMetrics`](../interfaces/WorkflowMetrics.md)

Defined in: [objects/WorkflowRuntime.ts:1358](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L1358)

#### Returns

[`WorkflowMetrics`](../interfaces/WorkflowMetrics.md)

***

### handleAlarm()

> **handleAlarm**(): `Promise`\<`void`\>

Defined in: [objects/WorkflowRuntime.ts:1295](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L1295)

#### Returns

`Promise`\<`void`\>

***

### initialize()

> **initialize**(): `Promise`\<`void`\>

Defined in: [objects/WorkflowRuntime.ts:455](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L455)

#### Returns

`Promise`\<`void`\>

***

### off()

> **off**(`event`, `handler`): `void`

Defined in: [objects/WorkflowRuntime.ts:1310](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L1310)

#### Parameters

##### event

`string`

##### handler

`EventHandler`

#### Returns

`void`

***

### on()

> **on**(`event`, `handler`): `void`

Defined in: [objects/WorkflowRuntime.ts:1303](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L1303)

#### Parameters

##### event

`string`

##### handler

`EventHandler`

#### Returns

`void`

***

### parallel()

> **parallel**(`steps`, `options`): `this`

Defined in: [objects/WorkflowRuntime.ts:579](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L579)

Register a group of steps to execute in parallel

#### Parameters

##### steps

`ParallelStepDefinition`[]

##### options

`ParallelOptions` = `{}`

#### Returns

`this`

#### Example

```typescript
workflow
  .step('validate', validateOrder)
  .parallel([
    step('checkInventory', checkStock),
    step('checkPayment', validatePayment),
    step('checkShipping', calculateShipping),
  ])
  .step('confirm', confirmOrder)
```

***

### pause()

> **pause**(): `Promise`\<`void`\>

Defined in: [objects/WorkflowRuntime.ts:695](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L695)

#### Returns

`Promise`\<`void`\>

***

### registerStep()

> **registerStep**(`name`, `handler`, `config?`): `void`

Defined in: [objects/WorkflowRuntime.ts:548](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L548)

#### Parameters

##### name

`string`

##### handler

(`ctx`) => `Promise`\<`unknown`\>

##### config?

[`WorkflowStepConfig`](../interfaces/WorkflowStepConfig.md)

#### Returns

`void`

***

### restore()

> **restore**(): `Promise`\<`void`\>

Defined in: [objects/WorkflowRuntime.ts:758](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L758)

#### Returns

`Promise`\<`void`\>

***

### resume()

> **resume**(): `Promise`\<`void`\>

Defined in: [objects/WorkflowRuntime.ts:706](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L706)

#### Returns

`Promise`\<`void`\>

***

### start()

> **start**(`input`): `Promise`\<[`WorkflowExecutionResult`](../interfaces/WorkflowExecutionResult.md)\>

Defined in: [objects/WorkflowRuntime.ts:622](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L622)

#### Parameters

##### input

`unknown`

#### Returns

`Promise`\<[`WorkflowExecutionResult`](../interfaces/WorkflowExecutionResult.md)\>

***

### step()

> **step**(`name`, `handler`, `config?`): `this`

Defined in: [objects/WorkflowRuntime.ts:559](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowRuntime.ts#L559)

Fluent API for step registration

#### Parameters

##### name

`string`

##### handler

(`ctx`) => `Promise`\<`unknown`\>

##### config?

[`WorkflowStepConfig`](../interfaces/WorkflowStepConfig.md)

#### Returns

`this`
