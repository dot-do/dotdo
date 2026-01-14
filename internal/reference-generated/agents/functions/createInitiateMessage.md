[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createInitiateMessage

# Function: createInitiateMessage()

> **createInitiateMessage**(`handoffId`, `sourceAgentId`, `targetAgentId`, `reason`, `context`, `options`): [`HandoffInitiateMessage`](../interfaces/HandoffInitiateMessage.md)

Defined in: [agents/handoff.ts:924](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L924)

Create a handoff initiation message

## Parameters

### handoffId

`string`

### sourceAgentId

`string`

### targetAgentId

`string`

### reason

[`HandoffReason`](../type-aliases/HandoffReason.md)

### context

[`HandoffContext`](../interfaces/HandoffContext.md)

### options

#### correlationId?

`string`

#### priority?

`number`

#### reasonDescription?

`string`

#### requireAck?

`boolean`

#### timeoutMs?

`number`

## Returns

[`HandoffInitiateMessage`](../interfaces/HandoffInitiateMessage.md)
