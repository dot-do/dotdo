[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / RateLimitCheckOptions

# Interface: RateLimitCheckOptions

Defined in: [types/WorkflowContext.ts:847](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L847)

Options for rate limit check

## Properties

### cost?

> `optional` **cost**: `number`

Defined in: [types/WorkflowContext.ts:853](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L853)

Cost of this operation (default 1)

***

### limit?

> `optional` **limit**: `number`

Defined in: [types/WorkflowContext.ts:849](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L849)

Maximum requests allowed in the window

***

### name?

> `optional` **name**: `string`

Defined in: [types/WorkflowContext.ts:855](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L855)

Named limit to use (e.g., 'api', 'auth')

***

### windowMs?

> `optional` **windowMs**: `number`

Defined in: [types/WorkflowContext.ts:851](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L851)

Window size in milliseconds
