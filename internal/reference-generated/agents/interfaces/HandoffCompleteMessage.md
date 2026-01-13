[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / HandoffCompleteMessage

# Interface: HandoffCompleteMessage

Defined in: [agents/handoff.ts:182](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L182)

Handoff completion message (Target -> Source)
Confirms successful completion with results

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

### durationMs

> **durationMs**: `number`

Defined in: [agents/handoff.ts:187](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L187)

Duration of processing in milliseconds

***

### followUp?

> `optional` **followUp**: `object`

Defined in: [agents/handoff.ts:191](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L191)

Any follow-up actions needed

#### instructions?

> `optional` **instructions**: `string`

Instructions for next steps

#### needsHandoff?

> `optional` **needsHandoff**: `boolean`

Whether another handoff is needed

#### suggestedAgent?

> `optional` **suggestedAgent**: `string`

Suggested next agent

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

### result

> **result**: [`AgentResult`](AgentResult.md)

Defined in: [agents/handoff.ts:185](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L185)

Final result from target agent

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

### summary?

> `optional` **summary**: `string`

Defined in: [agents/handoff.ts:189](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L189)

Completion summary

***

### timestamp

> **timestamp**: `Date`

Defined in: [agents/handoff.ts:96](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L96)

Message timestamp

#### Inherited from

[`HandoffMessageBase`](HandoffMessageBase.md).[`timestamp`](HandoffMessageBase.md#timestamp)

***

### type

> **type**: `"handoff:complete"`

Defined in: [agents/handoff.ts:183](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L183)

Message type identifier

#### Overrides

[`HandoffMessageBase`](HandoffMessageBase.md).[`type`](HandoffMessageBase.md#type)
