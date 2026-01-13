[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / HandoffResult

# Interface: HandoffResult

Defined in: [agents/handoff.ts:330](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L330)

Result of a completed handoff

## Properties

### acceptance?

> `optional` **acceptance**: [`HandoffAcceptMessage`](HandoffAcceptMessage.md)

Defined in: [agents/handoff.ts:350](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L350)

Acceptance message from target

***

### acknowledgment?

> `optional` **acknowledgment**: [`HandoffAckMessage`](HandoffAckMessage.md)

Defined in: [agents/handoff.ts:348](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L348)

Acknowledgment received from target

***

### chainedHandoff?

> `optional` **chainedHandoff**: `HandoffResult`

Defined in: [agents/handoff.ts:344](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L344)

Next handoff if target agent initiated one

***

### completedAt?

> `optional` **completedAt**: `Date`

Defined in: [agents/handoff.ts:340](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L340)

When the handoff completed

***

### durationMs?

> `optional` **durationMs**: `number`

Defined in: [agents/handoff.ts:342](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L342)

Duration of the handoff in milliseconds

***

### error?

> `optional` **error**: `Error`

Defined in: [agents/handoff.ts:338](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L338)

Error if handoff failed

***

### protocolMessages?

> `optional` **protocolMessages**: [`HandoffMessage`](../type-aliases/HandoffMessage.md)[]

Defined in: [agents/handoff.ts:354](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L354)

Protocol messages exchanged during handoff

***

### rejection?

> `optional` **rejection**: [`HandoffRejectMessage`](HandoffRejectMessage.md)

Defined in: [agents/handoff.ts:352](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L352)

Rejection message if handoff was rejected

***

### request

> **request**: `HandoffRequest`

Defined in: [agents/handoff.ts:332](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L332)

The handoff request that was executed

***

### result?

> `optional` **result**: [`AgentResult`](AgentResult.md)

Defined in: [agents/handoff.ts:336](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L336)

Result from target agent (if successful)

***

### state

> **state**: [`HandoffState`](../type-aliases/HandoffState.md)

Defined in: [agents/handoff.ts:334](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L334)

Current state of the handoff
