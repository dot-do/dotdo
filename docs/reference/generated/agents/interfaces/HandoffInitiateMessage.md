[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / HandoffInitiateMessage

# Interface: HandoffInitiateMessage

Defined in: [agents/handoff.ts:106](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L106)

Handoff initiation message (Source -> Target)

## Extends

- [`HandoffMessageBase`](HandoffMessageBase.md)

## Properties

### context

> **context**: [`HandoffContext`](HandoffContext.md)

Defined in: [agents/handoff.ts:113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L113)

Full context to transfer

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

### priority?

> `optional` **priority**: `number`

Defined in: [agents/handoff.ts:115](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L115)

Priority level (lower = higher priority)

***

### reason

> **reason**: [`HandoffReason`](../type-aliases/HandoffReason.md)

Defined in: [agents/handoff.ts:109](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L109)

Why this handoff is being made

***

### reasonDescription?

> `optional` **reasonDescription**: `string`

Defined in: [agents/handoff.ts:111](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L111)

Human-readable description

***

### recipientId

> **recipientId**: `string`

Defined in: [agents/handoff.ts:94](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L94)

Recipient agent ID

#### Inherited from

[`HandoffMessageBase`](HandoffMessageBase.md).[`recipientId`](HandoffMessageBase.md#recipientid)

***

### requireAck?

> `optional` **requireAck**: `boolean`

Defined in: [agents/handoff.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L119)

Whether target must acknowledge before proceeding

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

### timeoutMs?

> `optional` **timeoutMs**: `number`

Defined in: [agents/handoff.ts:117](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L117)

Timeout in milliseconds

***

### timestamp

> **timestamp**: `Date`

Defined in: [agents/handoff.ts:96](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L96)

Message timestamp

#### Inherited from

[`HandoffMessageBase`](HandoffMessageBase.md).[`timestamp`](HandoffMessageBase.md#timestamp)

***

### type

> **type**: `"handoff:initiate"`

Defined in: [agents/handoff.ts:107](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L107)

Message type identifier

#### Overrides

[`HandoffMessageBase`](HandoffMessageBase.md).[`type`](HandoffMessageBase.md#type)
