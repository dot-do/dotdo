[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createRejectMessage

# Function: createRejectMessage()

> **createRejectMessage**(`initiateMessage`, `rejectionReason`, `options`): [`HandoffRejectMessage`](../interfaces/HandoffRejectMessage.md)

Defined in: [agents/handoff.ts:1000](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L1000)

Create a rejection message (Target -> Source)

## Parameters

### initiateMessage

[`HandoffInitiateMessage`](../interfaces/HandoffInitiateMessage.md)

### rejectionReason

`string`

### options

#### rejectionCode?

`"custom"` \| `"error"` \| `"timeout"` \| `"busy"` \| `"unauthorized"` \| `"unsupported"`

#### suggestAlternative?

`string`

## Returns

[`HandoffRejectMessage`](../interfaces/HandoffRejectMessage.md)
