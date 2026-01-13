[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / UserContext

# Interface: UserContext

Defined in: [types/WorkflowContext.ts:83](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L83)

User context extracted from authentication.
This is passed to Durable Objects via X-User-* headers by the RPC auth middleware.

## Properties

### email?

> `optional` **email**: `string`

Defined in: [types/WorkflowContext.ts:87](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L87)

User's email address (optional)

***

### id

> **id**: `string`

Defined in: [types/WorkflowContext.ts:85](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L85)

Unique user identifier

***

### role?

> `optional` **role**: `string`

Defined in: [types/WorkflowContext.ts:89](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/WorkflowContext.ts#L89)

User's role for authorization (optional)
