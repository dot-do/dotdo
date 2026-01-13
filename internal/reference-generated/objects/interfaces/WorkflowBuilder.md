[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / WorkflowBuilder

# Interface: WorkflowBuilder

Defined in: [objects/WorkflowFactory.ts:257](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L257)

## Methods

### create()

> **create**(): [`WorkflowEntrypointClass`](WorkflowEntrypointClass.md)

Defined in: [objects/WorkflowFactory.ts:272](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L272)

#### Returns

[`WorkflowEntrypointClass`](WorkflowEntrypointClass.md)

***

### describe()

> **describe**(): `WorkflowDescription`

Defined in: [objects/WorkflowFactory.ts:274](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L274)

#### Returns

`WorkflowDescription`

***

### getMetadata()

> **getMetadata**(): `WorkflowMetadata`

Defined in: [objects/WorkflowFactory.ts:275](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L275)

#### Returns

`WorkflowMetadata`

***

### on()

> **on**(`event`, `handler`): `WorkflowBuilder`

Defined in: [objects/WorkflowFactory.ts:271](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L271)

#### Parameters

##### event

`string`

##### handler

[`WorkflowEventHandler`](../type-aliases/WorkflowEventHandler.md)

#### Returns

`WorkflowBuilder`

***

### step()

#### Call Signature

> **step**(`name`, `handler`, `options?`): `WorkflowBuilder`

Defined in: [objects/WorkflowFactory.ts:266](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L266)

##### Parameters

###### name

`string`

###### handler

[`WorkflowStepHandler`](../type-aliases/WorkflowStepHandler.md)

###### options?

`StepOptions`

##### Returns

`WorkflowBuilder`

#### Call Signature

> **step**(`name`, `config`): `WorkflowBuilder`

Defined in: [objects/WorkflowFactory.ts:267](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L267)

##### Parameters

###### name

`string`

###### config

`StepConfig`

##### Returns

`WorkflowBuilder`

***

### toJSON()

> **toJSON**(): `WorkflowJSON`

Defined in: [objects/WorkflowFactory.ts:273](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L273)

#### Returns

`WorkflowJSON`

***

### trigger()

#### Call Signature

> **trigger**(`type`, `config`): `WorkflowBuilder`

Defined in: [objects/WorkflowFactory.ts:268](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L268)

##### Parameters

###### type

`"webhook"`

###### config

`WebhookTriggerConfig`

##### Returns

`WorkflowBuilder`

#### Call Signature

> **trigger**(`type`, `config`): `WorkflowBuilder`

Defined in: [objects/WorkflowFactory.ts:269](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L269)

##### Parameters

###### type

`"cron"`

###### config

`CronTriggerConfig`

##### Returns

`WorkflowBuilder`

#### Call Signature

> **trigger**(`type`, `config`): `WorkflowBuilder`

Defined in: [objects/WorkflowFactory.ts:270](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L270)

##### Parameters

###### type

`"event"`

###### config

`EventTriggerConfig`

##### Returns

`WorkflowBuilder`

## Properties

### description?

> `optional` **description**: `string`

Defined in: [objects/WorkflowFactory.ts:259](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L259)

***

### eventHandlers

> **eventHandlers**: `WorkflowEventHandlerDefinition`[]

Defined in: [objects/WorkflowFactory.ts:264](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L264)

***

### name

> **name**: `string`

Defined in: [objects/WorkflowFactory.ts:258](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L258)

***

### steps

> **steps**: `WorkflowStepDefinition`[]

Defined in: [objects/WorkflowFactory.ts:262](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L262)

***

### tags?

> `optional` **tags**: `string`[]

Defined in: [objects/WorkflowFactory.ts:261](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L261)

***

### triggers

> **triggers**: `WorkflowTrigger`[]

Defined in: [objects/WorkflowFactory.ts:263](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L263)

***

### version?

> `optional` **version**: `string`

Defined in: [objects/WorkflowFactory.ts:260](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L260)
