[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createErrorMessage

# Function: createErrorMessage()

> **createErrorMessage**(`handoffId`, `senderId`, `recipientId`, `error`, `options`): [`HandoffErrorMessage`](../interfaces/HandoffErrorMessage.md)

Defined in: [agents/handoff.ts:1083](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L1083)

Create an error message (Either -> Either)

## Parameters

### handoffId

`string`

### senderId

`string`

### recipientId

`string`

### error

`string` | `Error`

### options

#### correlationId?

`string`

#### errorCode?

`string`

#### retryable?

`boolean`

#### retryAfterMs?

`number`

## Returns

[`HandoffErrorMessage`](../interfaces/HandoffErrorMessage.md)
