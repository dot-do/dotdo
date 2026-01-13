[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / HandoffRejectMessage

# Interface: HandoffRejectMessage

Defined in: [agents/handoff.ts:152](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L152)

Handoff rejection message (Target -> Source)
Indicates target cannot or will not handle the handoff

## Extends

- [`HandoffMessageBase`](HandoffMessageBase.md)

## Properties

### correlationId?

> `optional` **correlationId**: `string`

Defined in: [agents/handoff.ts:98](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L98)

Correlation ID for request-response tracking

#### Inherited from

[`HandoffMessageBase`](HandoffMessageBase.md).[`correlationId`](HandoffMessageBase.md#correlationid)

***

### handoffId

> **handoffId**: `string`

Defined in: [agents/handoff.ts:90](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L90)

Unique handoff identifier this message belongs to

#### Inherited from

[`HandoffMessageBase`](HandoffMessageBase.md).[`handoffId`](HandoffMessageBase.md#handoffid)

***

### recipientId

> **recipientId**: `string`

Defined in: [agents/handoff.ts:94](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L94)

Recipient agent ID

#### Inherited from

[`HandoffMessageBase`](HandoffMessageBase.md).[`recipientId`](HandoffMessageBase.md#recipientid)

***

### rejectionCode?

> `optional` **rejectionCode**: `"custom"` \| `"error"` \| `"timeout"` \| `"busy"` \| `"unauthorized"` \| `"unsupported"`

Defined in: [agents/handoff.ts:157](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L157)

Rejection code for programmatic handling

***

### rejectionReason

> **rejectionReason**: `string`

Defined in: [agents/handoff.ts:155](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L155)

Reason for rejection

***

### senderId

> **senderId**: `string`

Defined in: [agents/handoff.ts:92](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L92)

Sender agent ID

#### Inherited from

[`HandoffMessageBase`](HandoffMessageBase.md).[`senderId`](HandoffMessageBase.md#senderid)

***

### sequence?

> `optional` **sequence**: `number`

Defined in: [agents/handoff.ts:100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L100)

Sequence number for ordering

#### Inherited from

[`HandoffMessageBase`](HandoffMessageBase.md).[`sequence`](HandoffMessageBase.md#sequence)

***

### suggestAlternative?

> `optional` **suggestAlternative**: `string`

Defined in: [agents/handoff.ts:159](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L159)

Suggested alternative agent ID if available

***

### timestamp

> **timestamp**: `Date`

Defined in: [agents/handoff.ts:96](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L96)

Message timestamp

#### Inherited from

[`HandoffMessageBase`](HandoffMessageBase.md).[`timestamp`](HandoffMessageBase.md#timestamp)

***

### type

> **type**: `"handoff:reject"`

Defined in: [agents/handoff.ts:153](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L153)

Message type identifier

#### Overrides

[`HandoffMessageBase`](HandoffMessageBase.md).[`type`](HandoffMessageBase.md#type)
