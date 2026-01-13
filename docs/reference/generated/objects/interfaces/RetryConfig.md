[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / RetryConfig

# Interface: RetryConfig

Defined in: [lib/executors/BaseFunctionExecutor.ts:79](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L79)

## Properties

### backoff?

> `optional` **backoff**: `"fixed"` \| `"exponential"` \| `"exponential-jitter"` \| `"linear"`

Defined in: [lib/executors/BaseFunctionExecutor.ts:82](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L82)

***

### delay

> **delay**: `number`

Defined in: [lib/executors/BaseFunctionExecutor.ts:81](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L81)

***

### increment?

> `optional` **increment**: `number`

Defined in: [lib/executors/BaseFunctionExecutor.ts:83](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L83)

***

### maxAttempts

> **maxAttempts**: `number`

Defined in: [lib/executors/BaseFunctionExecutor.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L80)

***

### maxDelay?

> `optional` **maxDelay**: `number`

Defined in: [lib/executors/BaseFunctionExecutor.ts:84](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L84)

***

### onRetry()?

> `optional` **onRetry**: (`info`) => `void`

Defined in: [lib/executors/BaseFunctionExecutor.ts:87](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L87)

#### Parameters

##### info

###### attempt

`number`

###### delay

`number`

###### error

`Error`

#### Returns

`void`

***

### retryIf()?

> `optional` **retryIf**: (`error`) => `boolean`

Defined in: [lib/executors/BaseFunctionExecutor.ts:85](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L85)

#### Parameters

##### error

`Error`

#### Returns

`boolean`

***

### retryOnTimeout?

> `optional` **retryOnTimeout**: `boolean`

Defined in: [lib/executors/BaseFunctionExecutor.ts:86](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L86)
