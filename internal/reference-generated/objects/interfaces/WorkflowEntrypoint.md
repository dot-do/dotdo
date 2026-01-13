[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / WorkflowEntrypoint

# Interface: WorkflowEntrypoint

Defined in: [objects/WorkflowFactory.ts:303](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L303)

## Methods

### run()

> **run**(`event`, `step`): `Promise`\<`unknown`\>

Defined in: [objects/WorkflowFactory.ts:304](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L304)

#### Parameters

##### event

`unknown`

##### step

`StepContext`

#### Returns

`Promise`\<`unknown`\>

## Properties

### step

> **step**: `object`

Defined in: [objects/WorkflowFactory.ts:305](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/WorkflowFactory.ts#L305)

#### do()

> **do**: \<`T`\>(`name`, `callback`) => `Promise`\<`T`\>

##### Type Parameters

###### T

`T`

##### Parameters

###### name

`string`

###### callback

() => `T` \| `Promise`\<`T`\>

##### Returns

`Promise`\<`T`\>

#### sleep()

> **sleep**: (`name`, `duration`) => `Promise`\<`void`\>

##### Parameters

###### name

`string`

###### duration

`string` | `number`

##### Returns

`Promise`\<`void`\>

#### waitForEvent()

> **waitForEvent**: \<`T`\>(`name`, `options`) => `Promise`\<`T`\>

##### Type Parameters

###### T

`T`

##### Parameters

###### name

`string`

###### options

###### timeout?

`number`

###### type

`string`

##### Returns

`Promise`\<`T`\>
