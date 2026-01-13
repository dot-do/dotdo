[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / SimpleAnalysisResult

# Interface: SimpleAnalysisResult

Defined in: [workflows/analyzer.ts:33](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/analyzer.ts#L33)

Simple analysis result for basic independent/dependent classification

## Properties

### dependent

> **dependent**: [`PipelinePromise`](PipelinePromise.md)\<`unknown`\>[]

Defined in: [workflows/analyzer.ts:37](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/analyzer.ts#L37)

Expressions that depend on at least one other analyzed expression

***

### independent

> **independent**: [`PipelinePromise`](PipelinePromise.md)\<`unknown`\>[]

Defined in: [workflows/analyzer.ts:35](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/analyzer.ts#L35)

Expressions with no dependencies on other analyzed expressions
