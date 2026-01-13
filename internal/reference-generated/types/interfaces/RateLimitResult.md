[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / RateLimitResult

# Interface: RateLimitResult

Defined in: [types/WorkflowContext.ts:833](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L833)

Result from rate limit check/consume operations

## Properties

### limit?

> `optional` **limit**: `number`

Defined in: [types/WorkflowContext.ts:841](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L841)

Optional: Limit that was checked

***

### remaining

> **remaining**: `number`

Defined in: [types/WorkflowContext.ts:837](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L837)

Remaining quota in the current window

***

### resetAt?

> `optional` **resetAt**: `number`

Defined in: [types/WorkflowContext.ts:839](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L839)

Optional: When the limit resets (epoch ms)

***

### success

> **success**: `boolean`

Defined in: [types/WorkflowContext.ts:835](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L835)

Whether the action is allowed
