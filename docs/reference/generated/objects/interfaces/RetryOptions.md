[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / RetryOptions

# Interface: RetryOptions

Defined in: [lib/functions/FunctionComposition.ts:489](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L489)

## Properties

### backoff?

> `optional` **backoff**: `"fixed"` \| `"exponential"` \| `"linear"`

Defined in: [lib/functions/FunctionComposition.ts:492](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L492)

***

### delay

> **delay**: `number`

Defined in: [lib/functions/FunctionComposition.ts:491](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L491)

***

### maxAttempts

> **maxAttempts**: `number`

Defined in: [lib/functions/FunctionComposition.ts:490](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L490)

***

### maxDelay?

> `optional` **maxDelay**: `number`

Defined in: [lib/functions/FunctionComposition.ts:493](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L493)

***

### onRetry()?

> `optional` **onRetry**: (`attempt`, `error`) => `void`

Defined in: [lib/functions/FunctionComposition.ts:495](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L495)

#### Parameters

##### attempt

`number`

##### error

`Error`

#### Returns

`void`

***

### retryIf()?

> `optional` **retryIf**: (`error`) => `boolean`

Defined in: [lib/functions/FunctionComposition.ts:494](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionComposition.ts#L494)

#### Parameters

##### error

`Error`

#### Returns

`boolean`
