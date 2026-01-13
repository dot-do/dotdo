[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / AnalysisResult

# Interface: AnalysisResult

Defined in: [workflows/analyzer.ts:21](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/analyzer.ts#L21)

Full analysis result with dependency graph and execution order

## Properties

### dependencies

> **dependencies**: `Map`\<[`PipelineExpression`](../type-aliases/PipelineExpression.md), `Set`\<[`PipelineExpression`](../type-aliases/PipelineExpression.md)\>\>

Defined in: [workflows/analyzer.ts:25](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/analyzer.ts#L25)

Map of each expression to the set of expressions it depends on

***

### executionOrder

> **executionOrder**: [`PipelineExpression`](../type-aliases/PipelineExpression.md)[][]

Defined in: [workflows/analyzer.ts:27](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/analyzer.ts#L27)

Groups of expressions that can run in parallel, in execution order

***

### expressions

> **expressions**: [`PipelineExpression`](../type-aliases/PipelineExpression.md)[]

Defined in: [workflows/analyzer.ts:23](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/analyzer.ts#L23)

All expressions that were analyzed
