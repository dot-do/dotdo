[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / RetryPolicy

# Interface: RetryPolicy

Defined in: [types/WorkflowContext.ts:230](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L230)

Retry policy configuration for durable execution ($.do())

## Properties

### backoffMultiplier

> **backoffMultiplier**: `number`

Defined in: [types/WorkflowContext.ts:238](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L238)

Backoff multiplier for exponential backoff (default: 2)

***

### initialDelayMs

> **initialDelayMs**: `number`

Defined in: [types/WorkflowContext.ts:234](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L234)

Initial delay in milliseconds before first retry (default: 100)

***

### jitter

> **jitter**: `boolean`

Defined in: [types/WorkflowContext.ts:240](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L240)

Whether to add random jitter to delays (default: true)

***

### maxAttempts

> **maxAttempts**: `number`

Defined in: [types/WorkflowContext.ts:232](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L232)

Maximum number of retry attempts (default: 3)

***

### maxDelayMs

> **maxDelayMs**: `number`

Defined in: [types/WorkflowContext.ts:236](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L236)

Maximum delay in milliseconds between retries (default: 30000)
