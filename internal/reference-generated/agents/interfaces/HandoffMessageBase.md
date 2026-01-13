[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / HandoffMessageBase

# Interface: HandoffMessageBase

Defined in: [agents/handoff.ts:86](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L86)

Base structure for all handoff protocol messages

## Extended by

- [`HandoffInitiateMessage`](HandoffInitiateMessage.md)
- [`HandoffAckMessage`](HandoffAckMessage.md)
- [`HandoffAcceptMessage`](HandoffAcceptMessage.md)
- [`HandoffRejectMessage`](HandoffRejectMessage.md)
- [`HandoffProgressMessage`](HandoffProgressMessage.md)
- [`HandoffCompleteMessage`](HandoffCompleteMessage.md)
- [`HandoffErrorMessage`](HandoffErrorMessage.md)

## Properties

### correlationId?

> `optional` **correlationId**: `string`

Defined in: [agents/handoff.ts:98](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L98)

Correlation ID for request-response tracking

***

### handoffId

> **handoffId**: `string`

Defined in: [agents/handoff.ts:90](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L90)

Unique handoff identifier this message belongs to

***

### recipientId

> **recipientId**: `string`

Defined in: [agents/handoff.ts:94](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L94)

Recipient agent ID

***

### senderId

> **senderId**: `string`

Defined in: [agents/handoff.ts:92](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L92)

Sender agent ID

***

### sequence?

> `optional` **sequence**: `number`

Defined in: [agents/handoff.ts:100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L100)

Sequence number for ordering

***

### timestamp

> **timestamp**: `Date`

Defined in: [agents/handoff.ts:96](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L96)

Message timestamp

***

### type

> **type**: [`HandoffMessageType`](../type-aliases/HandoffMessageType.md)

Defined in: [agents/handoff.ts:88](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L88)

Message type identifier
