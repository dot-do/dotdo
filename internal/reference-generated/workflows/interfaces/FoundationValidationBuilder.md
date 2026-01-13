[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / FoundationValidationBuilder

# Interface: FoundationValidationBuilder

Defined in: [workflows/context/foundation.ts:321](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L321)

Validation builder - for running validation workflow

## Methods

### minConfidence()

> **minConfidence**(`threshold`): `this`

Defined in: [workflows/context/foundation.ts:323](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L323)

Set minimum confidence threshold

#### Parameters

##### threshold

`number`

#### Returns

`this`

***

### requireInterviews()

> **requireInterviews**(`count`): `this`

Defined in: [workflows/context/foundation.ts:325](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L325)

Require N customer interviews

#### Parameters

##### count

`number`

#### Returns

`this`

***

### requireMetrics()

> **requireMetrics**(): `this`

Defined in: [workflows/context/foundation.ts:327](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L327)

Require metrics baseline

#### Returns

`this`

***

### run()

> **run**(): `Promise`\<[`ValidationResult`](ValidationResult.md)\>

Defined in: [workflows/context/foundation.ts:329](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/foundation.ts#L329)

Run validation

#### Returns

`Promise`\<[`ValidationResult`](ValidationResult.md)\>
