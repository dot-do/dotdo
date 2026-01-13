[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / FoundationHypothesisBuilder

# Interface: FoundationHypothesisBuilder

Defined in: [workflows/context/foundation.ts:305](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L305)

Hypothesis builder - for creating/updating hypotheses

## Methods

### customer()

> **customer**(`persona`): `this`

Defined in: [workflows/context/foundation.ts:307](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L307)

Set customer persona(s)

#### Parameters

##### persona

[`CustomerPersona`](CustomerPersona.md) | [`CustomerPersona`](CustomerPersona.md)[]

#### Returns

`this`

***

### differentiation()

> **differentiation**(`diff`): `this`

Defined in: [workflows/context/foundation.ts:311](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L311)

Set differentiation

#### Parameters

##### diff

[`Differentiation`](Differentiation.md)

#### Returns

`this`

***

### problem()

> **problem**(`problem`): `this`

Defined in: [workflows/context/foundation.ts:309](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L309)

Set problem statement

#### Parameters

##### problem

[`ProblemStatement`](ProblemStatement.md)

#### Returns

`this`

***

### save()

> **save**(): `Promise`\<[`FoundingHypothesis`](FoundingHypothesis.md)\>

Defined in: [workflows/context/foundation.ts:313](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L313)

Save the hypothesis

#### Returns

`Promise`\<[`FoundingHypothesis`](FoundingHypothesis.md)\>

***

### validate()

> **validate**(): `Promise`\<[`ValidationResult`](ValidationResult.md)\>

Defined in: [workflows/context/foundation.ts:315](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L315)

Validate before saving

#### Returns

`Promise`\<[`ValidationResult`](ValidationResult.md)\>
