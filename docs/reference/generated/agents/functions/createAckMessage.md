[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createAckMessage

# Function: createAckMessage()

> **createAckMessage**(`initiateMessage`, `ready`, `options`): [`HandoffAckMessage`](../interfaces/HandoffAckMessage.md)

Defined in: [agents/handoff.ts:957](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L957)

Create an acknowledgment message (Target -> Source)

## Parameters

### initiateMessage

[`HandoffInitiateMessage`](../interfaces/HandoffInitiateMessage.md)

### ready

`boolean`

### options

#### estimatedProcessingMs?

`number`

#### message?

`string`

## Returns

[`HandoffAckMessage`](../interfaces/HandoffAckMessage.md)
