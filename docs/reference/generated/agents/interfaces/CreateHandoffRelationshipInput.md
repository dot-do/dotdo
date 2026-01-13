[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / CreateHandoffRelationshipInput

# Interface: CreateHandoffRelationshipInput

Defined in: agents/handoff-chain.ts:68

Input for creating a handoff relationship

## Properties

### context?

> `optional` **context**: `HandoffContext`

Defined in: agents/handoff-chain.ts:78

Context to transfer

***

### conversationId?

> `optional` **conversationId**: `string`

Defined in: agents/handoff-chain.ts:80

Conversation/task ID this handoff belongs to

***

### from

> **from**: `string`

Defined in: agents/handoff-chain.ts:70

Source agent $id (the agent handing off)

***

### reason

> **reason**: `HandoffReason`

Defined in: agents/handoff-chain.ts:74

Reason for the handoff

***

### reasonDescription?

> `optional` **reasonDescription**: `string`

Defined in: agents/handoff-chain.ts:76

Human-readable reason description

***

### to

> **to**: `string`

Defined in: agents/handoff-chain.ts:72

Target agent $id (the agent receiving)
