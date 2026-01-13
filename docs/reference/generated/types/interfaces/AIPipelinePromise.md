[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / AIPipelinePromise

# Interface: AIPipelinePromise\<T\>

Defined in: [types/WorkflowContext.ts:180](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L180)

PipelinePromise - Promise with chainable methods for no-await operations

## Extends

- `Promise`\<`T`\>

## Type Parameters

### T

`T`

## Methods

### catch()

> **catch**\<`R`\>(`fn`): `AIPipelinePromise`\<`R`\>

Defined in: [types/WorkflowContext.ts:186](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L186)

Handle errors

#### Type Parameters

##### R

`R` = `T`

#### Parameters

##### fn

(`error`) => `R` \| `Promise`\<`R`\>

#### Returns

`AIPipelinePromise`\<`R`\>

#### Overrides

`Promise.catch`

***

### get()

> **get**\<`K`\>(`key`): `AIPipelinePromise`\<`T`\[`K`\]\>

Defined in: [types/WorkflowContext.ts:184](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L184)

Access a property on the resolved value

#### Type Parameters

##### K

`K` *extends* `string` \| `number` \| `symbol`

#### Parameters

##### key

`K`

#### Returns

`AIPipelinePromise`\<`T`\[`K`\]\>

***

### map()

> **map**\<`R`\>(`fn`): `AIPipelinePromise`\<`R`\>

Defined in: [types/WorkflowContext.ts:182](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L182)

Transform the result

#### Type Parameters

##### R

`R`

#### Parameters

##### fn

(`value`) => `R` \| `Promise`\<`R`\>

#### Returns

`AIPipelinePromise`\<`R`\>
