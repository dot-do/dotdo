[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / findEmbeddedPromises

# Function: findEmbeddedPromises()

> **findEmbeddedPromises**(`value`, `allExprs`): `Set`\<[`PipelineExpression`](../type-aliases/PipelineExpression.md)\>

Defined in: [workflows/analyzer.ts:243](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/analyzer.ts#L243)

Finds embedded PipelinePromises in a value tree.

Used to detect when method arguments contain references to other
pipeline results.

## Parameters

### value

`unknown`

### allExprs

[`PipelinePromise`](../interfaces/PipelinePromise.md)\<`unknown`\>[]

## Returns

`Set`\<[`PipelineExpression`](../type-aliases/PipelineExpression.md)\>
