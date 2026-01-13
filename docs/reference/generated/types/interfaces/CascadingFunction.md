[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / CascadingFunction

# Interface: CascadingFunction()\<Output, Input\>

Defined in: [types/AIFunction.ts:820](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L820)

Function that can fallback through execution methods

## Type Parameters

### Output

`Output`

### Input

`Input` = `unknown`

> **CascadingFunction**(`input`): `Promise`\<[`ExecutionResult`](ExecutionResult.md)\<`Output`, [`ExecutionMetrics`](ExecutionMetrics.md)\>\>

Defined in: [types/AIFunction.ts:822](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L822)

Execute with cascade (code -> generative -> agentic -> human)

## Parameters

### input

`Input`

## Returns

`Promise`\<[`ExecutionResult`](ExecutionResult.md)\<`Output`, [`ExecutionMetrics`](ExecutionMetrics.md)\>\>

## Methods

### getCascade()

> **getCascade**(): [`FunctionType`](../type-aliases/FunctionType.md)[]

Defined in: [types/AIFunction.ts:824](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L824)

Get the cascade configuration

#### Returns

[`FunctionType`](../type-aliases/FunctionType.md)[]

***

### setCascade()

> **setCascade**(`order`): `CascadingFunction`\<`Output`, `Input`\>

Defined in: [types/AIFunction.ts:826](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L826)

Set cascade order

#### Parameters

##### order

[`FunctionType`](../type-aliases/FunctionType.md)[]

#### Returns

`CascadingFunction`\<`Output`, `Input`\>
