[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / FoundationBuilder

# Interface: FoundationBuilder

Defined in: [workflows/context/foundation.ts:262](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L262)

FoundationBuilder - Fluent builder for Foundation Sprint workflow

## Methods

### analyze()

> **analyze**(): [`FoundationAnalyzerBuilder`](FoundationAnalyzerBuilder.md)

Defined in: [workflows/context/foundation.ts:294](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L294)

Run differentiation analysis

#### Returns

[`FoundationAnalyzerBuilder`](FoundationAnalyzerBuilder.md)

***

### get()

> **get**(`id`): `Promise`\<[`FoundingHypothesis`](FoundingHypothesis.md) \| `null`\>

Defined in: [workflows/context/foundation.ts:273](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L273)

Access existing hypothesis by ID

#### Parameters

##### id

`string`

Hypothesis ID

#### Returns

`Promise`\<[`FoundingHypothesis`](FoundingHypothesis.md) \| `null`\>

***

### hypothesis()

> **hypothesis**(`hypothesis`): [`FoundationHypothesisBuilder`](FoundationHypothesisBuilder.md)

Defined in: [workflows/context/foundation.ts:267](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L267)

Capture or update the founding hypothesis

#### Parameters

##### hypothesis

`Partial`\<[`FoundingHypothesis`](FoundingHypothesis.md)\>

The hypothesis definition or update

#### Returns

[`FoundationHypothesisBuilder`](FoundationHypothesisBuilder.md)

***

### interview()

> **interview**(`customer`): [`FoundationInterviewBuilder`](FoundationInterviewBuilder.md)

Defined in: [workflows/context/foundation.ts:289](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L289)

Schedule or conduct customer interview

#### Parameters

##### customer

Customer identifier or persona

`string` | [`CustomerPersona`](CustomerPersona.md)

#### Returns

[`FoundationInterviewBuilder`](FoundationInterviewBuilder.md)

***

### list()

> **list**(): `Promise`\<[`FoundingHypothesis`](FoundingHypothesis.md)[]\>

Defined in: [workflows/context/foundation.ts:278](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L278)

List all hypotheses

#### Returns

`Promise`\<[`FoundingHypothesis`](FoundingHypothesis.md)[]\>

***

### metrics()

> **metrics**(): [`FoundationMetricsBuilder`](FoundationMetricsBuilder.md)

Defined in: [workflows/context/foundation.ts:299](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L299)

Access or establish HUNCH metrics

#### Returns

[`FoundationMetricsBuilder`](FoundationMetricsBuilder.md)

***

### validate()

> **validate**(): [`FoundationValidationBuilder`](FoundationValidationBuilder.md)

Defined in: [workflows/context/foundation.ts:283](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L283)

Run validation workflow on current hypothesis

#### Returns

[`FoundationValidationBuilder`](FoundationValidationBuilder.md)
