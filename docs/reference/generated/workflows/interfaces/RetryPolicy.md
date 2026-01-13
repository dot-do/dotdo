[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / RetryPolicy

# Interface: RetryPolicy

Defined in: [workflows/runtime.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L140)

Retry policy configuration

## Properties

### backoffMultiplier

> **backoffMultiplier**: `number`

Defined in: [workflows/runtime.ts:148](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L148)

Backoff multiplier (exponential backoff)

***

### initialDelayMs

> **initialDelayMs**: `number`

Defined in: [workflows/runtime.ts:144](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L144)

Initial delay in milliseconds

***

### jitter

> **jitter**: `boolean`

Defined in: [workflows/runtime.ts:150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L150)

Whether to add jitter to delays

***

### maxAttempts

> **maxAttempts**: `number`

Defined in: [workflows/runtime.ts:142](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L142)

Maximum number of retry attempts

***

### maxDelayMs

> **maxDelayMs**: `number`

Defined in: [workflows/runtime.ts:146](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L146)

Maximum delay in milliseconds
