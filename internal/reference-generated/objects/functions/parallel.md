[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / parallel

# Function: parallel()

## Call Signature

> **parallel**\<`T`, `R1`, `R2`\>(`f1`, `f2`, `options?`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, \[`R1`, `R2`\]\>

Defined in: [lib/functions/FunctionComposition.ts:290](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L290)

Execute multiple functions in parallel with the same input

### Type Parameters

#### T

`T`

#### R1

`R1`

#### R2

`R2`

### Parameters

#### f1

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `R1`\>

#### f2

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `R2`\>

#### options?

[`ParallelOptions`](../interfaces/ParallelOptions.md)

### Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, \[`R1`, `R2`\]\>

## Call Signature

> **parallel**\<`T`, `R1`, `R2`, `R3`\>(`f1`, `f2`, `f3`, `options?`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, \[`R1`, `R2`, `R3`\]\>

Defined in: [lib/functions/FunctionComposition.ts:296](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L296)

Execute multiple functions in parallel with the same input

### Type Parameters

#### T

`T`

#### R1

`R1`

#### R2

`R2`

#### R3

`R3`

### Parameters

#### f1

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `R1`\>

#### f2

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `R2`\>

#### f3

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `R3`\>

#### options?

[`ParallelOptions`](../interfaces/ParallelOptions.md)

### Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, \[`R1`, `R2`, `R3`\]\>

## Call Signature

> **parallel**\<`T`, `R1`, `R2`, `R3`, `R4`\>(`f1`, `f2`, `f3`, `f4`, `options?`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, \[`R1`, `R2`, `R3`, `R4`\]\>

Defined in: [lib/functions/FunctionComposition.ts:303](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L303)

Execute multiple functions in parallel with the same input

### Type Parameters

#### T

`T`

#### R1

`R1`

#### R2

`R2`

#### R3

`R3`

#### R4

`R4`

### Parameters

#### f1

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `R1`\>

#### f2

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `R2`\>

#### f3

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `R3`\>

#### f4

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `R4`\>

#### options?

[`ParallelOptions`](../interfaces/ParallelOptions.md)

### Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, \[`R1`, `R2`, `R3`, `R4`\]\>

## Call Signature

> **parallel**\<`T`\>(...`args`): [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `unknown`[]\>

Defined in: [lib/functions/FunctionComposition.ts:311](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L311)

Execute multiple functions in parallel with the same input

### Type Parameters

#### T

`T`

### Parameters

#### args

...([`ParallelOptions`](../interfaces/ParallelOptions.md) \| [`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `unknown`\> \| `undefined`)[]

### Returns

[`ComposableFunction`](../type-aliases/ComposableFunction.md)\<`T`, `unknown`[]\>
