[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / HandoffAcceptMessage

# Interface: HandoffAcceptMessage

Defined in: [agents/handoff.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L140)

Handoff acceptance message (Target -> Source)
Confirms that target has accepted and will process the handoff

## Extends

- [`HandoffMessageBase`](HandoffMessageBase.md)

## Properties

### acceptedAt

> **acceptedAt**: `Date`

Defined in: [agents/handoff.ts:145](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L145)

Accepted at timestamp (may differ from message timestamp)

***

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

### message?

> `optional` **message**: `string`

Defined in: [agents/handoff.ts:143](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L143)

Optional message from target

***

### recipientId

> **recipientId**: `string`

Defined in: [agents/handoff.ts:94](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L94)

Recipient agent ID

#### Inherited from

[`HandoffMessageBase`](HandoffMessageBase.md).[`recipientId`](HandoffMessageBase.md#recipientid)

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

### timestamp

> **timestamp**: `Date`

Defined in: [agents/handoff.ts:96](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L96)

Message timestamp

#### Inherited from

[`HandoffMessageBase`](HandoffMessageBase.md).[`timestamp`](HandoffMessageBase.md#timestamp)

***

### type

> **type**: `"handoff:accept"`

Defined in: [agents/handoff.ts:141](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L141)

Message type identifier

#### Overrides

[`HandoffMessageBase`](HandoffMessageBase.md).[`type`](HandoffMessageBase.md#type)
