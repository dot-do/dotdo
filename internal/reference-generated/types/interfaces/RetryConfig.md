[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / RetryConfig

# Interface: RetryConfig

Defined in: [types/AIFunction.ts:255](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L255)

Retry configuration for function execution

## Properties

### backoffMultiplier?

> `optional` **backoffMultiplier**: `number`

Defined in: [types/AIFunction.ts:263](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L263)

Exponential backoff multiplier

***

### initialDelayMs?

> `optional` **initialDelayMs**: `number`

Defined in: [types/AIFunction.ts:259](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L259)

Initial delay between retries in ms

***

### maxAttempts?

> `optional` **maxAttempts**: `number`

Defined in: [types/AIFunction.ts:257](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L257)

Maximum number of retry attempts

***

### maxDelayMs?

> `optional` **maxDelayMs**: `number`

Defined in: [types/AIFunction.ts:261](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L261)

Maximum delay between retries in ms

***

### noRetryOn?

> `optional` **noRetryOn**: (`string` \| `RegExp` \| (`error`) => `boolean`)[]

Defined in: [types/AIFunction.ts:267](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L267)

Errors that should not trigger a retry

***

### retryOn?

> `optional` **retryOn**: (`string` \| `RegExp` \| (`error`) => `boolean`)[]

Defined in: [types/AIFunction.ts:265](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L265)

Errors that should trigger a retry
