[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / pipe

# Function: pipe()

## Call Signature

> **pipe**\<`T1`, `T2`\>(`f1`, `options?`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T2`\>

Defined in: [lib/functions/FunctionComposition.ts:122](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L122)

Create a pipeline that executes functions sequentially.
Each function receives the output of the previous function.

### Type Parameters

#### T1

`T1`

#### T2

`T2`

### Parameters

#### f1

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T2`\>

#### options?

[`PipeOptions`](../interfaces/PipeOptions.md)

### Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T2`\>

## Call Signature

> **pipe**\<`T1`, `T2`, `T3`\>(`f1`, `f2`, `options?`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T3`\>

Defined in: [lib/functions/FunctionComposition.ts:127](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L127)

Create a pipeline that executes functions sequentially.
Each function receives the output of the previous function.

### Type Parameters

#### T1

`T1`

#### T2

`T2`

#### T3

`T3`

### Parameters

#### f1

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T2`\>

#### f2

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T2`, `T3`\>

#### options?

[`PipeOptions`](../interfaces/PipeOptions.md)

### Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T3`\>

## Call Signature

> **pipe**\<`T1`, `T2`, `T3`, `T4`\>(`f1`, `f2`, `f3`, `options?`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T4`\>

Defined in: [lib/functions/FunctionComposition.ts:133](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L133)

Create a pipeline that executes functions sequentially.
Each function receives the output of the previous function.

### Type Parameters

#### T1

`T1`

#### T2

`T2`

#### T3

`T3`

#### T4

`T4`

### Parameters

#### f1

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T2`\>

#### f2

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T2`, `T3`\>

#### f3

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T3`, `T4`\>

#### options?

[`PipeOptions`](../interfaces/PipeOptions.md)

### Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T4`\>

## Call Signature

> **pipe**\<`T1`, `T2`, `T3`, `T4`, `T5`\>(`f1`, `f2`, `f3`, `f4`, `options?`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T5`\>

Defined in: [lib/functions/FunctionComposition.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L140)

Create a pipeline that executes functions sequentially.
Each function receives the output of the previous function.

### Type Parameters

#### T1

`T1`

#### T2

`T2`

#### T3

`T3`

#### T4

`T4`

#### T5

`T5`

### Parameters

#### f1

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T2`\>

#### f2

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T2`, `T3`\>

#### f3

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T3`, `T4`\>

#### f4

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T4`, `T5`\>

#### options?

[`PipeOptions`](../interfaces/PipeOptions.md)

### Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T5`\>

## Call Signature

> **pipe**\<`T1`, `T2`, `T3`, `T4`, `T5`, `T6`\>(`f1`, `f2`, `f3`, `f4`, `f5`, `options?`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T6`\>

Defined in: [lib/functions/FunctionComposition.ts:148](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L148)

Create a pipeline that executes functions sequentially.
Each function receives the output of the previous function.

### Type Parameters

#### T1

`T1`

#### T2

`T2`

#### T3

`T3`

#### T4

`T4`

#### T5

`T5`

#### T6

`T6`

### Parameters

#### f1

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T2`\>

#### f2

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T2`, `T3`\>

#### f3

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T3`, `T4`\>

#### f4

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T4`, `T5`\>

#### f5

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T5`, `T6`\>

#### options?

[`PipeOptions`](../interfaces/PipeOptions.md)

### Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T1`, `T6`\>
