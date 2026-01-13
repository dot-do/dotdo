[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / FoundationAnalyzerBuilder

# Interface: FoundationAnalyzerBuilder

Defined in: [workflows/context/foundation.ts:353](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L353)

Analyzer builder - for differentiation analysis

## Methods

### competitor()

> **competitor**(`name`): `this`

Defined in: [workflows/context/foundation.ts:355](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L355)

Add competitor to analyze

#### Parameters

##### name

`string`

#### Returns

`this`

***

### discoverCompetitors()

> **discoverCompetitors**(): `Promise`\<`FoundationAnalyzerBuilder`\>

Defined in: [workflows/context/foundation.ts:357](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L357)

Use AI to discover competitors

#### Returns

`Promise`\<`FoundationAnalyzerBuilder`\>

***

### run()

> **run**(): `Promise`\<[`DifferentiationAnalysis`](DifferentiationAnalysis.md)\>

Defined in: [workflows/context/foundation.ts:361](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L361)

Run full analysis

#### Returns

`Promise`\<[`DifferentiationAnalysis`](DifferentiationAnalysis.md)\>

***

### swot()

> **swot**(): `Promise`\<\{ `opportunities`: `string`[]; `strengths`: `string`[]; `threats`: `string`[]; `weaknesses`: `string`[]; \}\>

Defined in: [workflows/context/foundation.ts:359](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L359)

Run SWOT analysis

#### Returns

`Promise`\<\{ `opportunities`: `string`[]; `strengths`: `string`[]; `threats`: `string`[]; `weaknesses`: `string`[]; \}\>
