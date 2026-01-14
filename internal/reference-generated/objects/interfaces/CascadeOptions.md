[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / CascadeOptions

# Interface: CascadeOptions\<TInput\>

Defined in: [lib/executors/CascadeExecutor.ts:344](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L344)

## Type Parameters

### TInput

`TInput` = `unknown`

## Properties

### branch?

> `optional` **branch**: `string`

Defined in: [lib/executors/CascadeExecutor.ts:359](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L359)

***

### channel?

> `optional` **channel**: `string`

Defined in: [lib/executors/CascadeExecutor.ts:358](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L358)

***

### context?

> `optional` **context**: `Record`\<`string`, `unknown`\>

Defined in: [lib/executors/CascadeExecutor.ts:352](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L352)

***

### emitEvent?

> `optional` **emitEvent**: `boolean`

Defined in: [lib/executors/CascadeExecutor.ts:350](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L350)

***

### emitEvents?

> `optional` **emitEvents**: `boolean`

Defined in: [lib/executors/CascadeExecutor.ts:351](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L351)

***

### eventContext?

> `optional` **eventContext**: [`EventContext`](EventContext.md)

Defined in: [lib/executors/CascadeExecutor.ts:349](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L349)

***

### handlers

> **handlers**: [`CascadeHandlers`](CascadeHandlers.md)

Defined in: [lib/executors/CascadeExecutor.ts:346](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L346)

***

### input

> **input**: `TInput`

Defined in: [lib/executors/CascadeExecutor.ts:345](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L345)

***

### model?

> `optional` **model**: `string`

Defined in: [lib/executors/CascadeExecutor.ts:356](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L356)

***

### onCascadeComplete()?

> `optional` **onCascadeComplete**: (`result`) => `void` \| `Promise`\<`void`\>

Defined in: [lib/executors/CascadeExecutor.ts:363](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L363)

#### Parameters

##### result

[`CascadeResult`](CascadeResult.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### onStepComplete()?

> `optional` **onStepComplete**: (`step`) => `void` \| `Promise`\<`void`\>

Defined in: [lib/executors/CascadeExecutor.ts:362](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L362)

#### Parameters

##### step

[`CascadeStep`](CascadeStep.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### onStepStart()?

> `optional` **onStepStart**: (`step`) => `void` \| `Promise`\<`void`\>

Defined in: [lib/executors/CascadeExecutor.ts:361](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L361)

#### Parameters

##### step

###### type

[`CascadeFunctionType`](../type-aliases/CascadeFunctionType.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### signal?

> `optional` **signal**: `AbortSignal`

Defined in: [lib/executors/CascadeExecutor.ts:355](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L355)

***

### startFrom?

> `optional` **startFrom**: [`CascadeFunctionType`](../type-aliases/CascadeFunctionType.md)

Defined in: [lib/executors/CascadeExecutor.ts:348](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L348)

***

### stepTimeout?

> `optional` **stepTimeout**: `number`

Defined in: [lib/executors/CascadeExecutor.ts:354](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L354)

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [lib/executors/CascadeExecutor.ts:353](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L353)

***

### tools?

> `optional` **tools**: `string`[]

Defined in: [lib/executors/CascadeExecutor.ts:357](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L357)

***

### trackSkipped?

> `optional` **trackSkipped**: `boolean`

Defined in: [lib/executors/CascadeExecutor.ts:360](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L360)

***

### type?

> `optional` **type**: [`CascadeFunctionType`](../type-aliases/CascadeFunctionType.md)

Defined in: [lib/executors/CascadeExecutor.ts:347](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/CascadeExecutor.ts#L347)
